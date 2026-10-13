<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button, Dropdown, Input, MultiSelect, Skeleton, formatNumber, useRovingTabs } from '@/06-shared'
import { useCoreStore, useNotificationStore, type ModrinthSearchHit } from '@/05-entities'
import { useModrinth, MODRINTH_SORTS, MODRINTH_CATEGORIES } from '@/04-features'
import ModrinthProjectPopup from './ModrinthProjectPopup.vue'
import ModrinthRow from './ModrinthRow.vue'

const coreStore = useCoreStore()
const notificationStore = useNotificationStore()
const modrinth = useModrinth()
const {
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
} = modrinth

type ModsView = 'catalog' | 'installed'

const activeView = ref<ModsView>('catalog')

const sortOptions = MODRINTH_SORTS.map((option) => ({
  title: option.label,
  value: option.value,
}))

const categoryOptions = MODRINTH_CATEGORIES.map((option) => ({
  title: option.label,
  value: option.value,
}))

const mcVersionText = computed((): string => coreStore.projectConfig?.mcVersion ?? '')

const isTabLoading = computed((): boolean =>
  isLoadingInstalled.value && activeView.value === 'installed',
)

const isCatalogSearching = computed((): boolean =>
  activeView.value === 'catalog' && isSearching.value && hits.value.length === 0,
)

const updatesCount = computed((): number => Object.keys(updates.value).length)

const viewTabs: Array<{ key: ModsView; label: string }> = [
  { key: 'catalog', label: 'Каталог' },
  { key: 'installed', label: 'Установленные' },
]

const { handleKeydown: handleViewsKeydown } = useRovingTabs<ModsView>({
  tabs: (): Array<{ key: ModsView; label: string }> => viewTabs,
  isActive: (key: ModsView): boolean => activeView.value === key,
  tabId: (key: ModsView): string => `modrinth-view-${key}`,
  select: (key: ModsView): void => {
    activeView.value = key
  },
})

type PaginationItem = { key: string; page: number | null }

const paginationItems = computed((): PaginationItem[] => {
  const pages = totalPages.value
  const current = currentPage.value
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => ({ key: `page-${index + 1}`, page: index + 1 }))
  }
  const result: PaginationItem[] = [{ key: 'page-1', page: 1 }]
  const start = Math.max(2, current - 1)
  const end = Math.min(pages - 1, current + 1)
  if (start > 2) result.push({ key: 'gap-start', page: null })
  for (let page = start; page <= end; page += 1) result.push({ key: `page-${page}`, page })
  if (end < pages - 1) result.push({ key: 'gap-end', page: null })
  result.push({ key: `page-${pages}`, page: pages })
  return result
})

function versionText(hit: ModrinthSearchHit): string {
  return versionNumbers.value[hit.project_id] ?? ''
}

function isInstalled(hit: ModrinthSearchHit): boolean {
  return installedIds.value.has(hit.project_id)
}

function availableUpdate(projectId: string): string | undefined {
  return updates.value[projectId]
}

function isBusy(projectId: string): boolean {
  return installingId.value === projectId
}

async function handleInstall(hit: ModrinthSearchHit): Promise<void> {
  await install(hit.project_id)
}

async function handleUpdate(projectId: string): Promise<void> {
  await install(projectId)
}

async function handleUninstall(projectId: string): Promise<void> {
  const confirmed = await notificationStore.confirm('Удалить этот мод из профиля?')
  if (!confirmed) return
  await uninstall(projectId)
}

const popupIsInstalled = computed((): boolean => {
  const hit = activeHit.value
  return hit !== null && isInstalled(hit)
})

const popupUpdateVersion = computed((): string => {
  const hit = activeHit.value
  return hit !== null ? (availableUpdate(hit.project_id) ?? '') : ''
})

const popupIsBusy = computed((): boolean => {
  const hit = activeHit.value
  return hit !== null && isBusy(hit.project_id)
})

const popupIsBusyAny = computed((): boolean => installingId.value !== null)

async function handlePopupInstall(): Promise<void> {
  const hit = activeHit.value
  if (hit === null) return
  await handleInstall(hit)
}

async function handlePopupUpdate(): Promise<void> {
  const hit = activeHit.value
  if (hit === null) return
  await handleUpdate(hit.project_id)
}

watch([sort, categories], () => {
  void loadPage(1)
})

onMounted(() => {
  void loadInstalled()
  void search(0)
})
</script>

