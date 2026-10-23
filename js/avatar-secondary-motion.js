import * as THREE from '../vendor/three/three.module.js';

const DOWN = new THREE.Vector3(0, -1, 0);

// Semi-fixed integration with explicit joint limits, independent of render FPS.
export function stepAngularSpring(state, target, stiffness, drag, dt, limit = .35) {
    const steps = Math.max(1, Math.ceil(Math.min(dt, .05) * 120));
    const h = Math.min(dt, .05) / steps;
    for (let i = 0; i < steps; i++) {
        state.velocity += ((target - state.angle) * stiffness - state.velocity * drag) * h;
        state.angle += state.velocity * h;
        if (Math.abs(state.angle) > limit) {
            state.angle = THREE.MathUtils.clamp(state.angle, -limit, limit);
            state.velocity *= -.15;
        }
    }
    return state.angle;
}

// A two-link arm with passive inertia and a weak optional balancing effort.
// Elbow and hand are constrained by length, gravity, body clearance and floor.
export class SecondaryArm {
    constructor(side, shoulder, upperLength = .43, lowerLength = .48) {
        this.side = side;
        this.shoulder = shoulder.clone();
        this.lengths = [upperLength, lowerLength];
        this.nodes = [0, 1, 2].map(() => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), before: new THREE.Vector3() }));
        this.anchor = new THREE.Vector3();
        this.lastAnchor = new THREE.Vector3();
        this.inverseBody = new THREE.Matrix4();
        this.local = new THREE.Vector3();
        this.delta = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.oldDirection = new THREE.Vector3();
        this.balanceTarget = new THREE.Vector3();
        this.initialized = false;
    }

    reset(bodyMatrix) {
        const offsets = [[0, 0], [this.side * .09, -.42], [this.side * .16, -.895]];
        this.nodes.forEach((node, i) => {
            node.position.copy(this.shoulder).add(new THREE.Vector3(offsets[i][0], offsets[i][1], 0)).applyMatrix4(bodyMatrix);
            node.velocity.set(0, 0, 0);
        });
        this.lastAnchor.copy(this.nodes[0].position);
        this.initialized = true;
    }

    solveLength(a, b, length, weightA, weightB) {
        this.delta.copy(b.position).sub(a.position);
        const distance = this.delta.length();
        if (distance < 1e-7) return;
        const correction = (distance - length) / (distance * (weightA + weightB));
        a.position.addScaledVector(this.delta, correction * weightA);
        b.position.addScaledVector(this.delta, -correction * weightB);
    }

    clearBody(node, bodyMatrix) {
        this.local.copy(node.position).applyMatrix4(this.inverseBody);
        // Ellipsoid includes the limb's radius. It prevents hands entering the belly.
        const cx = this.local.x / .49;
        const cy = (this.local.y - 1.23) / .65;
        const cz = this.local.z / .39;
        const distance = Math.hypot(cx, cy, cz);
        if (distance < 1 && distance > 1e-6) {
            this.local.set(cx / distance * .49, 1.23 + cy / distance * .65, cz / distance * .39);
        }
        // The head is a separate collider above the belly.
        const hx = this.local.x / .43;
        const hy = (this.local.y - 2.10) / .43;
        const hz = (this.local.z - .025) / .43;
        const headDistance = Math.hypot(hx, hy, hz);
        if (headDistance < 1 && headDistance > 1e-6) {
            this.local.set(hx / headDistance * .43, 2.10 + hy / headDistance * .43, .025 + hz / headDistance * .43);
        }
        // Keep each arm on its own side, with room to swing fore/aft.
        this.local.x = this.side * Math.max(this.side * this.local.x, .29);
        node.position.copy(this.local).applyMatrix4(bodyMatrix);
        node.position.y = Math.max(node.position.y, .13);
    }

    step(dt, bodyMatrix, scale = 1, reducedMotion = false, balance = null) {
        if (!this.initialized || reducedMotion) this.reset(bodyMatrix);
        this.inverseBody.copy(bodyMatrix).invert();
        this.anchor.copy(this.shoulder).applyMatrix4(bodyMatrix);
        if (reducedMotion) return;
        const steps = Math.max(1, Math.ceil(Math.min(dt, .05) * 120));
        const h = Math.min(dt, .05) / steps;
        if (h <= 0) return;
        for (let substep = 0; substep < steps; substep++) {
            const root = this.nodes[0];
            root.position.lerpVectors(this.lastAnchor, this.anchor, (substep + 1) / steps);
            for (const [index, node] of this.nodes.slice(1).entries()) {
                node.before.copy(node.position);
                node.velocity.multiplyScalar(Math.exp(-2.8 * h));
                node.velocity.y -= 9.81 * h;
                // A weak balancing effort, opposed to the same-side foot. The
                // joints still lag behind the shoulder under their own inertia.
                if (balance) {
                    this.balanceTarget.set(this.side * (index ? .17 : .10), index ? -.84 : -.40,
                        balance.forward * (index ? 1 : .45));
                    this.balanceTarget.x += this.side * balance.outward;
                    this.balanceTarget.add(this.shoulder).applyMatrix4(bodyMatrix).sub(node.position);
                    node.velocity.addScaledVector(this.balanceTarget, 12 * h);
                }
                node.position.addScaledVector(node.velocity, h);
            }
            for (let iteration = 0; iteration < 12; iteration++) {
                this.solveLength(root, this.nodes[1], this.lengths[0] * scale, 0, 1);
                this.solveLength(this.nodes[1], this.nodes[2], this.lengths[1] * scale, 1, .8);
                this.clearBody(this.nodes[1], bodyMatrix);
                this.clearBody(this.nodes[2], bodyMatrix);
            }
            for (const node of this.nodes.slice(1)) {
                node.velocity.copy(node.position).sub(node.before).divideScalar(h).clampLength(0, 5);
            }
        }
        this.lastAnchor.copy(this.anchor);
    }

    pose(upperBone, lowerBone) {
        this.local.copy(this.nodes[0].position).applyMatrix4(this.inverseBody);
        this.direction.copy(this.nodes[1].position).applyMatrix4(this.inverseBody).sub(this.local).normalize();
        upperBone.quaternion.setFromUnitVectors(DOWN, this.direction);
        this.local.copy(this.nodes[1].position).applyMatrix4(this.inverseBody);
        this.direction.copy(this.nodes[2].position).applyMatrix4(this.inverseBody).sub(this.local).normalize();
        this.oldDirection.copy(this.direction).applyQuaternion(upperBone.quaternion.clone().invert());
        lowerBone.quaternion.setFromUnitVectors(DOWN, this.oldDirection);
    }
}
