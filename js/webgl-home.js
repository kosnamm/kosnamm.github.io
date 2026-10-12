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

        const makeWallTitle = () => {
            const titleCanvas = document.createElement('canvas');
            titleCanvas.width = 1024;
            titleCanvas.height = 512;
            const context = titleCanvas.getContext('2d');
            context.clearRect(0, 0, titleCanvas.width, titleCanvas.height);
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.shadowBlur = 42;
            context.shadowColor = '#2ce5ff';
            context.fillStyle = '#dffcff';
            context.font = '700 142px ui-monospace, SFMono-Regular, Menlo, monospace';
            context.fillText("Matthew's", 512, 190);
            context.shadowColor = '#705cff';
            context.fillStyle = '#a89cff';
            context.font = '700 154px ui-monospace, SFMono-Regular, Menlo, monospace';
            context.fillText('Studio', 512, 342);

            const texture = new THREE.CanvasTexture(titleCanvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                toneMapped: false
            });
            const title = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.85), material);
            title.position.set(-5.63, 3.28, -2.7);
            title.rotation.y = Math.PI / 2;
            title.renderOrder = 8;
            return title;
        };

        const addObstacle = (minX, maxX, minZ, maxZ) => {
            obstacles.push({ minX, maxX, minZ, maxZ });
        };

        const registerZone = ({ id, label, kicker, group, position, radius = 1.85, color }) => {
            const ringMaterial = basic(color, 0.2);
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

            interactiveZones.push({ id, label, kicker, group, position, radius, marker, color });
        };

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;

        renderer.setClearColor(0x000000, 0);
        scene.background = null;
        scene.fog = new THREE.FogExp2(0x060711, 0.025);

        const hemi = new THREE.HemisphereLight(0x8297ff, 0x17101f, 1.45);
        scene.add(hemi);

        const keyLight = new THREE.DirectionalLight(0xc7d4ff, 3.1);
        keyLight.position.set(7, 12, 9);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.left = -9;
        keyLight.shadow.camera.right = 9;
        keyLight.shadow.camera.top = 9;
        keyLight.shadow.camera.bottom = -9;
        scene.add(keyLight);

        const cyanLight = new THREE.PointLight(palette.cyan, 13, 8, 2);
        cyanLight.position.set(-3.6, 2.1, -2.4);
        scene.add(cyanLight);

        const pinkLight = new THREE.PointLight(palette.pink, 10, 9, 2);
        pinkLight.position.set(4.2, 1.5, 2.8);
        scene.add(pinkLight);

        const room = new THREE.Group();
        scene.add(room);

        box(room, [12, 0.35, 9.5], [0, -0.2, 0], standard(palette.floor, { roughness: 0.92 }));
        box(room, [12, 5.4, 0.28], [0, 2.5, -4.65], standard(palette.wall, { roughness: 0.88 }));
        box(room, [0.28, 5.4, 9.5], [-5.85, 2.5, 0], standard(palette.wallAlt, { roughness: 0.88 }));

        for (let x = -5.2; x <= 5.2; x += 1.3) {
            box(room, [0.018, 0.012, 9], [x, 0.005, 0], basic(0x2e385a, 0.28), { castShadow: false });
        }
        for (let z = -4; z <= 4; z += 1.3) {
            box(room, [11.4, 0.012, 0.018], [0, 0.006, z], basic(0x2e385a, 0.28), { castShadow: false });
        }

        const edgeMaterial = basic(palette.violet, 0.9);
        box(room, [12.1, 0.045, 0.045], [0, 5.18, -4.43], edgeMaterial, { castShadow: false });
        box(room, [0.045, 0.045, 9.5], [-5.62, 5.18, 0], basic(palette.cyan, 0.88), { castShadow: false });
        box(room, [0.06, 0.06, 5.1], [-5.61, 2.48, -4.42], basic(palette.pink, 0.75), { rotation: [0, 0, Math.PI / 2], castShadow: false });

        box(room, [0.055, 2.3, 3.75], [-5.67, 3.25, -2.7], standard(0x0a0d1a, {
            roughness: 0.35,
            metalness: 0.22,
            emissive: palette.violet,
            emissiveIntensity: 0.08
        }), { castShadow: false });
        room.add(makeWallTitle());

        const rug = box(room, [4.8, 0.035, 3.35], [2.1, 0.01, 1.8], standard(0x211b3d, { roughness: 1 }));
        rug.rotation.y = -0.08;
        for (let index = 0; index < 3; index += 1) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.7 + index * 0.48, 0.73 + index * 0.48, 48),
                basic(index % 2 ? palette.violet : palette.pink, 0.16)
            );
            ring.position.set(2.2, 0.045, 1.8);
            ring.rotation.x = -Math.PI / 2;
            room.add(ring);
        }

        const desk = new THREE.Group();
        scene.add(desk);
        const deskTop = standard(palette.wood, { roughness: 0.5 });
        box(desk, [4.1, 0.22, 1.45], [-2.75, 1.05, -3.15], deskTop);
        [-4.45, -1.05].forEach((x) => {
            [-3.65, -2.67].forEach((z) => box(desk, [0.16, 1.05, 0.16], [x, 0.52, z], standard(0x171423)));
        });
        box(desk, [1.95, 1.12, 0.13], [-2.75, 1.88, -3.62], standard(0x151b2e, { metalness: 0.25 }));
        const monitorGlow = standard(0x162a3d, { emissive: palette.cyan, emissiveIntensity: 2.6, roughness: 0.25 });
        box(desk, [1.7, 0.88, 0.04], [-2.75, 1.88, -3.53], monitorGlow, { castShadow: false });
        box(desk, [0.16, 0.55, 0.12], [-2.75, 1.23, -3.55], standard(0x151722));
        box(desk, [1.18, 0.06, 0.58], [-2.65, 1.19, -2.93], standard(0x121620, { metalness: 0.2 }));
        cylinder(desk, 0.24, 0.4, [-4.03, 1.35, -3.12], standard(0x273041, { emissive: palette.pink, emissiveIntensity: 1.2 }), 16);
        const blogLabel = makeLabel('BLOG', '#2ce5ff');
        blogLabel.position.set(-2.75, 2.82, -3.55);
        desk.add(blogLabel);
        addObstacle(-4.9, -0.62, -4.25, -2.35);
        registerZone({
            id: 'blog', label: 'Read the Blog', kicker: 'DESK COMPUTER', group: desk,
            position: new THREE.Vector3(-2.7, 0, -1.85), radius: 1.72, color: palette.cyan
        });

        const chair = new THREE.Group();
        scene.add(chair);
        cylinder(chair, 0.58, 0.15, [-2.65, 0.55, -1.72], standard(0x2a2b45), 12);
        box(chair, [1.25, 1.05, 0.16], [-2.65, 1.15, -1.25], standard(0x31345a), { rotation: [-0.18, 0, 0] });
        cylinder(chair, 0.1, 0.62, [-2.65, 0.28, -1.72], standard(0x12131d, { metalness: 0.5 }), 10);
        addObstacle(-3.45, -1.85, -2.25, -0.88);

        const gallery = new THREE.Group();
        scene.add(gallery);
        const galleryColors = [palette.pink, palette.cyan, palette.amber];
        const galleryXs = [1.7, 3.05, 4.3];
        galleryXs.forEach((x, index) => {
            const height = index === 1 ? 1.55 : 1.22;
            box(gallery, [1.02, height, 0.12], [x, 2.65 + (index === 1 ? 0.2 : 0), -4.42], standard(0x111421, { metalness: 0.35 }));
            box(gallery, [0.84, height - 0.18, 0.035], [x, 2.65 + (index === 1 ? 0.2 : 0), -4.34], standard(0x242b48, {
                emissive: galleryColors[index], emissiveIntensity: 1.45, roughness: 0.35
            }), { castShadow: false });
        });
        const galleryLabel = makeLabel('GALLERY', '#ff4fa1');
        galleryLabel.position.set(3.05, 3.9, -4.28);
        gallery.add(galleryLabel);
        registerZone({
            id: 'gallery', label: 'Open the Photo Wall', kicker: 'GALLERY', group: gallery,
            position: new THREE.Vector3(3.1, 0, -3.15), radius: 1.82, color: palette.pink
        });

        const shelf = new THREE.Group();
        scene.add(shelf);
        box(shelf, [0.5, 3.65, 2.45], [-5.45, 1.82, 1.08], standard(0x251c35));
        [0.45, 1.35, 2.25, 3.15].forEach((y) => {
            box(shelf, [0.72, 0.12, 2.5], [-5.15, y, 1.08], standard(0x49304f));
        });
        const bookColors = [palette.violet, palette.pink, palette.cyan, palette.lime, palette.amber];
        for (let index = 0; index < 12; index += 1) {
            const y = 0.76 + Math.floor(index / 4) * 0.9;
            const z = 0.28 + (index % 4) * 0.46;
            box(shelf, [0.38, 0.56 + (index % 3) * 0.08, 0.26], [-4.84, y, z], standard(bookColors[index % bookColors.length], {
                emissive: bookColors[index % bookColors.length], emissiveIntensity: 0.18
            }));
        }
        const aboutLabel = makeLabel('ABOUT', '#86ff78');
        aboutLabel.position.set(-4.9, 4.05, 2.05);
        aboutLabel.rotation.y = Math.PI / 2;
        shelf.add(aboutLabel);
        addObstacle(-5.55, -4.45, -0.35, 2.55);
        registerZone({
            id: 'about', label: 'Browse the Bookshelf', kicker: 'ABOUT', group: shelf,
            position: new THREE.Vector3(-4.0, 0, 1.1), radius: 1.65, color: palette.lime
        });

        const timeline = new THREE.Group();
        scene.add(timeline);
        box(timeline, [2.45, 0.16, 0.82], [3.78, 0.38, 3.22], standard(0x16182b, { metalness: 0.3 }));
        box(timeline, [2.25, 2.15, 0.15], [3.78, 1.53, 3.42], standard(0x111525, { metalness: 0.28 }));
        const timelineLine = basic(palette.violet, 0.95);
        box(timeline, [1.72, 0.055, 0.04], [3.78, 1.6, 3.31], timelineLine, { castShadow: false });
        [-0.68, 0, 0.68].forEach((offset, index) => {
            cylinder(timeline, 0.095, 0.055, [3.78 + offset, 1.6, 3.26], basic(galleryColors[index], 1), 18).rotation.x = Math.PI / 2;
        });
        const timelineLabel = makeLabel('TIMELINE', '#705cff');
        timelineLabel.position.set(3.78, 3.05, 3.34);
        timeline.add(timelineLabel);
        addObstacle(2.45, 5.0, 2.74, 3.88);
        registerZone({
            id: 'timeline', label: 'View the Timeline', kicker: 'MILESTONES', group: timeline,
            position: new THREE.Vector3(2.65, 0, 2.55), radius: 1.7, color: palette.violet
        });

        const sofa = new THREE.Group();
        scene.add(sofa);
        box(sofa, [2.5, 0.6, 1.25], [0.62, 0.46, 3.25], standard(0x272641));
        box(sofa, [2.5, 1.22, 0.35], [0.62, 1.0, 3.75], standard(0x302d50), { rotation: [-0.13, 0, 0] });
        box(sofa, [0.34, 0.78, 1.25], [-0.76, 0.62, 3.25], standard(0x302d50));
        box(sofa, [0.34, 0.78, 1.25], [2.0, 0.62, 3.25], standard(0x302d50));
        addObstacle(-0.95, 2.2, 2.55, 4.25);

        const sideTable = new THREE.Group();
        scene.add(sideTable);
        cylinder(sideTable, 0.62, 0.12, [3.25, 0.72, 0.82], standard(0x482851), 18);
        cylinder(sideTable, 0.08, 0.68, [3.25, 0.34, 0.82], standard(0x171522, { metalness: 0.4 }), 10);
        box(sideTable, [0.68, 0.06, 0.44], [3.25, 0.84, 0.82], standard(0x15192a, { emissive: palette.pink, emissiveIntensity: 0.45 }));
        addObstacle(2.5, 4.0, 0.05, 1.58);

        const player = new THREE.Group();
        player.position.set(0, 0, 0.35);
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

        camera.position.set(12.8, 14.5, 16.2);
        camera.lookAt(0, 0.85, 0);

        const movementForward = new THREE.Vector3(-1, 0, -1).normalize();
        const movementRight = new THREE.Vector3(1, 0, -1).normalize();
        const moveDirection = new THREE.Vector3();
        const nextPosition = new THREE.Vector3();
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
            const viewHeight = aspect < 1 ? 14.5 / aspect : 21;
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
            if (x < -5.3 || x > 5.3 || z < -4.15 || z > 4.12) return true;
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
                const distance = player.position.distanceTo(zone.position);
                const active = distance < zone.radius;
                zone.marker.material.opacity += ((active ? 0.72 : 0.17) - zone.marker.material.opacity) * 0.12;
                const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.3 + index) * 0.08;
                zone.marker.scale.setScalar(active ? 1.18 * pulse : pulse);
                zone.marker.rotation.z += delta * (active ? 0.75 : 0.22);
                if (active && distance < nearestDistance) {
                    nearest = zone;
                    nearestDistance = distance;
                }
            });
            setNearbyZone(nearest);

            cyanLight.intensity = 11.5 + Math.sin(elapsed * 1.7) * 1.5;
            pinkLight.intensity = 8.5 + Math.cos(elapsed * 1.3) * 1.2;
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
