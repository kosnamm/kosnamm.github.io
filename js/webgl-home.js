import * as THREE from '../vendor/three/three.module.js';

const root = document.querySelector('[data-room-home]');
const canvas = document.querySelector('[data-room-canvas]');

if (root && canvas) {
    const prompt = root.querySelector('[data-room-prompt]');
    const promptLabel = root.querySelector('[data-room-prompt-label]');
    const promptKicker = root.querySelector('[data-room-prompt-kicker]');
    const panelContainer = root.querySelector('[data-room-panel-container]');
    const panelSections = [...root.querySelectorAll('[data-room-panel]')];
    const keys = new Set();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
    } catch (error) {
        console.warn('Interactive room could not start.', error);
    }

    if (renderer) {
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera();
        const timer = new THREE.Timer();
        timer.connect(document);
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const interactiveZones = [];
        const obstacles = [];
        const clickTargets = [];

        const palette = {
            floor: 0x171a2a,
            wall: 0x101326,
            wallAlt: 0x17152c,
            ink: 0x090b14,
            violet: 0x705cff,
            cyan: 0x2ce5ff,
            pink: 0xff4fa1,
            lime: 0x86ff78,
            amber: 0xffa64d,
            cream: 0xe8e4f4,
            wood: 0x3a2742
        };

        const standard = (color, options = {}) => new THREE.MeshStandardMaterial({
            color,
            roughness: options.roughness ?? 0.68,
            metalness: options.metalness ?? 0.08,
            emissive: options.emissive ?? 0x000000,
            emissiveIntensity: options.emissiveIntensity ?? 0
        });

        const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            toneMapped: false
        });

        const box = (parent, size, position, material, options = {}) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
            mesh.position.set(...position);
            mesh.rotation.set(...(options.rotation ?? [0, 0, 0]));
            mesh.castShadow = options.castShadow ?? true;
            mesh.receiveShadow = options.receiveShadow ?? true;
            parent.add(mesh);
            return mesh;
        };

        const cylinder = (parent, radius, height, position, material, sides = 12) => {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), material);
            mesh.position.set(...position);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            parent.add(mesh);
            return mesh;
        };

        const makeLabel = (text, color) => {
            const labelCanvas = document.createElement('canvas');
            labelCanvas.width = 512;
            labelCanvas.height = 128;
            const context = labelCanvas.getContext('2d');
            context.clearRect(0, 0, 512, 128);
            context.font = '700 54px ui-monospace, SFMono-Regular, Menlo, monospace';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.shadowBlur = 28;
            context.shadowColor = color;
            context.fillStyle = color;
            context.fillText(text, 256, 66);
            const texture = new THREE.CanvasTexture(labelCanvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                toneMapped: false
            }));
            sprite.scale.set(2.55, 0.64, 1);
            sprite.renderOrder = 10;
            return sprite;
        };

        // Original procedural materials keep the scene self-contained and deterministic.
        const texture = (width, height, paint, repeat = null) => {
            const surface = document.createElement('canvas');
            surface.width = width;
            surface.height = height;
            paint(surface.getContext('2d'), width, height);
            const map = new THREE.CanvasTexture(surface);
            map.colorSpace = THREE.SRGBColorSpace;
            map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
            if (repeat) {
                map.wrapS = map.wrapT = THREE.RepeatWrapping;
                map.repeat.set(...repeat);
            }
            return map;
        };
        let seed = 431;
        const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const timber = texture(1024, 1024, (c, w, h) => {
            c.fillStyle = '#4b3c32'; c.fillRect(0, 0, w, h);
            for (let row = 0; row < 16; row++) {
                const y = row * 64;
                c.fillStyle = `hsl(29, ${15 + random() * 12}%, ${23 + random() * 9}%)`;
                c.fillRect(0, y, w, 63);
                for (let i = 0; i < 160; i++) {
                    c.strokeStyle = `rgba(${random() > .5 ? '170,140,100' : '12,10,18'},${random() * .14})`;
                    const sy = y + random() * 63;
                    c.beginPath(); c.moveTo(0, sy);
                    c.bezierCurveTo(300, sy + random() * 5, 600, sy - random() * 5, w, sy);
                    c.stroke();
                }
                c.fillStyle = '#201e21'; c.fillRect(0, y, w, 1);
                for (let x = (row % 3) * 120; x < w; x += 380) c.fillRect(x, y, 1, 64);
            }
        }, [2, 2]);
        const cloth = texture(128, 128, (c, w, h) => {
            c.fillStyle = '#a1a3aa'; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 6000; i++) {
                c.fillStyle = random() > .5 ? '#83868d' : '#b6b9c1';
                c.fillRect(random() * w, random() * h, 1, 2);
            }
        }, [5, 5]);
        const fabric = (color) => new THREE.MeshStandardMaterial({ color, map: cloth, roughness: 1 });
        const rounded = (parent, size, pos, material, radius = .08, rotation = 0) => {
            const [w, h, d] = size;
            const r = Math.min(radius, w / 3, h / 3, d / 3);
            const shape = new THREE.Shape();
            shape.moveTo(-w / 2 + r, -h / 2);
            shape.lineTo(w / 2 - r, -h / 2);
            shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
            shape.lineTo(w / 2, h / 2 - r);
            shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
            shape.lineTo(-w / 2 + r, h / 2);
            shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
            shape.lineTo(-w / 2, -h / 2 + r);
            shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: d - r, bevelEnabled: true, bevelSegments: 2,
                steps: 1, bevelSize: r / 2, bevelThickness: r / 2, curveSegments: 4
            });
            geometry.translate(0, 0, -d / 2 + r / 2);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(...pos); mesh.rotation.y = rotation;
            mesh.castShadow = mesh.receiveShadow = true;
            parent.add(mesh); return mesh;
        };
        const rod = (parent, from, to, radius, material) => {
            const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8), material);
            mesh.position.copy(start).add(end).multiplyScalar(.5);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
            mesh.castShadow = true; parent.add(mesh); return mesh;
        };
        const glowMap = texture(128, 128, (c) => {
            const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,.5)');
            g.addColorStop(.25, 'rgba(255,255,255,.19)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g; c.fillRect(0, 0, 128, 128);
        });
        const glow = (parent, pos, size, color, rotation = [-Math.PI / 2, 0, 0], opacity = .5) => {
            const mat = new THREE.MeshBasicMaterial({ map: glowMap, color, transparent: true,
                opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), mat);
            mesh.position.set(...pos); mesh.rotation.set(...rotation); parent.add(mesh); return mesh;
        };
        const screenMap = texture(1024, 512, (c, w, h) => {
            const sky = c.createLinearGradient(0, 0, w, h);
            sky.addColorStop(0, '#101c43'); sky.addColorStop(.5, '#2098a0'); sky.addColorStop(1, '#c6c964');
            c.fillStyle = sky; c.fillRect(0, 0, w, h);
            c.fillStyle = '#d8e8a4'; c.beginPath(); c.arc(735, 145, 42, 0, Math.PI * 2); c.fill();
            for (let layer = 0; layer < 5; layer++) {
                c.fillStyle = ['#567e8d', '#376275', '#234a60', '#143743', '#0c2431'][layer];
                c.beginPath(); c.moveTo(0, h);
                for (let x = 0; x <= w; x += 50) c.lineTo(x, 200 + layer * 45 - random() * 120);
                c.lineTo(w, h); c.fill();
            }
            for (let i = 0; i < 160; i++) {
                const x = random() * w, y = 260 + random() * 250, height = 20 + random() * 100;
                c.fillStyle = i % 4 ? '#143932' : '#7c9e49';
                c.beginPath(); c.moveTo(x, y - height); c.lineTo(x - height * .22, y); c.lineTo(x + height * .22, y); c.fill();
            }
            c.fillStyle = '#ffffff70'; c.font = '12px monospace'; c.fillText('STUDIO / AFTER HOURS', 28, 475);
        });
        const screenMaterial = new THREE.MeshBasicMaterial({ map: screenMap, toneMapped: false });
        const makeWallTitle = () => {
            const map = texture(1024, 512, (c) => {
                c.textAlign = 'center'; c.textBaseline = 'middle';
                c.font = 'italic 112px Arial, sans-serif'; c.lineWidth = 2;
                ["Matthew’s", 'Studio'].forEach((line, i) => {
                    c.shadowColor = '#6e69ff'; c.shadowBlur = 22;
                    c.strokeStyle = '#8e8bff'; c.strokeText(line, 512, 165 + i * 145);
                    c.shadowBlur = 5; c.strokeStyle = '#ddfaff'; c.strokeText(line, 512, 165 + i * 145);
                });
            });
            const title = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.75),
                new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
            title.position.set(-5.685, 3.55, .75); title.rotation.y = Math.PI / 2;
            return title;
        };

        const addObstacle = (minX, maxX, minZ, maxZ) => {
            obstacles.push({ minX, maxX, minZ, maxZ });
        };

        const registerZone = ({ id, label, kicker, group, position, radius = 1.85, color }) => {
            const ringMaterial = basic(color, 0.14);
            const anchors = {
                blog: [-4.6, 2.95, 1.2], about: [-4.2, 5.15, -4.25],
                gallery: [.55, 4.75, -4.3], timeline: [4.2, 3.15, -3.95]
            };
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'room-home__hotspot';
            tag.textContent = `${id.toUpperCase()} ↗`;
            tag.setAttribute('aria-label', label);
            tag.style.setProperty('--hotspot-color', `#${new THREE.Color(color).getHexString()}`);
            tag.addEventListener('click', () => openPanel(id));
            root.appendChild(tag);
            const anchor = new THREE.Vector3(...anchors[id]);
            ringMaterial.side = THREE.DoubleSide;
            const marker = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 32), ringMaterial);
            marker.position.set(position.x, 0.025, position.z);
            marker.rotation.x = -Math.PI / 2;
            scene.add(marker);

            group.traverse((child) => {
                if (!child.isMesh) return;
                child.userData.interaction = id;
                clickTargets.push(child);
            });

            interactiveZones.push({ id, label, kicker, group, position, radius, marker, color, tag, anchor });
        };

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.setClearColor(0x000000, 0);
        scene.add(new THREE.HemisphereLight(0x8293bd, 0x181326, .7));
        const keyLight = new THREE.DirectionalLight(0xb6c9e2, 1.8);
        keyLight.position.set(5, 12, 9); keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        Object.assign(keyLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
        keyLight.shadow.normalBias = .035; keyLight.shadow.bias = -.0002;
        scene.add(keyLight);
        const pointLight = (color, intensity, pos, distance = 9) => {
            const light = new THREE.PointLight(color, intensity, distance, 2);
            light.position.set(...pos); scene.add(light); return light;
        };
        const cyanLight = pointLight(0x00ffc8, 25, [-4.1, 2.2, -.3]);
        const pinkLight = pointLight(0xd52bff, 24, [3.7, 1.9, -2.5]);
        pointLight(0x5366ff, 16, [-3, 4, -2.5]);
        pointLight(0xff16a6, 18, [2.2, 1.2, 3]);
        pointLight(0x2be8ff, 13, [.4, 3.4, -4]);

        const room = new THREE.Group(); scene.add(room);
        const darkMetal = standard(0x10131c, { metalness: .55, roughness: .4 });
        const black = standard(0x090c15, { roughness: .7 });
        const wood = standard(0x30252b, { roughness: .7 });
        const floorMat = new THREE.MeshStandardMaterial({ map: timber, roughness: .77, metalness: .06 });
        box(room, [12, .36, 10], [0, -.24, .15], standard(0x10101c));
        box(room, [11.65, .09, 9.65], [0, -.015, .15], floorMat);
        box(room, [.22, 5.6, 10], [-5.85, 2.58, .15], standard(0x272b38, { roughness: .95 }));
        box(room, [12, 5.6, .22], [0, 2.58, -4.75], standard(0x242c39, { roughness: .95 }));
        box(room, [.08, .16, 9.7], [-5.69, .1, .15], darkMetal);
        box(room, [11.7, .16, .08], [0, .1, -4.59], darkMetal);
        // Segmented spectrum follows both ceiling edges, as in the reference.
        const strip = (start, end, count, hue) => {
            for (let i = 0; i < count; i++) {
                const t = i / count, u = (i + 1) / count;
                const pos = start.map((v, j) => v + (end[j] - v) * (t + u) / 2);
                const size = start.map((v, j) => Math.max(.035, Math.abs(end[j] - v) / count + .006));
                box(room, size, pos, basic(new THREE.Color().setHSL((hue + t * .8) % 1, 1, .55)), { castShadow: false });
            }
        };
        strip([-5.69, 5.25, 4.95], [-5.69, 5.25, -4.62], 64, .13);
        strip([-5.69, 5.25, -4.62], [5.85, 5.25, -4.62], 72, .98);
        room.add(makeWallTitle());
        glow(room, [-5.715, 3.1, .8], [6.2, 4.1], 0x6151ff, [0, Math.PI / 2, 0], .55);
        glow(room, [-5.71, 1.6, 3.3], [2.8, 3.4], 0x00ffd0, [0, Math.PI / 2, 0], .85);
        glow(room, [4.3, 2.3, -4.62], [3.5, 4.5], 0xbd19ff, [0, 0, 0], .7);
        glow(room, [-3.8, .045, 1], [5, 4], 0x00d9ba);
        glow(room, [3.2, .046, 2.6], [5.5, 5], 0xc91bff, undefined, .7);

        // Desk is aligned with the left wall; the bed and window occupy the far wall.
        const desk = new THREE.Group(); scene.add(desk);
        rounded(desk, [1.7, .18, 5], [-4.65, 1.48, 1.2], wood, .06);
        box(desk, [.035, .025, 4.85], [-3.79, 1.52, 1.2], basic(0x19ffae));
        [-.98, 3.35].forEach(z => {
            box(desk, [1.42, 1.38, .13], [-4.65, .7, z], darkMetal);
        });
        rounded(desk, [1.3, 1.22, 1.1], [-4.55, .63, -.52], standard(0x27242e), .04);
        [.3, .68, 1.06].forEach(y => {
            box(desk, [.025, .018, .97], [-3.88, y, -.52], standard(0x53445c));
            box(desk, [.035, .035, .32], [-3.855, y + .14, -.52], darkMetal);
        });
        // Ultrawide screen and articulated stand.
        box(desk, [.14, 1.02, 2.9], [-5.13, 2.23, 1.16], black);
        const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.76, .88), screenMaterial);
        monitor.position.set(-5.048, 2.23, 1.16); monitor.rotation.y = Math.PI / 2; desk.add(monitor);
        rod(desk, [-5.15, 1.57, 1.16], [-5.15, 2.04, 1.16], .065, darkMetal);
        box(desk, [.5, .04, .65], [-5.03, 1.59, 1.16], darkMetal);
        rounded(desk, [1.05, .025, 2.8], [-4.28, 1.59, 1.35], basic(0xb81cba), .02);
        rounded(desk, [1.01, .03, 2.75], [-4.28, 1.61, 1.35], black, .02);
        rounded(desk, [.48, .07, 1.4], [-4.2, 1.65, 1.68], darkMetal, .025);
        for (let row = 0; row < 5; row++) for (let col = 0; col < 15; col++) {
            box(desk, [.065, .016, .065], [-4.39 + row * .082, 1.697, 1.05 + col * .085],
                basic(new THREE.Color().setHSL(col / 22 + row * .035, .9, .55)), { castShadow: false });
        }
        rounded(desk, [.22, .1, .32], [-4.22, 1.68, .42], standard(0x292238), .065);
        box(desk, [.015, .008, .15], [-4.22, 1.738, .42], basic(0xff25bb));
        // Phone and compact speakers.
        rounded(desk, [.23, .025, .42], [-4.3, 1.62, -.7], black, .025);
        box(desk, [.19, .008, .34], [-4.3, 1.64, -.7], screenMaterial);
        [-.48, 2.95].forEach(z => {
            rounded(desk, [.32, .5, .34], [-5.08, 1.85, z], black, .05);
            const cone = cylinder(desk, .105, .025, [-4.9, 1.84, z], standard(0x282c39), 24);
            cone.rotation.z = Math.PI / 2;
        });
        // Glass-front tower with RGB fans, below the desktop.
        rounded(desk, [.75, 1.1, 1.03], [-4.6, .6, 2.7], black, .04);
        box(desk, [.018, .91, .84], [-4.21, .64, 2.7], standard(0x163c36, { metalness: .6, roughness: .2 }));
        [.35, .68, 1].forEach(y => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(.115, .018, 6, 24), basic(0x18ff9b));
            ring.rotation.y = Math.PI / 2; ring.position.set(-4.19, y, 2.7); desk.add(ring);
        });
        addObstacle(-5.6, -3.7, -1.3, 3.8);
        registerZone({ id: 'blog', label: 'Read the Blog', kicker: 'DESK COMPUTER', group: desk,
            position: new THREE.Vector3(-3, 0, 1.2), radius: 1.5, color: palette.cyan });

        const chair = new THREE.Group(); scene.add(chair);
        const leather = fabric(0x202136), chairAccent = standard(0x39305a);
        rounded(chair, [.95, .2, .95], [-2.8, .88, 1.3], leather, .12);
        rounded(chair, [.22, 1.32, .92], [-2.29, 1.55, 1.3], leather, .14);
        rounded(chair, [.24, .38, .52], [-2.25, 2.15, 1.3], chairAccent, .09);
        [ .75, 1.85 ].forEach(z => {
            rod(chair, [-2.7, .85, z], [-2.7, 1.27, z], .035, darkMetal);
            rounded(chair, [.65, .1, .14], [-2.75, 1.28, z], black, .03);
        });
        rod(chair, [-2.8, .15, 1.3], [-2.8, .8, 1.3], .075, darkMetal);
        for (let i = 0; i < 5; i++) {
            const a = i * Math.PI * 2 / 5;
            const x = -2.8 + Math.cos(a) * .64, z = 1.3 + Math.sin(a) * .64;
            rod(chair, [-2.8, .22, 1.3], [x, .13, z], .04, darkMetal);
            const wheel = cylinder(chair, .085, .1, [x, .1, z], black); wheel.rotation.x = Math.PI / 2;
        }
        addObstacle(-3.4, -2.1, .6, 2);

        const bed = new THREE.Group(); scene.add(bed);
        rounded(bed, [3.1, .55, 3.8], [-2.25, .36, -2.65], standard(0x201c2a), .12);
        rounded(bed, [.22, 1.25, 3.85], [-3.85, .88, -2.65], wood, .06);
        box(bed, [.04, .05, 3.6], [-3.71, 1.48, -2.65], basic(0x00ebb6));
        rounded(bed, [2.95, .3, 3.63], [-2.2, .78, -2.65], fabric(0x7c8297), .14);
        const blanket = fabric(0x202c45);
        rounded(bed, [1.92, .22, 3.67], [-1.63, .99, -2.65], blanket, .11);
        rounded(bed, [.18, .75, 3.67], [-.67, .65, -2.65], blanket, .07);
        [-3.55, -1.8].forEach(z => {
            const pillow = rounded(bed, [.78, .21, 1.27], [-3.18, 1.04, z], fabric(0x8d92ad), .1);
            pillow.rotation.y = -.08;
        });
        rounded(bed, [.7, .23, .74], [-2.6, 1.13, -3.7], fabric(0x12392f), .08, .4);
        addObstacle(-4.05, -.55, -4.5, -.65);
        // Small floating bookshelf above the headboard, with individual spines.
        const shelf = new THREE.Group(); scene.add(shelf);
        [2.9, 3.75, 4.62].forEach((y, row) => {
            box(shelf, [2.35, .1, .62], [-4.24, y, -4.34], wood);
            for (let i = 0; i < 10; i++) {
                const h = .34 + random() * .28;
                const m = standard([0x213c4c, 0x22576a, 0x3b435e, 0x60576f, 0x303b38][i % 5]);
                box(shelf, [.12 + random() * .05, h, .36], [-5.23 + i * .19, y + h / 2 + .05, -4.3], m,
                    { rotation: [0, 0, i === 9 ? .2 : 0] });
                box(shelf, [.09, .015, .008], [-5.23 + i * .19, y + .15, -4.113], standard(0x9a9d9e));
            }
        });
        cylinder(shelf, .15, .23, [-3.35, 4.8, -4.3], standard(0x6e596f));
        const plant = standard(0x37845e);
        for (let i = 0; i < 6; i++) {
            rod(shelf, [-3.35, 4.9, -4.3], [-3.35 + Math.cos(i) * .2, 5.15 + random() * .15, -4.3 + Math.sin(i) * .14], .035, plant);
        }
        registerZone({ id: 'about', label: 'About Matthew', kicker: 'BOOKSHELF', group: shelf,
            position: new THREE.Vector3(-3.7, 0, -1), radius: 1.6, color: palette.lime });

        // Recessed midnight-blue window, three panes and closely spaced Venetian slats.
        const gallery = new THREE.Group(); scene.add(gallery);
        box(gallery, [3.35, 2.45, .12], [.55, 3.1, -4.59], darkMetal);
        box(gallery, [3.14, 2.22, .025], [.55, 3.1, -4.51], basic(0x122737));
        glow(gallery, [.55, 2.5, -4.49], [3, 2], 0x38bccc, [0, 0, 0], .35);
        [-.99, .03, 1.05, 2.08].forEach(x => box(gallery, [.045, 2.26, .09], [x, 3.1, -4.46], standard(0x8894a3)));
        box(gallery, [3.45, .1, .32], [.55, 1.95, -4.4], standard(0x87909d));
        for (let i = 0; i < 18; i++) {
            box(gallery, [3.25, .047, .09], [.55, 4.19 - i * .065, -4.39], standard(0x657f8a), { rotation: [.35, 0, 0] });
        }
        rod(gallery, [2.15, 4.22, -4.31], [2.15, 2.55, -4.31], .009, standard(0x98a3a8));
        registerZone({ id: 'gallery', label: 'Open the Gallery', kicker: 'WINDOW / GALLERY', group: gallery,
            position: new THREE.Vector3(.9, 0, -3.5), radius: 1.5, color: palette.pink });

        const timeline = new THREE.Group(); scene.add(timeline);
        rounded(timeline, [2.5, .85, 1], [4.18, .48, -3.91], standard(0x4d3b57), .05);
        box(timeline, [2.28, .5, .02], [4.18, .49, -3.39], darkMetal);
        [3.18, 4.18, 5.18].forEach(x => box(timeline, [.065, .65, 1], [x, .46, -3.91], standard(0x655478)));
        box(timeline, [1, .1, .6], [3.65, .44, -3.8], standard(0x242332));
        box(timeline, [.67, .09, .6], [4.75, .27, -3.8], standard(0x343245));
        box(timeline, [2.65, 1.65, .12], [4.15, 2, -4.1], black);
        const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), screenMaterial);
        tv.position.set(4.15, 2, -4.027); timeline.add(tv);
        [3.45, 4.85].forEach(x => rod(timeline, [x, 1.22, -4.1], [x - .1, .95, -3.83], .035, darkMetal));
        rounded(timeline, [.68, .045, .55], [4.25, .95, -3.6], black, .035);
        [-.17, .17].forEach(x => cylinder(timeline, .07, .05, [4.25 + x, 1, -3.6], standard(0x4b4267)));
        registerZone({ id: 'timeline', label: 'Browse the Timeline', kicker: 'TELEVISION', group: timeline,
            position: new THREE.Vector3(3.9, 0, -2.5), radius: 1.6, color: palette.violet });
        addObstacle(2.8, 5.5, -4.5, -3.25);
        // Radial dartboard on the upper right wall.
        const dartMap = texture(256, 256, c => {
            c.fillStyle = '#141722'; c.fillRect(0, 0, 256, 256);
            for (let i = 0; i < 20; i++) {
                c.beginPath(); c.moveTo(128, 128); c.arc(128, 128, 116, i * Math.PI / 10, (i + 1) * Math.PI / 10); c.closePath();
                c.fillStyle = i % 2 ? '#a3a2b1' : '#252837'; c.fill(); c.strokeStyle = '#575365'; c.stroke();
            }
            [108, 70].forEach(r => { c.beginPath(); c.arc(128, 128, r, 0, Math.PI * 2); c.strokeStyle = '#475b60'; c.lineWidth = 8; c.stroke(); });
            c.beginPath(); c.arc(128, 128, 9, 0, Math.PI * 2); c.fillStyle = '#8d3059'; c.fill();
        });
        const dart = new THREE.Mesh(new THREE.CircleGeometry(.57, 48), new THREE.MeshStandardMaterial({ map: dartMap, roughness: .85 }));
        dart.position.set(4.33, 3.91, -4.6); room.add(dart);

        const lounge = new THREE.Group(); scene.add(lounge);
        const rug = cylinder(lounge, 1.93, .025, [3, .06, 1.68], fabric(0x392553), 64);
        for (let i = 0; i < 3; i++) {
            const ring = new THREE.Mesh(new THREE.RingGeometry(1.2 + i * .27, 1.22 + i * .27, 64), basic(0x786091, .25));
            ring.rotation.x = -Math.PI / 2; ring.position.set(3, .08, 1.68); lounge.add(ring);
        }
        const upholstery = fabric(0x24233b), cushion = fabric(0x30304b);
        rounded(lounge, [1.7, .5, 2.5], [1.65, .48, 2.25], upholstery, .14);
        rounded(lounge, [.34, 1.3, 2.5], [.82, .98, 2.25], upholstery, .12);
        [1.67, 2.83].forEach(z => rounded(lounge, [1.35, .25, 1.08], [1.76, .82, z], cushion, .12));
        [ .9, 3.59 ].forEach(z => rounded(lounge, [1.7, .85, .25], [1.65, .72, z], upholstery, .1));
        rounded(lounge, [.28, .69, .7], [1.08, 1.1, 1.65], fabric(0x3e2c58), .09, -.08);
        addObstacle(.6, 2.5, .7, 3.8);
        cylinder(lounge, .76, .11, [3.6, .96, 1.38], standard(0x50616c, { roughness: .35 }), 48);
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3;
            rod(lounge, [3.6 + Math.cos(a) * .5, .92, 1.38 + Math.sin(a) * .5],
                [3.6 + Math.cos(a) * .65, .09, 1.38 + Math.sin(a) * .65], .045, darkMetal);
        }
        rounded(lounge, [.7, .06, .51], [3.55, 1.055, 1.3], black, .02, .16);
        box(lounge, [.62, .008, .43], [3.55, 1.09, 1.3], screenMaterial, { rotation: [0, .16, 0] });
        cylinder(lounge, .1, .19, [3.95, 1.1, 1.5], standard(0xaba7b8), 24);
        addObstacle(2.8, 4.4, .55, 2.2);
        // Tall frosted lamp and colored pool, visible at the front of the room.
        cylinder(lounge, .24, .055, [3.12, .08, 3.6], darkMetal, 32);
        cylinder(lounge, .028, 1.64, [3.12, .9, 3.6], standard(0x61536c, { metalness: .8 }), 12);
        cylinder(lounge, .22, .53, [3.12, 1.93, 3.6], standard(0x78447c, { emissive: 0xd726ff, emissiveIntensity: .7 }), 32);
        cylinder(lounge, .22, .025, [3.12, 2.21, 3.6], basic(0xe94dff), 32);
        glow(lounge, [3.12, 2.21, 3.6], [1.3, 1.3], 0xea32ff, [-Math.PI / 2, 0, 0], .6);
        // Desk light cylinders create the characteristic turquoise wall wash.
        [3.22, -.72].forEach(z => {
            cylinder(desk, .16, .34, [-5.05, 1.78, z], standard(0x486763), 24);
            cylinder(desk, .17, .025, [-5.05, 1.97, z], basic(0x65ffd7), 24);
        });

        const player = new THREE.Group();
        player.position.set(-.6, 0, 2.4);
        player.scale.setScalar(.72);
        scene.add(player);

        const playerBody = new THREE.Group();
        player.add(playerBody);
        const suitMaterial = standard(0xf1ecff, { roughness: 0.82 });
        const skinMaterial = standard(0xffc7a5, { roughness: 0.88 });
        const accentMaterial = standard(palette.violet, { emissive: palette.violet, emissiveIntensity: 0.35 });

        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.72, 5, 10), suitMaterial);
        torso.position.y = 1.35;
        torso.castShadow = true;
        playerBody.add(torso);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), skinMaterial);
        head.scale.y = 1.08;
        head.position.y = 2.08;
        head.castShadow = true;
        playerBody.add(head);

        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), accentMaterial);
        hair.position.y = 2.2;
        hair.rotation.x = -0.08;
        playerBody.add(hair);

        [-0.14, 0.14].forEach((x) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), basic(0x141420));
            eye.position.set(x, 2.11, 0.37);
            playerBody.add(eye);
        });

        const makeLimb = (x, y, length, material) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, y, 0);
            const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, length, 4, 8), material);
            limb.position.y = -length * 0.5;
            limb.castShadow = true;
            pivot.add(limb);
            playerBody.add(pivot);
            return pivot;
        };

        const leftArm = makeLimb(-0.5, 1.7, 0.68, skinMaterial);
        const rightArm = makeLimb(0.5, 1.7, 0.68, skinMaterial);
        const leftLeg = makeLimb(-0.2, 0.9, 0.62, accentMaterial);
        const rightLeg = makeLimb(0.2, 0.9, 0.62, accentMaterial);

        const playerShadow = new THREE.Mesh(new THREE.CircleGeometry(0.52, 24), basic(0x000000, 0.28));
        playerShadow.rotation.x = -Math.PI / 2;
        playerShadow.position.y = 0.025;
        player.add(playerShadow);

        camera.position.set(16, 17, 16);
        camera.lookAt(0, 1.5, 0);

        const movementForward = new THREE.Vector3(-1, 0, -1).normalize();
        const movementRight = new THREE.Vector3(1, 0, -1).normalize();
        const moveDirection = new THREE.Vector3();
        const nextPosition = new THREE.Vector3();
        const screenPosition = new THREE.Vector3();
        let nearbyZone = null;
        let panelOpen = false;
        let walkPhase = 0;
        let lastFocusedElement = null;

        const resize = () => {
            const width = Math.max(root.clientWidth, 1);
            const height = Math.max(root.clientHeight, 1);
            const aspect = width / height;
            // Keep the room as a centered object inside a larger digital-space canvas.
            // Portrait layouts retain a closer view so the character remains usable.
            const viewHeight = aspect < 1 ? 17 / aspect : 18.7;
            camera.left = -viewHeight * aspect * 0.5;
            camera.right = viewHeight * aspect * 0.5;
            camera.top = viewHeight * 0.5;
            camera.bottom = -viewHeight * 0.5;
            camera.near = 0.1;
            camera.far = 100;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height, false);
        };

        const isBlocked = (x, z) => {
            const radius = 0.34;
            if (x < -5.3 || x > 5.3 || z < -4.15 || z > 4.65) return true;
            return obstacles.some((obstacle) => (
                x > obstacle.minX - radius && x < obstacle.maxX + radius &&
                z > obstacle.minZ - radius && z < obstacle.maxZ + radius
            ));
        };

        const setNearbyZone = (zone) => {
            if (nearbyZone === zone) return;
            nearbyZone = zone;
            prompt.hidden = !zone;
            if (!zone) return;
            promptKicker.textContent = zone.kicker;
            promptLabel.textContent = zone.label;
        };

        const openPanel = (id) => {
            const selected = panelSections.find((section) => section.dataset.roomPanel === id);
            if (!selected) return;
            lastFocusedElement = document.activeElement;
            keys.clear();
            panelSections.forEach((section) => { section.hidden = section !== selected; });
            panelContainer.hidden = false;
            panelOpen = true;
            root.classList.add('is-panel-open');
            panelContainer.querySelector('.room-panel__close').focus();
        };

        const closePanel = () => {
            if (!panelOpen) return;
            panelContainer.hidden = true;
            panelOpen = false;
            root.classList.remove('is-panel-open');
            if (lastFocusedElement?.focus) lastFocusedElement.focus();
        };

        const interact = () => {
            if (nearbyZone && !panelOpen) openPanel(nearbyZone.id);
        };

        root.querySelectorAll('[data-room-interact]').forEach((button) => {
            button.addEventListener('click', interact);
        });
        root.querySelectorAll('[data-room-close]').forEach((button) => {
            button.addEventListener('click', closePanel);
        });

        const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']);
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closePanel();
                return;
            }
            if ((event.key === 'e' || event.key === 'E' || event.key === 'Enter') && !event.repeat) {
                interact();
                return;
            }
            if (movementKeys.has(event.key) && !panelOpen) {
                event.preventDefault();
                keys.add(event.key.toLowerCase());
            }
        });
        window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
        window.addEventListener('blur', () => keys.clear());
        panelContainer.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const items = [...panelContainer.querySelectorAll('button, a[href]')].filter(el => el.getClientRects().length);
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });

        root.querySelectorAll('[data-room-key]').forEach((button) => {
            const key = button.dataset.roomKey.toLowerCase();
            const start = (event) => {
                event.preventDefault();
                keys.add(key);
                button.setPointerCapture?.(event.pointerId);
            };
            const stop = (event) => {
                event.preventDefault();
                keys.delete(key);
            };
            button.addEventListener('pointerdown', start);
            button.addEventListener('pointerup', stop);
            button.addEventListener('pointercancel', stop);
            button.addEventListener('pointerleave', stop);
        });

        canvas.addEventListener('pointerdown', (event) => {
            const bounds = canvas.getBoundingClientRect();
            pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
            pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster.intersectObjects(clickTargets, false)[0];
            if (!hit?.object.userData.interaction) return;
            const zone = interactiveZones.find((item) => item.id === hit.object.userData.interaction);
            if (zone) openPanel(zone.id);
        });

        const lerpAngle = (start, end, amount) => {
            const difference = Math.atan2(Math.sin(end - start), Math.cos(end - start));
            return start + difference * amount;
        };

        const animate = (timestamp) => {
            timer.update(timestamp);
            const delta = Math.min(timer.getDelta(), 0.04);
            const elapsed = timer.getElapsed();
            moveDirection.set(0, 0, 0);

            if (!panelOpen) {
                if (keys.has('arrowup') || keys.has('w')) moveDirection.add(movementForward);
                if (keys.has('arrowdown') || keys.has('s')) moveDirection.sub(movementForward);
                if (keys.has('arrowright') || keys.has('d')) moveDirection.add(movementRight);
                if (keys.has('arrowleft') || keys.has('a')) moveDirection.sub(movementRight);
            }

            const moving = moveDirection.lengthSq() > 0;
            if (moving) {
                moveDirection.normalize();
                const speed = 2.45;
                nextPosition.copy(player.position);
                nextPosition.x += moveDirection.x * speed * delta;
                if (!isBlocked(nextPosition.x, player.position.z)) player.position.x = nextPosition.x;
                nextPosition.copy(player.position);
                nextPosition.z += moveDirection.z * speed * delta;
                if (!isBlocked(player.position.x, nextPosition.z)) player.position.z = nextPosition.z;

                const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
                player.rotation.y = lerpAngle(player.rotation.y, targetRotation, Math.min(delta * 10, 1));
                walkPhase += delta * 10;
            }

            const swing = moving ? Math.sin(walkPhase) * 0.58 : 0;
            const wobble = reducedMotion ? 0 : Math.sin(elapsed * 2.1) * (moving ? 0.045 : 0.018);
            playerBody.position.y = moving && !reducedMotion ? Math.abs(Math.sin(walkPhase * 2)) * 0.07 : 0;
            playerBody.rotation.z += ((moving ? -moveDirection.x * 0.12 : wobble) - playerBody.rotation.z) * 0.12;
            playerBody.rotation.x += ((moving ? moveDirection.z * 0.08 : 0) - playerBody.rotation.x) * 0.12;
            leftArm.rotation.x += (swing - leftArm.rotation.x) * 0.2;
            rightArm.rotation.x += (-swing - rightArm.rotation.x) * 0.2;
            leftLeg.rotation.x += (-swing * 0.65 - leftLeg.rotation.x) * 0.2;
            rightLeg.rotation.x += (swing * 0.65 - rightLeg.rotation.x) * 0.2;

            let nearest = null;
            let nearestDistance = Infinity;
            interactiveZones.forEach((zone, index) => {
                screenPosition.copy(zone.anchor).project(camera);
                zone.tag.style.left = `${(screenPosition.x + 1) * root.clientWidth / 2}px`;
                zone.tag.style.top = `${(1 - screenPosition.y) * root.clientHeight / 2}px`;
                const distance = player.position.distanceTo(zone.position);
                const active = distance < zone.radius;
                zone.marker.material.opacity += ((active ? 0.5 : 0.12) - zone.marker.material.opacity) * 0.12;
                const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.3 + index) * 0.08;
                zone.marker.scale.setScalar(active ? 1.18 * pulse : pulse);
                zone.marker.rotation.z += delta * (active ? 0.75 : 0.22);
                if (active && distance < nearestDistance) {
                    nearest = zone;
                    nearestDistance = distance;
                }
            });
            setNearbyZone(nearest);

            cyanLight.intensity = 25 + (reducedMotion ? 0 : Math.sin(elapsed * 1.7) * 1);
            pinkLight.intensity = 24 + (reducedMotion ? 0 : Math.cos(elapsed * 1.3) * 1);
            renderer.render(scene, camera);
            requestAnimationFrame(animate);
        };

        resize();
        window.addEventListener('resize', resize, { passive: true });
        renderer.compile(scene, camera);
        root.classList.add('is-room-ready');
        animate();
    }
}
