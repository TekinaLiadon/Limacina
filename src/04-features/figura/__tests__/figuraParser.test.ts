import { describe, expect, it } from 'vitest'
import { assert, boolean, integer, property, record, type Arbitrary } from 'fast-check'
import { parseFiguraModel, type FiguraCubeNode, type FiguraMeshNode } from '../figuraParser'

const TINY_PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]

const PNG_BASE64 = btoa(String.fromCharCode(...TINY_PNG_BYTES))
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

function makeCube(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    type: 'cube',
    uuid: `cube-${name}`,
    from: [-4, 8, -4],
    to: [4, 16, 4],
    origin: [0, 8, 0],
    rotation: [0, 0, 0],
    inflate: 0,
    box_uv: false,
    faces: {
      north: { uv: [0, 0, 8, 8], texture: 0 },
      east: { uv: [8, 0, 16, 8], texture: 0 },
    },
    ...overrides,
  }
}

function makeMesh(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    type: 'mesh',
    uuid: `mesh-${name}`,
    origin: [0, 16, 0],
    rotation: [0, 0, 0],
    vertices: {
      v0: [0, 0, 0],
      v1: [4, 0, 0],
      v2: [4, 4, 0],
      v3: [0, 4, 0],
      v4: [0, 0, -4],
    },
    faces: {
      front: {
        vertices: ['v0', 'v1', 'v2', 'v3'],
        uv: { v0: [0, 0], v1: [4, 0], v2: [4, 4], v3: [0, 4] },
        texture: 0,
      },
      side: {
        vertices: ['v0', 'v4', 'v2'],
        uv: { v0: [8, 0], v4: [12, 0], v2: [8, 4] },
        texture: 0,
      },
    },
    ...overrides,
  }
}

function makeModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: { format_version: '5.0', model_format: 'free', box_uv: false },
    name: 'FiguraAvatar',
    resolution: { width: 256, height: 320 },
    elements: [],
    outliner: [],
    textures: [],
    ...overrides,
  }
}

function fullModel(elements: unknown[], outliner: unknown[], texture = true): Uint8Array {
  return encode(makeModel({
    elements,
    outliner,
    textures: texture
      ? [{ name: 'skin.png', width: 1024, height: 1280, uv_width: 256, uv_height: 320, source: PNG_DATA_URL }]
      : [],
  }))
}

