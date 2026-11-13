import { describe, expect, it } from 'vitest'
import { array, assert, boolean, constant, constantFrom, double, integer, oneof, property, record, type Arbitrary } from 'fast-check'
import * as THREE from 'three'
import { buildFiguraModel } from '../figuraModelBuilder'
import {
  parseFiguraModel,
  type FiguraCubeNode,
  type FiguraEntry,
  type FiguraGroup,
  type FiguraMeshNode,
  type FiguraModel,
  type FiguraVec3,
} from '../figuraParser'

function vec3(x: number, y: number, z: number): FiguraVec3 {
  return { x, y, z }
}

function emptyModel(roots: FiguraEntry[], overrides: Partial<FiguraModel> = {}): FiguraModel {
  return {
    resolution: { width: 64, height: 64 },
    textureSize: { width: 64, height: 64 },
    nodes: [],
    roots,
    ...overrides,
  }
}

function cubeEntry(overrides: Partial<FiguraCubeNode> = {}): FiguraCubeNode {
  return {
    kind: 'cube',
    name: 'cube',
    uuid: 'cube-uuid',
    origin: vec3(0, 0, 0),
    rotation: vec3(0, 0, 0),
    visible: true,
    from: vec3(-4, 0, -4),
    to: vec3(4, 8, 4),
    inflate: 0,
    boxUv: false,
    mirrorUv: false,
    uvOffset: [0, 0],
    faces: {
      north: { uv: [0, 0, 8, 8], rotation: 0, texture: 0 },
      south: { uv: [8, 0, 16, 8], rotation: 0, texture: 0 },
      east: { uv: [16, 0, 24, 8], rotation: 0, texture: 0 },
      west: { uv: [24, 0, 32, 8], rotation: 0, texture: 0 },
      up: { uv: [32, 0, 40, 8], rotation: 0, texture: 0 },
      down: { uv: [40, 0, 48, 8], rotation: 0, texture: 0 },
    },
    ...overrides,
  }
}

function meshEntry(overrides: Partial<FiguraMeshNode> = {}): FiguraMeshNode {
  return {
    kind: 'mesh',
    name: 'mesh',
    uuid: 'mesh-uuid',
    origin: vec3(0, 0, 0),
    rotation: vec3(0, 0, 0),
    visible: true,
    vertices: {
      a: vec3(0, 0, 0),
      b: vec3(4, 0, 0),
      c: vec3(4, 4, 0),
      d: vec3(0, 4, 0),
    },
    faces: {
      quad: {
        vertices: ['a', 'b', 'c', 'd'],
        uv: { a: [0, 0], b: [4, 0], c: [4, 4], d: [0, 4] },
        texture: 0,
      },
    },
    ...overrides,
  }
}

function groupEntry(children: FiguraEntry[], overrides: Partial<FiguraGroup> = {}): FiguraGroup {
  return {
    kind: 'group',
    name: 'group',
    uuid: 'group-uuid',
    origin: vec3(0, 0, 0),
    rotation: vec3(0, 0, 0),
    visible: true,
    children,
    ...overrides,
  }
}

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  return meshes
}

