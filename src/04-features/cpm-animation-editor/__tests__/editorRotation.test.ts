import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { pivotRotationOffset, type PivotRotationInput } from '../editorRotation'

const input = (overrides: Partial<PivotRotationInput> = {}): PivotRotationInput => ({
  pivotLocal: new THREE.Vector3(3, 0, 0),
  pivotScale: new THREE.Vector3(1, 1, 1),
  startQuaternion: new THREE.Quaternion(),
  baseRotation: new THREE.Euler(),
  additive: false,
  startRotation: { x: 0, y: 0, z: 0 },
  deltaYaw: 0,
  deltaPitch: 0,
  ...overrides,
})

const nextQuaternion = (euler: THREE.Euler): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(euler)

describe('pivotRotationOffset', () => {
  it('returns no offset without rotation', () => {
    expect(pivotRotationOffset(input())).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('compensates the position of a rotated tip', () => {
    const offset = pivotRotationOffset(input({ deltaYaw: 90 }))
    expect(offset.x).toBeCloseTo(3)
    expect(offset.y).toBeCloseTo(0)
    expect(offset.z).toBeCloseTo(3)
  })

  it('keeps a point on the rotation axis fixed', () => {
    const offset = pivotRotationOffset(input({
      pivotLocal: new THREE.Vector3(0, 5, 0),
      deltaYaw: 90,
    }))
    expect(offset.x).toBeCloseTo(0)
    expect(offset.y).toBeCloseTo(0)
    expect(offset.z).toBeCloseTo(0)
  })

  it('keeps the tip in place after applying the compensation', () => {
    const source = input({
      pivotLocal: new THREE.Vector3(2, 3, 1),
      startRotation: { x: 15, y: 20, z: 35 },
      startQuaternion: nextQuaternion(new THREE.Euler(
        THREE.MathUtils.degToRad(15),
        -THREE.MathUtils.degToRad(20),
        -THREE.MathUtils.degToRad(35),
        'ZYX',
      )),
      deltaYaw: 40,
      deltaPitch: -12,
    })
    const offset = pivotRotationOffset(source)
    const next = nextQuaternion(new THREE.Euler(
      THREE.MathUtils.degToRad(3),
      -THREE.MathUtils.degToRad(60),
      -THREE.MathUtils.degToRad(35),
      'ZYX',
    ))
    const positionDelta = new THREE.Vector3(offset.x, -offset.y, -offset.z)
    const oldTip = source.pivotLocal.clone().applyQuaternion(source.startQuaternion)
    const newTip = source.pivotLocal.clone().applyQuaternion(next)
    expect(positionDelta.clone().add(newTip).distanceTo(oldTip)).toBeLessThan(1e-6)
  })

  it('uses the base rotation of an additive animation', () => {
    const baseRotation = new THREE.Euler(0.3, 0.2, 0.1, 'XYZ')
    const startQuaternion = nextQuaternion(new THREE.Euler(0.3, 0.2, 0.1, 'ZYX'))
    const source = input({
      pivotLocal: new THREE.Vector3(2, 0, 4),
      additive: true,
      baseRotation,
      startQuaternion,
      deltaPitch: 25,
    })
    const offset = pivotRotationOffset(source)
    const next = nextQuaternion(new THREE.Euler(
      baseRotation.x + THREE.MathUtils.degToRad(25),
      baseRotation.y,
      baseRotation.z,
      'ZYX',
    ))
    const positionDelta = new THREE.Vector3(offset.x, -offset.y, -offset.z)
    const oldTip = source.pivotLocal.clone().applyQuaternion(startQuaternion)
    const newTip = source.pivotLocal.clone().applyQuaternion(next)
    expect(positionDelta.clone().add(newTip).distanceTo(oldTip)).toBeLessThan(1e-6)
  })
})
