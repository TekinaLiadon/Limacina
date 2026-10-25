import { describe, expect, it } from 'vitest'
import { convertBbmodelAnimations, type BbmodelAnimatorIndex } from '../bbmodelAnimations'

const animators: BbmodelAnimatorIndex = new Map([
  ['group-part', { id: 100, hidden: false }],
  ['cube-part', { id: 101, hidden: true }],
  ['group-head', { id: 0, hidden: false }],
])

const vec = (x: unknown, y: unknown, z: unknown): Record<string, unknown> => ({ x, y, z })

const keyframe = (
  channel: string,
  time: unknown,
  points: Array<Record<string, unknown>>,
  interpolation?: string,
): Record<string, unknown> => ({
  channel,
  time,
  data_points: points,
  ...(interpolation === undefined ? {} : { interpolation }),
})

const rotationKeyframe = (x: number, time: number): Record<string, unknown> =>
  keyframe('rotation', time, [vec(x, 0, 0)])

const makeAnimation = (
  rawAnimators: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  uuid: 'anim-1',
  name: 'Wave',
  loop: 'once',
  length: 0.5,
  animators: rawAnimators,
  ...overrides,
})

const convert = (
  animations: unknown,
  legacySigns = false,
  index: BbmodelAnimatorIndex = animators,
): ReturnType<typeof convertBbmodelAnimations> => convertBbmodelAnimations(animations, index, legacySigns)

