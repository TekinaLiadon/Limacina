import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  modrinthExportPrepare,
  modrinthExportSave,
  modrinthImportApply,
  modrinthImportPreview,
} from '@/06-shared/api'
import { saveFile, selectFile } from '@/06-shared'
import { useCoreStore, useNotificationStore, type ModrinthExportReport, type ModrinthImportPreview, type ModrinthImportReport, type ModrinthInstalledMod } from '@/05-entities'
import { MODSET_ACCEPT, MODSET_FILTER, MODSET_FILE_NAME, MODSET_MAX_BYTES, useModrinthModset } from '../useModrinthModset'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  modrinthExportPrepare: vi.fn(),
  modrinthExportSave: vi.fn(),
  modrinthImportPreview: vi.fn(),
  modrinthImportApply: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  saveFile: vi.fn(),
  selectFile: vi.fn(),
}))

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
  ],
  unresolved: [{ filename: 'unknown.jar', reason: 'Не удалось привязать к Modrinth' }],
})

const makePreview = (): ModrinthImportPreview => ({
  format_version: 1,
  entries: [
    {
      source: 'modrinth',
      project_id: 'p-1',
      slug: 'sodium',
      version_id: 'v-1',
      version_number: '5.1.2',
      title: 'Sodium',
      filename: 'sodium-fabric-5.1.2.jar',
      status: 'ready',
      message: null,
    },
  ],
})

const makeImportReport = (): ModrinthImportReport => ({
  entries: makePreview().entries,
  removed: [],
  failed_removals: [],
  cleanup_requested: true,
  cleanup_skipped: false,
})

const makeInstalledMod = (overrides: Partial<ModrinthInstalledMod> = {}): ModrinthInstalledMod => ({
  project_id: 'p-1',
  slug: 'sodium',
  title: 'Sodium',
  icon_url: null,
  filename: 'sodium-fabric-5.1.2.jar',
  version_number: '5.1.2',
  sha1: 'hash-1',
  ...overrides,
})

const MODSET_CONTENT = '{"format_version":1,"mods":[]}'

const makeBuffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

const emitSelectedFile = (content: string): void => {
  vi.mocked(selectFile).mockImplementation((options): void => {
    options.onLoad(new File([content], 'set.limmods.json'), makeBuffer(content))
  })
}

