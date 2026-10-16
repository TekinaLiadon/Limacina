import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Dropdown, MultiSelect } from '@/06-shared'
import ModrinthSearch from '../ModrinthSearch.vue'

type SearchProps = {
  query: string
  sort: string
  categories: string[]
  isSearching: boolean
}

const mountSearch = (overrides: Partial<SearchProps> = {}) =>
  mount(ModrinthSearch, {
    props: {
      query: '',
      sort: 'relevance',
      categories: [],
      isSearching: false,
      ...overrides,
    } satisfies SearchProps,
  })

describe('ModrinthSearch', () => {
  beforeEach((): void => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('passes the sort and category options mapped from the Modrinth registries', () => {
    const wrapper = mountSearch()

    const sortOptions = wrapper.getComponent(Dropdown).props('options')
    expect(sortOptions).toContainEqual({ title: 'По загрузкам', value: 'downloads' })

    const categoryOptions = wrapper.getComponent(MultiSelect).props('options')
    expect(categoryOptions).toContainEqual({ title: 'Оптимизация', value: 'optimization' })

    wrapper.unmount()
  })

  it('writes the query and searches on Enter and on the button', async () => {
    const wrapper = mountSearch()

    const input = wrapper.get('input')
    await input.setValue('sodium')
    expect(wrapper.emitted('update:query')?.[0]).toEqual(['sodium'])

    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('search')).toHaveLength(1)

    await wrapper.get('.btn-primary').trigger('click')
    expect(wrapper.emitted('search')).toHaveLength(2)

    wrapper.unmount()
  })

  it('locks the search button while a request is running', () => {
    const wrapper = mountSearch({ isSearching: true })

    const button = wrapper.get('.btn-primary')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')

    wrapper.unmount()
  })
})
