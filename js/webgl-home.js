(() => {
    'use strict';

    const canvas = document.querySelector('[data-webgl-home]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canvas || reducedMotion) return;

    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        powerPreference: 'low-power'
    });
    if (!gl) return;

    const vertexSource = `
        attribute vec2 position;
        void main() {
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const fragmentSource = `
        precision mediump float;
        uniform vec2 resolution;
        uniform vec2 pointer;
        uniform float time;

        float glow(vec2 uv, vec2 point, float radius) {
            float distanceToPoint = max(length(uv - point), 0.003);
            return radius / distanceToPoint;
        }

        void main() {
            vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
            vec2 mouse = (pointer * 2.0 - 1.0) * vec2(resolution.x / resolution.y, 1.0);
            float slowTime = time * 0.18;

            vec2 p1 = vec2(sin(slowTime) * 0.58, cos(slowTime * 0.73) * 0.42);
            vec2 p2 = vec2(cos(slowTime * 0.62) * 0.78, sin(slowTime * 0.91) * 0.5);
            vec2 p3 = mix(vec2(-0.5, -0.38), mouse * 0.55, 0.32);

            float field = glow(uv, p1, 0.012) + glow(uv, p2, 0.009) + glow(uv, p3, 0.014);
            float rings = sin(length(uv - mouse * 0.2) * 13.0 - time * 0.42) * 0.5 + 0.5;
            float grain = fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453);

            vec3 accent = vec3(0.36, 0.49, 1.0);
            vec3 cyan = vec3(0.18, 0.78, 0.92);
            vec3 color = mix(accent, cyan, clamp(uv.y * 0.35 + 0.45, 0.0, 1.0));
            float alpha = smoothstep(0.02, 0.32, field) * 0.38;
            alpha += rings * 0.012 + grain * 0.018;
            alpha *= smoothstep(1.65, 0.25, length(uv));

            gl_FragColor = vec4(color, alpha);
        }
    `;

    const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };

    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'position');
    const resolution = gl.getUniformLocation(program, 'resolution');
    const pointer = gl.getUniformLocation(program, 'pointer');
    const time = gl.getUniformLocation(program, 'time');

    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const mouse = { x: 0.72, y: 0.58, targetX: 0.72, targetY: 0.58 };
    const updatePointer = (event) => {
        mouse.targetX = event.clientX / window.innerWidth;
        mouse.targetY = 1 - event.clientY / window.innerHeight;
    };
    window.addEventListener('pointermove', updatePointer, { passive: true });

    const resize = () => {
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
        const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);
        }
    };

    let frame;
    const startedAt = performance.now();
    const render = (now) => {
        resize();
        mouse.x += (mouse.targetX - mouse.x) * 0.045;
        mouse.y += (mouse.targetY - mouse.y) * 0.045;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform2f(pointer, mouse.x, mouse.y);
        gl.uniform1f(time, (now - startedAt) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        frame = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !frame) frame = requestAnimationFrame(render);
        if (!entry.isIntersecting && frame) {
            cancelAnimationFrame(frame);
            frame = null;
        }
    });

    observer.observe(canvas);
    canvas.classList.add('is-ready');
})();
