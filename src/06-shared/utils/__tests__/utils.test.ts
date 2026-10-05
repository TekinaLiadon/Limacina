import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard, joinPath, randomId, stripPathSuffix } from '../utils'

describe('joinPath', () => {
  it('joins with the forward separator for a posix parent', () => {
    expect(joinPath('/home/user', 'java')).toBe('/home/user/java')
  })

  it('joins with the backslash separator for a windows parent', () => {
    expect(joinPath('C:\\Games', 'bin')).toBe('C:\\Games\\bin')
  })

  it('trims trailing separators from the parent', () => {
    expect(joinPath('/home/user/', 'java')).toBe('/home/user/java')
    expect(joinPath('/home/user//', 'java')).toBe('/home/user/java')
    expect(joinPath('C:\\Games\\', 'bin')).toBe('C:\\Games\\bin')
  })
})

describe('stripPathSuffix', () => {
  it('strips a posix suffix', () => {
    expect(stripPathSuffix('/home/user/java', 'java')).toBe('/home/user')
  })

  it('strips a windows suffix', () => {
    expect(stripPathSuffix('C:\\Games\\java', 'java')).toBe('C:\\Games')
  })

  it('escapes regex special characters in the suffix', () => {
    expect(stripPathSuffix('/opt/java-21+ (x64)', 'java-21+ (x64)')).toBe('/opt')
  })

  it('keeps the path when the suffix is not at the end', () => {
    expect(stripPathSuffix('/home/user/java/bin', 'java')).toBe('/home/user/java/bin')
  })
})

describe('randomId', () => {
  it('generates unique prefixed ids', () => {
    const first = randomId()
    const second = randomId()
    expect(first).toMatch(/^re-/)
    expect(first).not.toBe(second)
  })
})

describe('copyToClipboard', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    writeText.mockReset()
  })

  it('writes text to the clipboard', async () => {
    writeText.mockResolvedValue(undefined)
    await copyToClipboard('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('propagates clipboard failures', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    await expect(copyToClipboard('hello')).rejects.toThrow('denied')
  })
})
