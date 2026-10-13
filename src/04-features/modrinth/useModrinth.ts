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
import { captureProjectScope, useAsyncRaceGuard } from '@/06-shared'
import {
  useCoreStore,
  type ModrinthSearchHit,
  type ModrinthProjectDetails,
  type ModrinthInstalledMod,
  type ModrinthSearchResult,
  type ModrinthUpdateCheck,
} from '@/05-entities'
import { runScopedAction } from './runScopedAction'

export interface ModrinthCategory {
  value: string
  label: string
}

export const MODRINTH_BASE_URL = 'https://modrinth.com'

export const MODRINTH_SORTS: Array<{ value: string; label: string }> = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'downloads', label: 'По загрузкам' },
  { value: 'follows', label: 'По подпискам' },
  { value: 'newest', label: 'Сначала новые' },
  { value: 'updated', label: 'Недавно обновлённые' },
]

export const MODRINTH_CATEGORIES: ModrinthCategory[] = [
  { value: 'adventure', label: 'Приключения' },
  { value: 'technology', label: 'Технологии' },
  { value: 'magic', label: 'Магия' },
  { value: 'utility', label: 'Утилиты' },
  { value: 'optimization', label: 'Оптимизация' },
  { value: 'worldgen', label: 'Генерация мира' },
  { value: 'storage', label: 'Хранение' },
  { value: 'food', label: 'Еда' },
  { value: 'equipment', label: 'Снаряжение' },
  { value: 'game-mechanics', label: 'Игровая механика' },
  { value: 'library', label: 'Библиотеки' },
]

export const MODRINTH_CATEGORY_LABELS: Record<string, string> = {
  adventure: 'Приключения',
  cursed: 'Проклятое',
  decoration: 'Декор',
  economy: 'Экономика',
  education: 'Обучение',
  equipment: 'Снаряжение',
  food: 'Еда',
  'game-mechanics': 'Игровая механика',
  library: 'Библиотеки',
  magic: 'Магия',
  management: 'Управление',
  minigame: 'Мини-игры',
  mobs: 'Мобы',
  optimization: 'Оптимизация',
  social: 'Социальное',
  storage: 'Хранение',
  technology: 'Технологии',
  transportation: 'Транспорт',
  utility: 'Утилиты',
  worldgen: 'Генерация мира',
}

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
    const generation = searchGuard.next()
    await runScopedAction({
      isCurrent: (): boolean => searchGuard.isCurrent(generation),
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
    const generation = installedGuard.next()
    await runScopedAction({
      isCurrent: (): boolean => installedGuard.isCurrent(generation) && scope.isCurrent(),
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
    const generation = detailsGuard.next()
    popupDetails.value = null
    await runScopedAction({
      isCurrent: (): boolean => detailsGuard.isCurrent(generation) && scope.isCurrent(),
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
    const generation = updatesGuard.next()
    await runScopedAction({
      isCurrent: (): boolean => updatesGuard.isCurrent(generation),
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

  const install = async (projectId: string): Promise<boolean> => {
    if (installingId.value !== null) return false
    const scope = captureProjectScope((): string => coreStore.currentProject)
    installingId.value = projectId
    return await runScopedAction({
      isCurrent: (): boolean => scope.isCurrent(),
      errorTarget: actionError,
      errorMessage: 'Не удалось установить мод',
      cleanup: (): void => {
        if (installingId.value === projectId) installingId.value = null
      },
      run: () => modrinthInstall(projectId),
      apply: async (): Promise<boolean> => {
        await loadInstalled()
        const { [projectId]: _resolved, ...rest } = updates.value
        updates.value = rest
        return true
      },
    }) ?? false
  }

  const uninstall = async (projectId: string): Promise<boolean> => {
    if (installingId.value !== null) return false
    const scope = captureProjectScope((): string => coreStore.currentProject)
    installingId.value = projectId
    return await runScopedAction({
      isCurrent: (): boolean => scope.isCurrent(),
      errorTarget: actionError,
      errorMessage: 'Не удалось удалить мод',
      cleanup: (): void => {
        if (installingId.value === projectId) installingId.value = null
      },
      run: (): Promise<void> => modrinthUninstall(projectId),
      apply: async (): Promise<boolean> => {
        const { [projectId]: _removed, ...rest } = updates.value
        updates.value = rest
        await loadInstalled()
        return true
      },
    }) ?? false
  }

  const openFolder = async (): Promise<void> => {
    if (isOpeningFolder.value) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    isOpeningFolder.value = true
    await runScopedAction({
      isCurrent: (): boolean => scope.isCurrent(),
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
