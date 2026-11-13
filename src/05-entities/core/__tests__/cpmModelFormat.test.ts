import { describe, expect, it } from 'vitest'
import type { UserContentItem } from '../types'
import { filterByFormat, modelFormatOf } from '../cpmModelFormat'

const item = (id: number, format?: UserContentItem['format']): UserContentItem => {
  const base: UserContentItem = { id, url: `https://cdn/${id}` }
  return format === undefined ? base : { ...base, format }
}

describe('modelFormatOf', () => {
  it('treats an item without format as cpm', () => {
    expect(modelFormatOf(item(1))).toBe('cpm')
  })

  it('keeps an explicit bbmodel format', () => {
    expect(modelFormatOf(item(1, 'bbmodel'))).toBe('bbmodel')
  })

  it('keeps an explicit cpm format', () => {
    expect(modelFormatOf(item(1, 'cpm'))).toBe('cpm')
  })
})

describe('filterByFormat', () => {
  const items = [item(1), item(2, 'cpm'), item(3, 'bbmodel'), item(4, 'bbmodel')]

  it('selects only cpm entries and counts legacy ones as cpm', () => {
    expect(filterByFormat(items, 'cpm').map((entry) => entry.id)).toEqual([1, 2])
  })

  it('selects only bbmodel entries', () => {
    expect(filterByFormat(items, 'bbmodel').map((entry) => entry.id)).toEqual([3, 4])
  })

  it('returns an empty list instead of failing when nothing matches', () => {
    expect(filterByFormat([item(1)], 'bbmodel')).toEqual([])
    expect(filterByFormat([], 'cpm')).toEqual([])
  })
})
