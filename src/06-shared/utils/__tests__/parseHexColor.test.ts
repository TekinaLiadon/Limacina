import { describe, expect, it } from 'vitest'
import { parseHexColor } from '../parseHexColor'

describe('parseHexColor', () => {
  it('parses a hex color string', () => {
    expect(parseHexColor('FF8000')).toBe(0xff8000)
    expect(parseHexColor('0x1f')).toBe(0x1f)
  })

  it('returns null for an empty or missing color', () => {
    expect(parseHexColor(undefined)).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })

  it('returns null for a non-hex value', () => {
    expect(parseHexColor('zzzz')).toBeNull()
  })
})
