import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { formatNumber } from '@/06-shared'
import type { ModrinthSearchHit } from '@/05-entities'
import ModrinthCatalogList from '../ModrinthCatalogList.vue'
import ModrinthRow from '../ModrinthRow.vue'

const makeHit = (id: string, overrides: Partial<ModrinthSearchHit> = {}): ModrinthSearchHit => ({
  project_id: id,
  project_type: 'mod',
  slug: id,
  author: 'Автор',
  title: id,
  description: `${id} описание`,
  categories: [],
  downloads: 1_500,
  follows: 0,
  icon_url: null,
  date_created: null,
  date_modified: null,
  latest_version: null,
  license: null,
  client_side: null,
  server_side: null,
  ...overrides,
})

type CatalogProps = {
  hits: ModrinthSearchHit[]
  total: number
  versionNumbers: Record<string, string>
  searchVersionsFailed: boolean
  isSearching: boolean
  searchError: string
  actionError: string
  installedError: string
  installedIds: Set<string>
  updates: Record<string, string>
  installingId: string | null
}

const mountCatalog = (overrides: Partial<CatalogProps> = {}) =>
  mount(ModrinthCatalogList, {
    props: {
      hits: [],
      total: 0,
      versionNumbers: {},
      searchVersionsFailed: false,
      isSearching: false,
      searchError: '',
      actionError: '',
      installedError: '',
      installedIds: new Set<string>(),
      updates: {},
      installingId: null,
      ...overrides,
    } satisfies CatalogProps,
  })

describe('ModrinthCatalogList', () => {
  it('reports an empty catalog when there is nothing to show', () => {
    const wrapper = mountCatalog()

    expect(wrapper.get('.modrinth-catalog__empty').text()).toBe('Ничего не найдено')
    expect(wrapper.findAllComponents(ModrinthRow)).toHaveLength(0)

    wrapper.unmount()
  })

  it('shows the found total and feeds every row with its catalog state', () => {
    const hit = makeHit('sodium')
    const wrapper = mountCatalog({
      hits: [hit],
      total: 4242,
      versionNumbers: { sodium: '1.2.3' },
      installedIds: new Set(['sodium']),
      updates: { sodium: '1.2.4' },
    })

    expect(wrapper.get('.modrinth-catalog__summary-text').text()).toBe(`Найдено: ${formatNumber(4242)}`)

    const row = wrapper.getComponent(ModrinthRow)
    expect(row.props('variant')).toBe('catalog')
    expect(row.props('title')).toBe('sodium')
    expect(row.props('description')).toBe('sodium описание')
    expect(row.props('versionText')).toBe('1.2.3')
    expect(row.props('updateVersion')).toBe('1.2.4')
    expect(row.props('isInstalled')).toBe(true)
    expect(row.props('isBusyAny')).toBe(false)
    expect(row.props('metaText')).toContain('Автор')

    wrapper.unmount()
  })

  it('shows the row skeletons and the total skeleton on the first search', () => {
    const wrapper = mountCatalog({ isSearching: true })

    expect(wrapper.findAll('.modrinth-row')).toHaveLength(6)
    expect(wrapper.get('.modrinth-catalog__list').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.modrinth-catalog__summary').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.modrinth-catalog__empty').exists()).toBe(false)

    wrapper.unmount()
  })

  it('marks the busy row while its install is running', () => {
    const wrapper = mountCatalog({ hits: [makeHit('sodium')], installingId: 'sodium' })

    const row = wrapper.getComponent(ModrinthRow)
    expect(row.props('isBusy')).toBe(true)
    expect(row.props('isBusyAny')).toBe(true)

    wrapper.unmount()
  })

  it('surfaces the search, action and installed-list errors', () => {
    const wrapper = mountCatalog({
      searchError: 'Не удалось выполнить поиск Modrinth',
      actionError: 'Не удалось установить мод',
      installedError: 'Не удалось загрузить список установленных модов',
    })

    const errors = wrapper.findAll('.modrinth-catalog__error').map((node) => node.text())
    expect(errors).toEqual([
      'Не удалось выполнить поиск Modrinth',
      'Не удалось установить мод',
      'Не удалось загрузить список установленных модов',
    ])

    wrapper.unmount()
  })

  it('prints the same error from two sources only once', () => {
    const message = 'моды Modrinth требуют загрузчик модов: выберите Fabric, Forge или NeoForge для профиля'
    const wrapper = mountCatalog({ searchError: message, installedError: message })

    const errors = wrapper.findAll('.modrinth-catalog__error').map((node) => node.text())
    expect(errors).toEqual([message])

    wrapper.unmount()
  })

  it('warns about missing version numbers only while the search itself succeeded', async () => {
    const wrapper = mountCatalog({ searchVersionsFailed: true })
    expect(wrapper.get('.modrinth-catalog__versions-hint').text()).toBe('Версии модов не загрузились, значки версий могут отсутствовать')

    await wrapper.setProps({ searchError: 'Не удалось выполнить поиск Modrinth' })
    expect(wrapper.find('.modrinth-catalog__versions-hint').exists()).toBe(false)

    wrapper.unmount()
  })

  it('passes the row actions up with the project they belong to', () => {
    const hit = makeHit('sodium')
    const wrapper = mountCatalog({ hits: [hit] })

    const row = wrapper.getComponent(ModrinthRow)
    row.vm.$emit('install')
    row.vm.$emit('details')

    expect(wrapper.emitted('install')?.[0]).toEqual([hit])
    expect(wrapper.emitted('details')?.[0]).toEqual([hit])

    wrapper.unmount()
  })
})
