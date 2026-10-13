import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard, joinPath, matchesExtension, randomId, stripPathSuffix } from '../utils'

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

describe('matchesExtension', () => {
  it('matches a plain extension token regardless of the file name case', () => {
    expect(matchesExtension('Hero.PNG', ['png', 'cpmproject'])).toBe(true)
    expect(matchesExtension('model.cpmproject', ['png', 'cpmproject'])).toBe(true)
  })

  it('matches dotted extension tokens from a comma-joined accept string', () => {
    expect(matchesExtension('skin.png', '.png,image/png'.split(','))).toBe(true)
    expect(matchesExtension('skin.jpg', '.png,image/png'.split(','))).toBe(false)
  })

  it('normalizes token case and surrounding spaces', () => {
    expect(matchesExtension('skin.png', ['.PNG', ' jpg '])).toBe(true)
    expect(matchesExtension('skin.jpg', ['.PNG', ' jpg '])).toBe(true)
    expect(matchesExtension('skin.txt', ['.PNG', ' jpg '])).toBe(false)
  })

  it('never matches a mime token against the file extension', () => {
    expect(matchesExtension('skin.png', ['image/png'])).toBe(false)
  })

  it('rejects names without a matching extension', () => {
    expect(matchesExtension('archive.zip', ['png'])).toBe(false)
    expect(matchesExtension('README', ['png'])).toBe(false)
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
