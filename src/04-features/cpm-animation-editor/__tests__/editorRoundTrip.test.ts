import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import type { CPMAnimation, CPMConfig, CPMVec3 } from '@/05-entities'
import { parseCpmProjectFile } from '../../cpm-settings/cpmProjectParser'
import { cpmProjectToBytes } from '../../cpm-convert/cpmProjectExporter'
import { buildEditorBoneIndex, buildEditorState, serializeEditorAnimation } from '../editorModel'
import { setBonePose } from '../editorOperations'
import type { EditorAnimationState, EditorBoneTrack } from '../types'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Head',
      pos: vec(),
      rotation: vec(),
    },
  ],
}

const skinPng = new Uint8Array(24)
skinPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
skinPng[19] = 64
skinPng[23] = 64

const componentJson = (storeID: number, rotationY: number): Record<string, unknown> => ({
  storeID,
  pos: vec(),
  rotation: vec(0, rotationY, 0),
  scale: vec(1, 1, 1),
  show: true,
  color: '0',
})

const animationJson = (): Record<string, unknown> => ({
  name: 'Wave',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  layerControlled: false,
  frames: [
    { components: [componentJson(0, 5)] },
    { components: [] },
    { components: [componentJson(0, 20)] },
    { components: [] },
    { components: [] },
    { components: [] },
  ],
})