describe('useModrinthModset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(modrinthExportPrepare).mockReset()
    vi.mocked(modrinthExportSave).mockReset()
    vi.mocked(modrinthImportPreview).mockReset()
    vi.mocked(modrinthImportApply).mockReset()
    vi.mocked(saveFile).mockReset()
    vi.mocked(selectFile).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the export report popup and saves the set after confirmation', async () => {
    const report = makeExportReport()
    vi.mocked(modrinthExportPrepare).mockResolvedValue(report)
    vi.mocked(saveFile).mockResolvedValue('/home/user/набор.limmods.json')
    const onImported = vi.fn().mockResolvedValue(undefined)
    const modset = useModrinthModset(onImported)

    await modset.openExport()

    expect(modrinthExportPrepare).toHaveBeenCalledTimes(1)
    expect(modset.isPopupVisible.value).toBe(true)
    expect(modset.view.value).toBe('export')
    expect(modset.exportReport.value).toEqual(report)
    expect(modset.actionError.value).toBe('')

    await modset.confirmPopup()

    expect(saveFile).toHaveBeenCalledWith({
      defaultPath: MODSET_FILE_NAME,
      filters: [MODSET_FILTER],
    })
    expect(modrinthExportSave).toHaveBeenCalledWith('/home/user/набор.limmods.json', report.mods)
    expect(useNotificationStore().message).toBe('Набор сохранён')
    expect(modset.isPopupVisible.value).toBe(false)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('keeps the popup open without saving or notifying when the dialog is cancelled', async () => {
    vi.mocked(modrinthExportPrepare).mockResolvedValue(makeExportReport())
    vi.mocked(saveFile).mockResolvedValue(null)
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    await modset.openExport()
    await modset.confirmPopup()

    expect(modrinthExportSave).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe('')
    expect(modset.actionError.value).toBe('')
    expect(modset.isPopupVisible.value).toBe(true)
    expect(modset.view.value).toBe('export')
  })

  it('shows an error and keeps the report when saving the file fails', async () => {
    vi.mocked(modrinthExportPrepare).mockResolvedValue(makeExportReport())
    vi.mocked(saveFile).mockResolvedValue('/home/user/set.limmods.json')
    vi.mocked(modrinthExportSave).mockRejectedValue(new Error('диск недоступен'))
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    await modset.openExport()
    await modset.confirmPopup()

    expect(modrinthExportSave).toHaveBeenCalledTimes(1)
    expect(modset.actionError.value).toBe('диск недоступен')
    expect(useNotificationStore().message).toBe('')
    expect(modset.isPopupVisible.value).toBe(true)
  })

  it('keeps the popup closed when preparing the export fails', async () => {
    vi.mocked(modrinthExportPrepare).mockRejectedValue(new Error('профиль офлайн'))
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    await modset.openExport()

    expect(modset.isPopupVisible.value).toBe(false)
    expect(modset.view.value).toBeNull()
    expect(modset.actionError.value).toBe('профиль офлайн')
  })

  it('passes the modset limits to the file picker and decodes the file for the preview', async () => {
    const preview = makePreview()
    vi.mocked(modrinthImportPreview).mockResolvedValue(preview)
    vi.mocked(modrinthImportApply).mockResolvedValue(makeImportReport())
    const onImported = vi.fn().mockResolvedValue(undefined)
    const modset = useModrinthModset(onImported)

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()

    expect(selectFile).toHaveBeenCalledWith(
      expect.objectContaining({ accept: MODSET_ACCEPT, maxBytes: MODSET_MAX_BYTES, readAs: 'arrayBuffer' }),
    )
    expect(modrinthImportPreview).toHaveBeenCalledWith(MODSET_CONTENT)
    expect(modset.isPopupVisible.value).toBe(true)
    expect(modset.view.value).toBe('import-preview')
    expect(modset.importPreview.value).toEqual(preview)

    const pending = modset.confirmPopup()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(modrinthImportApply).toHaveBeenCalledWith(MODSET_CONTENT, true)
    expect(modset.importReport.value).toEqual(makeImportReport())
    expect(modset.view.value).toBe('import-report')
    expect(modset.importPreview.value).toBeNull()
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('asks for confirmation before deleting extra mods and aborts when declined', async () => {
    vi.mocked(modrinthImportPreview).mockResolvedValue(makePreview())
    const notification = useNotificationStore()
    const confirm = vi.spyOn(notification, 'confirm').mockResolvedValue(false)
    const modset = useModrinthModset(
      vi.fn().mockResolvedValue(undefined),
      (): ModrinthInstalledMod[] => [makeInstalledMod({ project_id: 'p-old', slug: 'old', filename: 'old.jar' })],
    )

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()

    expect(modset.extraMods.value).toHaveLength(1)
    expect(modset.removeMissing.value).toBe(true)

    await modset.confirmPopup()

    expect(confirm).toHaveBeenCalledWith(
      'Удалить из папки моды, которых нет в наборе? Неподходящие версии и моды вне набора исчезнут безвозвратно. Найдено известных: 1 мод.',
    )
    expect(modrinthImportApply).not.toHaveBeenCalled()
  })

  it('skips the confirmation dialog when cleanup is turned off', async () => {
    vi.mocked(modrinthImportPreview).mockResolvedValue(makePreview())
    vi.mocked(modrinthImportApply).mockResolvedValue(makeImportReport())
    const notification = useNotificationStore()
    const confirm = vi.spyOn(notification, 'confirm')
    const modset = useModrinthModset(
      vi.fn().mockResolvedValue(undefined),
      (): ModrinthInstalledMod[] => [makeInstalledMod({ project_id: 'p-old', slug: 'old' })],
    )

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()
    modset.removeMissing.value = false

    await modset.confirmPopup()

    expect(confirm).not.toHaveBeenCalled()
    expect(modrinthImportApply).toHaveBeenCalledWith(MODSET_CONTENT, false)
  })

  it('confirms cleanup even when the frontend knows no extra mods', async () => {
    vi.mocked(modrinthImportPreview).mockResolvedValue(makePreview())
    vi.mocked(modrinthImportApply).mockResolvedValue(makeImportReport())
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()
    expect(modset.extraMods.value).toHaveLength(0)

    const pending = modset.confirmPopup()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(modrinthImportApply).toHaveBeenCalledWith(MODSET_CONTENT, true)
  })

  it('counts only mods that the set does not contain', async () => {
    const preview = makePreview()
    vi.mocked(modrinthImportPreview).mockResolvedValue(preview)
    const modset = useModrinthModset(
      vi.fn().mockResolvedValue(undefined),
      (): ModrinthInstalledMod[] => [
        makeInstalledMod(),
        makeInstalledMod({ project_id: 'p-slug', slug: 'Sodium', filename: 'sodium-other.jar' }),
        makeInstalledMod({ project_id: 'p-old', slug: 'old', filename: 'old.jar' }),
      ],
    )

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()

    const extra = modset.extraMods.value
    expect(extra).toHaveLength(1)
    expect(extra[0]?.project_id).toBe('p-old')
  })

  it('resets the cleanup toggle back to on after a project change', async () => {
    const coreStore = useCoreStore()
    vi.mocked(modrinthImportPreview).mockResolvedValue(makePreview())
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()
    modset.removeMissing.value = false

    coreStore.currentProject = 'другой-профиль'
    await nextTick()

    expect(modset.removeMissing.value).toBe(true)
  })

  it('shows a clear error and never applies when the file cannot be parsed', async () => {
    vi.mocked(modrinthImportPreview).mockRejectedValue(new Error('неизвестная версия формата 9, обновите лаунчер'))
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    emitSelectedFile('not json')
    modset.openImport()
    await flushPromises()

    expect(modset.isPopupVisible.value).toBe(false)
    expect(modset.actionError.value).toContain('неизвестная версия формата')
    expect(modrinthImportApply).not.toHaveBeenCalled()
  })

  it('surfaces the picker error without calling the preview command', () => {
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))
    vi.mocked(selectFile).mockImplementation((options): void => {
      options.onError('Размер файла не должен превышать 1024 КБ (загружено 2048 КБ)')
    })

    modset.openImport()

    expect(modset.actionError.value).toContain('Размер файла')
    expect(modrinthImportPreview).not.toHaveBeenCalled()
    expect(modset.isPopupVisible.value).toBe(false)
  })

  it('resets the popup state when the project changes', async () => {
    const coreStore = useCoreStore()
    vi.mocked(modrinthImportPreview).mockResolvedValue(makePreview())
    const modset = useModrinthModset(vi.fn().mockResolvedValue(undefined))

    emitSelectedFile(MODSET_CONTENT)
    modset.openImport()
    await flushPromises()
    expect(modset.isPopupVisible.value).toBe(true)

    coreStore.currentProject = 'другой-профиль'
    await nextTick()

    expect(modset.isPopupVisible.value).toBe(false)
    expect(modset.view.value).toBeNull()
    expect(modset.importPreview.value).toBeNull()
    expect(modset.exportReport.value).toBeNull()
    expect(modset.importReport.value).toBeNull()
    expect(modset.actionError.value).toBe('')
  })
})
