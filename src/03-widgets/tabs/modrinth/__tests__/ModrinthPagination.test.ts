import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModrinthPagination from '../ModrinthPagination.vue'

type PaginationProps = {
  currentPage: number
  totalPages: number
  isSearching: boolean
}

const mountPagination = (overrides: Partial<PaginationProps> = {}) =>
  mount(ModrinthPagination, {
    props: {
      currentPage: 1,
      totalPages: 1,
      isSearching: false,
      ...overrides,
    } satisfies PaginationProps,
  })

const pageLabels = (wrapper: ReturnType<typeof mountPagination>): string[] =>
  wrapper
    .findAll('.modrinth-pagination__page')
    .filter((button) => button.attributes('aria-label') === undefined)
    .map((button) => button.text())

describe('ModrinthPagination', () => {
  it('shows every page while there are seven or fewer', () => {
    const wrapper = mountPagination({ currentPage: 2, totalPages: 5 })

    expect(pageLabels(wrapper)).toEqual(['1', '2', '3', '4', '5'])
    expect(wrapper.find('.modrinth-pagination__page-gap').exists()).toBe(false)

    wrapper.unmount()
  })

  it('narrows a long list around the current page with gaps on both sides', () => {
    const wrapper = mountPagination({ currentPage: 10, totalPages: 20 })

    expect(pageLabels(wrapper)).toEqual(['1', '9', '10', '11', '20'])
    expect(wrapper.findAll('.modrinth-pagination__page-gap')).toHaveLength(2)

    wrapper.unmount()
  })

  it('marks the current page and locks the edges', () => {
    const first = mountPagination({ currentPage: 1, totalPages: 20 })
    expect(first.get('[aria-label="Предыдущая страница"]').attributes('disabled')).toBeDefined()
    expect(first.get('[aria-label="Следующая страница"]').attributes('disabled')).toBeUndefined()

    const last = mountPagination({ currentPage: 20, totalPages: 20 })
    expect(last.get('[aria-label="Следующая страница"]').attributes('disabled')).toBeDefined()
    expect(last.get('.modrinth-pagination__page--active').text()).toBe('20')
    expect(last.get('.modrinth-pagination__page--active').attributes('aria-current')).toBe('page')

    first.unmount()
    last.unmount()
  })

  it('locks every page button while a request is running', () => {
    const wrapper = mountPagination({ currentPage: 2, totalPages: 5, isSearching: true })

    const buttons = wrapper.findAll('.modrinth-pagination__page')
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    wrapper.unmount()
  })

  it('asks for the clicked page and for the neighbouring ones', async () => {
    const wrapper = mountPagination({ currentPage: 3, totalPages: 5 })

    await wrapper.get('.modrinth-pagination__page--active').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([3])

    await wrapper.get('[aria-label="Следующая страница"]').trigger('click')
    expect(wrapper.emitted('select')?.[1]).toEqual([4])

    await wrapper.get('[aria-label="Предыдущая страница"]').trigger('click')
    expect(wrapper.emitted('select')?.[2]).toEqual([2])

    wrapper.unmount()
  })
})
