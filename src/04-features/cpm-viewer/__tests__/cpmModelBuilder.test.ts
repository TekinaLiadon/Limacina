import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCpmModel } from '../cpmModelBuilder'
import type { CPMChild, CPMConfig, CPMElement } from '@/05-entities'

const FACES = ['east', 'west', 'up', 'down', 'north', 'south'] as const
type FaceName = (typeof FACES)[number]

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'arm',
  size: { x: 4, y: 12, z: 4 },
  offset: { x: -2, y: -2, z: -2 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
})

const makeElement = (overrides: Partial<CPMElement> = {}): CPMElement => ({
  id: 'head',
  name: 'head',
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ...overrides,
})

const makeConfig = (elements: CPMElement[], overrides: Partial<CPMConfig> = {}): CPMConfig => ({
  skinSize: { x: 64, y: 64 },
  elements,
  ...overrides,
})

function firstMesh(group: THREE.Group): THREE.Mesh {
  let found: THREE.Mesh | null = null
  group.traverse((object) => {
    if (found === null && object instanceof THREE.Mesh) found = object
  })
  if (!found) throw new Error('меш не построен')
  return found
}

function faceAtlasRect(mesh: THREE.Mesh, face: FaceName): number[] {
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  const index = FACES.indexOf(face)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 4; i++) {
    xs.push(uv.getX(index * 4 + i) * 64)
    ys.push((1 - uv.getY(index * 4 + i)) * 64)
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(
    (value) => Math.round(value * 1000) / 1000,
  )
}

function faceUvCorners(mesh: THREE.Mesh, face: FaceName): Array<[number, number]> {
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  const base = FACES.indexOf(face) * 4
  const corners: Array<[number, number]> = []
  for (let i = 0; i < 4; i++) {
    corners.push([uv.getX(base + i), uv.getY(base + i)])
  }
  return corners
}

describe('buildCpmModel box UV', () => {
  it('раскладывает ванильный UV-регион куба по шести граням', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({ u: 40, v: 16, textureSize: 1 })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)

    expect(faceAtlasRect(mesh, 'east')).toEqual([40, 20, 44, 32])
    expect(faceAtlasRect(mesh, 'south')).toEqual([44, 20, 48, 32])
    expect(faceAtlasRect(mesh, 'west')).toEqual([48, 20, 52, 32])
    expect(faceAtlasRect(mesh, 'north')).toEqual([52, 20, 56, 32])
    expect(faceAtlasRect(mesh, 'up')).toEqual([44, 16, 48, 20])
    expect(faceAtlasRect(mesh, 'down')).toEqual([48, 16, 52, 20])
  })

  it('поворачивает UV-квад при faceUV rot 90', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({
        size: { x: 8, y: 8, z: 8 },
        faceUV: { north: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '90', autoUV: true } },
      })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)

    expect(faceUvCorners(mesh, 'north')).toEqual([
      [0, 0.875],
      [0, 1],
      [0.125, 0.875],
      [0.125, 1],
    ])
  })

  it('зеркальный куб после свапа получает внешнюю колонку на west, внутреннюю на east', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({ u: 40, v: 16, textureSize: 1, mirror: true })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)

    expect(faceAtlasRect(mesh, 'east')).toEqual([48, 20, 52, 32])
    expect(faceAtlasRect(mesh, 'west')).toEqual([40, 20, 44, 32])
    expect(faceAtlasRect(mesh, 'south')).toEqual([44, 20, 48, 32])
    expect(faceAtlasRect(mesh, 'north')).toEqual([52, 20, 56, 32])
  })

  it('singleTex кладёт один квадрат на все шесть граней', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({
        size: { x: 4, y: 4, z: 4 },
        u: 8,
        v: 8,
        textureSize: 1,
        singleTex: true,
      })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)

    for (const face of FACES) {
      expect(faceAtlasRect(mesh, face)).toEqual([8, 8, 12, 12])
    }
  })
})