async function buildProject(files: Record<string, string | Uint8Array> = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('config.json', JSON.stringify(config))
  zip.file('skin.png', skinPng)
  zip.file('animations/g_wave.json', JSON.stringify(animationJson()))
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

const BLOCK = {
  END: 0,
  POSE: 1,
  GESTURE: 2,
  ROTATION: 3,
  POS: 4,
  VIS: 5,
  INFO: 7,
  DEFINITION: 3,
  ANIMATION_DATA_PART: 10,
  EXTRA: 10,
  INTERPOLATION: 11,
  ORDER: 14,
  COMMAND: 18,
  MUST_FINISH: 20,
  BUTTON_HIDDEN: 22,
}

const VEC_DIV = Math.floor(32767 / 48)

interface Block {
  type: number
  data: Uint8Array
}

function readVarInt(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let cursor = offset
  let byte = 0
  do {
    byte = bytes[cursor] ?? 0
    value |= (byte & 0x7F) << shift
    shift += 7
    cursor += 1
  } while ((byte & 0x80) !== 0)
  return { value, next: cursor }
}

function readBlocks(bytes: Uint8Array, start: number, end: number): Block[] {
  const blocks: Block[] = []
  let offset = start
  while (offset < end) {
    const type = bytes[offset] ?? 0
    offset += 1
    const { value: length, next } = readVarInt(bytes, offset)
    const dataEnd = Math.min(next + length, end)
    blocks.push({ type, data: bytes.subarray(next, dataEnd) })
    offset = dataEnd
  }
  return blocks
}

function readOuterBlocks(file: Uint8Array): Block[] {
  const blocks: Block[] = []
  let offset = 1
  while (offset < file.length) {
    const type = file[offset] ?? 0
    offset += 1
    const { value: length, next } = readVarInt(file, offset)
    const dataEnd = next + length
    blocks.push({ type, data: file.subarray(next, dataEnd) })
    offset = dataEnd
    if (type === BLOCK.END) break
  }
  return blocks
}

function readDefinitionBlocks(definition: Uint8Array): Block[] {
  const { value: cubeCount, next } = readVarInt(definition, 0)
  let offset = next
  for (let index = 0; index < cubeCount; index++) {
    offset += 21
    const parent = readVarInt(definition, offset)
    offset = parent.next
    const texSize = definition[offset] ?? 0
    offset += 1
    offset += texSize === 0 ? 3 : 2
  }
  return readBlocks(definition, offset, definition.length)
}

function u16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function i16(data: Uint8Array, offset: number): number {
  const raw = u16(data, offset)
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

function angleAt(data: Uint8Array, offset: number): number {
  return (u16(data, offset) / 65535) * 360
}

function readUtf(data: Uint8Array, offset: number): string {
  const length = u16(data, offset)
  let result = ''
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(data[offset + 2 + index] ?? 0)
  }
  return result
}

interface DecodedAnimation {
  name: string
  poseIndex: number | null
  duration: number
  frameCount: number
  additive: boolean
  loop: boolean
  priority: number
  interpolator: number | null
  order: number
  command: boolean
  mustFinish: boolean
  buttonHidden: boolean
  frames: { rotation: CPMVec3; pos: CPMVec3; show: boolean }[]
}

function decodeAnimation(part: Uint8Array): DecodedAnimation {
  const blocks = readBlocks(part, 0, part.length)
  const info = blocks.find((block) => block.type === BLOCK.INFO)
  if (!info) throw new Error('В части нет ANIMATION_INFO')
  const gesture = blocks.find((block) => block.type === BLOCK.GESTURE)
  const pose = blocks.find((block) => block.type === BLOCK.POSE)
  if (!gesture && !pose) throw new Error('В части нет GESTURE или POSE')

  const frameCount = info.data[2] ?? 0
  const duration = u16(info.data, 3)
  const componentCount = info.data[1] ?? 0

  const rotations = new Map<number, CPMVec3[]>()
  const positions = new Map<number, CPMVec3[]>()
  const visibility = new Map<number, boolean[]>()

  for (const block of blocks) {
    if (block.type !== BLOCK.ROTATION && block.type !== BLOCK.POS && block.type !== BLOCK.VIS) continue
    const component = block.data[1] ?? 0
    if (block.type === BLOCK.ROTATION) {
      const values: CPMVec3[] = []
      for (let frame = 0; frame < frameCount; frame++) {
        const base = 2 + frame * 6
        values.push({
          x: angleAt(block.data, base),
          y: angleAt(block.data, base + 2),
          z: angleAt(block.data, base + 4),
        })
      }
      rotations.set(component, values)
      continue
    }
    if (block.type === BLOCK.POS) {
      const values: CPMVec3[] = []
      for (let frame = 0; frame < frameCount; frame++) {
        const base = 2 + frame * 6
        values.push({
          x: i16(block.data, base) / VEC_DIV,
          y: i16(block.data, base + 2) / VEC_DIV,
          z: i16(block.data, base + 4) / VEC_DIV,
        })
      }
      positions.set(component, values)
      continue
    }
    const values: boolean[] = []
    for (let frame = 0; frame < frameCount; frame++) {
      const byte = block.data[2 + Math.floor(frame / 8)] ?? 0
      values.push(((byte >> (frame % 8)) & 1) === 1)
    }
    visibility.set(component, values)
  }

  const frames = Array.from({ length: frameCount }, (_, frame) => ({
    rotation: rotations.get(0)?.[frame] ?? vec(),
    pos: positions.get(0)?.[frame] ?? vec(),
    show: visibility.get(0)?.[frame] ?? true,
  }))

  const flags = gesture
    ? (gesture.data[3 + u16(gesture.data, 1)] ?? 0)
    : (pose?.data[2] ?? 0)
  const interpolation = blocks.find((block) => block.type === BLOCK.INTERPOLATION)
  const priority = blocks.find((block) => block.type === BLOCK.EXTRA)
  const order = blocks.find((block) => block.type === BLOCK.ORDER)

  expect(componentCount).toBeGreaterThan(0)
  return {
    name: gesture ? readUtf(gesture.data, 1) : '',
    poseIndex: pose ? (pose.data[0] ?? null) : null,
    duration,
    frameCount,
    additive: (flags & 1) === 1,
    loop: (flags & 2) === 2,
    priority: priority?.data[1] ?? 0,
    interpolator: interpolation?.data[1] ?? null,
    order: order?.data[1] ?? 0,
    command: blocks.some((block) => block.type === BLOCK.COMMAND),
    mustFinish: blocks.some((block) => block.type === BLOCK.MUST_FINISH),
    buttonHidden: blocks.some((block) => block.type === BLOCK.BUTTON_HIDDEN),
    frames,
  }
}

function readFirstAnimation(file: Uint8Array): DecodedAnimation {
  const definition = readOuterBlocks(file).find((block) => block.type === BLOCK.DEFINITION)
  if (!definition) throw new Error('В файле нет определения модели')
  const part = readDefinitionBlocks(definition.data).find((block) => block.type === BLOCK.ANIMATION_DATA_PART)
  if (!part) throw new Error('В определении нет блока анимаций')
  return decodeAnimation(part.data)
}

function trackOf(state: EditorAnimationState): EditorBoneTrack {
  const track = state.model.bones.get(0)
  if (!track) throw new Error('Нет дорожки кости 0')
  return track
}

describe('round trip .cpmproject', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  it('parses a project, edits an animation, writes it and reads the frames back', async () => {
    const projectBytes = await buildProject()
    const project = await parseCpmProjectFile(projectBytes)
    const [source] = project.animations
    if (!source) throw new Error('Анимация не разобралась')

    expect(source.frames).toHaveLength(6)
    expect(source.name).toBe('Wave')

    const index = buildEditorBoneIndex(config)
    const initial = buildEditorState(source, index)
    expect(trackOf(initial).keys).toEqual([0, 2])

    const withKey = setBonePose(initial, 0, 4, { rotation: vec(0, 60, 0), pos: vec(1, 0, 0), show: true })
    if (!withKey) throw new Error('Ключ не поставился')
    const edited = setBonePose(withKey, 0, 5, { rotation: vec(0, 60, 0), pos: vec(1, 0, 0), show: false })
    if (!edited) throw new Error('Ключ видимости не поставился')

    expect(trackOf(edited).keys).toEqual([0, 2, 4, 5])
    expect(trackOf(edited).frames.map((item) => item.rotation.y)).toEqual([5, 0, 20, 40, 60, 60])
    expect(trackOf(edited).frames.map((item) => item.pos.x)).toEqual([0, 0, 0, 0.5, 1, 1])
    expect(trackOf(edited).frames.map((item) => item.show)).toEqual([true, true, true, true, true, false])

    const written = await cpmProjectToBytes(projectBytes, {
      animations: [serializeEditorAnimation(edited)],
      animEnc: project.animEnc,
    })
    const decoded = readFirstAnimation(written)

    expect(decoded.name).toBe('Wave')
    expect(decoded.duration).toBe(1000)
    expect(decoded.frameCount).toBe(6)

    const expected = trackOf(edited)
    decoded.frames.forEach((decodedFrame, frame) => {
      const expectedFrame = expected.frames[frame]
      if (!expectedFrame) throw new Error(`Нет кадра ${frame}`)
      expect(decodedFrame.rotation.x).toBeCloseTo(expectedFrame.rotation.x, 1)
      expect(decodedFrame.rotation.y).toBeCloseTo(expectedFrame.rotation.y, 1)
      expect(decodedFrame.rotation.z).toBeCloseTo(expectedFrame.rotation.z, 1)
      expect(decodedFrame.pos.x).toBeCloseTo(expectedFrame.pos.x, 2)
      expect(decodedFrame.pos.y).toBeCloseTo(expectedFrame.pos.y, 2)
      expect(decodedFrame.pos.z).toBeCloseTo(expectedFrame.pos.z, 2)
      expect(decodedFrame.show).toBe(expectedFrame.show)
    })
  })

  it('rejects a broken project file', async () => {
    const zip = new JSZip()
    zip.file('config.json', '{ broken json')
    zip.file('skin.png', skinPng)
    zip.file('animations/g_wave.json', JSON.stringify(animationJson()))
    const broken = await zip.generateAsync({ type: 'uint8array' })

    await expect(parseCpmProjectFile(broken)).rejects.toThrow('Некорректный config.json в файле проекта')
  })

  it('writes the advanced properties', async () => {
    const projectBytes = await buildProject()
    const animation: CPMAnimation = {
      id: 'g_intro.json',
      name: 'Intro',
      kind: 'gesture',
      duration: 1500,
      priority: 3,
      loop: true,
      additive: true,
      interpolator: 'trig_single',
      hidden: true,
      order: 2,
      command: false,
      mustFinish: true,
      frames: Array.from({ length: 6 }, () => ({ components: [] })),
    }
    let state = buildEditorState(animation, buildEditorBoneIndex(config))
    state = setBonePose(state, 0, 0, { rotation: vec(0, 10, 0), pos: vec(), show: true }) ?? state
    state = setBonePose(state, 0, 5, { rotation: vec(0, 20, 0), pos: vec(), show: true }) ?? state

    const written = await cpmProjectToBytes(projectBytes, {
      animations: [serializeEditorAnimation(state)],
      animEnc: null,
    })
    const decoded = readFirstAnimation(written)

    expect(decoded.name).toBe('Intro')
    expect(decoded.duration).toBe(1500)
    expect(decoded.additive).toBe(true)
    expect(decoded.loop).toBe(true)
    expect(decoded.priority).toBe(3)
    expect(decoded.interpolator).toBe(6)
    expect(decoded.order).toBe(2)
    expect(decoded.command).toBe(false)
    expect(decoded.mustFinish).toBe(true)
    expect(decoded.buttonHidden).toBe(true)
  })

  it('writes the command flag without an order', async () => {
    const projectBytes = await buildProject()
    const animation: CPMAnimation = {
      id: 'g_command.json',
      name: 'Command',
      kind: 'gesture',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'poly_loop',
      hidden: false,
      order: 4,
      command: true,
      frames: Array.from({ length: 6 }, () => ({ components: [] })),
    }
    let state = buildEditorState(animation, buildEditorBoneIndex(config))
    state = setBonePose(state, 0, 0, { rotation: vec(0, 10, 0), pos: vec(), show: true }) ?? state
    state = setBonePose(state, 0, 5, { rotation: vec(0, 20, 0), pos: vec(), show: true }) ?? state

    const written = await cpmProjectToBytes(projectBytes, {
      animations: [serializeEditorAnimation(state)],
      animEnc: null,
    })
    const decoded = readFirstAnimation(written)

    expect(decoded.command).toBe(true)
    expect(decoded.order).toBe(0)
  })

  it('writes the service prefix of a staged trigger', async () => {
    const projectBytes = await buildProject()
    const animation: CPMAnimation = {
      id: 'g_intro.json',
      name: 'Intro',
      kind: 'setup',
      duration: 1200,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'poly_loop',
      hidden: false,
      frames: Array.from({ length: 6 }, () => ({ components: [] })),
    }
    let state = buildEditorState(animation, buildEditorBoneIndex(config))
    state = setBonePose(state, 0, 0, { rotation: vec(0, 10, 0), pos: vec(), show: true }) ?? state
    state = setBonePose(state, 0, 5, { rotation: vec(0, 20, 0), pos: vec(), show: true }) ?? state

    const written = await cpmProjectToBytes(projectBytes, {
      animations: [serializeEditorAnimation(state)],
      animEnc: null,
    })
    const decoded = readFirstAnimation(written)

    expect(decoded.name).toBe('$pre$Intro')
    expect(decoded.duration).toBe(1200)
  })

  it('writes the vanilla pose index instead of a gesture name', async () => {
    const projectBytes = await buildProject()
    const animation: CPMAnimation = {
      id: 'v_swimming.json',
      name: 'swimming',
      kind: 'vanilla-pose',
      poseIndex: 5,
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'poly_loop',
      hidden: false,
      frames: Array.from({ length: 6 }, () => ({ components: [] })),
    }
    let state = buildEditorState(animation, buildEditorBoneIndex(config))
    state = setBonePose(state, 0, 1, { rotation: vec(0, 15, 0), pos: vec(), show: true }) ?? state
    state = setBonePose(state, 0, 4, { rotation: vec(0, 45, 0), pos: vec(), show: true }) ?? state

    const written = await cpmProjectToBytes(projectBytes, {
      animations: [serializeEditorAnimation(state)],
      animEnc: null,
    })
    const decoded = readFirstAnimation(written)

    expect(decoded.poseIndex).toBe(5)
    expect(decoded.name).toBe('')
    expect(decoded.frameCount).toBe(6)
    expect(decoded.frames[4]?.rotation.y).toBeCloseTo(45, 1)
  })

  it('skips a broken animation file and reports it', async () => {
    const projectBytes = await buildProject({ 'animations/broken.json': '{ broken anim' })
    const project = await parseCpmProjectFile(projectBytes)

    expect(project.animations).toHaveLength(1)
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('broken.json'))
  })
})