function allFinite(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

function attributeValues(mesh: THREE.Mesh, name: 'position' | 'uv' | 'normal'): number[] {
  const attribute = mesh.geometry.getAttribute(name) as THREE.BufferAttribute | undefined
  if (attribute === undefined) return []
  return Array.from({ length: attribute.count * attribute.itemSize }, (_, index) => attribute.array[index] as number)
}

describe('buildFiguraModel', () => {
  it('строит непустую группу с мешами для куба и меша', () => {
    const model = emptyModel([cubeEntry(), meshEntry()], { nodes: [cubeEntry(), meshEntry()] })

    const group = buildFiguraModel(model, new THREE.Texture())

    expect(group).toBeInstanceOf(THREE.Group)
    expect(group.children).toHaveLength(2)
    expect(meshesOf(group)).toHaveLength(2)
  })

  it('даёт конечные координаты и UV куба и меша', () => {
    const model = emptyModel([cubeEntry(), meshEntry()], { nodes: [cubeEntry(), meshEntry()] })

    const group = buildFiguraModel(model, new THREE.Texture())

    for (const mesh of meshesOf(group)) {
      expect(mesh.position.toArray().every(Number.isFinite)).toBe(true)
      expect(allFinite(attributeValues(mesh, 'position'))).toBe(true)
      expect(allFinite(attributeValues(mesh, 'uv'))).toBe(true)
      expect(allFinite(attributeValues(mesh, 'normal'))).toBe(true)
    }
  })

  it('переносит поворот узла в rotation группы в порядке ZYX', () => {
    const node = cubeEntry({ rotation: vec3(10, 20, 30) })

    const group = buildFiguraModel(emptyModel([node]), new THREE.Texture())
    const [entryGroup] = group.children

    if (!(entryGroup instanceof THREE.Group)) throw new Error('группа узла не построена')
    expect(entryGroup.rotation.order).toBe('ZYX')
    expect(THREE.MathUtils.radToDeg(entryGroup.rotation.x)).toBeCloseTo(10, 6)
    expect(THREE.MathUtils.radToDeg(entryGroup.rotation.y)).toBeCloseTo(20, 6)
    expect(THREE.MathUtils.radToDeg(entryGroup.rotation.z)).toBeCloseTo(30, 6)
  })

  it('размещает вложенную группу относительно origin родителя', () => {
    const model = emptyModel([
      groupEntry([cubeEntry({ origin: vec3(0, 24, 0) })], { origin: vec3(0, 12, 0) }),
    ])

    const group = buildFiguraModel(model, new THREE.Texture())
    const [outer] = group.children
    if (!(outer instanceof THREE.Group)) throw new Error('внешняя группа не построена')
    const [inner] = outer.children
    if (!(inner instanceof THREE.Group)) throw new Error('вложенная группа не построена')

    expect(inner.position.toArray()).toEqual([0, 12, 0])
  })

  it('применяет инфляцию куба к размеру геометрии', () => {
    const model = emptyModel([cubeEntry({ inflate: 0.5 })])

    const [mesh] = meshesOf(buildFiguraModel(model, new THREE.Texture()))

    expect(mesh).toBeInstanceOf(THREE.Mesh)
    const size = new THREE.Box3().setFromObject(mesh as THREE.Mesh).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(9, 6)
    expect(size.y).toBeCloseTo(9, 6)
    expect(size.z).toBeCloseTo(9, 6)
  })

  it('строит материал с текстурой, alphaTest 0.3 и DoubleSide', () => {
    const texture = new THREE.Texture()

    const [mesh] = meshesOf(buildFiguraModel(emptyModel([cubeEntry()]), texture))
    const material = (mesh as THREE.Mesh).material as THREE.MeshLambertMaterial

    expect(material.map).toBe(texture)
    expect(material.alphaTest).toBe(0.3)
    expect(material.side).toBe(THREE.DoubleSide)
  })

  it('разбивает квад меша на два треугольника и треугольник на один', () => {
    const model = emptyModel([meshEntry({
      faces: {
        quad: { vertices: ['a', 'b', 'c', 'd'], uv: {}, texture: 0 },
        tri: { vertices: ['a', 'b', 'c'], uv: {}, texture: 0 },
      },
    })])

    const [mesh] = meshesOf(buildFiguraModel(model, new THREE.Texture()))

    expect((mesh as THREE.Mesh).geometry.getAttribute('position').count).toBe(9)
  })

  it('пропускает грани без текстуры и вершины, которых нет в карте', () => {
    const model = emptyModel([meshEntry({
      faces: {
        hidden: { vertices: ['a', 'b', 'c'], uv: {}, texture: null },
        broken: { vertices: ['a', 'b', 'ghost'], uv: {}, texture: 0 },
        real: { vertices: ['a', 'b', 'c'], uv: {}, texture: 0 },
      },
    })])

    const [mesh] = meshesOf(buildFiguraModel(model, new THREE.Texture()))

    expect((mesh as THREE.Mesh).geometry.getAttribute('position').count).toBe(3)
  })

  it('раскладывает uv куба по граням в порядке BoxGeometry east, west, up, down, south, north', () => {
    const model = emptyModel([cubeEntry({
      faces: {
        south: { uv: [8, 16, 16, 24], rotation: 0, texture: 0 },
        north: { uv: [0, 0, 8, 8], rotation: 0, texture: 0 },
      },
    })])

    const [mesh] = meshesOf(buildFiguraModel(model, new THREE.Texture()))
    const uv = (mesh as THREE.Mesh).geometry.getAttribute('uv') as THREE.BufferAttribute

    expect([uv.getX(16), uv.getY(16)]).toEqual([0.125, 0.75])
    expect([uv.getX(22), uv.getY(22)]).toEqual([0, 0.875])
  })

  it('применяет box_uv через uv_offset и размеры куба', () => {
    const model = emptyModel([cubeEntry({
      boxUv: true,
      uvOffset: [16, 16],
      from: vec3(-4, 0, -2),
      to: vec3(4, 12, 2),
    })])

    const [mesh] = meshesOf(buildFiguraModel(model, new THREE.Texture()))
    const uv = (mesh as THREE.Mesh).geometry.getAttribute('uv') as THREE.BufferAttribute

    const xs: number[] = []
    for (let index = 0; index < 4; index++) xs.push(uv.getX(index) * 64)
    const ys: number[] = []
    for (let index = 0; index < 4; index++) ys.push((1 - uv.getY(index)) * 64)
    expect(Math.min(...xs)).toBe(16)
    expect(Math.max(...xs)).toBe(20)
    expect(Math.min(...ys)).toBe(20)
    expect(Math.max(...ys)).toBe(32)
  })

  it('прячет группу скрытого узла', () => {
    const model = emptyModel([cubeEntry({ visible: false })])

    const group = buildFiguraModel(model, new THREE.Texture())

    expect(group.children[0]?.visible).toBe(false)
  })

  it('не роняет построение на пустых roots', () => {
    const group = buildFiguraModel(emptyModel([]), new THREE.Texture())

    expect(group.children).toHaveLength(0)
  })
})

interface RandomNodeSpec {
  coordinate: number
  inflate: number
  rotation: number
  uv: number
  uvScale: number
  triangle: boolean
}

const randomNode: Arbitrary<RandomNodeSpec> = record({
  coordinate: oneof(double({ min: -512, max: 512, noNaN: true }), integer({ min: -64, max: 64 })),
  inflate: oneof(double({ min: -1, max: 4, noNaN: true }), constant(0)),
  rotation: double({ min: -720, max: 720, noNaN: true }),
  uv: double({ min: -64, max: 320, noNaN: true }),
  uvScale: oneof(constant(0), double({ min: 1, max: 2048, noNaN: true })),
  triangle: boolean(),
})

function randomEntry(spec: RandomNodeSpec): FiguraEntry {
  const { coordinate: c, inflate, rotation, uv, uvScale, triangle } = spec
  const vertices: Record<string, FiguraVec3> = {
    a: vec3(c, c + 1, c),
    b: vec3(c + 4, c + 1, c),
    c: vec3(c + 4, c + 5, c),
    d: vec3(c, c + 5, c),
  }
  const faceVertices = triangle ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd']
  return groupEntry([
    cubeEntry({
      from: vec3(c - 4, c, c - 4),
      to: vec3(c + 4, c + 8, c + 4),
      origin: vec3(c, c, c),
      rotation: vec3(rotation, rotation, rotation),
      inflate,
    }),
    meshEntry({
      vertices,
      faces: {
        face: {
          vertices: faceVertices,
          uv: { a: [uv, uv], b: [uv + uvScale, uv], c: [uv + uvScale, uv + uvScale], d: [uv, uv + uvScale] },
          texture: 0,
        },
      },
    }),
  ])
}

function randomModel(specs: RandomNodeSpec[]): FiguraModel {
  const roots = specs.map((spec) => randomEntry(spec))
  return emptyModel(roots, {
    textureSize: { width: specs[0]?.uvScale || 0, height: specs[0]?.uvScale || 0 },
  })
}

interface RandomBbmodelSpec {
  cubes: number
  meshes: number
  planes: number
  texture: boolean
}

const randomBbmodelSpec: Arbitrary<RandomBbmodelSpec> = record({
  cubes: integer({ min: 1, max: 4 }),
  meshes: integer({ min: 0, max: 3 }),
  planes: integer({ min: 0, max: 2 }),
  texture: boolean(),
})

function buildRandomBbmodel(spec: RandomBbmodelSpec): { bytes: Uint8Array; elementCount: number } {
  const elements: Record<string, unknown>[] = []
  const outliner: string[] = []
  for (let index = 0; index < spec.cubes; index++) {
    elements.push({
      name: `cube_${index}`,
      type: 'cube',
      uuid: `cube-${index}`,
      from: [0, index, 0],
      to: [4, index + 4, 4],
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      faces: { north: { uv: [0, 0, 4, 4], texture: 0 } },
    })
    outliner.push(`cube-${index}`)
  }
  for (let index = 0; index < spec.meshes; index++) {
    elements.push({
      name: `mesh_${index}`,
      type: 'mesh',
      uuid: `mesh-${index}`,
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      vertices: { a: [0, 0, 0], b: [2, 0, 0], c: [2, 2, 0] },
      faces: { face: { vertices: ['a', 'b', 'c'], uv: { a: [0, 0], b: [2, 0], c: [2, 2] }, texture: 0 } },
    })
    outliner.push(`mesh-${index}`)
  }
  for (let index = 0; index < spec.planes; index++) {
    elements.push({ name: `plane_${index}`, type: 'plane', uuid: `plane-${index}` })
    outliner.push(`plane-${index}`)
  }
  const model: Record<string, unknown> = {
    resolution: { width: 64, height: 64 },
    elements,
    outliner,
    textures: spec.texture
      ? [{ name: 'skin.png', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,iVBORw0KGgo=' }]
      : [],
  }
  return { bytes: new TextEncoder().encode(JSON.stringify(model)), elementCount: elements.length }
}

describe('buildFiguraModel инварианты', () => {
  it('INV-5: все координаты и UV построенной группы конечные', () => {
    assert(
      property(array(randomNode, { minLength: 0, maxLength: 3 }), (specs) => {
        const group = buildFiguraModel(randomModel(specs), new THREE.Texture())
        const meshes = meshesOf(group)

        for (const mesh of meshes) {
          expect(allFinite(mesh.position.toArray())).toBe(true)
          for (const name of ['position', 'uv', 'normal'] as const) {
            expect(allFinite(attributeValues(mesh, name))).toBe(true)
          }
        }
        expect(allFinite(group.position.toArray())).toBe(true)
      }),
      { numRuns: 60 },
    )
  })

  it('INV-5: построение не бросает на экстремальных числах', () => {
    assert(
      property(
        double({ min: -1e12, max: 1e12, noNaN: true }),
        constantFrom(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN),
        (finite, hostile) => {
          const model = emptyModel([
            cubeEntry({
              from: vec3(finite, hostile, -finite),
              to: vec3(hostile, finite, finite),
              origin: vec3(hostile, hostile, hostile),
              inflate: hostile,
              rotation: vec3(hostile, finite, hostile),
            }),
            meshEntry({
              vertices: {
                a: vec3(hostile, 0, 0),
                b: vec3(0, finite, 0),
                c: vec3(0, 0, hostile),
              },
            }),
          ])

          const group = buildFiguraModel(model, new THREE.Texture())

          for (const mesh of meshesOf(group)) {
            expect(allFinite(attributeValues(mesh, 'position'))).toBe(true)
            expect(allFinite(attributeValues(mesh, 'uv'))).toBe(true)
          }
          expect(allFinite(group.position.toArray())).toBe(true)
        },
      ),
      { numRuns: 40 },
    )
  })
})

describe('buildFiguraModel сквозные инварианты', () => {
  it('INV-1..INV-5 держатся на разобранной модели', () => {
    assert(
      property(randomBbmodelSpec, (spec) => {
        const { bytes, elementCount } = buildRandomBbmodel(spec)
        const result = parseFiguraModel(bytes)

        expect(result.model.nodes.length + result.skipped.length).toBe(elementCount)
        expect(result.model.nodes.length).toBeLessThanOrEqual(elementCount)
        if (result.texturePng !== null) expect(Array.from(result.texturePng.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])

        const group = buildFiguraModel(result.model, new THREE.Texture())
        for (const mesh of meshesOf(group)) {
          expect(allFinite(attributeValues(mesh, 'position'))).toBe(true)
          expect(allFinite(attributeValues(mesh, 'uv'))).toBe(true)
        }
      }),
      { numRuns: 30 },
    )
  })

  it('INV-3: пустые elements и отсутствующий outliner бросают ошибку до построения', () => {
    assert(
      property(boolean(), (withOutliner) => {
        const model: Record<string, unknown> = {
          resolution: { width: 64, height: 64 },
          elements: [],
          textures: [],
        }
        if (withOutliner) model.outliner = []

        expect(() => parseFiguraModel(new TextEncoder().encode(JSON.stringify(model)))).toThrow(
          'Файл .bbmodel не содержит поддерживаемых элементов модели',
        )
      }),
      { numRuns: 4 },
    )
  })
})
