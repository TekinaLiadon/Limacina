<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button, Dropdown, Input, MultiSelect, Skeleton, formatNumber } from '@/06-shared'
import { useCoreStore, useNotificationStore, type ModrinthSearchHit } from '@/05-entities'
import { useModrinth, MODRINTH_SORTS, MODRINTH_CATEGORIES } from '@/04-features'
import ModrinthProjectPopup from './ModrinthProjectPopup.vue'
import ModrinthIcon from './ModrinthIcon.vue'

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
} = modrinth

type ModsView = 'catalog' | 'installed'

const activeView = ref<ModsView>('catalog')
const popupVisible = ref(false)
const activeHit = ref<ModrinthSearchHit | null>(null)

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

const moveView = (delta: number): void => {
  const count = viewTabs.length
  const currentIndex = viewTabs.findIndex((tab) => tab.key === activeView.value)
  const nextTab = viewTabs[(currentIndex + delta + count) % count]
  if (!nextTab) return
  activeView.value = nextTab.key
  void nextTick((): void => {
    document.getElementById(`modrinth-view-${nextTab.key}`)?.focus({ preventScroll: true })
  })
}

const handleViewsKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveView(1)
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveView(-1)
  }
}

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

function openDetails(hit: ModrinthSearchHit): void {
  activeHit.value = hit
  popupVisible.value = true
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
        <article
          v-for="mod in installed"
          :key="mod.project_id"
          class="modrinth-tab__row"
        >
          <ModrinthIcon :src="mod.icon_url" :title="mod.title" />
          <div class="modrinth-tab__row-info">
            <div class="modrinth-tab__row-head">
              <span class="modrinth-tab__row-title">{{ mod.title }}</span>
              <span class="modrinth-tab__badge">{{ mod.version_number }}</span>
              <span v-if="availableUpdate(mod.project_id)" class="modrinth-tab__badge modrinth-tab__badge--update">
                Доступно: {{ availableUpdate(mod.project_id) }}
              </span>
            </div>
            <span class="modrinth-tab__row-meta">{{ mod.filename }}</span>
          </div>
          <div class="modrinth-tab__row-actions">
            <Button
              v-if="availableUpdate(mod.project_id)"
              class="btn-primary"
              :is-loading="isBusy(mod.project_id)"
              :is-disabled="installingId !== null"
              @click="handleUpdate(mod.project_id)"
            >
              Обновить
            </Button>
            <Button
              class="btn-danger"
              :is-loading="isBusy(mod.project_id)"
              :is-disabled="installingId !== null"
              @click="handleUninstall(mod.project_id)"
            >
              Удалить
            </Button>
          </div>
        </article>
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
        <article
          v-for="(hit, index) in hits"
          :key="hit.project_id"
          class="modrinth-tab__row"
          :style="{ '--modrinth-row-index': String(Math.min(index, 11)) }"
        >
          <ModrinthIcon :src="hit.icon_url" :title="hit.title" />
          <div class="modrinth-tab__row-info">
            <div class="modrinth-tab__row-head">
              <span class="modrinth-tab__row-title">{{ hit.title }}</span>
              <span v-if="versionText(hit)" class="modrinth-tab__badge">{{ versionText(hit) }}</span>
              <span v-if="availableUpdate(hit.project_id)" class="modrinth-tab__badge modrinth-tab__badge--update">
                Доступно: {{ availableUpdate(hit.project_id) }}
              </span>
            </div>
            <p class="modrinth-tab__row-description">{{ hit.description }}</p>
            <span class="modrinth-tab__row-meta">{{ formatNumber(hit.downloads) }} загрузок · {{ hit.author }}</span>
          </div>
          <div class="modrinth-tab__row-actions">
            <Button
              v-if="availableUpdate(hit.project_id)"
              class="btn-primary"
              :is-loading="isBusy(hit.project_id)"
              :is-disabled="installingId !== null"
              @click="handleUpdate(hit.project_id)"
            >
              Обновить
            </Button>
            <Button
              v-else-if="!isInstalled(hit)"
              class="btn-primary"
              :is-loading="isBusy(hit.project_id)"
              :is-disabled="installingId !== null"
              @click="handleInstall(hit)"
            >
              Скачать
            </Button>
            <span v-else class="modrinth-tab__badge modrinth-tab__badge--installed">Установлен</span>
            <Button class="btn-secondary" @click="openDetails(hit)">Подробнее</Button>
          </div>
        </article>
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
      :visible="popupVisible"
      :hit="activeHit"
      :is-installed="popupIsInstalled"
      :update-version="popupUpdateVersion"
      :is-busy="popupIsBusy"
      :is-busy-any="popupIsBusyAny"
      @install="handlePopupInstall"
      @update="handlePopupUpdate"
      @close="popupVisible = false"
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

    &--update {
      color: var(--accent-text);
    }

    &--installed {
      color: var(--accent-text);
    }
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
