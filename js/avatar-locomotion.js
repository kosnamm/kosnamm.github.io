import * as THREE from '../vendor/three/three.module.js';

const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const moveTowards = (value, target, amount) => value + THREE.MathUtils.clamp(target - value, -amount, amount);
const smoothStep = value => value * value * (3 - 2 * value);

/**
 * A grounded, kinematic walk controller. Root movement remains collision-safe;
 * each sole stays in world space until that foot is picked up for its next step.
 */
export class AvatarLocomotion {
    constructor({ position, yaw = 0, scale = .92, isBlocked = () => false, floorY = .035 }) {
        this.scale = Number.isFinite(scale) && scale > 0 ? scale : .92;
        this.floorY = floorY;
        this.isBlocked = isBlocked;
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.acceleration = new THREE.Vector3();
        this.yaw = yaw;
        this.yawVelocity = 0;
        this.speed = 0;
        this.distance = 0;
        this.turnRate = 0;
        this.support = 0;
        this.stepWeight = 0;
        this.landing = 0;
        this.feet = [-1, 1].map(side => ({
            side,
            position: new THREE.Vector3(),
            yaw,
            planted: true,
            swingProgress: 0,
        }));

        this._hipWidth = .19 * this.scale;
        this._reach = .28 * this.scale / .92;
        this._maxSpeed = 1.72;
        this._direction = new THREE.Vector3();
        this._desiredVelocity = new THREE.Vector3();
        this._delta = new THREE.Vector3();
        this._hip = new THREE.Vector3();
        this._candidate = new THREE.Vector3();
        this._before = new THREE.Vector3();
        this._frameVelocity = new THREE.Vector3();
        this._landingTarget = new THREE.Vector3();
        this.reset(position || new THREE.Vector3(), yaw);
    }

    reset(position, yaw = 0) {
        this.position.copy(position);
        this.yaw = Number.isFinite(yaw) ? wrapAngle(yaw) : 0;
        this._targetYaw = this.yaw;
        this._nextSide = -1;
        this._swing = null;
        this._doubleSupport = 0;
        this._wasReduced = false;
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.yawVelocity = 0;
        this.speed = this.distance = this.turnRate = 0;
        this.support = this.stepWeight = this.landing = 0;
        for (const foot of this.feet) {
            this._hipAt(this.position, this.yaw, foot.side, foot.position);
            foot.position.y = this.floorY;
            foot.yaw = this.yaw;
            foot.planted = true;
            foot.swingProgress = 0;
        }
    }

    // UI/blur can stop the root immediately without freezing a foot in midair.
    // Calling step afterwards with no input completes and settles that step.
    stop() {
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.yawVelocity = 0;
        this.speed = this.distance = this.turnRate = 0;
        this._targetYaw = this.yaw;
    }

    _hipAt(position, yaw, side, target) {
        const width = side * this._hipWidth;
        return target.set(position.x + Math.cos(yaw) * width, this.floorY, position.z - Math.sin(yaw) * width);
    }

