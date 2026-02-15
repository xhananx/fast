/* ============================================
   HybridSpeed - Speed Test Engine
   Real Network Measurement Implementation
   ============================================ */

'use strict';

/**
 * SpeedTest Engine
 * Measures download/upload speed and latency using real network requests
 * 
 * IMPORTANT: This requires server endpoints to function properly.
 * See documentation for server setup requirements.
 */
class SpeedTest {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || SpeedTest.getDefaultBaseUrl();
        this.debug = !!options.debug || !!(typeof window !== 'undefined' && window.HYBRIDSPEED_DEBUG);

        // Configuration
        this.config = {
            // Server endpoints (configure these for your server)
            endpoints: {
                health: SpeedTest.toAbsolute(options.healthUrl || '/api/speed/health', this.baseUrl),
                ping: SpeedTest.toAbsolute(options.pingUrl || '/api/speed/ping', this.baseUrl),
                download: SpeedTest.toAbsolute(options.downloadUrl || '/api/speed/download', this.baseUrl),
                upload: SpeedTest.toAbsolute(options.uploadUrl || '/api/speed/upload', this.baseUrl),
            },

            // Health check
            health: {
                timeout: 4000,
            },

            // Test parameters
            ping: {
                count: 10,           // Number of ping samples
                warmup: 2,           // Discard first N samples
                timeout: 5000,       // Timeout per request (ms)
            },

            download: {
                duration: 10000,     // Test duration (ms)
                warmupTime: 2000,    // Warmup period (ms)
                minChunkSize: 100 * 1024,      // 100 KB
                maxChunkSize: 25 * 1024 * 1024, // 25 MB
                parallelStreams: 4,  // Concurrent connections
                requestTimeout: 15000, // Timeout per chunk request (ms)
            },

            upload: {
                duration: 10000,     // Test duration (ms)
                warmupTime: 2000,    // Warmup period (ms)
                chunkSize: 1 * 1024 * 1024,    // 1 MB per chunk
                parallelStreams: 3,  // Concurrent connections
                requestTimeout: 12000, // Timeout per chunk request (ms)
            },

            ...options.config,
        };

        // Flags
        this.shouldCheckHealth = options.skipHealthCheck !== true;
        this.measurementFlags = { ping: false, download: false, upload: false };

        // State
        this.state = {
            phase: 'idle', // idle, checking_server, running_ping, running_download, running_upload, completed, error
            progress: 0,
            aborted: false,
        };

        // Results storage
        this.results = {
            ping: { avg: 0, min: 0, max: 0, jitter: 0, samples: [] },
            download: { speed: 0, samples: [], bytesLoaded: 0 },
            upload: { speed: 0, samples: [], bytesLoaded: 0 },
        };

        // Event callbacks
        this.callbacks = {
            onProgress: options.onProgress || (() => { }),
            onPhaseChange: options.onPhaseChange || (() => { }),
            onSpeedUpdate: options.onSpeedUpdate || (() => { }),
            onMetricUpdate: options.onMetricUpdate || (() => { }),
            onComplete: options.onComplete || (() => { }),
            onError: options.onError || (() => { }),
        };

        // Abort controller for cancellation
        this.abortController = null;

        // Pre-generate upload data once (reused across all upload streams)
        this._uploadBlob = null;

