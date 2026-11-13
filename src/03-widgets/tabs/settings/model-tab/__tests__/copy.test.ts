import { describe, expect, it } from 'vitest'
import {
  BLOCKBENCH_CARD_HINT,
  BLOCKBENCH_CARD_TITLE,
  EMPTY_STATES,
  ERRORS,
  FORMAT_HINTS,
  LIST_TITLES,
  MODEL_TAB_LABELS,
  MODEL_TAB_TITLES,
  SUBTABS_ARIA_LABEL,
} from '../copy'

const MODEL_MAX_BYTES = 4 * 1024 * 1024
const SUBTABS = ['cpm', 'blockbench', 'figura'] as const

describe('model tab copy', () => {
  it('fills every exported string', () => {
    const strings = [
      SUBTABS_ARIA_LABEL,
      BLOCKBENCH_CARD_TITLE,
      BLOCKBENCH_CARD_HINT,
      ...Object.values(MODEL_TAB_LABELS),
      ...Object.values(MODEL_TAB_TITLES),
      ...Object.values(EMPTY_STATES),
      ...Object.values(LIST_TITLES),
      ...Object.values(ERRORS),
      FORMAT_HINTS.cpm(MODEL_MAX_BYTES),
      FORMAT_HINTS.blockbench(MODEL_MAX_BYTES),
    ]

    for (const value of strings) {
      expect(value.trim().length).toBeGreaterThan(0)
    }
  })

  it('labels the three sub-tabs in the fixed order', () => {
    expect(SUBTABS.map((key) => MODEL_TAB_LABELS[key])).toEqual(['CPM', 'BlockBench', 'Figura'])
  })

  it('titles every sub-tab', () => {
    const titles = SUBTABS.map((key) => MODEL_TAB_TITLES[key])

    for (const title of titles) {
      expect(title.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(titles).size).toBe(SUBTABS.length)
  })

  it('gives every sub-tab its own empty state', () => {
    const emptyStates = [
      EMPTY_STATES.cpm,
      EMPTY_STATES.blockbench,
      EMPTY_STATES.figuraNoAvatars,
    ]

    for (const empty of emptyStates) {
      expect(empty.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(emptyStates).size).toBe(SUBTABS.length)
  })

  it('keeps the existing cpm viewer hint and names the avatar states apart', () => {
    expect(EMPTY_STATES.cpm).toBe('Загрузите модель, чтобы увидеть её здесь')
    expect(EMPTY_STATES.figuraNoSelection).not.toBe(EMPTY_STATES.figuraNoAvatars)
    expect(EMPTY_STATES.figuraNoSelection.trim().length).toBeGreaterThan(0)
  })

  it('names the format group for screen readers', () => {
    expect(SUBTABS_ARIA_LABEL).toBe('Формат модели')
  })

  it('hints both model formats in the cpm sub-tab', () => {
    const hint = FORMAT_HINTS.cpm(MODEL_MAX_BYTES)

    expect(hint).toBe('Формат: .cpmproject или .bbmodel, не более 4 МБ')
  })

  it('hints only bbmodel in the blockbench sub-tab', () => {
    const hint = FORMAT_HINTS.blockbench(MODEL_MAX_BYTES)

    expect(hint).toBe('Формат: .bbmodel, не более 4 МБ')
    expect(hint).not.toContain('.cpmproject')
  })

  it.each([2, 4, 8])('substitutes the %i MB limit into both hints', (megabytes) => {
    const maxBytes = megabytes * 1024 * 1024

    expect(FORMAT_HINTS.cpm(maxBytes)).toContain(`не более ${megabytes} МБ`)
    expect(FORMAT_HINTS.blockbench(maxBytes)).toContain(`не более ${megabytes} МБ`)
  })

  it('keeps the cpm and blockbench list titles apart', () => {
    expect(LIST_TITLES.cpm).toBe('Загруженные модели CPM')
    expect(LIST_TITLES.blockbench).toBe('Загруженные модели BlockBench')
  })

  it('describes the converted blockbench card', () => {
    expect(BLOCKBENCH_CARD_TITLE.trim().length).toBeGreaterThan(0)
    expect(BLOCKBENCH_CARD_HINT).toBe('Модель сконвертирована в CPM, предпросмотр появится в игре')
  })
})

describe('figura errors', () => {
  it('describes every failure with a distinct message', () => {
    const messages = Object.values(ERRORS)

    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('names the model file when the avatar model is unreadable', () => {
    expect(ERRORS.figuraModelMissing).toContain('model.bbmodel')
  })

  it('names the metadata file when the avatar itself is unreadable', () => {
    expect(ERRORS.figuraAvatarMissing).toContain('avatar.json')
  })

  it('tells the texture failure apart from the model failure', () => {
    expect(ERRORS.figuraTextureMissing).not.toBe(ERRORS.figuraModelMissing)
    expect(ERRORS.figuraTextureMissing).toContain('текстуру')
  })
})
