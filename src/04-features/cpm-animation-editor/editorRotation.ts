import * as THREE from 'three'
import type { CPMVec3 } from '@/05-entities'

export interface PivotRotationInput {
  pivotLocal: THREE.Vector3
  pivotScale: THREE.Vector3
  startQuaternion: THREE.Quaternion
  baseRotation: THREE.Euler
  additive: boolean
  startRotation: CPMVec3
  deltaYaw: number
  deltaPitch: number
}

export function pivotRotationOffset(input: PivotRotationInput): CPMVec3 {
  const nextRotation: CPMVec3 = {
    x: input.startRotation.x + input.deltaPitch,
    y: input.startRotation.y + input.deltaYaw,
    z: input.startRotation.z,
  }
  const nextQuaternion = nextGroupQuaternion(input, nextRotation)
  const scaledPivot = input.pivotLocal.clone().multiply(input.pivotScale)
  const oldTip = scaledPivot.clone().applyQuaternion(input.startQuaternion)
  const newTip = scaledPivot.clone().applyQuaternion(nextQuaternion)
  const delta = oldTip.sub(newTip)
  return { x: delta.x, y: negate(delta.y), z: negate(delta.z) }
}

function nextGroupQuaternion(input: PivotRotationInput, rotation: CPMVec3): THREE.Quaternion {
  const radians = THREE.MathUtils.degToRad
  const euler = input.additive
    ? new THREE.Euler(
      input.baseRotation.x + radians(rotation.x),
      input.baseRotation.y - radians(rotation.y),
      input.baseRotation.z - radians(rotation.z),
      'ZYX',
    )
    : new THREE.Euler(
      radians(rotation.x),
      -radians(rotation.y),
      -radians(rotation.z),
      'ZYX',
    )
  return new THREE.Quaternion().setFromEuler(euler)
}

function negate(value: number): number {
  return value === 0 ? 0 : -value
}
