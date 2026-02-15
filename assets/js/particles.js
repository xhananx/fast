/* ============================================
   HybridSpeed - Particle Canvas System
   Spatial-grid accelerated constellation effect
   ============================================ */

'use strict';

(function () {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    // Respect reduced-motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        canvas.style.display = 'none';
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // -------------------- Configuration --------------------
    const config = {
        particleCount: 60,
        maxSpeed: 0.3,
        minSize: 1,
        maxSize: 2.5,
        connectionDistance: 130,
        mouseRadius: 160,
        baseOpacity: 0.35,
        lineOpacity: 0.12,
        primaryColor: { r: 0, g: 240, b: 255 },
        accentColor: { r: 168, g: 85, b: 247 },
        primaryRatio: 0.7,
        gridCellSize: 140, // spatial hash cell size ≥ connectionDistance
        speedBoost: 1,     // reactive: increased during speed test
    };

    let particles = [];
    let mouse = { x: -1000, y: -1000 };
    let animationId = null;
    let isVisible = true;
    let width = 0;
    let height = 0;
    let grid = {};

    // -------------------- Spatial Hash Grid --------------------
    function cellKey(cx, cy) {
        return cx + ',' + cy;
    }

    function buildGrid() {
        grid = {};
        const cellSize = config.gridCellSize;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const cx = Math.floor(p.x / cellSize);
            const cy = Math.floor(p.y / cellSize);
            const key = cellKey(cx, cy);
            if (!grid[key]) grid[key] = [];
            grid[key].push(i);
        }
    }

    function getNeighborIndices(px, py) {
        const cellSize = config.gridCellSize;
        const cx = Math.floor(px / cellSize);
        const cy = Math.floor(py / cellSize);
        const result = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = cellKey(cx + dx, cy + dy);
                const cell = grid[key];
                if (cell) {
                    for (let k = 0; k < cell.length; k++) {
                        result.push(cell[k]);
                    }
                }
            }
        }
        return result;
    }

    // -------------------- Particle --------------------
    function createParticle() {
        const isPrimary = Math.random() < config.primaryRatio;
        const color = isPrimary ? config.primaryColor : config.accentColor;
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * config.maxSpeed * 2,
            vy: (Math.random() - 0.5) * config.maxSpeed * 2,
            size: config.minSize + Math.random() * (config.maxSize - config.minSize),
            color: color,
            opacity: 0.2 + Math.random() * config.baseOpacity,
            pulsePhase: Math.random() * Math.PI * 2,
        };
    }

    // -------------------- Resize --------------------
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initParticles() {
        const targetCount = Math.min(config.particleCount, Math.floor((width * height) / 15000));
        particles = [];
        for (let i = 0; i < targetCount; i++) {
            particles.push(createParticle());
        }
    }

    // -------------------- Update --------------------
    function updateParticles() {
        const boost = config.speedBoost;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            // Mouse repulsion
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const distSq = dx * dx + dy * dy;
            const r2 = config.mouseRadius * config.mouseRadius;
            if (distSq < r2 && distSq > 0) {
                const dist = Math.sqrt(distSq);
                const force = (config.mouseRadius - dist) / config.mouseRadius * 0.015;
                p.vx += (dx / dist) * force;
                p.vy += (dy / dist) * force;
            }

            // Move
            p.x += p.vx * boost;
            p.y += p.vy * boost;

            // Speed limit
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            const maxV = config.maxSpeed * 1.5 * boost;
            if (speed > maxV) {
                p.vx = (p.vx / speed) * maxV;
                p.vy = (p.vy / speed) * maxV;
            }

            // Friction
            p.vx *= 0.999;
            p.vy *= 0.999;

            // Wrap edges
            if (p.x < 0) p.x += width;
            else if (p.x > width) p.x -= width;
            if (p.y < 0) p.y += height;
            else if (p.y > height) p.y -= height;

            // Pulse
            p.pulsePhase += 0.008 * boost;
        }
    }

    // -------------------- Draw --------------------
    function draw() {
        ctx.clearRect(0, 0, width, height);

        buildGrid();

        const connDist = config.connectionDistance;
        const connDistSq = connDist * connDist;
        const drawnConnections = {};

        // Draw connections first (lines underneath particles)
        ctx.lineWidth = 0.5;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const neighbors = getNeighborIndices(p.x, p.y);

            for (let k = 0; k < neighbors.length; k++) {
                const j = neighbors[k];
                if (j <= i) continue; // avoid duplicates

                const key = i < j ? i * 10000 + j : j * 10000 + i;
                if (drawnConnections[key]) continue;

                const q = particles[j];
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < connDistSq) {
                    const dist = Math.sqrt(distSq);
                    const opacity = (1 - dist / connDist) * config.lineOpacity;
                    const c = p.color;
                    ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${opacity})`;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                    drawnConnections[key] = 1;
                }
            }
        }

        // Draw particles
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const pulse = Math.sin(p.pulsePhase) * 0.15;
            const opacity = Math.min(p.opacity + pulse, 0.8);
            const c = p.color;

            // Glow
            ctx.shadowBlur = 6;
            ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${opacity * 0.5})`;

            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${opacity})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.shadowBlur = 0;
    }

    // -------------------- Animation Loop --------------------
    function animate() {
        if (!isVisible) return;
        updateParticles();
        draw();
        animationId = requestAnimationFrame(animate);
    }

    function start() {
        if (animationId) return;
        isVisible = true;
        animate();
    }

    function stop() {
        isVisible = false;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    // -------------------- Events --------------------
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resize();
            // Re-bound escaped particles
            for (let i = 0; i < particles.length; i++) {
                if (particles[i].x > width) particles[i].x = Math.random() * width;
                if (particles[i].y > height) particles[i].y = Math.random() * height;
            }
        }, 150);
    }, { passive: true });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    }, { passive: true });

    canvas.addEventListener('mouseleave', () => {
        mouse.x = -1000;
        mouse.y = -1000;
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stop();
        } else {
            start();
        }
    });

    // -------------------- Speed Test Integration --------------------
    // Pages can call window.setParticleBoost(multiplier) to react to test state
    window.setParticleBoost = function (multiplier) {
        config.speedBoost = Math.max(0.5, Math.min(multiplier, 3));
    };

    // -------------------- Init --------------------
    resize();
    initParticles();
    start();
})();
