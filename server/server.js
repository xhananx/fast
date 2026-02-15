/* ============================================
   HybridSpeed - Speed Test Server
   Node.js Express Backend for Speed Testing
   Enhanced with compression & pre-allocated buffers
   ============================================ */

const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BROWSER_HOST = (HOST === '0.0.0.0' || HOST === '::') ? 'localhost' : HOST;
const SERVER_LOCATION = process.env.SERVER_LOCATION || 'HybridSpeed Node';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const resolvedCorsOrigin = CORS_ORIGIN === '*'
    ? '*'
    : CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
const NO_CACHE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
};
const DOWNLOAD_SIZE_OPTIONS = [200 * 1024, 1 * 1024 * 1024, 5 * 1024 * 1024, 25 * 1024 * 1024, 50 * 1024 * 1024];
const MAX_DOWNLOAD_SIZE = DOWNLOAD_SIZE_OPTIONS[DOWNLOAD_SIZE_OPTIONS.length - 1];
const DEFAULT_DOWNLOAD_SIZE = 5 * 1024 * 1024;
const rawUploadParser = express.raw({
    type: 'application/octet-stream',
    limit: '100mb',
});

// ==================== PRE-ALLOCATED DOWNLOAD BUFFERS ====================
// Generate random buffers at startup for the most common sizes.
// These live in memory and are served directly — no per-request random fill.

const preAllocatedBuffers = {};
const PRE_ALLOC_SIZES = [1 * 1024 * 1024, 5 * 1024 * 1024, 25 * 1024 * 1024]; // 1MB, 5MB, 25MB

function preAllocate() {
    const start = Date.now();
    for (const size of PRE_ALLOC_SIZES) {
        const buf = Buffer.alloc(size);
        crypto.randomFillSync(buf);
        preAllocatedBuffers[size] = buf;
    }
    console.log(`  Pre-allocated ${PRE_ALLOC_SIZES.map(s => `${(s / 1024 / 1024).toFixed(0)}MB`).join(', ')} buffers in ${Date.now() - start}ms`);
}

function getClosestBuffer(size) {
    // Find the closest pre-allocated size that is >= requested size
    for (const preSize of PRE_ALLOC_SIZES) {
        if (preSize >= size) return { buffer: preAllocatedBuffers[preSize], size: preSize };
    }
    return null;
}

// ==================== SERVER STATS ====================
const serverStats = {
    startedAt: Date.now(),
    requests: { ping: 0, download: 0, upload: 0, health: 0 },
};

// ==================== MIDDLEWARE ====================

// Compression (gzip/brotli) for API JSON responses and static assets
// Exclude speed test download/upload endpoints to avoid skewing measurements
app.use(compression({
    filter: (req, res) => {
        if (req.path.includes('/download') || req.path.includes('/upload')) return false;
        return compression.filter(req, res);
    },
    level: 6,
}));

// CORS for cross-origin requests
app.use(cors({
    origin: resolvedCorsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));

// Basic hardening headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// Lightweight request logger
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path.startsWith('/api/')) {
            console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        }
    });
    next();
});

// ==================== SPEED TEST ENDPOINTS ====================

/**
 * Health Endpoint
 * Quick readiness probe before running tests
 */
app.get(['/api/speed/health', '/api/health', '/health'], (req, res) => {
    serverStats.requests.health++;
    res.set({
        ...NO_CACHE_HEADERS,
        'Content-Type': 'application/json',
    });

    res.json({ ok: true, timestamp: Date.now() });
});

/**
 * Ping Endpoint
 * Returns minimal response for latency measurement
 * Headers prevent caching
 */
const pingHandler = (req, res) => {
    serverStats.requests.ping++;
    // Prevent caching
    res.set({
        ...NO_CACHE_HEADERS,
        'X-Timestamp': Date.now().toString(),
        'Content-Encoding': 'identity',
    });

    res.send('1');
};
app.get(['/api/speed/ping', '/ping'], pingHandler);

/**
 * Download Endpoint
 * Serves pre-allocated random buffers for speed measurement.
 * Falls back to streaming random data for non-cached sizes.
 * Query param: size (bytes, default 5MB, max 50MB)
 */
const downloadHandler = (req, res) => {
    serverStats.requests.download++;
    // Parse and validate size
    let size = parseInt(req.query.size, 10);
    if (Number.isNaN(size)) size = DEFAULT_DOWNLOAD_SIZE;
    size = Math.min(size, MAX_DOWNLOAD_SIZE);
    size = Math.max(size, DOWNLOAD_SIZE_OPTIONS[0]);

    // Prevent caching
    res.set({
        ...NO_CACHE_HEADERS,
        'Content-Type': 'application/octet-stream',
        'Content-Length': size.toString(),
        'X-Timestamp': Date.now().toString(),
        'Content-Encoding': 'identity',
        'Content-Disposition': 'attachment; filename="speedtest.bin"',
        'Accept-Ranges': 'none',
    });

    // Try pre-allocated buffer first
    const cached = getClosestBuffer(size);
    if (cached && cached.size === size) {
        // Exact match — serve from memory
        res.end(cached.buffer);
        return;
    }

    if (cached && cached.size > size) {
        // Serve a slice of the larger buffer
        res.end(cached.buffer.subarray(0, size));
        return;
    }

    // Fallback: stream random data in chunks
    const chunkSize = 1_000_000; // 1MB chunks
    let remaining = size;
    const sendChunk = () => {
        if (remaining <= 0) {
            res.end();
            return;
        }

        const currentChunk = Math.min(chunkSize, remaining);
        const buffer = Buffer.alloc(currentChunk);

        // Fill with pseudo-random data (faster than crypto for large buffers)
        const wordBytes = Math.floor(currentChunk / 4) * 4;
        for (let i = 0; i < wordBytes; i += 4) {
            const rand = Math.random() * 0xffffffff >>> 0;
            buffer.writeUInt32LE(rand, i);
        }
        for (let i = wordBytes; i < currentChunk; i += 1) {
            buffer[i] = Math.floor(Math.random() * 256);
        }

        remaining -= currentChunk;

        const canContinue = res.write(buffer);
        if (canContinue) {
            setImmediate(sendChunk);
        } else {
            res.once('drain', sendChunk);
        }
    };

    sendChunk();
};
app.get(['/api/speed/download', '/download'], downloadHandler);

