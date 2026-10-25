import { computed, ref, watch } from 'vue'
import {
  modrinthSearch,
  modrinthProject,
  modrinthInstalled,
  modrinthCheckUpdates,
  modrinthInstall,
  modrinthUninstall,
  openModsFolder,
} from '@/06-shared/api'
import { captureProjectScope, runScopedAction, useAsyncRaceGuard, type PluralForms } from '@/06-shared'
import {
  useCoreStore,
  type ModrinthSearchHit,
  type ModrinthProjectDetails,
  type ModrinthInstalledMod,
  type ModrinthSearchResult,
  type ModrinthUpdateCheck,
  type ModrinthInstallResult,
} from '@/05-entities'

export interface ModrinthCategory {
  value: string
  label: string
  filterable: boolean
}

export const MODRINTH_BASE_URL = 'https://modrinth.com'

export const MODRINTH_DOWNLOAD_FORMS: PluralForms = { one: 'загрузка', few: 'загрузки', many: 'загрузок' }

export const MODRINTH_FOLLOW_FORMS: PluralForms = { one: 'подписчик', few: 'подписчика', many: 'подписчиков' }

export const MODRINTH_SORTS: Array<{ value: string; label: string }> = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'downloads', label: 'По загрузкам' },
  { value: 'follows', label: 'По подпискам' },
  { value: 'newest', label: 'Сначала новые' },
  { value: 'updated', label: 'Недавно обновлённые' },
]

const MODRINTH_CATEGORY_REGISTRY: ModrinthCategory[] = [
  { value: 'adventure', label: 'Приключения', filterable: true },
  { value: 'technology', label: 'Технологии', filterable: true },
  { value: 'magic', label: 'Магия', filterable: true },
  { value: 'utility', label: 'Утилиты', filterable: true },
  { value: 'optimization', label: 'Оптимизация', filterable: true },
  { value: 'worldgen', label: 'Генерация мира', filterable: true },
  { value: 'storage', label: 'Хранение', filterable: true },
  { value: 'food', label: 'Еда', filterable: true },
  { value: 'equipment', label: 'Снаряжение', filterable: true },
  { value: 'game-mechanics', label: 'Игровая механика', filterable: true },
  { value: 'library', label: 'Библиотеки', filterable: true },
  { value: 'cursed', label: 'Проклятое', filterable: false },
  { value: 'decoration', label: 'Декор', filterable: false },
  { value: 'economy', label: 'Экономика', filterable: false },
  { value: 'education', label: 'Обучение', filterable: false },
  { value: 'management', label: 'Управление', filterable: false },
  { value: 'minigame', label: 'Мини-игры', filterable: false },
  { value: 'mobs', label: 'Мобы', filterable: false },
  { value: 'social', label: 'Социальное', filterable: false },
  { value: 'transportation', label: 'Транспорт', filterable: false },
]

export const MODRINTH_CATEGORIES: ModrinthCategory[] = MODRINTH_CATEGORY_REGISTRY.filter(
  (category) => category.filterable,
)

export const MODRINTH_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  MODRINTH_CATEGORY_REGISTRY.map((category) => [category.value, category.label]),
)

export const PAGE_SIZE = 20

export async function fetchModrinthProjectDetails(projectId: string): Promise<ModrinthProjectDetails> {
  return modrinthProject(projectId)
}