describe('parseFiguraModel', () => {
  it('разбирает два куба и меш в три узла без skipped', () => {
    const bytes = fullModel(
      [makeCube('head'), makeCube('body'), makeMesh('cape')],
      ['cube-head', 'cube-body', 'mesh-cape'],
    )

    const result = parseFiguraModel(bytes)

    expect(result.model.nodes).toHaveLength(3)
    expect(result.model.nodes.map((node) => node.name)).toEqual(['head', 'body', 'cape'])
    expect(result.skipped).toEqual([])
    expect(result.texturePng).not.toBeNull()
  })

  it('переносит куб с from, to, origin, поворотом и гранями', () => {
    const bytes = fullModel(
      [makeCube('head', { origin: [0.5, 24, -1], rotation: [10, 20, -30], inflate: 0.25 })],
      ['cube-head'],
    )

    const result = parseFiguraModel(bytes)
    const node = result.model.nodes[0] as FiguraCubeNode

    expect(node.kind).toBe('cube')
    expect(node.from).toEqual({ x: -4, y: 8, z: -4 })
    expect(node.to).toEqual({ x: 4, y: 16, z: 4 })
    expect(node.origin).toEqual({ x: 0.5, y: 24, z: -1 })
    expect(node.rotation).toEqual({ x: 10, y: 20, z: -30 })
    expect(node.inflate).toBe(0.25)
    expect(node.faces.north).toEqual({ uv: [0, 0, 8, 8], rotation: 0, texture: 0 })
    expect(node.faces.east?.uv).toEqual([8, 0, 16, 8])
  })

  it('переносит меш с вершинами относительно origin, uv по ключам и индексами текстур', () => {
    const bytes = fullModel([makeMesh('cape')], ['mesh-cape'])

    const result = parseFiguraModel(bytes)
    const node = result.model.nodes[0] as FiguraMeshNode

    expect(node.kind).toBe('mesh')
    expect(node.vertices.v0).toEqual({ x: 0, y: 0, z: 0 })
    expect(node.vertices.v2).toEqual({ x: 4, y: 4, z: 0 })
    expect(node.faces.front?.vertices).toEqual(['v0', 'v1', 'v2', 'v3'])
    expect(node.faces.front?.uv.v2).toEqual([4, 4])
    expect(node.faces.front?.texture).toBe(0)
    expect(node.faces.side?.vertices).toHaveLength(3)
  })

  it('строит дерево групп из outliner с вложенностью', () => {
    const bytes = encode(makeModel({
      elements: [makeCube('head'), makeCube('hair')],
      groups: [
        { name: 'Root', uuid: 'group-root', origin: [0, 0, 0], rotation: [0, 0, 0], children: [] },
        { name: 'Hair', uuid: 'group-hair', origin: [0, 24, 0], rotation: [-8, 0, 0], children: [] },
      ],
      outliner: [{
        uuid: 'group-root',
        children: ['cube-head', { uuid: 'group-hair', children: ['cube-hair'] }],
      }],
    }))

    const result = parseFiguraModel(bytes)
    const [root] = result.model.roots

    expect(root?.kind).toBe('group')
    if (root?.kind !== 'group') throw new Error('корневая группа не построена')
    expect(root.name).toBe('Root')
    expect(root.children).toHaveLength(2)
    expect(root.children[0]?.kind).toBe('cube')
    expect(root.children[1]?.kind).toBe('group')
    const [, hair] = root.children
    if (hair?.kind !== 'group') throw new Error('вложенная группа не построена')
    expect(hair.name).toBe('Hair')
    expect(hair.rotation).toEqual({ x: -8, y: 0, z: 0 })
    expect(hair.children).toHaveLength(1)
  })

  it('кладывает неподдерживаемый тип в skipped и сохраняет остальные узлы', () => {
    const bytes = fullModel(
      [
        makeCube('box'),
        { name: 'plane_name', type: 'plane', uuid: 'plane-uuid' },
        makeMesh('shell'),
      ],
      ['cube-box', 'plane-uuid', 'mesh-shell'],
    )

    const result = parseFiguraModel(bytes)

    expect(result.model.nodes).toHaveLength(2)
    expect(result.skipped).toEqual(['plane_name'])
  })

  it('считает элемент без uuid пропущенным, а не теряет молча', () => {
    const bytes = fullModel(
      [makeCube('head'), { name: 'orphan', type: 'cube', from: [0, 0, 0], to: [1, 1, 1] }],
      ['cube-head'],
    )

    const result = parseFiguraModel(bytes)

    expect(result.model.nodes).toHaveLength(1)
    expect(result.skipped).toEqual(['orphan'])
  })

  it('сохраняет элемент вне outliner и сообщает о нём в skipped', () => {
    const bytes = fullModel([makeCube('head'), makeCube('floating')], ['cube-head'])

    const result = parseFiguraModel(bytes)

    expect(result.model.nodes).toHaveLength(1)
    expect(result.skipped).toEqual(['floating'])
  })

  it('распаковывает текстуру data-URL в PNG-байты', () => {
    const result = parseFiguraModel(fullModel([makeCube('head')], ['cube-head']))

    expect(result.texturePng).toEqual(new Uint8Array(TINY_PNG_BYTES))
  })

  it('берёт uv_width и uv_height текстуры как размер UV-развёртки', () => {
    const result = parseFiguraModel(fullModel([makeCube('head')], ['cube-head']))

    expect(result.model.resolution).toEqual({ width: 256, height: 320 })
    expect(result.model.textureSize).toEqual({ width: 256, height: 320 })
  })

  it('возвращает null вместо текстуры, когда её нет в модели', () => {
    const result = parseFiguraModel(fullModel([makeCube('head')], ['cube-head'], false))

    expect(result.texturePng).toBeNull()
  })

  it('бросает ошибку на битом JSON', () => {
    expect(() => parseFiguraModel(new TextEncoder().encode('{ broken'))).toThrow(
      'Файл .bbmodel не является корректным JSON',
    )
  })

  it('бросает ошибку, когда elements пуст или отсутствует', () => {
    const message = 'Файл .bbmodel не содержит поддерживаемых элементов модели'

    expect(() => parseFiguraModel(encode(makeModel({ elements: [], outliner: ['cube-head'] })))).toThrow(message)
    expect(() => parseFiguraModel(encode({ outliner: [] }))).toThrow(message)
  })

  it('бросает ошибку, когда outliner отсутствует', () => {
    expect(() => parseFiguraModel(encode({
      resolution: { width: 64, height: 64 },
      elements: [makeCube('head')],
    }))).toThrow('Файл .bbmodel не содержит поддерживаемых элементов модели')
  })

  it('бросает ошибку, когда все элементы модели неподдерживаемого типа', () => {
    const bytes = fullModel([{ name: 'plane', type: 'plane', uuid: 'plane-uuid' }], ['plane-uuid'])

    expect(() => parseFiguraModel(bytes)).toThrow('Файл .bbmodel не содержит поддерживаемых элементов модели')
  })

  it('бросает ошибку на текстуре без PNG-сигнатуры', () => {
    const notPng = btoa(String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8))
    const bytes = encode(makeModel({
      elements: [makeCube('head')],
      outliner: ['cube-head'],
      textures: [{ name: 'broken.png', source: `data:image/png;base64,${notPng}` }],
    }))

    expect(() => parseFiguraModel(bytes)).toThrow('Текстура "broken.png" не является PNG-изображением')
  })

  it('бросает ошибку на текстуре с битым base64', () => {
    const bytes = encode(makeModel({
      elements: [makeCube('head')],
      outliner: ['cube-head'],
      textures: [{ name: 'broken.png', source: 'data:image/png;base64,%%%' }],
    }))

    expect(() => parseFiguraModel(bytes)).toThrow('Текстура "broken.png" повреждена')
  })

  it('бросает ошибку на повреждённых координатах куба', () => {
    const bytes = fullModel([makeCube('head', { from: ['a', 8, -4] })], ['cube-head'])

    expect(() => parseFiguraModel(bytes)).toThrow('Файл .bbmodel повреждён')
  })

  it('не зацикливается на группе, сославшейся на себя', () => {
    const bytes = encode(makeModel({
      elements: [makeCube('head')],
      groups: [{ name: 'Loop', uuid: 'group-loop', origin: [0, 0, 0], rotation: [0, 0, 0], children: [] }],
      outliner: [{
        uuid: 'group-loop',
        children: ['cube-head', { uuid: 'group-loop', children: ['cube-head'] }],
      }],
    }))

    const result = parseFiguraModel(bytes)

    expect(result.model.nodes).toHaveLength(1)
  })

  it('сохраняет видимость элементов и групп', () => {
    const bytes = encode(makeModel({
      elements: [makeCube('shown'), makeCube('hidden', { visibility: false })],
      groups: [{ name: 'Off', uuid: 'group-off', origin: [0, 0, 0], rotation: [0, 0, 0], visibility: false, children: [] }],
      outliner: [{ uuid: 'group-off', children: ['cube-shown', 'cube-hidden'] }],
    }))

    const result = parseFiguraModel(bytes)
    const [root] = result.model.roots

    expect(root?.visible).toBe(false)
    expect(result.model.nodes[0]?.visible).toBe(true)
    expect(result.model.nodes[1]?.visible).toBe(false)
  })
})

