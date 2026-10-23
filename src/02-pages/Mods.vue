<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ModrinthCatalogList, ModrinthInstalled, ModrinthPagination, ModrinthProjectPopup, ModrinthSearch, ModrinthViews } from '@/03-widgets'
import { useModrinth } from '@/04-features'
import { useCoreStore, useNotificationStore, type ModrinthSearchHit } from '@/05-entities'
import type { ModsView } from '@/03-widgets/types'

const coreStore = useCoreStore()
const notificationStore = useNotificationStore()

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
} = useModrinth()

const activeView = ref<ModsView>('catalog')

const updatesCount = computed((): number => Object.keys(updates.value).length)

const mcVersionText = computed((): string => coreStore.projectConfig?.mcVersion ?? '')

const popupIsInstalled = computed((): boolean => {
  const hit = activeHit.value
  return hit !== null && installedIds.value.has(hit.project_id)
})

const popupUpdateVersion = computed((): string => {
  const hit = activeHit.value
  return hit !== null ? (updates.value[hit.project_id] ?? '') : ''
})

const popupIsBusy = computed((): boolean => {
  const hit = activeHit.value
  return hit !== null && installingId.value === hit.project_id
})

const popupIsBusyAny = computed((): boolean => installingId.value !== null)

const handleInstall = async (hit: ModrinthSearchHit): Promise<void> => {
  await install(hit.project_id)
}

const handleUpdate = async (projectId: string): Promise<void> => {
  await install(projectId)
}

const handleUninstall = async (projectId: string): Promise<void> => {
  const confirmed = await notificationStore.confirm('Удалить этот мод из профиля?')
  if (!confirmed) return
  await uninstall(projectId)
}

const handlePopupInstall = async (): Promise<void> => {
  const hit = activeHit.value
  if (hit === null) return
  await handleInstall(hit)
}

const handlePopupUpdate = async (): Promise<void> => {
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
  <div class="mods-page">
    <p class="mods-page__hint">
      Моды Modrinth для одиночного профиля{{ mcVersionText ? ` (Minecraft ${mcVersionText})` : '' }}. Требуемые зависимости устанавливаются автоматически.
    </p>

    <ModrinthViews
      :active-view="activeView"
      :installed-count="installed.length"
      :updates-count="updatesCount"
      @update:active-view="activeView = $event"
    />

    <section
      id="modrinth-view-panel"
      role="tabpanel"
      :aria-labelledby="`modrinth-view-${activeView}`"
      class="mods-page__section"
    >
      <template v-if="activeView === 'catalog'">
        <ModrinthSearch
          :query="query"
          :sort="sort"
          :categories="categories"
          :is-searching="isSearching"
          @update:query="query = $event"
          @update:sort="sort = $event"
          @update:categories="categories = $event"
          @search="loadPage(1)"
        />

        <ModrinthCatalogList
          :hits="hits"
          :total="total"
          :version-numbers="versionNumbers"
          :search-versions-failed="searchVersionsFailed"
          :is-searching="isSearching"
          :search-error="searchError"
          :action-error="actionError"
          :installed-error="installedError"
          :installed-ids="installedIds"
          :updates="updates"
          :installing-id="installingId"
          @install="handleInstall"
          @update="handleUpdate"
          @details="openDetails"
        />

        <ModrinthPagination
          v-if="totalPages > 1 && hits.length > 0"
          :current-page="currentPage"
          :total-pages="totalPages"
          :is-searching="isSearching"
          @select="loadPage"
        />
      </template>

      <ModrinthInstalled
        v-else
        :mods="installed"
        :updates="updates"
        :installing-id="installingId"
        :is-loading="isLoadingInstalled"
        :is-opening-folder="isOpeningFolder"
        :is-checking-updates="isCheckingUpdates"
        :action-error="actionError"
        :installed-error="installedError"
        @open-folder="openFolder"
        @check-updates="checkForUpdates"
        @update="handleUpdate"
        @uninstall="handleUninstall"
      />
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

.mods-page {
  @include mixins.page-scaffold(none);

  position: relative;
  gap: var(--element-gap);
  text-align: left;

  &__hint {
    @include mixins.caption-hint(left);
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }
}
</style>
