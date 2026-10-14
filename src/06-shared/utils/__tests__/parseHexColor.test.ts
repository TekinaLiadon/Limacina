import { describe, expect, it } from 'vitest'
import { DEFAULT_RGB, parseHexColor } from '../parseHexColor'

describe('parseHexColor', () => {
  it('parses a 6-digit hex color with an optional # prefix', () => {
    expect(parseHexColor('FF8000')).toBe(0xff8000)
    expect(parseHexColor('#ff8000')).toBe(0xff8000)
    expect(parseHexColor('#Ff80A0')).toBe(0xff80a0)
  })

  it('expands a 3-digit shortcut to the full color', () => {
    expect(parseHexColor('fa0')).toBe(0xffaa00)
    expect(parseHexColor('#0af')).toBe(0x00aaff)
  })

  it('returns null for an empty or missing color', () => {
    expect(parseHexColor(undefined)).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })

  it('returns null for anything that is not exactly 3 or 6 hex digits', () => {
    expect(parseHexColor('zzzz')).toBeNull()
    expect(parseHexColor('0x1f')).toBeNull()
    expect(parseHexColor('ff')).toBeNull()
    expect(parseHexColor('fffff')).toBeNull()
    expect(parseHexColor('ffffff0')).toBeNull()
    expect(parseHexColor('80808080')).toBeNull()
    expect(parseHexColor('#ff0000ff')).toBeNull()
    expect(parseHexColor('rgb(255,0,0)')).toBeNull()
    expect(parseHexColor(' ff8000')).toBeNull()
  })

  it('exposes the shared fallback color for the viewer and the exporter', () => {
    expect(DEFAULT_RGB).toBe(0xffffff)
  })
})
