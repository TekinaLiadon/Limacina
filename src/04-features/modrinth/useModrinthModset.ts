import { computed, ref, watch } from 'vue'
import {
  modrinthExportPrepare,
  modrinthExportSave,
  modrinthImportApply,
  modrinthImportPreview,
} from '@/06-shared/api'
import { captureProjectScope, runScopedAction, selectFile, saveFile, useAsyncRaceGuard } from '@/06-shared'
import { useCoreStore, useNotificationStore, type ModrinthExportReport, type ModrinthImportPreview, type ModrinthImportReport } from '@/05-entities'

export const MODSET_FILE_NAME = 'limmods.json'
export const MODSET_ACCEPT = '.limmods.json'
export const MODSET_FILTER = { name: 'Набор модов Limacina', extensions: ['limmods.json'] }
export const MODSET_MAX_BYTES = 1_048_576

export type ModrinthModsetView = 'export' | 'import-preview' | 'import-report'

export function useModrinthModset(onImported: () => Promise<void>) {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const isPopupVisible = ref(false)
  const view = ref<ModrinthModsetView | null>(null)
  const exportReport = ref<ModrinthExportReport | null>(null)
  const importPreview = ref<ModrinthImportPreview | null>(null)
  const importReport = ref<ModrinthImportReport | null>(null)
  const importContent = ref('')
  const isExporting = ref(false)
  const isConfirming = ref(false)
  const actionError = ref('')

  const prepareGuard = useAsyncRaceGuard()
  const previewGuard = useAsyncRaceGuard()
  const confirmGuard = useAsyncRaceGuard()

  const isBusy = computed((): boolean => isConfirming.value)

  const closePopup = (): void => {
    isPopupVisible.value = false
    view.value = null
    exportReport.value = null
    importPreview.value = null
    importReport.value = null
    importContent.value = ''
    actionError.value = ''
  }

  const openExport = async (): Promise<void> => {
    if (isExporting.value) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await runScopedAction({
      guard: prepareGuard,
      scope,
      errorTarget: actionError,
      errorMessage: 'Не удалось собрать набор модов для сохранения',
      busyFlag: isExporting,
      run: (): Promise<ModrinthExportReport> => modrinthExportPrepare(),
      apply: (report: ModrinthExportReport): void => {
        exportReport.value = report
        view.value = 'export'
        isPopupVisible.value = true
      },
    })
  }

  const loadPreview = async (content: string): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await runScopedAction({
      guard: previewGuard,
      scope,
      errorTarget: actionError,
      errorMessage: 'Не удалось прочитать файл набора модов',
      run: (): Promise<ModrinthImportPreview> => modrinthImportPreview(content),
      apply: (preview: ModrinthImportPreview): void => {
        importContent.value = content
        importPreview.value = preview
        importReport.value = null
        view.value = 'import-preview'
        isPopupVisible.value = true
      },
    })
  }

  const openImport = (): void => {
    actionError.value = ''
    selectFile({
      accept: MODSET_ACCEPT,
      maxBytes: MODSET_MAX_BYTES,
      readAs: 'arrayBuffer',
      onError: (message: string): void => {
        actionError.value = message
      },
      onLoad: (_file: File, result: string | ArrayBuffer): void => {
        if (!(result instanceof ArrayBuffer)) return
        void loadPreview(new TextDecoder().decode(result))
      },
    })
  }

  const confirmExport = async (): Promise<void> => {
    const report = exportReport.value
    if (report === null || isConfirming.value) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await runScopedAction<boolean>({
      guard: confirmGuard,
      scope,
      errorTarget: actionError,
      errorMessage: 'Не удалось сохранить файл набора модов',
      busyFlag: isConfirming,
      run: async (): Promise<boolean> => {
        const path = await saveFile({ defaultPath: MODSET_FILE_NAME, filters: [MODSET_FILTER] })
        if (path === null) return false
        await modrinthExportSave(path, report.mods)
        return true
      },
      apply: (saved: boolean): void => {
        if (!saved) return
        notification.show('Набор сохранён')
        closePopup()
      },
    })
  }

  const confirmImport = async (): Promise<void> => {
    if (importPreview.value === null || isConfirming.value) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await runScopedAction({
      guard: confirmGuard,
      scope,
      errorTarget: actionError,
      errorMessage: 'Не удалось импортировать набор модов',
      busyFlag: isConfirming,
      run: (): Promise<ModrinthImportReport> => modrinthImportApply(importContent.value),
      apply: async (report: ModrinthImportReport): Promise<void> => {
        importReport.value = report
        importPreview.value = null
        importContent.value = ''
        view.value = 'import-report'
        await onImported()
      },
    })
  }

  const confirmPopup = async (): Promise<void> => {
    if (view.value === 'export') await confirmExport()
    else if (view.value === 'import-preview') await confirmImport()
  }

  const resetState = (): void => {
    prepareGuard.cancel()
    previewGuard.cancel()
    confirmGuard.cancel()
    closePopup()
    isExporting.value = false
    isConfirming.value = false
  }

  watch((): string => coreStore.currentProject, (projectName: string): void => {
    if (!projectName) return
    resetState()
  })

  return {
    isPopupVisible,
    view,
    exportReport,
    importPreview,
    importReport,
    isExporting,
    isConfirming,
    isBusy,
    actionError,
    openExport,
    openImport,
    confirmPopup,
    closePopup,
  }
}
