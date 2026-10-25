import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModrinthModsetPopup from '../ModrinthModsetPopup.vue'
import type { ModrinthExportReport, ModrinthImportPreview, ModrinthImportReport } from '@/05-entities'
import type { ModrinthModsetView } from '@/04-features'

const makeExportReport = (): ModrinthExportReport => ({
  mods: [
    {
      source: 'modrinth',
      project_id: 'p-1',
      slug: 'sodium',
      version_id: 'v-1',
      version_number: '5.1.2',
      title: 'Sodium',
      filename: 'sodium-fabric-5.1.2.jar',
    },
    {
      source: 'modrinth',
      project_id: 'p-2',
      slug: 'lambda',
      version_id: 'v-2',
      version_number: null,
      title: null,
      filename: 'lambda.jar',
    },
  ],
  unresolved: [
    { filename: 'unknown.jar', reason: 'Не удалось привязать к Modrinth' },
    { filename: 'old.jar', reason: 'Файл дублирует уже установленный мод другой версией' },
  ],
})

const makeEntry = (overrides: Partial<ModrinthImportPreview['entries'][number]> = {}): ModrinthImportPreview['entries'][number] => ({
  source: 'modrinth',
  project_id: 'p-1',
  slug: 'sodium',
  version_id: 'v-1',
  version_number: '5.1.2',
  title: 'Sodium',
  filename: 'sodium-fabric-5.1.2.jar',
  status: 'ready',
  message: null,
  ...overrides,
})

const makePreview = (entries: ModrinthImportPreview['entries']): ModrinthImportPreview => ({
  format_version: 1,
  entries,
})

const makeImportReport = (entries: ModrinthImportPreview['entries']): ModrinthImportReport => ({
  entries,
})

type MountOptions = {
  view: ModrinthModsetView
  exportReport?: ModrinthExportReport | null
  importPreview?: ModrinthImportPreview | null
  importReport?: ModrinthImportReport | null
  installedIds?: Set<string>
  isBusy?: boolean
  actionError?: string
}

const mountPopup = (options: MountOptions) =>
  mount(ModrinthModsetPopup, {
    props: {
      visible: true,
      view: options.view,
      exportReport: options.exportReport ?? null,
      importPreview: options.importPreview ?? null,
      importReport: options.importReport ?? null,
      installedIds: options.installedIds ?? new Set<string>(),
      isBusy: options.isBusy ?? false,
      actionError: options.actionError ?? '',
    },
    global: { stubs: { teleport: true } },
  })

describe('ModrinthModsetPopup', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('shows the export report with bound mods and the unresolved block', () => {
    const wrapper = mountPopup({ view: 'export', exportReport: makeExportReport() })

    expect(wrapper.get('.modrinth-modset-popup__title').text()).toBe('Сохранить набор')
    const rows = wrapper.findAll('.modrinth-modset-popup__row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Sodium')
    expect(rows[0]?.text()).toContain('5.1.2')
    expect(rows[1]?.text()).toContain('lambda.jar')
    expect(rows[1]?.text()).toContain('версия не указана')

    const unresolved = wrapper.get('.modrinth-modset-popup__unresolved')
    expect(unresolved.get('.modrinth-modset-popup__unresolved-title').text()).toBe('Не вошли')
    const reasons = unresolved.findAll('.modrinth-modset-popup__unresolved-row')
    expect(reasons).toHaveLength(2)
    expect(reasons[0]?.text()).toBe('unknown.jar — Не удалось привязать к Modrinth')
    expect(reasons[1]?.text()).toContain('old.jar')

    expect(wrapper.get('.modrinth-modset-popup__confirm').text()).toBe('Сохранить')

    wrapper.unmount()
  })

  it('emits confirm and close from the export popup', async () => {
    const wrapper = mountPopup({ view: 'export', exportReport: makeExportReport() })

    await wrapper.get('.modrinth-modset-popup__confirm').trigger('click')
    await wrapper.get('.modrinth-modset-popup__close').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  it('shows the import preview with statuses, fallback names and already installed marks', () => {
    const preview = makePreview([
      makeEntry(),
      { source: 'modrinth', project_id: 'p-1', status: 'ready' },
      makeEntry({ project_id: 'p-3', title: 'Broken', status: 'skipped', message: 'неизвестный источник "curse"' }),
    ])
    const wrapper = mountPopup({
      view: 'import-preview',
      importPreview: preview,
      installedIds: new Set(['p-1']),
    })

    expect(wrapper.get('.modrinth-modset-popup__title').text()).toBe('Импорт набора')
    const rows = wrapper.findAll('.modrinth-modset-popup__row')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Sodium')
    expect(rows[0]?.text()).toContain('Готов к установке')
    expect(rows[0]?.text()).toContain('Уже установлен')
    expect(rows[1]?.text()).toContain('p-1')
    expect(rows[1]?.text()).toContain('версия не указана')
    expect(rows[2]?.text()).toContain('Broken')
    expect(rows[2]?.text()).toContain('Пропущен')
    expect(rows[2]?.text()).toContain('неизвестный источник "curse"')

    expect(wrapper.get('.modrinth-modset-popup__confirm').text()).toBe('Установить')

    wrapper.unmount()
  })

  it('shows the import report with all outcome statuses and no confirm button', () => {
    const report = makeImportReport([
      makeEntry({ title: 'Alpha', status: 'installed' }),
      makeEntry({ title: 'Beta', status: 'already_installed', message: 'Мод уже установлен' }),
      makeEntry({ title: 'Gamma', status: 'skipped', message: 'неизвестный источник "rift"' }),
      makeEntry({ title: 'Delta', status: 'failed', message: 'версия несовместима с лоадером' }),
    ])
    const wrapper = mountPopup({ view: 'import-report', importReport: report })

    expect(wrapper.get('.modrinth-modset-popup__title').text()).toBe('Отчёт импорта')
    const text = wrapper.text()
    expect(text).toContain('Alpha')
    expect(text).toContain('Установлен')
    expect(text).toContain('Beta')
    expect(text).toContain('Уже установлен')
    expect(text).toContain('Gamma')
    expect(text).toContain('Пропущен')
    expect(text).toContain('Delta')
    expect(text).toContain('Ошибка')
    expect(text).toContain('версия несовместима с лоадером')

    expect(wrapper.find('.modrinth-modset-popup__confirm').exists()).toBe(false)
    expect(wrapper.get('.modrinth-modset-popup__close').text()).toBe('Закрыть')

    wrapper.unmount()
  })

  it('blocks the confirm button while the action is running and shows the error', () => {
    const wrapper = mountPopup({
      view: 'import-preview',
      importPreview: makePreview([makeEntry()]),
      isBusy: true,
      actionError: 'Не удалось импортировать набор модов',
    })

    const confirm = wrapper.get('.modrinth-modset-popup__confirm')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.modrinth-modset-popup__error').text()).toBe('Не удалось импортировать набор модов')

    wrapper.unmount()
  })
})
