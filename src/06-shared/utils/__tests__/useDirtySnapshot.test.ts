import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useDirtySnapshot } from '../useDirtySnapshot'

describe('useDirtySnapshot', () => {
  it('reports clean while no baseline is captured', () => {
    const value = ref('a')
    const state = useDirtySnapshot(() => ({ value: value.value }))

    expect(state.hasBaseline.value).toBe(false)
    expect(state.isDirty.value).toBe(false)
  })

  it('reacts to edits right after the baseline capture', () => {
    const value = ref('a')
    const state = useDirtySnapshot(() => ({ value: value.value }))
    state.captureBaseline()

    expect(state.isDirty.value).toBe(false)

    value.value = 'b'
    expect(state.isDirty.value).toBe(true)

    value.value = 'a'
    expect(state.isDirty.value).toBe(false)
  })

  it('tracks nested values through JSON comparison', () => {
    const items = ref(['first'])
    const state = useDirtySnapshot(() => ({ items: [...items.value] }))
    state.captureBaseline()

    expect(state.isDirty.value).toBe(false)

    items.value = ['first', 'second']
    expect(state.isDirty.value).toBe(true)
  })

  it('reports per-key dirtiness without touching untouched keys', () => {
    const values = ref({ loaderVersion: '1', javaPath: '/java' })
    const state = useDirtySnapshot(() => ({ ...values.value }))
    state.captureBaseline()

    expect(state.isFieldDirty('loaderVersion')).toBe(false)
    expect(state.isFieldDirty('javaPath')).toBe(false)

    values.value = { loaderVersion: '2', javaPath: '/java' }
    expect(state.isFieldDirty('loaderVersion')).toBe(true)
    expect(state.isFieldDirty('javaPath')).toBe(false)
  })

  it('re-baselines on capture so saved state becomes clean again', () => {
    const value = ref('a')
    const state = useDirtySnapshot(() => ({ value: value.value }))
    state.captureBaseline()

    value.value = 'b'
    expect(state.isDirty.value).toBe(true)

    state.captureBaseline()
    expect(state.isDirty.value).toBe(false)
  })

  it('patches a single baseline field without absorbing unrelated edits', () => {
    const first = ref('a')
    const second = ref('b')
    const state = useDirtySnapshot(() => ({ first: first.value, second: second.value }))
    state.captureBaseline()

    second.value = 'edited'
    expect(state.isDirty.value).toBe(true)

    first.value = 'synced'
    state.patchBaseline({ first: first.value })

    expect(state.isDirty.value).toBe(true)

    second.value = 'b'
    expect(state.isDirty.value).toBe(false)
  })
})