    _canPlantFrom(position, target) {
        // Check the whole short reach, rather than allowing a target on the far
        // side of a thin obstacle simply because the endpoint happens to clear.
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .025));
        let last = 0;
        for (let i = 1; i <= samples; i++) {
            const fraction = i / samples;
            if (this.isBlocked(position.x + dx * fraction, position.z + dz * fraction)) break;
            last = fraction;
        }
        target.set(position.x + dx * last, this.floorY, position.z + dz * last);
        return target;
    }

    _withinPlants(position, yaw) {
        const limitSquared = this._reach * this._reach;
        for (const foot of this.feet) {
            if (!foot.planted) continue;
            this._hipAt(position, yaw, foot.side, this._hip);
            const dx = this._hip.x - foot.position.x;
            const dz = this._hip.z - foot.position.z;
            if (dx * dx + dz * dz > limitSquared) return false;
        }
        return true;
    }

    _turn(dt) {
        const error = wrapAngle(this._targetYaw - this.yaw);
        const desiredRate = THREE.MathUtils.clamp(error * 6.2, -3.8, 3.8);
        this.yawVelocity = moveTowards(this.yawVelocity, desiredRate, 15 * dt);
        if (Math.abs(error) < .0002 && Math.abs(this.yawVelocity) < .01) this.yawVelocity = 0;
        let delta = this.yawVelocity * dt;
        if (Math.abs(delta) > Math.abs(error) && Math.sign(delta) === Math.sign(error)) delta = error;
        if (!this._withinPlants(this.position, this.yaw + delta)) {
            let low = 0;
            let high = 1;
            for (let iteration = 0; iteration < 10; iteration++) {
                const middle = (low + high) / 2;
                if (this._withinPlants(this.position, this.yaw + delta * middle)) low = middle;
                else high = middle;
            }
            delta *= low;
        }
        this.yaw = wrapAngle(this.yaw + delta);
        this.yawVelocity = delta / dt;
    }

    _moveAxis(axis, amount, dt) {
        if (!amount) return;
        const start = this.position[axis];
        const count = Math.max(1, Math.ceil(Math.abs(amount) / .025));
        const increment = amount / count;
        for (let i = 0; i < count; i++) {
            this._candidate.copy(this.position);
            this._candidate[axis] += increment;
            if (this.isBlocked(this._candidate.x, this._candidate.z)) break;
            if (!this._withinPlants(this._candidate, this.yaw)) {
                let low = 0;
                let high = 1;
                for (let iteration = 0; iteration < 10; iteration++) {
                    const middle = (low + high) / 2;
                    this._candidate.copy(this.position);
                    this._candidate[axis] += increment * middle;
                    if (this._withinPlants(this._candidate, this.yaw)) low = middle;
                    else high = middle;
                }
                this.position[axis] += increment * low;
                break;
            }
            this.position.copy(this._candidate);
        }
        // Actual travel determines momentum. A wall cannot store velocity that
        // later launches the character when the input or obstacle changes.
        this.velocity[axis] = (this.position[axis] - start) / dt;
    }

    _move(dt, input) {
        const inputLength = input.length();
        if (inputLength > 1e-6) {
            this._targetYaw = Math.atan2(input.x, input.z);
            const alignment = Math.max(0, Math.cos(wrapAngle(this._targetYaw - this.yaw)));
            const turnSpeed = .35 + .65 * alignment;
            this._desiredVelocity.copy(input).multiplyScalar(this._maxSpeed * Math.min(1, inputLength) * turnSpeed / inputLength);
        } else {
            this._desiredVelocity.set(0, 0, 0);
        }
        this._delta.copy(this._desiredVelocity).sub(this.velocity);
        const braking = !inputLength || this.velocity.dot(this._desiredVelocity) < 0;
        const change = Math.min(this._delta.length(), (braking ? 9 : 6) * dt);
        if (change) this.velocity.addScaledVector(this._delta.normalize(), change);
        this._turn(dt);
        this._moveAxis('x', this.velocity.x * dt, dt);
        this._moveAxis('z', this.velocity.z * dt, dt);
        this.speed = this.velocity.length();
    }

    _setTarget(swing) {
        const remaining = swing.duration - swing.elapsed;
        this._candidate.copy(this.position).addScaledVector(this.velocity, remaining);
        // Replant around the heading being approached, so a pivot is made from
        // alternating steps instead of turning over two fixed, parallel feet.
        const error = wrapAngle(this._targetYaw - this.yaw);
        // Aim into the first half of the upcoming support phase as well as
        // flight. On the outside of a pivot the hip keeps travelling around
        // the body after touchdown; ignoring that arc makes the leg run out
        // of reach just before the other sole can land.
        const turnLead = Math.min(.92, Math.abs(this.yawVelocity) * (remaining + swing.duration * .45) + .08);
        const predictedYaw = this.yaw + THREE.MathUtils.clamp(error, -turnLead, turnLead);
        this._hipAt(this._candidate, predictedYaw, swing.foot.side, this._landingTarget);
        this._landingTarget.addScaledVector(this.velocity, .085);
        this._landingTarget.y = this.floorY;
        this._canPlantFrom(this.position, this._landingTarget);
        swing.target.copy(this._landingTarget);
        swing.targetYaw = wrapAngle(predictedYaw);
    }

    _startSwing(foot) {
        const duration = .19 - .025 * Math.min(1, this.speed / this._maxSpeed) + foot.side * .005;
        this._swing = {
            foot,
            from: foot.position.clone(),
            fromYaw: foot.yaw,
            target: foot.position.clone(),
            targetYaw: foot.yaw,
            elapsed: 0,
            duration,
        };
        foot.planted = false;
        foot.swingProgress = 0;
        this._setTarget(this._swing);
    }

    _chooseStep() {
        if (this._swing) return;
        let urgent = null;
        for (const foot of this.feet) {
            this._hipAt(this.position, this.yaw, foot.side, this._hip);
            if (foot.position.distanceToSquared(this._hip) > this._reach * this._reach * .70) urgent = foot;
        }
        // A brief double-support beat is useful, but an accelerating body must
        // transfer weight before the old trailing leg reaches its hard limit.
        if (this._doubleSupport > 0 && !urgent) return;
        const turning = Math.abs(this.yawVelocity) > .16 || this.feet.some(foot => Math.abs(wrapAngle(this._targetYaw - foot.yaw)) > .22);
        if (this.speed > .075 || turning) {
            // Normally alternate. A particularly stretched foot gets the next
            // turn if a quick reversal made it the one that must be picked up.
            let selected = urgent || this.feet.find(foot => foot.side === this._nextSide);
            for (const foot of this.feet) {
                this._hipAt(this.position, this.yaw, foot.side, this._hip);
                if (foot.position.distanceToSquared(this._hip) > this._reach * this._reach * .75) selected = foot;
            }
            this._startSwing(selected);
            return;
        }
        let selected = null;
        let largestError = 0;
        for (const foot of this.feet) {
            this._hipAt(this.position, this.yaw, foot.side, this._hip);
            this._landingTarget.copy(this._hip);
            this._canPlantFrom(this.position, this._landingTarget);
            // Near a wall the comfortable reachable stance can be narrower.
            // Compare with that stance so an impossible ideal pose cannot
            // cause an endless sequence of corrective steps after stopping.
            const distance = foot.position.distanceTo(this._landingTarget);
            const yawError = Math.abs(wrapAngle(this.yaw - foot.yaw));
            const error = Math.max(distance / .035, yawError / .11);
            if (error > 1 && error > largestError) {
                largestError = error;
                selected = foot;
            }
        }
        if (selected) this._startSwing(selected);
    }

    _stepFeet(dt) {
        this._doubleSupport = Math.max(0, this._doubleSupport - dt);
        this._chooseStep();
        const swing = this._swing;
        if (!swing) {
            this.support = 0;
            return;
        }
        swing.elapsed = Math.min(swing.duration, swing.elapsed + dt);
        const progress = swing.elapsed / swing.duration;
        // Early in flight the landing can follow a change of direction. The
        // final portion commits to its world-space contact point before impact.
        if (progress < .68) this._setTarget(swing);
        const foot = swing.foot;
        foot.swingProgress = progress;
        foot.position.lerpVectors(swing.from, swing.target, smoothStep(progress));
        this._hipAt(this.position, this.yaw, foot.side, this._hip);
        this._delta.copy(foot.position).sub(this._hip);
        this._delta.y = 0;
        if (this._delta.lengthSq() > this._reach * this._reach) {
            this._delta.setLength(this._reach);
            foot.position.copy(this._hip).add(this._delta);
        }
        foot.position.y = this.floorY + Math.pow(Math.sin(Math.PI * progress), 1.25) * .078 * this.scale;
        foot.yaw = wrapAngle(swing.fromYaw + wrapAngle(swing.targetYaw - swing.fromYaw) * smoothStep(progress));
        this.support = -foot.side;
        if (progress >= 1) {
            this._canPlantFrom(this.position, foot.position);
            foot.position.y = this.floorY;
            foot.planted = true;
            foot.swingProgress = 0;
            this._nextSide = -foot.side;
            this._swing = null;
            this._doubleSupport = .016;
            this.support = 0;
            this.landing = 1;
        }
    }

    step(dt, inputDirection, { disabled = false, reducedMotion = false } = {}) {
        const elapsed = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .05) : 0;
        this.distance = 0;
        this.acceleration.set(0, 0, 0);
        this.turnRate = 0;
        if (!elapsed) return;
        this._frameVelocity.copy(this.velocity);
        const initialYaw = this.yaw;
        this._direction.set(
            Number.isFinite(inputDirection?.x) ? inputDirection.x : 0,
            0,
            Number.isFinite(inputDirection?.z) ? inputDirection.z : 0,
        );
        this._direction.clampLength(0, 1);
        if (disabled) {
            this._direction.set(0, 0, 0);
            this.stop();
            this._frameVelocity.set(0, 0, 0);
        }
        if (reducedMotion || this._wasReduced) {
            this._swing = null;
            this._doubleSupport = 0;
            for (const foot of this.feet) {
                this._hipAt(this.position, this.yaw, foot.side, foot.position);
                foot.position.y = this.floorY;
                foot.yaw = this.yaw;
                foot.planted = true;
                foot.swingProgress = 0;
            }
        }
        const count = Math.max(1, Math.ceil(elapsed * 120));
        const h = elapsed / count;
        for (let i = 0; i < count; i++) {
            this._before.copy(this.position);
            if (!reducedMotion) this._chooseStep();
            if (!disabled) this._move(h, this._direction);
            this.distance += this._before.distanceTo(this.position);
            this.landing *= Math.exp(-h / .085);
            if (reducedMotion) {
                // Accessible motion keeps the same controls and smoothed yaw,
                // with grounded soles and no lift, impact pulse or gait bounce.
                for (const foot of this.feet) {
                    this._hipAt(this.position, this.yaw, foot.side, foot.position);
                    foot.yaw = this.yaw;
                }
                this.support = this.stepWeight = this.landing = 0;
            } else {
                this._stepFeet(h);
                const activity = Math.max(Math.min(1, this.speed / this._maxSpeed), this._swing ? .25 : 0);
                this.stepWeight += (activity - this.stepWeight) * (1 - Math.exp(-10 * h));
            }
        }
        this._wasReduced = reducedMotion;
        this.speed = this.velocity.length();
        this.turnRate = wrapAngle(this.yaw - initialYaw) / elapsed;
        this.acceleration.copy(this.velocity).sub(this._frameVelocity).divideScalar(elapsed).clampLength(0, 18);
    }
}
