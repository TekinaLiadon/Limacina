import { computed, ref } from 'vue'
import {
  getErrorMessage,
  modrinthSearch,
  modrinthProject,
  modrinthInstalled,
  modrinthCheckUpdates,
  modrinthInstall,
  modrinthUninstall,
} from '@/06-shared/api'
import type {
  ModrinthSearchHit,
  ModrinthProjectDetails,
  ModrinthInstalledMod,
} from '@/05-entities/modrinth/types'

export interface ModrinthCategory {
  value: string
  label: string
}

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

export function useModrinth() {
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
  const actionError = ref('')

  const totalPages = computed((): number => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  const installedIds = computed((): Set<string> => {
    return new Set(installed.value.map((mod) => mod.project_id))
  })

  const currentPage = ref(1)

  const search = async (newOffset: number = 0): Promise<void> => {
    isSearching.value = true
    searchError.value = ''
    try {
      const result = await modrinthSearch({
        query: query.value,
        index: sort.value,
        categories: categories.value,
        offset: newOffset,
      })
      versionNumbers.value = { ...versionNumbers.value, ...result.version_numbers }
      hits.value = result.hits
      total.value = result.total
      currentPage.value = Math.floor(newOffset / PAGE_SIZE) + 1
    } catch (e: unknown) {
      searchError.value = getErrorMessage(e)
    } finally {
      isSearching.value = false
    }
  }

  const loadPage = async (page: number): Promise<void> => {
    const clamped = Math.min(Math.max(1, page), totalPages.value)
    await search((clamped - 1) * PAGE_SIZE)
  }

  const loadInstalled = async (): Promise<void> => {
    isLoadingInstalled.value = true
    try {
      installed.value = await modrinthInstalled()
    } catch (e: unknown) {
      actionError.value = getErrorMessage(e)
    } finally {
      isLoadingInstalled.value = false
    }
  }

  const checkForUpdates = async (): Promise<void> => {
    isCheckingUpdates.value = true
    actionError.value = ''
    try {
      const checks = await modrinthCheckUpdates()
      const next: Record<string, string> = {}
      for (const check of checks) {
        if (check.available_version !== null) {
          next[check.project_id] = check.available_version
        }
      }
      updates.value = next
    } catch (e: unknown) {
      actionError.value = getErrorMessage(e)
    } finally {
      isCheckingUpdates.value = false
    }
  }

  const install = async (projectId: string): Promise<boolean> => {
    installingId.value = projectId
    actionError.value = ''
    try {
      await modrinthInstall(projectId)
      await loadInstalled()
      return true
    } catch (e: unknown) {
      actionError.value = getErrorMessage(e)
      return false
    } finally {
      installingId.value = null
    }
  }

  const uninstall = async (projectId: string): Promise<boolean> => {
    installingId.value = projectId
    actionError.value = ''
    try {
      await modrinthUninstall(projectId)
      const { [projectId]: _removed, ...rest } = updates.value
      updates.value = rest
      await loadInstalled()
      return true
    } catch (e: unknown) {
      actionError.value = getErrorMessage(e)
      return false
    } finally {
      installingId.value = null
    }
  }

  const fetchProjectDetails = async (projectId: string): Promise<ModrinthProjectDetails | null> => {
    try {
      return await modrinthProject(projectId)
    } catch (e: unknown) {
      actionError.value = getErrorMessage(e)
      return null
    }
  }

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
    actionError,
    search,
    loadPage,
    loadInstalled,
    checkForUpdates,
    install,
    uninstall,
    fetchProjectDetails,
  }
}