describe('convertBbmodelAnimations', () => {
  it('принимает числовые строки в длине, времени и координатах кейфрейма', () => {
    const animations = [makeAnimation(
      { 'group-part': { channels: ['position'], keyframes: [keyframe('position', ' 0 ', [vec(' -2.5 ', ' 1 ', ' 2 ')])] } },
      { length: ' 0.5 ' },
    )]

    const [animation] = convert(animations)

    expect(animation?.frames).toHaveLength(10)
    expect(animation?.duration).toBe(500)
    for (const frame of animation?.frames ?? []) {
      expect(frame.components[0]?.storeID).toBe(100)
      expect(frame.components[0]?.pos).toEqual({ x: -2.5, y: -1, z: -2 })
    }
  })

  it('отвергает Molang-выражения в координатах кейфрейма', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['position'], keyframes: [keyframe('position', 0, [vec('math.sin(query.anim_time * 90)', '0', '0')])] },
    })]

    expect(() => convert(animations)).toThrow(/повреждён/)
  })

  it('отвергает нечисловые координаты кейфрейма', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [keyframe('rotation', 0, [vec(true, 0, 0)])] },
    })]

    expect(() => convert(animations)).toThrow(/повреждён/)
  })

  it('инвертирует знаки позиции и поворота для файлов 4.x', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['position', 'rotation'],
        keyframes: [keyframe('position', 0, [vec(-2, 1, 2)]), keyframe('rotation', 0, [vec(5, 10, 3)])],
      },
    }, { length: 0.1 })]

    const [animation] = convert(animations, true)

    expect(animation?.frames).toHaveLength(2)
    for (const frame of animation?.frames ?? []) {
      expect(frame.components[0]?.pos).toEqual({ x: 2, y: -1, z: -2 })
      expect(frame.components[0]?.rotation).toEqual({ x: 355, y: 10, z: 357 })
    }
  })

  it('применяет таблицу знаков 5.0 без дополнительной инверсии', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['position', 'rotation'],
        keyframes: [keyframe('position', 0, [vec(-2, 1, 2)]), keyframe('rotation', 0, [vec(5, 10, 3)])],
      },
    }, { length: 0.1 })]

    const [animation] = convert(animations)

    for (const frame of animation?.frames ?? []) {
      expect(frame.components[0]?.pos).toEqual({ x: -2, y: -1, z: -2 })
      expect(frame.components[0]?.rotation).toEqual({ x: 5, y: 350, z: 357 })
    }
  })

  it('loop: сетка замкнута, последний кадр не достигает финального кейфрейма', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['rotation'],
        keyframes: [rotationKeyframe(0, 0), rotationKeyframe(90, 0.5)],
      },
    }, { loop: 'loop' })]

    const [animation] = convert(animations)

    expect(animation?.loop).toBe(true)
    expect(animation?.interpolator).toBe('linear_loop')
    expect(animation?.duration).toBe(500)
    expect(animation?.frames).toHaveLength(10)
    const values = (animation?.frames ?? []).map((frame) => frame.components[0]?.rotation.x ?? 0)
    values.forEach((value, index) => expect(value).toBeCloseTo(index * 9, 5))
  })

  it('once: финальная поза попадает на последний кадр', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['rotation'],
        keyframes: [rotationKeyframe(0, 0), rotationKeyframe(90, 0.5)],
      },
    })]

    const [animation] = convert(animations)

    expect(animation?.loop).toBe(false)
    expect(animation?.interpolator).toBe('linear_single')
    expect(animation?.frames).toHaveLength(10)
    const values = (animation?.frames ?? []).map((frame) => frame.components[0]?.rotation.x ?? 0)
    values.forEach((value, index) => expect(value).toBeCloseTo(index * 10, 5))
    expect(values[9]).toBeCloseTo(90, 5)
  })

  it('hold работает как однократная анимация', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { loop: 'hold', length: 0.1 })]

    const [animation] = convert(animations)

    expect(animation?.loop).toBe(false)
    expect(animation?.interpolator).toBe('linear_single')
  })

  it('step держит post-значение кейфрейма до следующего', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['rotation'],
        keyframes: [
          rotationKeyframe(0, 0),
          keyframe('rotation', 0.25, [vec(90, 0, 0)], 'step'),
          rotationKeyframe(0, 0.5),
        ],
      },
    }, { loop: 'loop' })]

    const [animation] = convert(animations)

    const values = (animation?.frames ?? []).map((frame) => frame.components[0]?.rotation.x ?? 0)
    const expected = [0, 18, 36, 54, 72, 90, 90, 90, 90, 90]
    expect(values).toHaveLength(expected.length)
    values.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 5))
  })

  it('blink: сегмент идёт от post кейфрейма к pre следующего', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['rotation'],
        keyframes: [
          rotationKeyframe(0, 0),
          keyframe('rotation', 0.2, [vec(0, 0, 0), vec(30, 0, 0)]),
          rotationKeyframe(0, 0.4),
        ],
      },
    }, { loop: 'loop', length: 0.35 })]

    const [animation] = convert(animations)

    expect(animation?.duration).toBe(400)
    expect(animation?.frames).toHaveLength(8)
    const values = (animation?.frames ?? []).map((frame) => frame.components[0]?.rotation.x ?? 0)
    const expected = [0, 0, 0, 0, 30, 22.5, 15, 7.5]
    values.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 5))
  })

  it('catmullrom интерполирует по соседним узлам', () => {
    const animations = [makeAnimation({
      'group-part': {
        channels: ['rotation'],
        keyframes: [
          keyframe('rotation', 0, [vec(0, 0, 0)], 'catmullrom'),
          rotationKeyframe(8, 0.2),
        ],
      },
    }, { loop: 'loop', length: 0.2 })]

    const [animation] = convert(animations)

    const values = (animation?.frames ?? []).map((frame) => frame.components[0]?.rotation.x ?? 0)
    const expected = [0, 1.625, 4, 6.375]
    expect(values).toHaveLength(expected.length)
    values.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 5))
  })

  it('заворачивает углы в диапазон [0, 360)', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [keyframe('rotation', 0, [vec(-10, 1, 370)])] },
    }, { length: 0.1 })]

    const [animation] = convert(animations)

    expect(animation?.frames[0]?.components[0]?.rotation).toEqual({ x: 350, y: 359, z: 350 })
  })

  it('заполняет отсутствующие каналы нейтральными значениями и учитывает hidden узла', () => {
    const animations = [makeAnimation({
      'cube-part': { channels: ['rotation'], keyframes: [rotationKeyframe(15, 0)] },
    }, { length: 0.1 })]

    const [animation] = convert(animations)

    const component = animation?.frames[0]?.components[0]
    expect(component?.storeID).toBe(101)
    expect(component?.pos).toEqual({ x: 0, y: 0, z: 0 })
    expect(component?.rotation).toEqual({ x: 15, y: 0, z: 0 })
    expect(component?.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(component?.show).toBe(false)
  })

  it('конвертирует канал масштаба без инверсии знаков в обеих версиях', () => {
    const makeScaleAnimation = (): Record<string, unknown> => makeAnimation({
      'group-part': { channels: ['scale'], keyframes: [keyframe('scale', 0, [vec(2, 1.5, 0.5)])] },
    }, { length: 0.1 })

    const [legacy] = convert([makeScaleAnimation()], true)
    const [modern] = convert([makeScaleAnimation()])

    expect(legacy?.frames[0]?.components[0]?.scale).toEqual({ x: 2, y: 1.5, z: 0.5 })
    expect(modern?.frames[0]?.components[0]?.scale).toEqual({ x: 2, y: 1.5, z: 0.5 })
  })

  it('адресует ванильный корень по ординалу', () => {
    const animations = [makeAnimation({
      'group-head': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { length: 0.1 })]

    const [animation] = convert(animations)

    expect(animation?.frames[0]?.components[0]?.storeID).toBe(0)
  })

  it('игнорирует неизвестных аниматоров и effects рядом с известными', () => {
    const animations = [makeAnimation({
      'uuid-ghost': { channels: ['rotation'], keyframes: [rotationKeyframe(90, 0)] },
      effects: { keyframes: [rotationKeyframe(90, 0)] },
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { length: 0.1 })]

    const [animation] = convert(animations)

    const components = animation?.frames[0]?.components ?? []
    expect(components).toHaveLength(1)
    expect(components[0]?.storeID).toBe(100)
  })

  it('пропускает анимации без кейфреймов у известных аниматоров', () => {
    expect(convert([makeAnimation({})])).toEqual([])
    expect(convert([makeAnimation({
      'uuid-ghost': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    })])).toEqual([])
    expect(convert([makeAnimation({
      effects: { keyframes: [rotationKeyframe(10, 0)] },
    })])).toEqual([])
    expect(convert([makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [] },
    })])).toEqual([])
  })

  it('пропускает анимацию с нулевой длиной', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { length: 0 })]

    expect(convert(animations)).toEqual([])
  })

  it('пропускает анимацию из одних нейтральных значений', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(0, 0)] },
    }, { length: 0.1 })]

    expect(convert(animations)).toEqual([])
  })

  it('вычищает # из имён и разводит дубликаты суффиксами', () => {
    const track = { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] }
    const animations = [
      makeAnimation({ 'group-part': track }, { uuid: 'anim-a', name: 'Wave#1', length: 0.1 }),
      makeAnimation({ 'group-part': track }, { uuid: 'anim-b', name: 'Wave#2', length: 0.1 }),
      makeAnimation({ 'group-part': track }, { uuid: 'anim-c', name: 'Wave', length: 0.1 }),
      makeAnimation({ 'group-part': track }, { uuid: 'anim-d', name: 'Wave', length: 0.1 }),
    ]

    const names = convert(animations).map((animation) => animation.name)

    expect(names).toEqual(['Wave1', 'Wave2', 'Wave', 'Wave (2)'])
  })

  it('отвергает значения позиции за пределами формата вектора', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['position'], keyframes: [keyframe('position', 0, [vec(100, 0, 0)])] },
    }, { length: 0.1 })]

    expect(() => convert(animations)).toThrow(/формат вектора/)
  })

  it('отвергает длительность больше 65 секунд', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { length: 70 })]

    expect(() => convert(animations)).toThrow(/65 секунд/)
  })

  it('ограничивает число кадров 255', () => {
    const animations = [makeAnimation({
      'group-part': { channels: ['rotation'], keyframes: [rotationKeyframe(10, 0)] },
    }, { length: 30 })]

    const [animation] = convert(animations)

    expect(animation?.frames).toHaveLength(255)
  })
})