<template>
  <div class="modrinth-tab">
    <p class="modrinth-tab__hint">
      Моды Modrinth для одиночного профиля{{ mcVersionText ? ` (Minecraft ${mcVersionText})` : '' }}. Требуемые зависимости устанавливаются автоматически.
    </p>

    <div class="modrinth-tab__views" role="tablist" aria-label="Режим модов" @keydown="handleViewsKeydown">
      <button
        v-for="view in viewTabs"
        :id="`modrinth-view-${view.key}`"
        :key="view.key"
        type="button"
        role="tab"
        class="modrinth-tab__view"
        :class="{ 'modrinth-tab__view--active': activeView === view.key }"
        :aria-selected="activeView === view.key"
        :tabindex="activeView === view.key ? 0 : -1"
        aria-controls="modrinth-view-panel"
        @click="activeView = view.key"
      >
        {{ view.label }}
        <template v-if="view.key === 'installed'">
          <span class="modrinth-tab__view-count">{{ installed.length }}</span>
          <span v-if="updatesCount > 0" class="modrinth-tab__view-updates">{{ updatesCount }}</span>
        </template>
      </button>
    </div>

    <section
      v-if="activeView === 'installed'"
      id="modrinth-view-panel"
      role="tabpanel"
      aria-labelledby="modrinth-view-installed"
      class="modrinth-tab__section"
    >
      <div class="modrinth-tab__section-head">
        <Button
          class="btn-secondary"
          :is-loading="isOpeningFolder"
          :is-disabled="isOpeningFolder"
          @click="openFolder"
        >
          Открыть папку модов
        </Button>
        <Button
          class="btn-secondary"
          :is-loading="isCheckingUpdates"
          :is-disabled="isCheckingUpdates || installed.length === 0"
          @click="checkForUpdates"
        >
          Проверить обновления
        </Button>
      </div>

      <div v-if="actionError" class="modrinth-tab__error">{{ actionError }}</div>
      <div v-if="installedError" class="modrinth-tab__error">{{ installedError }}</div>

      <div v-if="isTabLoading" class="modrinth-tab__list" aria-hidden="true">
        <div v-for="index in 5" :key="index" class="modrinth-tab__row">
          <Skeleton variant="list-item" icon-shape="square" :lines="4" flat size="lg" />
        </div>
      </div>
      <p v-else-if="installed.length === 0 && !installedError" class="modrinth-tab__empty">
        Пока ничего не установлено — найдите моды в каталоге
      </p>
      <div v-else class="modrinth-tab__list">
        <ModrinthRow
          v-for="mod in installed"
          :key="mod.project_id"
          variant="installed"
          :icon-url="mod.icon_url"
          :title="mod.title"
          :version-text="mod.version_number"
          :update-version="availableUpdate(mod.project_id) ?? ''"
          :is-installed="true"
          :is-busy="isBusy(mod.project_id)"
          :is-busy-any="installingId !== null"
          :meta-text="mod.filename"
          @update="handleUpdate(mod.project_id)"
          @uninstall="handleUninstall(mod.project_id)"
        />
      </div>
    </section>

    <section
      v-else
      id="modrinth-view-panel"
      role="tabpanel"
      aria-labelledby="modrinth-view-catalog"
      class="modrinth-tab__section"
    >
      <div class="modrinth-tab__search">
        <Input
          v-model="query"
          class="modrinth-tab__search-input"
          :options="{ placeholder: 'Поиск модов Modrinth' }"
          @keydown.enter="loadPage(1)"
        />
        <div class="modrinth-tab__search-controls">
          <Dropdown
            v-model="sort"
            class="modrinth-tab__search-sort"
            :options="sortOptions"
            width="var(--filter-control-width)"
          />
          <MultiSelect
            v-model="categories"
            class="modrinth-tab__search-categories"
            :options="categoryOptions"
            placeholder="Категории"
            width="var(--filter-control-width)"
            clearable
          />
          <Button class="btn-primary" :is-loading="isSearching" @click="loadPage(1)">
            Найти
          </Button>
        </div>
      </div>

      <div v-if="searchError" class="modrinth-tab__error">{{ searchError }}</div>
      <div v-if="actionError" class="modrinth-tab__error">{{ actionError }}</div>
      <div v-if="installedError" class="modrinth-tab__error">{{ installedError }}</div>
      <p v-if="searchVersionsFailed && !searchError" class="modrinth-tab__versions-hint">
        Версии модов не загрузились — значки версий могут отсутствовать
      </p>

      <div v-if="isCatalogSearching" class="modrinth-tab__summary" aria-hidden="true">
        <Skeleton
          class="modrinth-tab__summary-skeleton"
          width="var(--modrinth-summary-skeleton-width)"
          height="calc(var(--text-caption) * var(--leading-caption))"
        />
      </div>
      <div v-else-if="hits.length > 0" class="modrinth-tab__summary">
        <span class="modrinth-tab__row-meta">Найдено: {{ formatNumber(total) }}</span>
      </div>

      <p v-if="!isCatalogSearching && hits.length === 0 && !searchError" class="modrinth-tab__empty">Ничего не найдено</p>
      <div v-else-if="isCatalogSearching" class="modrinth-tab__list" aria-hidden="true">
        <div v-for="index in 6" :key="index" class="modrinth-tab__row">
          <Skeleton variant="list-item" icon-shape="square" :lines="4" flat size="lg" />
        </div>
      </div>
      <TransitionGroup v-else name="modrinth-rows" tag="div" class="modrinth-tab__list">
        <ModrinthRow
          v-for="(hit, index) in hits"
          :key="hit.project_id"
          variant="catalog"
          :style="{ '--modrinth-row-index': String(Math.min(index, 11)) }"
          :icon-url="hit.icon_url"
          :title="hit.title"
          :version-text="versionText(hit)"
          :update-version="availableUpdate(hit.project_id) ?? ''"
          :is-installed="isInstalled(hit)"
          :is-busy="isBusy(hit.project_id)"
          :is-busy-any="installingId !== null"
          :meta-text="`${formatNumber(hit.downloads)} загрузок · ${hit.author}`"
          :description="hit.description"
          @update="handleUpdate(hit.project_id)"
          @install="handleInstall(hit)"
          @details="openDetails(hit)"
        />
      </TransitionGroup>

      <div v-if="totalPages > 1 && hits.length > 0" class="modrinth-tab__pagination">
        <Button
          class="btn-quiet modrinth-tab__page"
          aria-label="Предыдущая страница"
          :is-disabled="currentPage === 1 || isSearching"
          @click="loadPage(currentPage - 1)"
        >
          ‹
        </Button>
        <template v-for="item in paginationItems" :key="item.key">
          <span v-if="item.page === null" class="modrinth-tab__page-gap">...</span>
          <Button
            v-else
            class="btn-quiet modrinth-tab__page"
            :class="{ 'modrinth-tab__page--active': item.page === currentPage }"
            :aria-current="item.page === currentPage ? 'page' : undefined"
            :is-disabled="isSearching"
            @click="loadPage(item.page)"
          >
            {{ item.page }}
          </Button>
        </template>
        <Button
          class="btn-quiet modrinth-tab__page"
          aria-label="Следующая страница"
          :is-disabled="currentPage === totalPages || isSearching"
          @click="loadPage(currentPage + 1)"
        >
          ›
        </Button>
      </div>
    </section>

    <ModrinthProjectPopup
      :visible="isPopupVisible"
      :hit="activeHit"
      :details="popupDetails"
      :is-loading="isPopupLoading"
      :load-error="popupError"
      :is-installed="popupIsInstalled"
      :update-version="popupUpdateVersion"
      :is-busy="popupIsBusy"
      :is-busy-any="popupIsBusyAny"
      @install="handlePopupInstall"
      @update="handlePopupUpdate"
      @close="closeDetails"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.modrinth-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__hint {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__views {
    @include mixins.segmented;

    align-self: flex-start;
  }

  &__view {
    @include mixins.segmented-item($disabled-opacity: null, $hover-exclude-active: true);

    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-16);
    font-family: inherit;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out);
  }

  &__view-count {
    @include mixins.badge-count;
  }

  &__view-updates {
    @include mixins.badge-count($background: var(--accent-active-bg), $color: var(--accent-text));

    font-weight: var(--weight-medium);
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__search {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;

    &-input {
      flex: 1 1 var(--filter-control-width);
      min-width: var(--filter-control-width);
    }

    &-controls {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      flex-wrap: wrap;
      min-width: 0;
    }
  }

  &__summary {
    display: flex;
    justify-content: flex-end;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__row {
    @include mixins.subtle-card(var(--space-8) var(--space-12));

    display: flex;
    align-items: center;
    gap: var(--space-12);
  }

  &__row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__row-head {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__row-title {
    font-weight: var(--weight-medium);
    overflow-wrap: anywhere;
  }

  &__row-description {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }

  &__row-meta {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__badge {
    @include mixins.badge;
  }

  &__row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  &__page {
    min-width: var(--control-height-sm);
    padding: 0 var(--space-8);

    &--active {
      background: var(--accent-active-bg);
      color: var(--accent-text);
      box-shadow: var(--elevation-inset);
    }
  }

  &__page-gap {
    color: var(--login-text-muted);
  }

  &__empty {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__error {
    @include mixins.error-box;
  }

  &__versions-hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }

  @include breakpoints.media-under-md {
    &__row {
      flex-direction: column;
      align-items: flex-start;
    }

    &__row-actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
}

.modrinth-rows-enter-active {
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
  transition-delay: calc(var(--modrinth-row-index, 0) * var(--stagger-step));
}

.modrinth-rows-enter-from {
  opacity: 0;
  transform: translateY(var(--space-8));
}
</style>
