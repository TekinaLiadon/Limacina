import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModrinthViews from '../ModrinthViews.vue'

type ViewsProps = {
  activeView: 'catalog' | 'installed'
  installedCount: number
  updatesCount: number
}

const mountViews = (overrides: Partial<ViewsProps> = {}) =>
  mount(ModrinthViews, {
    attachTo: document.body,
    props: {
      activeView: 'catalog',
      installedCount: 0,
      updatesCount: 0,
      ...overrides,
    } satisfies ViewsProps,
  })

describe('ModrinthViews', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('marks the active view and shows the installed counters', () => {
    const wrapper = mountViews({ activeView: 'installed', installedCount: 4, updatesCount: 2 })

    const tablist = wrapper.get('[role="tablist"]')
    expect(tablist.attributes('aria-label')).toBe('Режим модов')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.attributes('aria-selected')).toBe('false')
    expect(tabs[0]?.attributes('tabindex')).toBe('-1')
    expect(tabs[1]?.attributes('aria-selected')).toBe('true')
    expect(tabs[1]?.attributes('tabindex')).toBe('0')
    expect(tabs[1]?.attributes('aria-controls')).toBe('modrinth-view-panel')

    expect(wrapper.get('.modrinth-views__view-count').text()).toBe('4')
    expect(wrapper.get('.modrinth-views__view-updates').text()).toBe('2')

    wrapper.unmount()
  })

  it('hides the update counter when there is nothing to update', () => {
    const wrapper = mountViews()

    expect(wrapper.get('.modrinth-views__view-count').text()).toBe('0')
    expect(wrapper.find('.modrinth-views__view-updates').exists()).toBe(false)

    wrapper.unmount()
  })

  it('switches the view on click', async () => {
    const wrapper = mountViews()

    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')

    expect(wrapper.emitted('update:activeView')?.[0]).toEqual(['installed'])

    wrapper.unmount()
  })

  it('moves the roving focus with arrow keys and switches the view along with it', () => {
    const wrapper = mountViews()

    const first = wrapper.get('#modrinth-view-catalog')
    ;(first.element as HTMLElement).focus()
    first.trigger('keydown', { key: 'ArrowRight' })

    expect(document.activeElement?.id).toBe('modrinth-view-installed')
    expect(wrapper.emitted('update:activeView')?.[0]).toEqual(['installed'])

    wrapper.unmount()
  })
})
