import { computed, ref, watch } from 'vue'
import {
  getErrorMessage,
  modrinthSearch,
  modrinthProject,
  modrinthInstalled,
  modrinthCheckUpdates,
  modrinthInstall,
  modrinthUninstall,
  openModsFolder,
} from '@/06-shared/api'
import { useAsyncRaceGuard } from '@/06-shared'
import {
  useCoreStore,
  type ModrinthSearchHit,
  type ModrinthProjectDetails,
  type ModrinthInstalledMod,
} from '@/05-entities'

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

  const totalPages = computed((): number => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  const installedIds = computed((): Set<string> => {
    return new Set(installed.value.map((mod) => mod.project_id))
  })

  const currentPage = ref(1)
  const searchGuard = useAsyncRaceGuard()

  const search = async (newOffset: number = 0): Promise<void> => {
    const generation = searchGuard.next()
    isSearching.value = true
    searchError.value = ''
    try {
      const result = await modrinthSearch({
        query: query.value,
        index: sort.value,
        categories: categories.value,
        offset: newOffset,
      })
      if (!searchGuard.isCurrent(generation)) return
      versionNumbers.value = result.version_numbers
      hits.value = result.hits
      total.value = result.total
      currentPage.value = Math.floor(newOffset / PAGE_SIZE) + 1
    } catch (e: unknown) {
      if (!searchGuard.isCurrent(generation)) return
      searchError.value = getErrorMessage(e)
    } finally {
      if (searchGuard.isCurrent(generation)) isSearching.value = false
    }
  }

  const loadPage = async (page: number): Promise<void> => {
    const clamped = Math.min(Math.max(1, page), totalPages.value)
    await search((clamped - 1) * PAGE_SIZE)
  }

  const installedGuard = useAsyncRaceGuard()

  const loadInstalled = async (): Promise<void> => {
    const project = coreStore.currentProject
    const generation = installedGuard.next()
    isLoadingInstalled.value = true
    installedError.value = ''
    try {
      const list = await modrinthInstalled()
      if (!installedGuard.isCurrent(generation) || coreStore.currentProject !== project) return
      installed.value = list
    } catch (e: unknown) {
      if (!installedGuard.isCurrent(generation) || coreStore.currentProject !== project) return
      installedError.value = getErrorMessage(e)
    } finally {
      if (installedGuard.isCurrent(generation) && coreStore.currentProject === project) isLoadingInstalled.value = false
    }
  }

  const updatesGuard = useAsyncRaceGuard()

  const checkForUpdates = async (): Promise<void> => {
    const generation = updatesGuard.next()
    isCheckingUpdates.value = true
    actionError.value = ''
    try {
      const checks = await modrinthCheckUpdates()
      if (!updatesGuard.isCurrent(generation)) return
      const next: Record<string, string> = {}
      for (const check of checks) {
        if (check.available_version !== null) {
          next[check.project_id] = check.available_version
        }
      }
      updates.value = next
    } catch (e: unknown) {
      if (!updatesGuard.isCurrent(generation)) return
      actionError.value = getErrorMessage(e)
    } finally {
      if (updatesGuard.isCurrent(generation)) isCheckingUpdates.value = false
    }
  }

  const install = async (projectId: string): Promise<boolean> => {
    if (installingId.value !== null) return false
    const project = coreStore.currentProject
    installingId.value = projectId
    actionError.value = ''
    try {
      await modrinthInstall(projectId)
      if (coreStore.currentProject !== project) return false
      await loadInstalled()
      const { [projectId]: _resolved, ...rest } = updates.value
      updates.value = rest
      return true
    } catch (e: unknown) {
      if (coreStore.currentProject !== project) return false
      actionError.value = getErrorMessage(e)
      return false
    } finally {
      if (installingId.value === projectId) installingId.value = null
    }
  }

  const uninstall = async (projectId: string): Promise<boolean> => {
    if (installingId.value !== null) return false
    const project = coreStore.currentProject
    installingId.value = projectId
    actionError.value = ''
    try {
      await modrinthUninstall(projectId)
      if (coreStore.currentProject !== project) return false
      const { [projectId]: _removed, ...rest } = updates.value
      updates.value = rest
      await loadInstalled()
      return true
    } catch (e: unknown) {
      if (coreStore.currentProject !== project) return false
      actionError.value = getErrorMessage(e)
      return false
    } finally {
      if (installingId.value === projectId) installingId.value = null
    }
  }

  const openFolder = async (): Promise<void> => {
    if (isOpeningFolder.value) return
    const project = coreStore.currentProject
    isOpeningFolder.value = true
    actionError.value = ''
    try {
      await openModsFolder()
    } catch (e: unknown) {
      if (coreStore.currentProject === project) actionError.value = getErrorMessage(e)
    } finally {
      isOpeningFolder.value = false
    }
  }

  const resetTabState = (): void => {
    searchGuard.cancel()
    installedGuard.cancel()
    updatesGuard.cancel()
    query.value = ''
    sort.value = 'relevance'
    categories.value = []
    hits.value = []
    total.value = 0
    versionNumbers.value = {}
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
    search,
    loadPage,
    loadInstalled,
    checkForUpdates,
    install,
    uninstall,
    openFolder,
  }
}