/**
 * Upload Endpoint
 * Accepts and discards binary data
 * Returns confirmation with bytes received
 */
const uploadHandler = (req, res) => {
    serverStats.requests.upload++;
    // Headers for no caching
    res.set({
        ...NO_CACHE_HEADERS,
        'Content-Encoding': 'identity',
    });

    let bytesReceived = 0;

    // For raw body parser, body is already available
    if (req.body && req.body.length) {
        bytesReceived = req.body.length;
        res.json({
            received: true,
            bytes: bytesReceived,
            timestamp: Date.now(),
        });
        return;
    }

    // Fallback: stream handling
    req.on('data', (chunk) => {
        bytesReceived += chunk.length;
    });

    req.on('end', () => {
        res.json({
            received: true,
            bytes: bytesReceived,
            timestamp: Date.now(),
        });
    });

    req.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
};
app.post(['/api/speed/upload', '/upload'], rawUploadParser, uploadHandler);

/**
 * Server Info Endpoint
 * Returns server information for diagnostics
 */
app.get('/api/speed/info', (req, res) => {
    res.set(NO_CACHE_HEADERS);
    res.json({
        server: 'HybridSpeed Test Server',
        version: '2.0.0',
        location: SERVER_LOCATION,
        timestamp: Date.now(),
        capabilities: {
            maxDownload: `${Math.round(MAX_DOWNLOAD_SIZE / (1024 * 1024))}MB`,
            maxUpload: '100MB',
            parallelStreams: true,
            compression: true,
            preAllocatedSizes: PRE_ALLOC_SIZES.map(s => `${(s / 1024 / 1024).toFixed(0)}MB`),
        },
    });
});

/**
 * Server Stats Endpoint
 * Returns aggregate request counts and uptime
 */
app.get('/api/speed/stats', (req, res) => {
    res.set(NO_CACHE_HEADERS);
    const uptime = Date.now() - serverStats.startedAt;
    res.json({
        uptime: Math.round(uptime / 1000),
        uptimeFormatted: formatUptime(uptime),
        requests: { ...serverStats.requests },
        totalRequests: Object.values(serverStats.requests).reduce((a, b) => a + b, 0),
    });
});

function formatUptime(ms) {
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    return `${h}h ${m}m ${s}s`;
}

// ==================== STATIC ASSETS ====================

// Serve static files with ETag and conditional caching
app.use(express.static(path.join(__dirname, '..'), {
    etag: true,
    lastModified: true,
    maxAge: IS_PRODUCTION ? '1h' : 0,
}));

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: IS_PRODUCTION ? 'Something went wrong' : err.message,
    });
});

// ==================== START SERVER ====================

// Pre-allocate buffers before accepting connections
preAllocate();

const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                                                          ║');
    console.log('║   🚀 HybridSpeed Test Server v2.0                       ║');
    console.log(`║   📡 Open at http://${BROWSER_HOST}:${PORT}${' '.repeat(Math.max(0, 30 - `${BROWSER_HOST}:${PORT}`.length))}║`);
    console.log('║                                                          ║');
    console.log('║   Endpoints:                                             ║');
    console.log('║   • GET  /api/speed/health    Health check               ║');
    console.log('║   • GET  /api/speed/ping      Latency test               ║');
    console.log('║   • GET  /api/speed/download  Download test              ║');
    console.log('║   • POST /api/speed/upload    Upload test                ║');
    console.log('║   • GET  /api/speed/info      Server info                ║');
    console.log('║   • GET  /api/speed/stats     Server stats               ║');
    console.log('║                                                          ║');
    console.log('║   ⚡ Compression: enabled                                ║');
    console.log('║   💾 Pre-alloc:   1MB, 5MB, 25MB buffers                 ║');
    console.log('║                                                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
});
server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the existing process or use a different PORT.`);
    } else {
        console.error('Server failed to start:', err);
    }
    process.exit(1);
});

const gracefulShutdown = (signal) => {
    console.log(`${signal} received. Shutting down server...`);
    server.close(() => {
        process.exit(0);
    });

    // Force-close after timeout in case of hanging connections
    setTimeout(() => {
        process.exit(1);
    }, 10_000).unref();
};

// Graceful error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
