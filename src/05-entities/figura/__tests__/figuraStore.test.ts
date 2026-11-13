import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FiguraAvatarEntry } from '../../core/types'
import { useFiguraStore } from '../figuraStore'

const makeEntry = (name: string, hasModel = true): FiguraAvatarEntry => ({
  name,
  authors: ['tekina'],
  description: `${name} avatar`,
  hasModel,
  hasTexture: false,
})

describe('useFiguraStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no list and no selection', () => {
    const store = useFiguraStore()

    expect(store.list).toBeNull()
    expect(store.selectedName).toBeNull()
    expect(store.isListLoading).toBe(false)
    expect(store.listError).toBe('')
  })

  it('keeps the fetched avatars in the given order', () => {
    const store = useFiguraStore()
    store.setList([makeEntry('alpha'), makeEntry('beta')])

    expect(store.list?.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
  })

  it('accepts an empty list as a valid no-avatars answer', () => {
    const store = useFiguraStore()
    store.setList([])

    expect(store.list).toEqual([])
  })

  it('copies the incoming entries instead of holding the caller array', () => {
    const store = useFiguraStore()
    const entries = [makeEntry('alpha')]
    store.setList(entries)
    entries.push(makeEntry('late'))

    expect(store.list).toHaveLength(1)
  })

  it('selects an avatar by its folder name', () => {
    const store = useFiguraStore()
    store.setList([makeEntry('alpha'), makeEntry('beta')])
    store.select('beta')

    expect(store.selectedName).toBe('beta')
  })

  it('replaces the list without touching the selection', () => {
    const store = useFiguraStore()
    store.setList([makeEntry('alpha')])
    store.select('alpha')

    store.setList([makeEntry('beta')])

    expect(store.list?.map((entry) => entry.name)).toEqual(['beta'])
    expect(store.selectedName).toBe('alpha')
  })

  it('clears the selection explicitly', () => {
    const store = useFiguraStore()
    store.select('alpha')

    store.select(null)

    expect(store.selectedName).toBeNull()
  })

  it('drops list, selection and errors on reset', () => {
    const store = useFiguraStore()
    store.setList([makeEntry('alpha')])
    store.select('alpha')
    store.isListLoading = true
    store.listError = 'не удалось'

    store.reset()

    expect(store.list).toBeNull()
    expect(store.selectedName).toBeNull()
    expect(store.isListLoading).toBe(false)
    expect(store.listError).toBe('')
  })
})
