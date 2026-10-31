import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { writeAnimationParts, type CpmAnimationElement } from '../cpmAnimationWriter'
import { parseCpmAnimations } from '@/04-features/cpm-settings/cpmAnimationParser'
import { createZipReadBudget } from '../cpmProjectZip'
import type { CPMAnimation, CPMAnimationFrameComponent, CPMAnimEnc } from '@/05-entities'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

const BLOCK = {
  END: 0, POSE: 1, GESTURE: 2, ANIMATION_DATA_ROTATION: 3, ANIMATION_DATA_POS: 4,
  ANIMATION_DATA_VIS: 5, ANIMATION_DATA_COLOR: 6, ANIMATION_INFO: 7, ENCODING: 8,
  CTRL_IDS: 9, ANIMATION_DATA_EXTRA: 10, ANIMATION_DATA_INTERPOLATION: 11,
  ANIMATION_DATA_SCALE: 12, ANIMATION_DATA_LAYER_DEFAULT: 13, ANIMATION_DATA_ORDER: 14,
  ANIMATION_DATA_IS_PROPERTY: 15, ANIMATION_DATA_GROUP: 16, ANIMATION_DATA_COMMAND: 18,
  ANIMATION_DATA_ENC: 19, ANIMATION_MUST_FINISH: 20, ANIMATION_SLIDER_OPT: 21,
  ANIMATION_BUTTON_HIDDEN: 22,
}

const BLOCK_NAMES = new Map(Object.entries(BLOCK).map(([name, type]) => [type, name]))

interface Block {
  type: number
  data: Uint8Array
}

function readVarInt(data: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let cursor = offset
  let byte = 0
  do {
    byte = data[cursor] ?? 0
    value |= (byte & 0x7F) << shift
    shift += 7
    cursor += 1
  } while ((byte & 0x80) !== 0)
  return { value, next: cursor }
}

function readBlocks(bytes: Uint8Array): Block[] {
  const blocks: Block[] = []
  let offset = 0
  while (offset < bytes.length) {
    const type = bytes[offset] ?? 0
    offset += 1
    const { value: length, next } = readVarInt(bytes, offset)
    blocks.push({ type, data: bytes.subarray(next, next + length) })
    offset = next + length
  }
  return blocks
}

function blockTypes(blocks: Block[]): string[] {
  return blocks.map((block) => BLOCK_NAMES.get(block.type) ?? String(block.type))
}

function findBlock(blocks: Block[], type: number): Block | undefined {
  return blocks.find((block) => block.type === type)
}

function u16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function i16(data: Uint8Array, offset: number): number {
  const value = u16(data, offset)
  return value >= 0x8000 ? value - 0x10000 : value
}

function readAscii(data: Uint8Array, offset = 0): string {
  const length = u16(data, offset)
  let result = ''
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(data[offset + 2 + index] ?? 0)
  }
  return result
}

const element = (overrides: Partial<CpmAnimationElement> = {}): CpmAnimationElement => ({
  id: 10,
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  hidden: false,
  texture: true,
  recolor: false,
  rgb: 0,
  ...overrides,
})

const elements = (overrides: Partial<CpmAnimationElement> = {}): Map<number, CpmAnimationElement> =>
  new Map([[555, element(overrides)]])

const component = (overrides: Partial<CPMAnimationFrameComponent> = {}): CPMAnimationFrameComponent => ({
  storeID: 555,
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  show: true,
  color: '0',
  ...overrides,
})

const animation = (overrides: Partial<CPMAnimation> = {}): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: true,
  interpolator: 'poly_loop',
  hidden: false,
  frames: [{ components: [component({ pos: { x: 1, y: 0, z: 0 } })] }],
  layerControlled: false,
  ...overrides,
})

const animEnc = (overrides: Partial<CPMAnimEnc> = {}): CPMAnimEnc => ({
  freeLayers: ['hat', 'jacket', 'left_sleeve'],
  defaultValues: { hat: true },
  ...overrides,
})

