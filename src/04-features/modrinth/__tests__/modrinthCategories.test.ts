import { describe, expect, it } from 'vitest'
import { MODRINTH_CATEGORIES, MODRINTH_CATEGORY_LABELS } from '../useModrinth'

describe('Modrinth categories', () => {
  it('gives every filter category its own label', () => {
    expect(MODRINTH_CATEGORIES.length).toBeGreaterThan(0)

    for (const category of MODRINTH_CATEGORIES) {
      expect(category.filterable).toBe(true)
      expect(category.label).not.toBe('')
      expect(MODRINTH_CATEGORY_LABELS[category.value]).toBe(category.label)
    }
  })

  it('keeps the filter values unique', () => {
    const values = MODRINTH_CATEGORIES.map((category) => category.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('labels categories that are not offered as filters', () => {
    expect(MODRINTH_CATEGORY_LABELS.cursed).toBe('Проклятое')
    expect(MODRINTH_CATEGORY_LABELS.transportation).toBe('Транспорт')
  })
})
