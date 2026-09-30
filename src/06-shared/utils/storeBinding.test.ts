import { describe, expect, it } from 'vitest'
import { storeBinding } from './storeBinding'

describe('storeBinding', () => {
  it('reads the bound field', () => {
    const store = { count: 1, name: 'a' }

    const count = storeBinding(store, 'count')

    expect(count.value).toBe(1)
  })

  it('writes through to the store field', () => {
    const store = { count: 1 }

    const count = storeBinding(store, 'count')
    count.value = 5

    expect(store.count).toBe(5)
  })

  it('works with non-primitive fields', () => {
    const store = { logins: ['a'] as string[] }

    const logins = storeBinding(store, 'logins')
    logins.value = ['b', 'c']

    expect(logins.value).toEqual(['b', 'c'])
    expect(store.logins).toEqual(['b', 'c'])
  })
})