describe('writeAnimationParts', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  it('writes a gesture as a CPM animation part', () => {
    const parts = writeAnimationParts({ animations: [animation()], animEnc: null, elements: elements() })

    expect(parts).toHaveLength(1)
    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks)).toEqual([
      'GESTURE', 'ANIMATION_INFO', 'ANIMATION_DATA_ENC', 'ANIMATION_DATA_POS', 'CTRL_IDS', 'END',
    ])

    const gesture = findBlock(blocks, BLOCK.GESTURE)?.data ?? new Uint8Array()
    expect(gesture[0]).toBe(0)
    expect(readAscii(gesture, 1)).toBe('Wave')
    expect(gesture[gesture.length - 1]).toBe(1)

    const info = findBlock(blocks, BLOCK.ANIMATION_INFO)?.data ?? new Uint8Array()
    expect(info[0]).toBe(0)
    expect(info[1]).toBe(1)
    expect(info[2]).toBe(1)
    expect(u16(info, 3)).toBe(1000)
    expect(readVarInt(info, 5).value).toBe(10)

    const pos = findBlock(blocks, BLOCK.ANIMATION_DATA_POS)?.data ?? new Uint8Array()
    expect(pos[0]).toBe(0)
    expect(pos[1]).toBe(0)
    expect(i16(pos, 2)).toBe(682)
    expect(i16(pos, 4)).toBe(0)
    expect(i16(pos, 6)).toBe(0)

    const encoding = findBlock(blocks, BLOCK.ANIMATION_DATA_ENC)?.data ?? new Uint8Array()
    expect([...encoding]).toEqual([0, 1])

    const ctrl = findBlock(blocks, BLOCK.CTRL_IDS)?.data ?? new Uint8Array()
    expect([...ctrl]).toEqual([0, 0])
  })

  it('writes a vanilla pose with the game pose index', () => {
    const parts = writeAnimationParts({
      animations: [animation({ kind: 'vanilla-pose', name: 'walking', poseIndex: 2, additive: false })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks).slice(0, 2)).toEqual(['POSE', 'ANIMATION_INFO'])

    const pose = findBlock(blocks, BLOCK.POSE)?.data ?? new Uint8Array()
    expect(pose[0]).toBe(2)
    expect(pose[1]).toBe(0)
    expect(pose[2]).toBe(0)
    expect(pose).toHaveLength(3)
  })

  it('writes a custom pose with its name', () => {
    const parts = writeAnimationParts({
      animations: [animation({ kind: 'custom-pose', name: 'Dance', additive: true })],
      animEnc: null,
      elements: elements(),
    })

    const pose = findBlock(readBlocks(parts[0] ?? new Uint8Array()), BLOCK.POSE)?.data ?? new Uint8Array()
    expect(pose[0]).toBe(0)
    expect(readAscii(pose, 3)).toBe('Dance')
  })

  it('writes staged animations under their name prefix', () => {
    const parts = writeAnimationParts({
      animations: [animation({ kind: 'setup', name: 'Combo' })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    const gesture = findBlock(blocks, BLOCK.GESTURE)?.data ?? new Uint8Array()
    expect(readAscii(gesture, 1)).toBe('$pre$Combo')
    expect(findBlock(blocks, BLOCK.ANIMATION_DATA_ENC)).toBeUndefined()
  })

  it('skips animations without any frame changes', () => {
    const parts = writeAnimationParts({
      animations: [animation({ frames: [{ components: [component()] }] })],
      animEnc: null,
      elements: elements(),
    })

    expect(parts).toEqual([])
  })

  it('writes only the channels that change', () => {
    const parts = writeAnimationParts({
      animations: [animation({ frames: [{ components: [component({ scale: { x: 2, y: 1, z: 1 } })] }] })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks)).toContain('ANIMATION_DATA_SCALE')
    expect(blockTypes(blocks)).not.toContain('ANIMATION_DATA_POS')

    const scale = findBlock(blocks, BLOCK.ANIMATION_DATA_SCALE)?.data ?? new Uint8Array()
    expect(i16(scale, 2)).toBe(1364)
  })

  it('writes in-range rotation frames as unsigned angle fractions', () => {
    const parts = writeAnimationParts({
      animations: [animation({ frames: [{ components: [component({ rotation: { x: 90, y: 180, z: 270 } })] }] })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks)).toContain('ANIMATION_DATA_ROTATION')

    const rot = findBlock(blocks, BLOCK.ANIMATION_DATA_ROTATION)?.data ?? new Uint8Array()
    expect(rot[0]).toBe(0)
    expect(rot[1]).toBe(0)
    expect(u16(rot, 2)).toBe(16383)
    expect(u16(rot, 4)).toBe(32767)
    expect(u16(rot, 6)).toBe(49151)
  })

  it('wraps negative and over-360 rotation frames into the 0-360 range', () => {
    const parts = writeAnimationParts({
      animations: [animation({
        frames: [
          { components: [component({ rotation: { x: -45, y: 405, z: 720 } })] },
          { components: [component({ rotation: { x: -405, y: 765, z: 360 } })] },
        ],
      })],
      animEnc: null,
      elements: elements(),
    })

    const rot = findBlock(readBlocks(parts[0] ?? new Uint8Array()), BLOCK.ANIMATION_DATA_ROTATION)?.data ?? new Uint8Array()
    expect(u16(rot, 2)).toBe(57343)
    expect(u16(rot, 4)).toBe(8191)
    expect(u16(rot, 6)).toBe(0)
    expect(u16(rot, 8)).toBe(57343)
    expect(u16(rot, 10)).toBe(8191)
    expect(u16(rot, 12)).toBe(0)
  })

  it('exports cpmproject frames with negative and over-360 angles as equivalent rotations', async () => {
    const zip = new JSZip()
    zip.file('animations/g_turn.json', JSON.stringify({
      name: 'Turn',
      layerControlled: false,
      frames: [{
        components: [{
          storeID: 555,
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: -45, y: 405, z: 720 },
          scale: { x: 1, y: 1, z: 1 },
          show: true,
        }],
      }],
    }))

    const animations = await parseCpmAnimations(zip, createZipReadBudget())
    expect(animations).toHaveLength(1)

    const parts = writeAnimationParts({ animations, animEnc: null, elements: elements() })
    expect(reportError).not.toHaveBeenCalled()

    const rot = findBlock(readBlocks(parts[0] ?? new Uint8Array()), BLOCK.ANIMATION_DATA_ROTATION)?.data ?? new Uint8Array()
    expect(u16(rot, 2) / 65535 * 360).toBeCloseTo(315, 1)
    expect(u16(rot, 4) / 65535 * 360).toBeCloseTo(45, 1)
    expect(u16(rot, 6) / 65535 * 360).toBe(0)
  })

  it('writes hidden frames as packed visibility bits', () => {
    const frames = Array.from({ length: 3 }, (_, index) => ({ components: [component({ show: index !== 1 })] }))

    const parts = writeAnimationParts({
      animations: [animation({ frames })],
      animEnc: null,
      elements: elements(),
    })

    const vis = findBlock(readBlocks(parts[0] ?? new Uint8Array()), BLOCK.ANIMATION_DATA_VIS)?.data ?? new Uint8Array()
    expect(vis[0]).toBe(0)
    expect(vis[1]).toBe(0)
    expect([...vis.subarray(2)]).toEqual([0b101])
  })

  it('encodes layer controlled animations with the anim_enc layers', () => {
    const parts = writeAnimationParts({
      animations: [
        animation({ name: 'First', layerControlled: true }),
        animation({ id: 'g_second.json', name: 'Second', layerControlled: true }),
      ],
      animEnc: animEnc(),
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    const encodings = blocks
      .filter((block) => block.type === BLOCK.ENCODING)
      .map((block) => [...block.data])
    expect(encodings).toEqual([[0, 1], [1, 2]])
    expect(findBlock(blocks, BLOCK.ANIMATION_DATA_ENC)).toBeUndefined()

    const ctrl = findBlock(blocks, BLOCK.CTRL_IDS)?.data ?? new Uint8Array()
    expect([...ctrl]).toEqual([0, 19])
  })

  it('keeps duplicate gesture names on the masked encoding value', () => {
    const parts = writeAnimationParts({
      animations: [
        animation({ name: 'Same', layerControlled: true }),
        animation({ id: 'g_same.json', name: 'Same', layerControlled: true }),
      ],
      animEnc: animEnc(),
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blocks.filter((block) => block.type === BLOCK.ENCODING)).toHaveLength(1)

    const duplicates = blocks
      .filter((block) => block.type === BLOCK.ANIMATION_DATA_ENC)
      .map((block) => [...block.data])
    expect(duplicates).toEqual([[1, 19]])
  })

  it('keeps duplicate gesture names on one fallback encoding id', () => {
    const parts = writeAnimationParts({
      animations: [
        animation({ name: 'Same', layerControlled: true }),
        animation({ id: 'g_same.json', name: 'Same', layerControlled: true }),
        animation({ id: 'g_other.json', name: 'Other', layerControlled: true }),
      ],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    const encodings = blocks
      .filter((block) => block.type === BLOCK.ANIMATION_DATA_ENC)
      .map((block) => [...block.data])
    expect(encodings).toEqual([[0, 1], [1, 0], [2, 2]])
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('anim_enc.json'))
  })

  it('falls back to plain gestures when the encoding is unusable', () => {
    const parts = writeAnimationParts({
      animations: [animation({ layerControlled: true })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks)).toContain('ANIMATION_DATA_ENC')
    expect(blockTypes(blocks)).not.toContain('ENCODING')
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('anim_enc.json'))
  })

  it('writes value layer sliders and layer defaults', () => {
    const parts = writeAnimationParts({
      animations: [animation({
        kind: 'value-layer',
        name: 'Strength',
        layerDefault: 0.5,
        maxValue: 42,
        interpolateValue: false,
      })],
      animEnc: null,
      elements: elements(),
    })

    const blocks = readBlocks(parts[0] ?? new Uint8Array())
    expect(blockTypes(blocks)).not.toContain('ENCODING')

    const gesture = findBlock(blocks, BLOCK.GESTURE)?.data ?? new Uint8Array()
    expect(readAscii(gesture, 1)).toBe('$value$Strength')

    const layerDefault = findBlock(blocks, BLOCK.ANIMATION_DATA_LAYER_DEFAULT)?.data ?? new Uint8Array()
    expect([...layerDefault]).toEqual([0, 127])

    const slider = findBlock(blocks, BLOCK.ANIMATION_SLIDER_OPT)?.data ?? new Uint8Array()
    expect([...slider]).toEqual([0, 0, 42])
  })

  it('splits animations over the count limit into separate parts', () => {
    const animations = Array.from({ length: 252 }, (_, index) => animation({
      id: `g_${index}.json`,
      name: `Wave ${index}`,
      layerControlled: false,
    }))

    const parts = writeAnimationParts({ animations, animEnc: null, elements: elements() })
    expect(parts).toHaveLength(2)

    const first = readBlocks(parts[0] ?? new Uint8Array())
    expect(first.filter((block) => block.type === BLOCK.ANIMATION_INFO)).toHaveLength(251)
    expect([...(findBlock(first, BLOCK.CTRL_IDS)?.data ?? new Uint8Array())]).toEqual([0, 0])

    const second = readBlocks(parts[1] ?? new Uint8Array())
    expect(second.filter((block) => block.type === BLOCK.ANIMATION_INFO)).toHaveLength(1)
    const info = findBlock(second, BLOCK.ANIMATION_INFO)?.data ?? new Uint8Array()
    expect(info[0]).toBe(0)
  })

  it('assigns fallback encoding ids across the full one-byte range', () => {
    const animations = Array.from({ length: 255 }, (_, index) => animation({
      id: `g_${index}.json`,
      name: `Wave ${index}`,
    }))

    const parts = writeAnimationParts({ animations, animEnc: null, elements: elements() })
    expect(parts).toHaveLength(2)

    const encodings = parts.flatMap((part) =>
      readBlocks(part)
        .filter((block) => block.type === BLOCK.ANIMATION_DATA_ENC)
        .map((block) => [...block.data]),
    )
    expect(encodings).toHaveLength(255)
    expect(encodings[encodings.length - 1]).toEqual([3, 255])
  })

  it('fails when fallback encoding ids exceed the one-byte range', () => {
    const animations = Array.from({ length: 256 }, (_, index) => animation({
      id: `g_${index}.json`,
      name: `Wave ${index}`,
    }))

    expect(() => writeAnimationParts({ animations, animEnc: null, elements: elements() }))
      .toThrow('Контрольный id 256 не помещается в однобайтовый диапазон')
  })

  it('drops components missing from the model', () => {
    const parts = writeAnimationParts({
      animations: [animation({ frames: [{ components: [component({ storeID: 999 })] }] })],
      animEnc: null,
      elements: elements(),
    })

    expect(parts).toEqual([])
  })
})