        // Auto-tune from navigator.connection if available
        this._autoTuned = false;
    }

    /**
     * Auto-tune test parameters based on navigator.connection API
     */
    _autoTune() {
        if (this._autoTuned) return;
        this._autoTuned = true;
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return;

        const effectiveType = conn.effectiveType; // 'slow-2g', '2g', '3g', '4g'
        const downlink = conn.downlink; // Mbps estimate

        if (effectiveType === '4g' && downlink > 50) {
            // Fast connection: use larger chunks and more streams
            this.config.download.parallelStreams = Math.min(this.config.download.parallelStreams + 2, 8);
            this.config.download.maxChunkSize = 50 * 1024 * 1024;
            this.config.upload.chunkSize = 2 * 1024 * 1024;
            this.config.upload.parallelStreams = Math.min(this.config.upload.parallelStreams + 1, 6);
        } else if (effectiveType === '3g' || (downlink && downlink < 5)) {
            // Slow connection: use smaller chunks
            this.config.download.parallelStreams = 2;
            this.config.download.maxChunkSize = 5 * 1024 * 1024;
            this.config.upload.chunkSize = 256 * 1024;
            this.config.upload.parallelStreams = 2;
        }

        this.logDebug('Auto-tuned from navigator.connection', { effectiveType, downlink });
    }

    // ==================== PUBLIC API ====================

    /**
     * Start the complete speed test
     * Runs: Ping → Download → Upload
     */
    async start() {
        if (this.state.phase !== 'idle') {
            throw new Error('Test already running');
        }

        this.state.aborted = false;
        this.abortController = new AbortController();

        // Auto-tune based on connection info
        this._autoTune();

        try {
            // Optional health check before any UI movement
            if (this.shouldCheckHealth) {
                this.setPhase('checking_server');
                await this.checkHealth();
            }

            // Phase 1: Ping Test
            await this.runPingTest();
            if (this.state.aborted) return this.getResults();

            // Phase 2: Download Test
            await this.runDownloadTest();
            if (this.state.aborted) return this.getResults();

            // Phase 3: Upload Test
            await this.runUploadTest();
            if (this.state.aborted) return this.getResults();

            // Complete
            this.setPhase('completed');
            this.callbacks.onComplete(this.getResults());

        } catch (error) {
            if (!this.state.aborted) {
                this.setPhase('error');
                this.callbacks.onError(error);
                throw error;
            }
        }

        return this.getResults();
    }

    /**
     * Pre-flight health check to verify backend availability
     */
    async checkHealth(timeout = this.config.health?.timeout || 4000) {
        try {
            const response = await this.fetchWithTimeout(this.addCacheBuster(this.config.endpoints.health || this.config.endpoints.ping), {
                method: 'GET',
                cache: 'no-store',
            }, timeout);

            if (!response.ok) {
                throw new Error(`Health endpoint returned ${response.status}`);
            }

            const payload = await response.json().catch(() => ({}));
            this.logDebug('Health response', payload);
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'ok') && payload.ok === false) {
                throw new Error('Health check responded with ok=false');
            }

            return true;
        } catch (err) {
            throw new Error(`Health check failed: ${err.message || err}`);
        }
    }

    /**
     * Abort the current test
     */
    abort() {
        this.state.aborted = true;
        if (this.abortController) {
            this.abortController.abort();
        }
        this.setPhase('idle');
    }

    /**
     * Get current results
     */
    getResults() {
        return {
            ping: this.results.ping.avg,
            jitter: this.results.ping.jitter,
            download: this.results.download.speed,
            upload: this.results.upload.speed,
            details: { ...this.results },
        };
    }

    // ==================== PING TEST ====================

    async runPingTest() {
        this.setPhase('running_ping');
        const { count, warmup, timeout } = this.config.ping;
        const samples = [];

        for (let i = 0; i < count; i++) {
            if (this.state.aborted) return;

            try {
                const latency = await this.measurePing(timeout);
                samples.push(latency);
                this.logDebug('Ping sample', { latency });

                const reportableSamples = samples.slice(warmup);
                if (reportableSamples.length > 0) {
                    const stats = this.calculatePingStats(reportableSamples);
                    this.callbacks.onMetricUpdate({
                        phase: 'running_ping',
                        ping: stats.avg,
                        jitter: stats.jitter,
                        sample: Math.round(latency),
                        samples: reportableSamples.length,
                    });
                    this.callbacks.onSpeedUpdate({
                        phase: 'running_ping',
                        speed: stats.avg,
                        samples: reportableSamples.length,
                    });
                }

                // Update progress
                this.updateProgress((i + 1) / count * 20); // Ping is 0-20%

            } catch (error) {
                if (this.state.aborted || (this.abortController && this.abortController.signal.aborted)) {
                    return;
                }
                console.warn('Ping sample failed:', error);
                // Continue with other samples
            }
        }

        // Calculate results (excluding warmup samples)
        const validSamples = samples.slice(warmup);
        if (!validSamples.length) {
            throw new Error('Ping test failed: no valid samples collected');
        }

        this.measurementFlags.ping = true;
        this.results.ping = this.calculatePingStats(validSamples);
    }

    /**
     * Measure single ping (round-trip time)
     */
    async measurePing(timeout) {
        const url = this.addCacheBuster(this.config.endpoints.ping);
        const start = performance.now();

        const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            cache: 'no-store',
        }, timeout);

        if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`);
        }

        // Consume response to ensure request is complete
        await response.text();

        const end = performance.now();
        return end - start;
    }

    /**
     * Calculate ping statistics
     */
    calculatePingStats(samples) {
        const sorted = [...samples].sort((a, b) => a - b);
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];

        // Jitter: average deviation from mean
        const jitter = samples.reduce((sum, s) => sum + Math.abs(s - avg), 0) / samples.length;

        return {
            avg: Math.round(avg),
            min: Math.round(min),
            max: Math.round(max),
            jitter: Math.round(jitter * 10) / 10,
            samples,
        };
    }

    // ==================== DOWNLOAD TEST ====================

    async runDownloadTest() {
        this.setPhase('running_download');
        const { duration, warmupTime, parallelStreams, minChunkSize, maxChunkSize } = this.config.download;

        const startTime = performance.now();
        const samples = [];
        let totalBytes = 0;
        let currentChunkSize = minChunkSize;
        let warmupComplete = false;
        let phaseStopRequested = false;

        // Active download streams
        const activeStreams = new Set();

        // Start parallel download streams
        const downloadLoop = async (streamId) => {
            while (!this.state.aborted && !phaseStopRequested) {
                const elapsed = performance.now() - startTime;

                // Check if test duration exceeded
                if (elapsed > duration) break;

                try {
                    const { bytes, time } = await this.downloadChunk(currentChunkSize);
                    totalBytes += bytes;

                    const currentElapsed = performance.now() - startTime;

                    // After warmup, start recording samples
                    if (currentElapsed > warmupTime) {
                        if (!warmupComplete) {
                            warmupComplete = true;
                            totalBytes = bytes; // Reset after warmup
                        }

                        // Calculate instantaneous speed
                        const speedMbps = (bytes * 8) / (time / 1000) / 1_000_000;
                        samples.push({ speed: speedMbps, time: currentElapsed, bytes });
                        this.logDebug('Download sample', { bytes, time, speedMbps, currentElapsed });

                        // Update speed display with moving average
                        this.updateDownloadSpeed(samples);
                    }

                    // Adaptive chunk sizing (increase if fast)
                    if (time < 500 && currentChunkSize < maxChunkSize) {
                        currentChunkSize = Math.min(currentChunkSize * 2, maxChunkSize);
                    }

                    // Update progress (20-60% of total)
                    const progress = Math.min((currentElapsed / duration) * 40, 40);
                    this.updateProgress(20 + progress);

                } catch (error) {
                    if (this.state.aborted || phaseStopRequested) break;
                    console.warn('Download chunk failed:', error);
                }
            }

            activeStreams.delete(streamId);
        };

        // Start parallel streams
        for (let i = 0; i < parallelStreams; i++) {
            activeStreams.add(i);
            downloadLoop(i);
        }

        // Wait for duration or external cancellation
        while (!this.state.aborted && (performance.now() - startTime) < duration) {
            await this.sleep(100);
        }
        phaseStopRequested = true;

        // Wait for all streams to finish
        while (activeStreams.size > 0) {
            await this.sleep(50);
        }

        if (this.state.aborted) return;

        // Calculate final speed from samples after warmup
        if (!samples.length) {
            throw new Error('Download test failed: no data received');
        }

        const speeds = samples.map(s => s.speed);
        // Use 90th percentile for stability
        const sorted = [...speeds].sort((a, b) => a - b);
        const p90Index = Math.floor(sorted.length * 0.9);
        this.results.download.speed = Math.round(sorted[p90Index] * 10) / 10;
        this.results.download.samples = samples;
        this.results.download.bytesLoaded = totalBytes;
        this.measurementFlags.download = true;
    }

    /**
     * Download a single chunk
     */
    async downloadChunk(size) {
        const url = this.addCacheBuster(`${this.config.endpoints.download}?size=${size}`);
        const start = performance.now();
        const timeout = this.config.download?.requestTimeout || 15000;

        const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            cache: 'no-store',
            signal: this.abortController.signal,
        }, timeout);

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        // Read response body
        const buffer = await response.arrayBuffer();
        const end = performance.now();

        return {
            bytes: buffer.byteLength,
            time: end - start,
        };
    }

    /**
     * Update download speed with moving average
     */
    updateDownloadSpeed(samples) {
        if (samples.length < 3) return;

        // Use last 5 samples for smoothing
        const recent = samples.slice(-5);
        const avgSpeed = recent.reduce((a, b) => a + b.speed, 0) / recent.length;

        this.callbacks.onSpeedUpdate({
            phase: 'running_download',
            speed: Math.round(avgSpeed * 10) / 10,
            samples: samples.length,
        });
    }

    // ==================== UPLOAD TEST ====================

    async runUploadTest() {
        this.setPhase('running_upload');
        performance.mark('hybridspeed-upload-start');
        const { duration, warmupTime, parallelStreams, chunkSize } = this.config.upload;

        const startTime = performance.now();
        const samples = [];
        let totalBytes = 0;
        let warmupComplete = false;
        let phaseStopRequested = false;

        // Use pre-cached upload data or generate once
        if (!this._uploadBlob || this._uploadBlob.size !== chunkSize) {
            this._uploadBlob = this.generateUploadData(chunkSize);
        }
        const uploadData = this._uploadBlob;

        // Active upload streams
        const activeStreams = new Set();

        // Upload loop
        const uploadLoop = async (streamId) => {
            while (!this.state.aborted && !phaseStopRequested) {
                const elapsed = performance.now() - startTime;

                // Check if test duration exceeded
                if (elapsed > duration) break;

                try {
                    const { bytes, time } = await this.uploadChunk(uploadData);
                    totalBytes += bytes;

                    const currentElapsed = performance.now() - startTime;

                    // After warmup, record samples
                    if (currentElapsed > warmupTime) {
                        if (!warmupComplete) {
                            warmupComplete = true;
                            totalBytes = bytes;
                        }

                        const speedMbps = (bytes * 8) / (time / 1000) / 1_000_000;
                        samples.push({ speed: speedMbps, time: currentElapsed, bytes });

                        this.updateUploadSpeed(samples);
                        this.logDebug('Upload sample', { bytes, time, speedMbps, currentElapsed });
                    }

                    // Update progress (60-100% of total)
                    const progress = Math.min((currentElapsed / duration) * 40, 40);
                    this.updateProgress(60 + progress);

                } catch (error) {
                    if (this.state.aborted || phaseStopRequested) break;
                    console.warn('Upload chunk failed:', error);
                }
            }

            activeStreams.delete(streamId);
        };

        // Start parallel streams
        for (let i = 0; i < parallelStreams; i++) {
            activeStreams.add(i);
            uploadLoop(i);
        }

        // Wait for duration or external cancellation
        while (!this.state.aborted && (performance.now() - startTime) < duration) {
            await this.sleep(100);
        }
        phaseStopRequested = true;

        // Wait for streams
        while (activeStreams.size > 0) {
            await this.sleep(50);
        }

        if (this.state.aborted) return;

        // Calculate final speed
        if (!samples.length) {
            throw new Error('Upload test failed: no data sent');
        }

        const speeds = samples.map(s => s.speed);
        const sorted = [...speeds].sort((a, b) => a - b);
        const p90Index = Math.floor(sorted.length * 0.9);
        this.results.upload.speed = Math.round(sorted[p90Index] * 10) / 10;
        this.results.upload.samples = samples;
        this.results.upload.bytesLoaded = totalBytes;
        this.measurementFlags.upload = true;
    }

    /**
     * Upload a single chunk
     */
    async uploadChunk(data) {
        const url = this.addCacheBuster(this.config.endpoints.upload);
        const start = performance.now();
        const timeout = this.config.upload?.requestTimeout || 12000;

        const response = await this.fetchWithTimeout(url, {
            method: 'POST',
            body: data,
            headers: {
                'Content-Type': 'application/octet-stream',
            },
            signal: this.abortController.signal,
        }, timeout);

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }

        await response.text();
        const end = performance.now();

        return {
            bytes: data.byteLength || data.size,
            time: end - start,
        };
    }

    /**
     * Generate random data for upload
     */
    generateUploadData(size) {
        const buffer = new ArrayBuffer(size);
        const view = new Uint8Array(buffer);

        // Fill with random data (use crypto for speed)
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            // getRandomValues caps at 65,536 bytes per call; fill in chunks
            const chunk = 65_536;
            for (let offset = 0; offset < view.length; offset += chunk) {
                crypto.getRandomValues(view.subarray(offset, Math.min(offset + chunk, view.length)));
            }
        } else {
            for (let i = 0; i < size; i++) {
                view[i] = Math.floor(Math.random() * 256);
            }
        }

        return new Blob([buffer]);
    }

    /**
     * Update upload speed with moving average
     */
    updateUploadSpeed(samples) {
        if (samples.length < 3) return;

        const recent = samples.slice(-5);
        const avgSpeed = recent.reduce((a, b) => a + b.speed, 0) / recent.length;

        this.callbacks.onSpeedUpdate({
            phase: 'running_upload',
            speed: Math.round(avgSpeed * 10) / 10,
            samples: samples.length,
        });
    }

    // ==================== UTILITIES ====================

    setPhase(phase) {
        this.state.phase = phase;
        this.callbacks.onPhaseChange(phase);
    }

    updateProgress(progress) {
        this.state.progress = Math.round(progress);
        this.callbacks.onProgress(this.state.progress);
    }

    addCacheBuster(url) {
        const target = new URL(url, this.baseUrl);
        target.searchParams.set('_', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        return target.toString();
    }

    async fetchWithTimeout(url, options = {}, timeoutMs = 0) {
        const controller = new AbortController();
        const externalSignal = options.signal || null;
        const abortSignal = this.abortController ? this.abortController.signal : null;
        let timer = null;
        let timedOut = false;

        const handleExternalAbort = () => controller.abort(externalSignal ? externalSignal.reason : undefined);
        const handleAbort = () => controller.abort(abortSignal ? abortSignal.reason : undefined);

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort(externalSignal.reason);
            } else {
                externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
            }
        }

        if (!controller.signal.aborted && abortSignal) {
            if (abortSignal.aborted) {
                controller.abort(abortSignal.reason);
            } else {
                abortSignal.addEventListener('abort', handleAbort, { once: true });
            }
        }

        if (!controller.signal.aborted && timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        }

        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
            if (timedOut) {
                const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
                timeoutError.name = 'TimeoutError';
                throw timeoutError;
            }
            throw error;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
            if (externalSignal) {
                externalSignal.removeEventListener('abort', handleExternalAbort);
            }
            if (abortSignal) {
                abortSignal.removeEventListener('abort', handleAbort);
            }
        }
    }

    logDebug(message, meta) {
        if (!this.debug) return;
        /* eslint-disable no-console */
        console.debug(`[HybridSpeed] ${message}`, meta || '');
        /* eslint-enable no-console */
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Reset state for new test
     */
    reset() {
        this.state = {
            phase: 'idle',
            progress: 0,
            aborted: false,
        };
        this.results = {
            ping: { avg: 0, min: 0, max: 0, jitter: 0, samples: [] },
            download: { speed: 0, samples: [], bytesLoaded: 0 },
            upload: { speed: 0, samples: [], bytesLoaded: 0 },
        };
    }

    // Determine a sensible default base URL for browser file:// or hosted contexts
    static getDefaultBaseUrl() {
        try {
            if (typeof window !== 'undefined' && window.HYBRIDSPEED_API_BASE) {
                return window.HYBRIDSPEED_API_BASE;
            }
            const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
            if (origin && origin !== 'null' && !origin.startsWith('file:')) {
                return origin;
            }
        } catch (err) {
            // ignore
        }
        // Fallback to localhost server
        return 'http://localhost:3000';
    }

    /**
     * Resolve a possibly relative path to an absolute URL based on base
     */
    static toAbsolute(pathOrUrl, base) {
        try {
            return new URL(pathOrUrl, base).toString();
        } catch (err) {
            return pathOrUrl;
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpeedTest;
}
