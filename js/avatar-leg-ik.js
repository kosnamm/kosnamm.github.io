import * as THREE from '../vendor/three/three.module.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const target = new THREE.Vector3();
const direction = new THREE.Vector3();
const bend = new THREE.Vector3();
const knee = new THREE.Vector3();
const lowerDirection = new THREE.Vector3();
const inverseUpper = new THREE.Quaternion();
const parentRotation = new THREE.Quaternion();
const footRotation = new THREE.Quaternion();

// The controller supplies a world-space sole position, locked throughout stance.
// Solve both leg segments in the hip frame, then keep the ankle level in world
// space. This also supports sideways steps and turns without twisting a plant.
export function posePlantedLeg(leg, contact, scale = .92) {
    leg.hipPivot.updateWorldMatrix(true, false);
    target.copy(contact.position);
    target.y += .14 * scale;
    leg.hipPivot.worldToLocal(target);
    const reach = THREE.MathUtils.clamp(target.length(), .04, .599);
    direction.copy(target).normalize();
    target.copy(direction).multiplyScalar(reach);
    bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (bend.lengthSq() < .0001) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);
    bend.normalize();
    knee.copy(direction).multiplyScalar(reach * .5)
        .addScaledVector(bend, Math.sqrt(Math.max(0, .30 ** 2 - (reach * .5) ** 2)));
    leg.hip.quaternion.setFromUnitVectors(DOWN, lowerDirection.copy(knee).normalize());
    inverseUpper.copy(leg.hip.quaternion).invert();
    lowerDirection.copy(target).sub(knee).normalize().applyQuaternion(inverseUpper);
    leg.knee.quaternion.setFromUnitVectors(DOWN, lowerDirection);
    leg.knee.updateWorldMatrix(true, false);
    leg.knee.getWorldQuaternion(parentRotation);
    footRotation.setFromAxisAngle(UP, contact.yaw);
    leg.ankle.quaternion.copy(parentRotation).invert().multiply(footRotation);
}