interface RandomModelSpec {
  cubes: number
  meshes: number
  planes: number
  texture: boolean
}

const randomSpec: Arbitrary<RandomModelSpec> = record({
  cubes: integer({ min: 1, max: 6 }),
  meshes: integer({ min: 0, max: 4 }),
  planes: integer({ min: 0, max: 3 }),
  texture: boolean(),
})

function buildRandomModel(spec: RandomModelSpec): { bytes: Uint8Array; elementCount: number } {
  const elements: unknown[] = []
  const outliner: unknown[] = []
  for (let index = 0; index < spec.cubes; index++) {
    elements.push(makeCube(`cube_${index}`))
    outliner.push(`cube-cube_${index}`)
  }
  for (let index = 0; index < spec.meshes; index++) {
    elements.push(makeMesh(`mesh_${index}`))
    outliner.push(`mesh-mesh_${index}`)
  }
  for (let index = 0; index < spec.planes; index++) {
    elements.push({ name: `plane_${index}`, type: 'plane', uuid: `plane-${index}` })
    outliner.push(`plane-${index}`)
  }
  return { bytes: fullModel(elements, outliner, spec.texture), elementCount: elements.length }
}

describe('parseFiguraModel инварианты', () => {
  it('INV-1: каждый элемент попадает либо в nodes, либо в skipped', () => {
    assert(
      property(randomSpec, (spec) => {
        const { bytes, elementCount } = buildRandomModel(spec)
        const result = parseFiguraModel(bytes)

        expect(result.model.nodes.length + result.skipped.length).toBe(elementCount)
      }),
      { numRuns: 40 },
    )
  })

  it('INV-2: texturePng это null или PNG-байты', () => {
    assert(
      property(randomSpec, (spec) => {
        const { bytes } = buildRandomModel(spec)
        const { texturePng } = parseFiguraModel(bytes)

        if (texturePng === null) return
        expect(Array.from(texturePng.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
      }),
      { numRuns: 40 },
    )
  })

  it('INV-3: пустые elements и отсутствующий outliner дают исключение', () => {
    assert(
      property(boolean(), (withOutliner) => {
        const model = makeModel({
          elements: [],
          outliner: withOutliner ? [] : undefined,
        })
        if (!withOutliner) delete model.outliner

        expect(() => parseFiguraModel(encode(model))).toThrow()
      }),
      { numRuns: 10 },
    )
  })

  it('INV-4: число узлов не больше числа элементов файла', () => {
    assert(
      property(randomSpec, (spec) => {
        const { bytes, elementCount } = buildRandomModel(spec)

        expect(parseFiguraModel(bytes).model.nodes.length).toBeLessThanOrEqual(elementCount)
      }),
      { numRuns: 40 },
    )
  })

  it('INV-1 и INV-4 сохраняются при дубликатах uuid и повторных ссылках', () => {
    assert(
      property(integer({ min: 1, max: 5 }), (count) => {
        const elements = Array.from({ length: count }, () => makeCube('twin'))
        const outliner = Array.from({ length: count }, () => 'cube-twin')
        const result = parseFiguraModel(fullModel(elements, outliner))

        expect(result.model.nodes.length).toBe(1)
        expect(result.model.nodes.length + result.skipped.length).toBe(count)
      }),
      { numRuns: 20 },
    )
  })
})