describe('buildCpmModel extruded geometry', () => {
  it('строит шесть квадов с осями нормалей и вставляет полпикселя на стенках', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({
        size: { x: 4, y: 4, z: 4 },
        u: 0,
        v: 0,
        textureSize: 1,
        extrude: true,
      })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)
    const geo = mesh.geometry as THREE.BufferGeometry
    const positions = geo.getAttribute('position') as THREE.BufferAttribute
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute
    const uvs = geo.getAttribute('uv') as THREE.BufferAttribute

    expect(positions.count).toBe(36)

    const axisNormals = new Set<number[]>()
    for (let i = 0; i < normals.count; i += 6) {
      axisNormals.add([
        Math.round(normals.getX(i)),
        Math.round(normals.getY(i)),
        Math.round(normals.getZ(i)),
      ])
    }
    expect(axisNormals).toEqual(new Set([
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ]))

    const frontU = Array.from({ length: 6 }, (_, i) => uvs.getX(i))
    expect(Math.min(...frontU)).toBe(0)
    expect(Math.max(...frontU)).toBe(4 / 64)

    const eastU = Array.from({ length: 6 }, (_, i) => uvs.getX(12 + i))
    expect(Math.min(...eastU)).toBeCloseTo(3.5 / 64, 6)
    expect(Math.max(...eastU)).toBeCloseTo(3.5 / 64, 6)
  })
})

describe('buildCpmModel structure', () => {
  it('помечает ванильный корень isVanillaPart и мапит storeID ординалом', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ id: 'head', storeID: 100, children: [makeChild()] }),
    ]), new THREE.Texture())

    const [root] = model.children
    if (!(root instanceof THREE.Group)) throw new Error('корень не построен')
    expect(root.name).toBe('head')
    expect(root.userData.isRoot).toBe(true)
    expect(root.userData.isVanillaPart).toBe(true)
    expect(root.userData.storeID).toBe(0)
  })

  it('не помечает customPart корень как ванильный и уважает show: false', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({
        id: 'cape',
        customPart: true,
        show: false,
        storeID: 6,
        children: [makeChild()],
      }),
    ]), new THREE.Texture())

    const [root] = model.children
    if (!(root instanceof THREE.Group)) throw new Error('корень не построен')
    expect(root.userData.isVanillaPart).toBe(false)
    expect(root.userData.storeID).toBe(6)
    expect(root.visible).toBe(false)
  })

  it('пропускает dup-корень, когда ванильная часть с тем же id уже есть', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ id: 'head', children: [makeChild()] }),
      makeElement({ id: 'head', dup: true, storeID: 7, children: [makeChild()] }),
    ]), new THREE.Texture())

    expect(model.children).toHaveLength(1)
  })

  it('применяет scaling конфига к корню модели', () => {
    const model = buildCpmModel(makeConfig([makeElement({ children: [makeChild()] })], { scaling: 2 }), new THREE.Texture())

    expect(model.scale.x).toBe(2)
    expect(model.scale.y).toBe(2)
    expect(model.scale.z).toBe(2)
  })

  it('делает группу скрытого ребёнка невидимой и пишет layerId в userData меша', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [
        makeChild({ name: 'visible', storeID: 1 }),
        makeChild({ name: 'hidden', storeID: 2, hidden: true }),
      ] }),
    ]), new THREE.Texture())

    const groupsByName = new Map<string, THREE.Group>()
    const meshes: THREE.Mesh[] = []
    model.traverse((object) => {
      if (object instanceof THREE.Group && object.name === 'hidden') groupsByName.set(object.name, object)
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    expect(meshes).toHaveLength(2)
    expect(meshes[0]?.userData.layerId).toBe(1)
    expect(meshes[0]?.userData.animVisible).toBe(true)
    expect(meshes[1]?.userData.layerId).toBe(2)
    expect(meshes[1]?.userData.animVisible).toBe(false)
    expect(groupsByName.get('hidden')?.visible).toBe(false)
  })

  it('красит куб без текстуры в цвет из конфига', () => {
    const model = buildCpmModel(makeConfig([
      makeElement({ children: [makeChild({ texture: false, color: 'ff0000' })] }),
    ]), new THREE.Texture())
    const mesh = firstMesh(model)
    const material = mesh.material as THREE.MeshLambertMaterial

    expect(material.map).toBeNull()
    expect(material.color.getHexString()).toBe('ff0000')
  })
})
