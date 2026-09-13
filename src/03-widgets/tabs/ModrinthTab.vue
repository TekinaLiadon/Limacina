<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button, Dropdown, Input, MultiSelect, Preloader } from '@/06-shared'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { useModrinth, MODRINTH_SORTS, MODRINTH_CATEGORIES } from '@/04-features'
import type { ModrinthSearchHit, ModrinthInstalledMod } from '@/05-entities/modrinth/types'
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
  actionError,
  search,
  loadPage,
  loadInstalled,
  checkForUpdates,
  install,
  uninstall,
} = modrinth

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

const paginationItems = computed((): Array<number | 'gap'> => {
  const pages = totalPages.value
  const current = currentPage.value
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const result: Array<number | 'gap'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(pages - 1, current + 1)
  if (start > 2) result.push('gap')
  for (let page = start; page <= end; page += 1) result.push(page)
  if (end < pages - 1) result.push('gap')
  result.push(pages)
  return result
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value)
}

function versionText(hit: ModrinthSearchHit): string {
  return versionNumbers.value[hit.project_id] ?? ''
}

function isInstalled(hit: ModrinthSearchHit): boolean {
  return installedIds.value.has(hit.project_id)
}

function availableUpdate(hit: ModrinthSearchHit): string | undefined {
  return updates.value[hit.project_id]
}

function isBusy(projectId: string): boolean {
  return installingId.value === projectId
}

async function handleInstall(hit: ModrinthSearchHit): Promise<void> {
  await install(hit.project_id)
}

async function handleUpdate(mod: ModrinthSearchHit | ModrinthInstalledMod): Promise<void> {
  await install(mod.project_id)
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

    <section class="modrinth-tab__section">
      <div class="modrinth-tab__section-head">
        <h3 class="modrinth-tab__section-title">Установленные моды</h3>
        <Button
          class="btn-secondary"
          :is-loading="isCheckingUpdates"
          :is-disabled="isCheckingUpdates || installed.length === 0"
          @click="checkForUpdates"
        >
          Проверить обновления
        </Button>
      </div>

      <Preloader v-if="isLoadingInstalled" text="Загрузка модов" />
      <p v-else-if="installed.length === 0" class="modrinth-tab__empty">
        Пока ничего не установлено — найдите моды поиском ниже
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
              <span v-if="updates[mod.project_id]" class="modrinth-tab__badge modrinth-tab__badge--update">
                Доступно: {{ updates[mod.project_id] }}
              </span>
            </div>
            <span class="modrinth-tab__row-meta">{{ mod.filename }}</span>
          </div>
          <div class="modrinth-tab__row-actions">
            <Button
              v-if="updates[mod.project_id]"
              class="btn-primary"
              :is-loading="isBusy(mod.project_id)"
              :is-disabled="installingId !== null"
              @click="handleUpdate(mod)"
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

    <section class="modrinth-tab__section">
      <div class="modrinth-tab__search">
        <Input
          v-model="query"
          class="modrinth-tab__search-input"
          :options="{ placeholder: 'Поиск модов Modrinth' }"
          @keydown.enter="loadPage(1)"
        />
        <Dropdown
          v-model="sort"
          class="modrinth-tab__search-sort"
          :options="sortOptions"
          width="220px"
        />
        <MultiSelect
          v-model="categories"
          class="modrinth-tab__search-categories"
          :options="categoryOptions"
          placeholder="Категории"
          width="220px"
          clearable
        />
        <Button class="btn-primary" :is-loading="isSearching" @click="loadPage(1)">
          Найти
        </Button>
      </div>

      <div v-if="searchError" class="modrinth-tab__error">{{ searchError }}</div>
      <div v-if="actionError" class="modrinth-tab__error">{{ actionError }}</div>

      <Preloader v-if="isSearching && hits.length === 0" text="Поиск модов" />
      <p v-else-if="hits.length === 0" class="modrinth-tab__empty">Ничего не найдено</p>
      <div v-else class="modrinth-tab__list">
        <article v-for="hit in hits" :key="hit.project_id" class="modrinth-tab__row">
          <ModrinthIcon :src="hit.icon_url" :title="hit.title" />
          <div class="modrinth-tab__row-info">
            <div class="modrinth-tab__row-head">
              <span class="modrinth-tab__row-title">{{ hit.title }}</span>
              <span v-if="versionText(hit)" class="modrinth-tab__badge">{{ versionText(hit) }}</span>
              <span v-if="availableUpdate(hit)" class="modrinth-tab__badge modrinth-tab__badge--update">
                Доступно: {{ availableUpdate(hit) }}
              </span>
            </div>
            <p class="modrinth-tab__row-description">{{ hit.description }}</p>
            <span class="modrinth-tab__row-meta">{{ formatNumber(hit.downloads) }} загрузок · {{ hit.author }}</span>
          </div>
          <div class="modrinth-tab__row-actions">
            <Button
              v-if="availableUpdate(hit)"
              class="btn-primary"
              :is-loading="isBusy(hit.project_id)"
              :is-disabled="installingId !== null"
              @click="handleUpdate(hit)"
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
      </div>

      <div v-if="totalPages > 1 && hits.length > 0" class="modrinth-tab__pagination">
        <Button
          class="btn-quiet modrinth-tab__page"
          :is-disabled="currentPage === 1 || isSearching"
          @click="loadPage(currentPage - 1)"
        >
          ‹
        </Button>
        <template v-for="(item, index) in paginationItems" :key="`${item}-${index}`">
          <span v-if="item === 'gap'" class="modrinth-tab__page-gap">...</span>
          <Button
            v-else
            class="btn-quiet modrinth-tab__page"
            :class="{ 'modrinth-tab__page--active': item === currentPage }"
            :is-disabled="isSearching"
            @click="loadPage(item)"
          >
            {{ item }}
          </Button>
        </template>
        <Button
          class="btn-quiet modrinth-tab__page"
          :is-disabled="currentPage === totalPages || isSearching"
          @click="loadPage(currentPage + 1)"
        >
          ›
        </Button>
        <span class="modrinth-tab__row-meta">Найдено: {{ formatNumber(total) }}</span>
      </div>
    </section>

    <ModrinthProjectPopup
      :visible="popupVisible"
      :hit="activeHit"
      @close="popupVisible = false"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.modrinth-tab {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__hint {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__section-title {
    font-size: var(--text-subtitle);
  }

  &__search {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;

    &-input {
      flex: 1 1 240px;
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
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
    font-weight: var(--weight-semibold);
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
    padding: var(--space-4) var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    color: var(--login-text-muted);
    font-size: var(--text-caption);
    white-space: nowrap;

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

  &__loading {
    @include mixins.caption-hint;
    text-align: left;
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
</style>
