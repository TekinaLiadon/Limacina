import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBbmodel } from '../bbmodelParser'
import { cpmConfigToBytes } from '../cpmProjectExporter'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

const TINY_PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]

const TINY_PNG_BASE64 = btoa(String.fromCharCode(...TINY_PNG_BYTES))

interface FaceStub {
  uv: number[]
  rotation?: number
  texture?: number | null
}

const makeCube = (
  name: string,
  from: number[],
  to: number[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  type: 'cube',
  uuid: `uuid-${name}`,
  box_uv: false,
  autouv: 0,
  color: 0,
  origin: [0, 24, 0],
  from,
  to,
  faces: {},
  ...overrides,
})

const makeGroup = (
  name: string,
  origin: number[],
  children: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  uuid: `group-${name}`,
  origin,
  export: true,
  mirror_uv: false,
  children,
  ...overrides,
})

const makeModel = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  meta: { format_version: '4.10', model_format: 'free', box_uv: false },
  name: 'TestModel',
  model_identifier: '',
  resolution: { width: 64, height: 64 },
  elements: [],
  outliner: [],
  textures: [],
  ...overrides,
})

const encode = (model: Record<string, unknown>): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(model))

describe('parseBbmodel', () => {
  it('конвертирует ванильный head-куб как в PlayerPartValues', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4], { box_uv: true, uv_offset: [0, 0] })],
      outliner: [makeGroup('Head', [0, 24, 0], ['uuid-Head'])],
      textures: [{ name: 'skin.png', source: `data:image/png;base64,${TINY_PNG_BASE64}` }],
    })

    const { config, skinPng } = parseBbmodel(encode(model))

    expect(config.skinSize).toEqual({ x: 64, y: 64 })
    expect(config.elements).toHaveLength(1)

    const [root] = config.elements
    expect(root?.id).toBe('head')
    expect(root?.name).toBe('Head')
    expect(root?.pos).toEqual({ x: 0, y: 0, z: 0 })
    expect(root?.rotation).toEqual({ x: 0, y: 0, z: 0 })

    const cube = root?.children?.[0]
    expect(cube?.name).toBe('Head')
    expect(cube?.size).toEqual({ x: 8, y: 8, z: 8 })
    expect(cube?.offset).toEqual({ x: -4, y: -8, z: -4 })
    expect(cube?.u).toBe(0)
    expect(cube?.v).toBe(0)
    expect(cube?.textureSize).toBe(1)
    expect(cube?.faceUV).toBeUndefined()

    expect(skinPng).toEqual(new Uint8Array(TINY_PNG_BYTES))
  })

  it('воспроизводит ванильные offset кубов left_arm и right_leg', () => {
    const model = makeModel({
      elements: [
        makeCube('LeftArm', [4, 12, -2], [8, 24, 2], { box_uv: true, uv_offset: [32, 48] }),
        makeCube('RightLeg', [0, 0, -2], [4, 12, 2], { box_uv: true, uv_offset: [0, 16] }),
      ],
      outliner: [
        makeGroup('left_arm', [5, 22, 0], ['uuid-LeftArm']),
        makeGroup('right_leg', [2, 12, 0], ['uuid-RightLeg']),
      ],
    })

    const { config } = parseBbmodel(encode(model))

    expect(config.elements[0]?.pos).toEqual({ x: 0, y: 0, z: 0 })
    expect(config.elements[0]?.children?.[0]?.offset).toEqual({ x: -1, y: -2, z: -2 })
    expect(config.elements[1]?.children?.[0]?.offset).toEqual({ x: -2, y: 0, z: -2 })
  })

  it('сдвинутая ванильная группа даёт pos-дельту от пивота части', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 26, -3], [4, 34, 5])],
      outliner: [makeGroup('head', [2, 26, 1], ['uuid-Head'])],
    })

    const { config } = parseBbmodel(encode(model))

    expect(config.elements[0]?.id).toBe('head')
    expect(config.elements[0]?.pos).toEqual({ x: 2, y: -2, z: -1 })
  })

  it('группа без ванильного имени становится customPart-корнем', () => {
    const model = makeModel({
      elements: [makeCube('Wing', [1, 16, 3], [3, 20, 7])],
      outliner: [makeGroup('Wings', [0, 18, 4], ['uuid-Wing'])],
    })

    const { config } = parseBbmodel(encode(model))

    const [root] = config.elements
    expect(root?.customPart).toBe(true)
    expect(root?.name).toBe('Wings')
    expect(root?.pos).toEqual({ x: 0, y: -18, z: -4 })
    expect(root?.children?.[0]?.offset).toEqual({
      x: 1 - 0,
      y: 18 - 20,
      z: 4 - 7,
    })
  })

  it('вложенная группа становится child-узлом с pos относительно родителя', () => {
    const model = makeModel({
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        makeCube('Fringe', [0, 29, -5], [2, 31, -3]),
      ],
      outliner: [
        makeGroup('head', [0, 24, 0], [
          'uuid-Head',
          makeGroup('Hair', [0, 30, 0], ['uuid-Fringe']),
        ]),
      ],
    })

    const { config } = parseBbmodel(encode(model))

    const hair = config.elements[0]?.children?.[1]
    expect(hair?.name).toBe('Hair')
    expect(hair?.pos).toEqual({ x: 0, y: -6, z: 0 })
    expect(hair?.size).toEqual({ x: 0, y: 0, z: 0 })
    expect(hair?.children).toHaveLength(1)
    expect(hair?.children?.[0]?.offset).toEqual({ x: 0, y: -1, z: 3 })
  })

  it('переводит per-face UV: north/south меняются местами, up/down получают rot 180', () => {
    const faces: Record<string, FaceStub> = {
      north: { uv: [4, 26, 8, 32] },
      south: { uv: [12, 26, 16, 32] },
      east: { uv: [0, 26, 4, 32] },
      west: { uv: [8, 26, 12, 32] },
      up: { uv: [8, 20, 4, 16] },
      down: { uv: [12, 16, 8, 20] },
    }
    const model = makeModel({
      elements: [makeCube('Middle', [-4, 12, -2], [4, 24, 2], { faces })],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Middle'])],
    })

    const { config } = parseBbmodel(encode(model))

    const faceUV = config.elements[0]?.children?.[0]?.faceUV
    expect(faceUV).toEqual({
      north: { sx: 12, sy: 26, ex: 16, ey: 32, rot: '0', autoUV: false },
      south: { sx: 4, sy: 26, ex: 8, ey: 32, rot: '0', autoUV: false },
      east: { sx: 0, sy: 26, ex: 4, ey: 32, rot: '0', autoUV: false },
      west: { sx: 8, sy: 26, ex: 12, ey: 32, rot: '0', autoUV: false },
      up: { sx: 8, sy: 20, ex: 4, ey: 16, rot: '180', autoUV: false },
      down: { sx: 12, sy: 16, ex: 8, ey: 20, rot: '180', autoUV: false },
    })
  })

  it('учитывает rotation грани BlockBench в rot CPM', () => {
    const faces: Record<string, FaceStub> = {
      north: { uv: [4, 26, 8, 32], rotation: 90 },
      up: { uv: [8, 20, 4, 16], rotation: 90 },
    }
    const model = makeModel({
      elements: [makeCube('Rot', [-1, 12, -1], [1, 14, 1], { faces })],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Rot'])],
    })

    const { config } = parseBbmodel(encode(model))

    const faceUV = config.elements[0]?.children?.[0]?.faceUV
    expect(faceUV?.south?.rot).toBe('90')
    expect(faceUV?.up?.rot).toBe('270')
  })

  it('передаёт flipped UV как есть — формат CPM поддерживает sx>ex', () => {
    const faces: Record<string, FaceStub> = {
      north: { uv: [10, 5, 4, 9] },
    }
    const model = makeModel({
      elements: [makeCube('Flip', [-1, 12, -1], [1, 14, 1], { faces })],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Flip'])],
    })

    const { config } = parseBbmodel(encode(model))

    expect(config.elements[0]?.children?.[0]?.faceUV?.south).toEqual({
      sx: 10, sy: 5, ex: 4, ey: 9, rot: '0', autoUV: false,
    })
  })

  it('отказывается от не-кубовых элементов со списком имён', () => {
    const model = makeModel({
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        { name: 'Curl', type: 'mesh', uuid: 'uuid-mesh' },
        { name: 'Pixie', type: 'texture_mesh', uuid: 'uuid-tmesh' },
      ],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head', 'uuid-mesh', 'uuid-tmesh'])],
    })

    expect(() => parseBbmodel(encode(model))).toThrow(/Curl, Pixie/)
  })

  it('возвращает null вместо текстуры, когда PNG в файле нет', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head'])],
      textures: [],
    })

    const { skinPng } = parseBbmodel(encode(model))

    expect(skinPng).toBeNull()
  })

  it('отвергает текстуру без PNG-сигнатуры', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head'])],
      textures: [{ name: 'fake.png', source: `data:image/png;base64,${btoa('not a png')}` }],
    })

    expect(() => parseBbmodel(encode(model))).toThrow(/PNG/)
  })

  it('сообщает понятную ошибку для текстуры с невалидным base64', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head'])],
      textures: [{ name: 'broken.png', source: 'data:image/png;base64,@@' }],
    })

    expect(() => parseBbmodel(encode(model))).toThrow(/Текстура "broken\.png" повреждена/)
  })

  it('учитывает inflate в размере и offset куба', () => {
    const model = makeModel({
      elements: [makeCube('Puff', [0, 12, -2], [8, 24, 2], { inflate: 0.5 })],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Puff'])],
    })

    const { config } = parseBbmodel(encode(model))

    const cube = config.elements[0]?.children?.[0]
    expect(cube?.size).toEqual({ x: 9, y: 13, z: 5 })
    expect(cube?.offset).toEqual({ x: -0.5, y: 24 - 24.5, z: -2.5 })
  })

  it('куб с поворотом получает pos от rotation origin и инвертированные углы Y/Z', () => {
    const model = makeModel({
      elements: [
        makeCube('Tilt', [4, 16, -2], [8, 20, 2], { rotation: [10, 20, 15], origin: [4, 20, 0] }),
      ],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Tilt'])],
    })

    const { config } = parseBbmodel(encode(model))

    const cube = config.elements[0]?.children?.[0]
    expect(cube?.pos).toEqual({ x: 4, y: 4, z: 0 })
    expect(cube?.offset).toEqual({ x: 0, y: 0, z: -2 })
    expect(cube?.rotation).toEqual({ x: 10, y: -20, z: -15 })
    expect(cube?.size).toEqual({ x: 4, y: 4, z: 4 })
  })

  it('инвертирует углы Y/Z у повёрнутой группы и считает pos от пивота части', () => {
    const model = makeModel({
      elements: [makeCube('Arm', [3.6, 12, -2], [6.6, 24, 2], { box_uv: true, uv_offset: [40, 16] })],
      outliner: [makeGroup('right_arm', [4.6, 22, 0], ['uuid-Arm'], { rotation: [0, 0, 2.5] })],
    })

    const { config } = parseBbmodel(encode(model))

    const [root] = config.elements
    expect(root?.id).toBe('right_arm')
    expect(root?.rotation).toEqual({ x: 0, y: 0, z: -2.5 })
    expect(root?.pos).toEqual({ x: 4.6 - -5, y: 22 - 22, z: 0 })
  })

  it('свободный куб в корне outliner становится customPart-корнем', () => {
    const model = makeModel({
      elements: [makeCube('Loose', [2, 10, 1], [5, 14, 4], { origin: [3, 12, 2] })],
      outliner: ['uuid-Loose'],
    })

    const { config } = parseBbmodel(encode(model))

    const [root] = config.elements
    expect(root?.customPart).toBe(true)
    expect(root?.name).toBe('Loose')
    expect(root?.pos).toEqual({ x: 3, y: -12, z: -2 })
    expect(root?.children?.[0]?.offset).toEqual({ x: -1, y: -2, z: -2 })
  })

  it('пропускает пустые группы', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('- By author', [0, 0, 0], []), makeGroup('head', [0, 24, 0], ['uuid-Head'])],
    })

    const { config } = parseBbmodel(encode(model))

    expect(config.elements).toHaveLength(1)
    expect(config.elements[0]?.id).toBe('head')
  })

  it('повторная группа той же ванильной части становится customPart-корнем', () => {
    const model = makeModel({
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        makeCube('Phones', [-5, 28, -1], [5, 30, 1]),
      ],
      outliner: [
        makeGroup('head', [0, 24, 0], ['uuid-Head']),
        makeGroup('headphones', [0, 29, 0], ['uuid-Phones']),
      ],
    })

    const { config } = parseBbmodel(encode(model))

    expect(config.elements).toHaveLength(2)
    expect(config.elements[0]?.id).toBe('head')
    expect(config.elements[1]?.customPart).toBe(true)
    expect(config.elements[1]?.name).toBe('headphones')
  })

  it('сохраняет uv за пределами атласа и проходит через экспортёр с UV_OVERFLOW', () => {
    const model = makeModel({
      resolution: { width: 128, height: 128 },
      elements: [makeCube('Wide', [0, 12, -2], [8, 24, 2], { box_uv: true, uv_offset: [300, 10] })],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Wide'])],
    })

    const { config, skinPng } = parseBbmodel(encode(model))

    expect(config.skinSize).toEqual({ x: 128, y: 128 })
    const cube = config.elements[0]?.children?.[0]
    expect(cube?.u).toBe(300)
    expect(cube?.v).toBe(10)
    expect(() => cpmConfigToBytes(config, skinPng ?? undefined)).not.toThrow()
  })

  it('сообщает понятную ошибку для некорректного JSON', () => {
    expect(() => parseBbmodel(new TextEncoder().encode('{oops'))).toThrow(/bbmodel/)
  })

  it('сообщает понятную ошибку для модели без элементов', () => {
    expect(() => parseBbmodel(encode(makeModel()))).toThrow(/элементов/)
  })

  it('golden-снапшот мини-модели со всеми Supported-фичами', () => {
    const faces: Record<string, FaceStub> = {
      north: { uv: [4, 26, 8, 32], rotation: 0 },
      east: { uv: [0, 26, 4, 32] },
      south: { uv: [12, 26, 16, 32] },
      west: { uv: [8, 26, 12, 32], rotation: 90 },
      up: { uv: [8, 20, 4, 16] },
      down: { uv: [12, 16, 8, 20] },
    }
    const model = makeModel({
      name: 'MiniGolden',
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4], { box_uv: true, uv_offset: [0, 0] }),
        makeCube('Hat', [-4.5, 23.5, -4.5], [4.5, 32.5, 4.5], { box_uv: true, uv_offset: [32, 0], inflate: 0.5 }),
        makeCube('Chest', [-4, 12, -2], [4, 24, 2], { faces }),
        makeCube('Gem', [1, 20, -3], [3, 22, -1], { rotation: [0, 0, 15], origin: [2, 21, -2] }),
        makeCube('Skirt', [-4, 4, -2], [4, 12, 2], { box_uv: true, uv_offset: [16, 48] }),
      ],
      outliner: [
        makeGroup('Head', [0, 24, 0], ['uuid-Head', 'uuid-Hat']),
        makeGroup('Body', [0, 24, 0], [
          'uuid-Chest',
          makeGroup('Body', [0, 24, 0], [
            'uuid-Gem',
            makeGroup('Skirt', [0, 12, 0], ['uuid-Skirt']),
          ]),
        ]),
        makeGroup('Scarf', [0, 26, 0], [makeCube('Knot', [-1, 25, -3], [1, 27, -1])], { rotation: [0, 15, 0] }),
      ],
      textures: [{ name: 'mini.png', source: `data:image/png;base64,${TINY_PNG_BASE64}` }],
    })

    const { config, skinPng } = parseBbmodel(encode(model))

    expect(skinPng).toEqual(new Uint8Array(TINY_PNG_BYTES))
    expect(JSON.parse(JSON.stringify(config))).toMatchSnapshot()
  })
})