export function useModrinth() {
  const coreStore = useCoreStore()
  const query = ref('')
  const sort = ref('relevance')
  const categories = ref<string[]>([])

  const hits = ref<ModrinthSearchHit[]>([])
  const total = ref(0)
  const versionNumbers = ref<Record<string, string>>({})
  const searchVersionsFailed = ref(false)
  const isSearching = ref(false)
  const searchError = ref('')

  const installed = ref<ModrinthInstalledMod[]>([])
  const isLoadingInstalled = ref(false)
  const updates = ref<Record<string, string>>({})
  const isCheckingUpdates = ref(false)
  const installingId = ref<string | null>(null)
  const isOpeningFolder = ref(false)
  const actionError = ref('')
  const installedError = ref('')

  const activeHit = ref<ModrinthSearchHit | null>(null)
  const isPopupVisible = ref(false)
  const popupDetails = ref<ModrinthProjectDetails | null>(null)
  const isPopupLoading = ref(false)
  const popupError = ref('')
  const detailsGuard = useAsyncRaceGuard()

  const totalPages = computed((): number => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  const installedIds = computed((): Set<string> => {
    return new Set(installed.value.map((mod) => mod.project_id))
  })

  const currentPage = ref(1)
  const searchGuard = useAsyncRaceGuard()

  const search = async (newOffset: number = 0): Promise<void> => {
    await runScopedAction({
      guard: searchGuard,
      errorTarget: searchError,
      errorMessage: 'Не удалось выполнить поиск Modrinth',
      busyFlag: isSearching,
      run: (): Promise<ModrinthSearchResult> => modrinthSearch({
        query: query.value,
        index: sort.value,
        categories: categories.value,
        offset: newOffset,
      }),
      apply: (result: ModrinthSearchResult): void => {
        versionNumbers.value = result.version_numbers
        searchVersionsFailed.value = result.version_numbers_failed
        hits.value = result.hits
        total.value = result.total
        currentPage.value = Math.floor(newOffset / PAGE_SIZE) + 1
      },
    })
  }

  const loadPage = async (page: number): Promise<void> => {
    const clamped = Math.min(Math.max(1, page), totalPages.value)
    await search((clamped - 1) * PAGE_SIZE)
  }

  const installedGuard = useAsyncRaceGuard()

  const loadInstalled = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await runScopedAction({
      guard: installedGuard,
      scope,
      errorTarget: installedError,
      errorMessage: 'Не удалось загрузить список установленных модов',
      busyFlag: isLoadingInstalled,
      run: (): Promise<ModrinthInstalledMod[]> => modrinthInstalled(),
      apply: (list: ModrinthInstalledMod[]): void => {
        installed.value = list
      },
    })
  }

  const updatesGuard = useAsyncRaceGuard()

  const loadProjectDetails = async (projectId: string): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    popupDetails.value = null
    await runScopedAction({
      guard: detailsGuard,
      scope,
      errorTarget: popupError,
      errorMessage: 'Не удалось загрузить информацию о моде',
      busyFlag: isPopupLoading,
      run: (): Promise<ModrinthProjectDetails> => fetchModrinthProjectDetails(projectId),
      apply: (result: ModrinthProjectDetails): void => {
        popupDetails.value = result
      },
    })
  }

  const openDetails = (hit: ModrinthSearchHit): void => {
    activeHit.value = hit
    isPopupVisible.value = true
    void loadProjectDetails(hit.project_id)
  }

  const closeDetails = (): void => {
    isPopupVisible.value = false
  }

  const checkForUpdates = async (): Promise<void> => {
    await runScopedAction({
      guard: updatesGuard,
      errorTarget: actionError,
      errorMessage: 'Не удалось проверить обновления модов',
      busyFlag: isCheckingUpdates,
      run: (): Promise<ModrinthUpdateCheck[]> => modrinthCheckUpdates(),
      apply: (checks: ModrinthUpdateCheck[]): void => {
        const next: Record<string, string> = {}
        for (const check of checks) {
          if (check.available_version !== null) {
            next[check.project_id] = check.available_version
          }
        }
        updates.value = next
      },
    })
  }

  const runInstallAction = async <T>(
    projectId: string,
    errorMessage: string,
    run: () => Promise<T>,
    apply: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (installingId.value !== null) return false
    const scope = captureProjectScope((): string => coreStore.currentProject)
    installingId.value = projectId
    return await runScopedAction({
      scope,
      errorTarget: actionError,
      errorMessage,
      cleanup: (): void => {
        if (installingId.value === projectId) installingId.value = null
      },
      run,
      apply,
    }) ?? false
  }

  const install = (projectId: string, versionId?: string): Promise<boolean> =>
    runInstallAction(
      projectId,
      'Не удалось установить мод',
      (): Promise<ModrinthInstallResult> => modrinthInstall(projectId, versionId),
      async (): Promise<boolean> => {
        await loadInstalled()
        const { [projectId]: _resolved, ...rest } = updates.value
        updates.value = rest
        return true
      },
    )

  const uninstall = (projectId: string): Promise<boolean> =>
    runInstallAction(
      projectId,
      'Не удалось удалить мод',
      (): Promise<void> => modrinthUninstall(projectId),
      async (): Promise<boolean> => {
        const { [projectId]: _removed, ...rest } = updates.value
        updates.value = rest
        await loadInstalled()
        return true
      },
    )

  const openFolder = async (): Promise<void> => {
    if (isOpeningFolder.value) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    isOpeningFolder.value = true
    await runScopedAction({
      scope,
      errorTarget: actionError,
      errorMessage: 'Не удалось открыть папку модов',
      cleanup: (): void => {
        isOpeningFolder.value = false
      },
      run: (): Promise<void> => openModsFolder(),
    })
  }

  const resetTabState = (): void => {
    searchGuard.cancel()
    installedGuard.cancel()
    updatesGuard.cancel()
    detailsGuard.cancel()
    query.value = ''
    sort.value = 'relevance'
    categories.value = []
    hits.value = []
    total.value = 0
    versionNumbers.value = {}
    searchVersionsFailed.value = false
    currentPage.value = 1
    isSearching.value = false
    searchError.value = ''
    installed.value = []
    isLoadingInstalled.value = false
    installingId.value = null
    updates.value = {}
    isCheckingUpdates.value = false
    isOpeningFolder.value = false
    actionError.value = ''
    installedError.value = ''
    activeHit.value = null
    isPopupVisible.value = false
    popupDetails.value = null
    isPopupLoading.value = false
    popupError.value = ''
  }

  watch((): string => coreStore.currentProject, (projectName: string): void => {
    if (!projectName) return
    resetTabState()
    void loadInstalled()
    void search(0)
  })

  return {
    query,
    sort,
    categories,
    hits,
    total,
    totalPages,
    currentPage,
    versionNumbers,
    searchVersionsFailed,
    isSearching,
    searchError,
    installed,
    isLoadingInstalled,
    installedIds,
    updates,
    isCheckingUpdates,
    installingId,
    isOpeningFolder,
    actionError,
    installedError,
    activeHit,
    isPopupVisible,
    popupDetails,
    isPopupLoading,
    popupError,
    search,
    loadPage,
    loadInstalled,
    checkForUpdates,
    install,
    uninstall,
    openFolder,
    openDetails,
    closeDetails,
  }
}
