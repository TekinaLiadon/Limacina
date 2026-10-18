import { beforeEach, describe, expect, it } from 'vitest'
import {
  frameColorStorageKey,
  readFrameColors,
  removeFrameColors,
  writeFrameColors,
} from '../frameColorStorage'

describe('frameColorStorage', () => {
  beforeEach((): void => {
    localStorage.clear()
  })

  it('writes and reads frame colors', () => {
    const key = frameColorStorageKey('Модель', 'g_wave.json')
    writeFrameColors(key, new Map([
      [0, '#ef4444'],
      [3, '#3b82f6'],
    ]))

    expect([...readFrameColors(key)]).toEqual([
      [0, '#ef4444'],
      [3, '#3b82f6'],
    ])
  })

  it('removes storage when the map becomes empty', () => {
    const key = frameColorStorageKey('Модель', 'g_wave.json')
    writeFrameColors(key, new Map([[0, '#ef4444']]))
    writeFrameColors(key, new Map())

    expect(localStorage.getItem(key)).toBeNull()
    expect(readFrameColors(key).size).toBe(0)
  })

  it('ignores broken and invalid entries', () => {
    const key = frameColorStorageKey('Модель', 'g_wave.json')
    localStorage.setItem(key, JSON.stringify({
      '0': '#ef4444',
      '-1': '#3b82f6',
      '2.5': '#22c55e',
      '3': 'red',
      '4': '#123',
    }))

    expect([...readFrameColors(key)]).toEqual([[0, '#ef4444']])

    localStorage.setItem(key, '{')
    expect(readFrameColors(key).size).toBe(0)
  })

  it('removes stored colors', () => {
    const key = frameColorStorageKey('Модель', 'g_wave.json')
    writeFrameColors(key, new Map([[0, '#ef4444']]))
    removeFrameColors(key)

    expect(readFrameColors(key).size).toBe(0)
  })

  it('builds a stable key and falls back to a generic model name', () => {
    expect(frameColorStorageKey('', 'g_wave.json'))
      .toBe(frameColorStorageKey('model', 'g_wave.json'))
    expect(frameColorStorageKey('Модель', 'g_wave.json'))
      .not.toBe(frameColorStorageKey('Другая', 'g_wave.json'))
  })
})
