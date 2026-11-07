import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OptionalModEntry } from '../../core/types'
import { useOptionalModsStore } from '../optionalModsStore'

const makeEntry = (path: string): OptionalModEntry => ({
  path,
  hash: `sha1-${path}`,
})

describe('useOptionalModsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no list while nothing was fetched', () => {
    const store = useOptionalModsStore()
    expect(store.list).toBeNull()
  })

  it('keeps the fetched entries under their file names', () => {
    const store = useOptionalModsStore()
    store.setList([makeEntry('optional-mods/b.jar'), makeEntry('optional-mods/a.jar')])

    expect(store.list).toEqual([
      { path: 'optional-mods/b.jar', hash: 'sha1-optional-mods/b.jar' },
      { path: 'optional-mods/a.jar', hash: 'sha1-optional-mods/a.jar' },
    ])
  })

  it('accepts an empty list as a valid no-mods answer', () => {
    const store = useOptionalModsStore()
    store.setList([])

    expect(store.list).toEqual([])
  })

  it('copies the incoming entries instead of holding the caller array', () => {
    const store = useOptionalModsStore()
    const entries = [makeEntry('optional-mods/a.jar')]
    store.setList(entries)
    entries.push(makeEntry('optional-mods/late.jar'))

    expect(store.list).toHaveLength(1)
  })

  it('drops the list back to the not-fetched state on reset', () => {
    const store = useOptionalModsStore()
    store.setList([makeEntry('optional-mods/a.jar')])

    store.reset()

    expect(store.list).toBeNull()
  })
})