describe('parseBbmodel: формат 5.0 и анимации', () => {
  beforeEach(() => {
    reportError.mockClear()
  })

  const groupEntry = (name: string, origin: number[]): Record<string, unknown> => ({
    name,
    uuid: `group-${name}`,
    origin,
    export: true,
    mirror_uv: false,
    rotation: [0, 0, 0],
  })

  const bbKeyframe = (channel: string, x: string, time: number): Record<string, unknown> => ({
    channel,
    time,
    data_points: [{ x, y: '0', z: '0' }],
  })

  it('читает формат 5.0 (groups + ссылки outliner) идентично инлайн-формату 4.x', () => {
    const animation = {
      uuid: 'anim-pulse',
      name: 'Pulse',
      loop: 'loop',
      length: 0.2,
      animators: {
        'group-belt': {
          channels: ['scale'],
          keyframes: [
            bbKeyframe('scale', '1', 0),
            { channel: 'scale', time: 0.2, data_points: [{ x: '1.5', y: '1.5', z: '1.5' }] },
          ],
        },
      },
    }
    const legacy = makeModel({
      meta: { format_version: '4.10', model_format: 'free', box_uv: false },
      elements: [makeCube('Chest', [-4, 12, -2], [4, 24, 2]), makeCube('Buckle', [-1, 11, -1], [1, 13, 1])],
      outliner: [makeGroup('body', [0, 24, 0], ['uuid-Chest', makeGroup('belt', [0, 12, 0], ['uuid-Buckle'])])],
      animations: [animation],
    })
    const modern = makeModel({
      meta: { format_version: '5.0', model_format: 'free', box_uv: false },
      elements: [makeCube('Chest', [-4, 12, -2], [4, 24, 2]), makeCube('Buckle', [-1, 11, -1], [1, 13, 1])],
      groups: [groupEntry('body', [0, 24, 0]), groupEntry('belt', [0, 12, 0])],
      outliner: [{
        uuid: 'group-body',
        isOpen: true,
        children: ['uuid-Chest', { uuid: 'group-belt', isOpen: false, children: ['uuid-Buckle'] }],
      }],
      animations: [animation],
    })

    const legacyResult = parseBbmodel(encode(legacy))
    const modernResult = parseBbmodel(encode(modern))

    expect(modernResult.config).toEqual(legacyResult.config)
    expect(modernResult.animations).toEqual(legacyResult.animations)
    expect(modernResult.animations).toHaveLength(1)
    expect(modernResult.animations[0]?.name).toBe('Pulse')
    expect(modernResult.animations[0]?.frames).toHaveLength(4)
  })

  it('назначает storeID от 100 без конфликтов с ординалами и мапит аниматоров на узлы', () => {
    const track = (keyframes: Array<Record<string, unknown>>): Record<string, unknown> => ({ channels: ['rotation'], keyframes })
    const animation = {
      uuid: 'anim-all',
      name: 'All',
      loop: 'loop',
      length: 0.25,
      animators: {
        'group-head': track([bbKeyframe('rotation', '0', 0), bbKeyframe('rotation', '30', 0.25)]),
        'group-belt': track([bbKeyframe('rotation', '10', 0)]),
        'uuid-Chest': { channels: ['scale'], keyframes: [{ channel: 'scale', time: 0, data_points: [{ x: '1.5', y: '1.5', z: '1.5' }] }] },
        'uuid-Buckle': track([bbKeyframe('rotation', '20', 0)]),
        'uuid-Wing': { channels: ['position'], keyframes: [{ channel: 'position', time: 0, data_points: [{ x: '0', y: '1', z: '0' }] }] },
        'uuid-Loose': track([bbKeyframe('rotation', '25', 0)]),
        'uuid-ghost': track([bbKeyframe('rotation', '90', 0)]),
      },
    }
    const model = makeModel({
      meta: { format_version: '5.0', model_format: 'free', box_uv: false },
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        makeCube('Chest', [-4, 12, -2], [4, 24, 2]),
        makeCube('Buckle', [-1, 11, -1], [1, 13, 1], { visibility: false }),
        makeCube('Wing', [1, 16, 3], [3, 20, 7]),
        makeCube('Loose', [2, 10, 1], [5, 14, 4], { origin: [3, 12, 2] }),
      ],
      outliner: [
        makeGroup('head', [0, 24, 0], ['uuid-Head']),
        makeGroup('body', [0, 24, 0], ['uuid-Chest', makeGroup('belt', [0, 12, 0], ['uuid-Buckle'])]),
        makeGroup('Wings', [0, 18, 4], ['uuid-Wing']),
        'uuid-Loose',
      ],
      animations: [animation],
    })

    const { config, animations } = parseBbmodel(encode(model))

    const head = config.elements.find((element) => element.id === 'head')
    const body = config.elements.find((element) => element.id === 'body')
    const wings = config.elements.find((element) => element.name === 'Wings')
    const loose = config.elements.find((element) => element.name === 'Loose')

    expect(head?.storeID).toBeUndefined()
    expect(body?.storeID).toBeUndefined()
    expect(wings?.customPart).toBe(true)
    expect(wings?.storeID).toBeGreaterThanOrEqual(100)
    expect(loose?.storeID).toBeUndefined()

    const storeIds: number[] = []
    const walkStoreIds = (nodes: Array<{ storeID?: number, children?: unknown[] }>): void => {
      for (const node of nodes) {
        if (typeof node.storeID === 'number') storeIds.push(node.storeID)
        walkStoreIds((node.children ?? []) as Array<{ storeID?: number, children?: unknown[] }>)
      }
    }
    walkStoreIds(config.elements as unknown as Array<{ storeID?: number, children?: unknown[] }>)
    expect(storeIds.length).toBe(new Set(storeIds).size)
    for (const storeId of storeIds) {
      expect(storeId).toBeGreaterThanOrEqual(100)
    }

    const idOf = (node: { storeID?: number } | undefined): number => node?.storeID ?? -1
    const belt = body?.children?.[1]
    const [anim] = animations
    expect(anim?.frames).toHaveLength(5)
    expect(anim?.duration).toBe(250)
    const components = anim?.frames[0]?.components ?? []
    expect(components).toHaveLength(6)
    const byId = new Map(components.map((component) => [component.storeID, component]))
    expect(byId.get(0)?.show).toBe(true)
    expect(byId.get(idOf(belt))?.rotation.x).toBeCloseTo(10, 5)
    expect(byId.get(idOf(body?.children?.[0]))?.scale).toEqual({ x: 1.5, y: 1.5, z: 1.5 })
    expect(byId.get(idOf(belt?.children?.[0]))?.show).toBe(false)
    expect(byId.get(idOf(belt?.children?.[0]))?.rotation.x).toBeCloseTo(20, 5)
    expect(byId.get(idOf(wings?.children?.[0]))?.pos).toEqual({ x: 0, y: -1, z: 0 })
    expect(byId.get(idOf(loose?.children?.[0]))?.rotation.x).toBeCloseTo(25, 5)
    const lastFrame = anim?.frames[4]?.components ?? []
    const headLast = lastFrame.find((component) => component.storeID === 0)
    expect(headLast?.rotation.x).toBeCloseTo(24, 5)
    for (const component of components) {
      expect(component.storeID === 0 || component.storeID >= 100).toBe(true)
    }
  })

  it('сквозная конвертация в cpmConfigToBytes пишет анимации без reportError', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head'])],
      textures: [{ name: 'skin.png', source: `data:image/png;base64,${TINY_PNG_BASE64}` }],
      animations: [{
        uuid: 'anim-nod',
        name: 'Nod',
        loop: 'once',
        length: 0.5,
        animators: {
          'group-head': {
            channels: ['rotation'],
            keyframes: [bbKeyframe('rotation', '0', 0), bbKeyframe('rotation', '25', 0.5)],
          },
        },
      }],
    })

    const { config, skinPng, animations } = parseBbmodel(encode(model))
    const plain = cpmConfigToBytes(config, skinPng ?? undefined)
    const withAnimations = cpmConfigToBytes(config, skinPng ?? undefined, { animations })

    expect(reportError).not.toHaveBeenCalled()
    expect(withAnimations.length).toBeGreaterThan(plain.length)
  })

  it('модель без анимаций возвращает пустой список', () => {
    const model = makeModel({
      elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
      outliner: [makeGroup('head', [0, 24, 0], ['uuid-Head'])],
    })

    const { animations } = parseBbmodel(encode(model))

    expect(animations).toEqual([])
  })
})
