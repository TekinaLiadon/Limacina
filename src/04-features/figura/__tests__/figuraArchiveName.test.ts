import { describe, expect, it } from 'vitest'
import { AVATAR_NAME_MAX_CHARS, avatarNameError, avatarNameFromArchive } from '../figuraArchiveName'

describe('avatarNameFromArchive', () => {
  it('strips the zip extension from the file name', () => {
    expect(avatarNameFromArchive('Hecate.zip')).toBe('Hecate')
  })

  it('strips the extension case-insensitively', () => {
    expect(avatarNameFromArchive('Hecate.ZIP')).toBe('Hecate')
    expect(avatarNameFromArchive('Hecate.Zip')).toBe('Hecate')
  })

  it('uses the base name of a full path', () => {
    expect(avatarNameFromArchive('/home/user/models/Hecate.zip')).toBe('Hecate')
    expect(avatarNameFromArchive('C:\\models\\Hecate.zip')).toBe('Hecate')
  })

  it('trims surrounding whitespace', () => {
    expect(avatarNameFromArchive('  Hecate.zip  ')).toBe('Hecate')
  })

  it('keeps a name that merely contains zip inside', () => {
    expect(avatarNameFromArchive('zip-avatar.zip')).toBe('zip-avatar')
  })

  it('keeps inner dots', () => {
    expect(avatarNameFromArchive('Hecate.v2.zip')).toBe('Hecate.v2')
  })
})

describe('avatarNameError', () => {
  it('accepts a plain avatar name', () => {
    expect(avatarNameError('Hecate')).toBeNull()
    expect(avatarNameError('Геката')).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(avatarNameError('')).not.toBeNull()
    expect(avatarNameError('   ')).not.toBeNull()
  })

  it('rejects names with path separators and reserved characters', () => {
    for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(avatarNameError(name), name).not.toBeNull()
    }
  })

  it('rejects dot-only names', () => {
    expect(avatarNameError('.')).not.toBeNull()
    expect(avatarNameError('..')).not.toBeNull()
  })

  it('rejects names longer than the limit', () => {
    expect(avatarNameError('a'.repeat(AVATAR_NAME_MAX_CHARS))).toBeNull()
    expect(avatarNameError('a'.repeat(AVATAR_NAME_MAX_CHARS + 1))).not.toBeNull()
  })
})
