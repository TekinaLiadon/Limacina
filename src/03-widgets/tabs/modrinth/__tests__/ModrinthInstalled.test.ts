import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ModrinthInstalledMod } from '@/05-entities'
import ModrinthInstalled from '../ModrinthInstalled.vue'
import ModrinthRow from '../ModrinthRow.vue'

const makeInstalled = (id: string): ModrinthInstalledMod => ({
  project_id: id,
  slug: id,
  title: id,
  icon_url: null,
  filename: `${id}.jar`,
  version_number: '1.0.0',
  sha1: '0'.repeat(40),
})

type InstalledProps = {
  mods: ModrinthInstalledMod[]
  updates: Record<string, string>
  installingId: string | null
  isLoading: boolean
  isOpeningFolder: boolean
  isCheckingUpdates: boolean
  isExporting: boolean
  actionError: string
  installedError: string
}

const mountInstalled = (overrides: Partial<InstalledProps> = {}) =>
  mount(ModrinthInstalled, {
    props: {
      mods: [],
      updates: {},
      installingId: null,
      isLoading: false,
      isOpeningFolder: false,
      isCheckingUpdates: false,
      isExporting: false,
      actionError: '',
      installedError: '',
      ...overrides,
    } satisfies InstalledProps,
  })

const button = (wrapper: ReturnType<typeof mountInstalled>, label: string) =>
  wrapper.findAll('button').find((node) => node.text() === label)

describe('ModrinthInstalled', () => {
  it('locks the update check while nothing is installed', () => {
    const empty = mountInstalled()
    expect(button(empty, 'Проверить обновления')?.attributes('disabled')).toBeDefined()

    const filled = mountInstalled({ mods: [makeInstalled('sodium')] })
    expect(button(filled, 'Проверить обновления')?.attributes('disabled')).toBeUndefined()

    empty.unmount()
    filled.unmount()
  })

  it('invites to the catalog when nothing is installed yet', () => {
    const wrapper = mountInstalled()

    expect(wrapper.get('.modrinth-installed__empty').text()).toBe('Пока ничего не установлено, найдите моды в каталоге')
    expect(wrapper.findAllComponents(ModrinthRow)).toHaveLength(0)

    wrapper.unmount()
  })

  it('shows the skeletons instead of the empty state while loading', () => {
    const wrapper = mountInstalled({ isLoading: true })

    expect(wrapper.findAll('.modrinth-row')).toHaveLength(5)
    expect(wrapper.find('.modrinth-installed__empty').exists()).toBe(false)

    wrapper.unmount()
  })

  it('feeds every installed row with its file, version and pending update', () => {
    const wrapper = mountInstalled({
      mods: [makeInstalled('sodium')],
      updates: { sodium: '1.1.0' },
      installingId: 'sodium',
    })

    const row = wrapper.getComponent(ModrinthRow)
    expect(row.props('variant')).toBe('installed')
    expect(row.props('isInstalled')).toBe(true)
    expect(row.props('metaText')).toBe('sodium.jar')
    expect(row.props('versionText')).toBe('1.0.0')
    expect(row.props('updateVersion')).toBe('1.1.0')
    expect(row.props('isBusy')).toBe(true)

    wrapper.unmount()
  })

  it('locks the running button and keeps the folder button available', () => {
    const wrapper = mountInstalled({ isCheckingUpdates: true })

    expect(button(wrapper, 'Проверить обновления')?.attributes('aria-busy')).toBe('true')
    expect(button(wrapper, 'Открыть папку модов')?.attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('surfaces the action and installed-list errors', () => {
    const wrapper = mountInstalled({
      actionError: 'Не удалось удалить мод',
      installedError: 'Не удалось загрузить список установленных модов',
    })

    const errors = wrapper.findAll('.modrinth-installed__error').map((node) => node.text())
    expect(errors).toEqual(['Не удалось удалить мод', 'Не удалось загрузить список установленных модов'])

    wrapper.unmount()
  })

  it('prints the same error from two sources only once', () => {
    const message = 'моды Modrinth требуют загрузчик модов: выберите Fabric, Forge или NeoForge для профиля'
    const wrapper = mountInstalled({
      mods: [makeInstalled('sodium')],
      actionError: message,
      installedError: message,
    })

    const errors = wrapper.findAll('.modrinth-installed__error').map((node) => node.text())
    expect(errors).toEqual([message])

    wrapper.unmount()
  })

  it('hands the row and header actions up', async () => {
    const wrapper = mountInstalled({ mods: [makeInstalled('sodium')] })

    const row = wrapper.getComponent(ModrinthRow)
    row.vm.$emit('update')
    row.vm.$emit('uninstall')
    expect(wrapper.emitted('update')?.[0]).toEqual(['sodium'])
    expect(wrapper.emitted('uninstall')?.[0]).toEqual(['sodium'])

    await button(wrapper, 'Открыть папку модов')?.trigger('click')
    await button(wrapper, 'Проверить обновления')?.trigger('click')
    expect(wrapper.emitted('open-folder')).toHaveLength(1)
    expect(wrapper.emitted('check-updates')).toHaveLength(1)

    wrapper.unmount()
  })

  it('gates the modset buttons by the installed list and the export run', () => {
    const empty = mountInstalled()
    expect(button(empty, 'Сохранить набор')?.attributes('disabled')).toBeDefined()
    expect(button(empty, 'Импортировать набор')?.attributes('disabled')).toBeUndefined()

    const filled = mountInstalled({ mods: [makeInstalled('sodium')] })
    expect(button(filled, 'Сохранить набор')?.attributes('disabled')).toBeUndefined()
    expect(button(filled, 'Импортировать набор')?.attributes('disabled')).toBeUndefined()

    const exporting = mountInstalled({ mods: [makeInstalled('sodium')], isExporting: true })
    expect(button(exporting, 'Сохранить набор')?.attributes('aria-busy')).toBe('true')
    expect(button(exporting, 'Импортировать набор')?.attributes('disabled')).toBeDefined()

    empty.unmount()
    filled.unmount()
    exporting.unmount()
  })

  it('hands the modset actions up', async () => {
    const wrapper = mountInstalled({ mods: [makeInstalled('sodium')] })

    await button(wrapper, 'Сохранить набор')?.trigger('click')
    await button(wrapper, 'Импортировать набор')?.trigger('click')
    expect(wrapper.emitted('export-modset')).toHaveLength(1)
    expect(wrapper.emitted('import-modset')).toHaveLength(1)

    wrapper.unmount()
  })
})
