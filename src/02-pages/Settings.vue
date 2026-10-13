<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button, Tooltip } from '@/06-shared'
import { useProjectSettings, useSettingsNav, useSettingsDirtyGuard } from '@/04-features'

const router = useRouter()
const route = useRoute()

const { config, isLoaded } = useProjectSettings()
const { items: tabs } = useSettingsNav()
useSettingsDirtyGuard()

const settingsTabPanelId = 'settings-tabpanel'

const tabId = (key: string): string => `settings-tab-${key}`

const activeTabKey = computed<string | null>(() => {
  const active = tabs.value.find((tab) => tab.routeName === route.name)
  return active?.key ?? null
})

const moveTabFocus = (delta: number): void => {
  const available = tabs.value.filter((tab) => tab.isAvailable)
  if (available.length === 0) return
  const focusedId = document.activeElement?.id ?? ''
  const focusedIndex = available.findIndex((tab) => tabId(tab.key) === focusedId)
  const anchorIndex = focusedIndex !== -1
    ? focusedIndex
    : available.findIndex((tab) => tab.key === activeTabKey.value)
  const nextIndex = anchorIndex === -1 ? 0 : (anchorIndex + delta + available.length) % available.length
  const next = available[nextIndex]
  if (next) document.getElementById(tabId(next.key))?.focus()
}

const handleTabsKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveTabFocus(1)
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveTabFocus(-1)
  }
}

watch((): boolean => isLoaded.value && !config.value.online, (offline) => {
  if (offline && route.name === 'SettingsAccount') router.replace({ name: 'SettingsLauncher' })
}, { immediate: true })
</script>

<template>
  <div class="settings-page">
    <h2 class="settings-page__title heading-display">Настройки</h2>

    <div class="settings-page__tabs" role="tablist" aria-label="Настройки" @keydown="handleTabsKeydown">
      <Tooltip
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-page__tab-tooltip"
        :content="tab.reason"
        :disabled="tab.isAvailable"
      >
        <Button
          :id="tabId(tab.key)"
          class="settings-page__tab"
          :class="{ 'settings-page__tab--active': route.name === tab.routeName }"
          role="tab"
          :aria-selected="route.name === tab.routeName"
          :tabindex="route.name === tab.routeName ? 0 : -1"
          :aria-controls="settingsTabPanelId"
          :is-disabled="!tab.isAvailable"
          @click="tab.isAvailable && router.push({ name: tab.routeName })"
        >
          {{ tab.label }}
        </Button>
      </Tooltip>
    </div>

    <div
      :id="settingsTabPanelId"
      class="settings-page__content"
      role="tabpanel"
      :aria-labelledby="activeTabKey !== null ? tabId(activeTabKey) : undefined"
    >
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.settings-page {
  width: 100%;
  max-width: var(--page-max-width-wide);
  margin: 0 auto;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 0;

  &__title {
    margin-bottom: var(--title-gap);
  }

  &__tabs {
    @include mixins.segmented;

    display: none;
    margin-bottom: var(--tabs-gap);
  }

  &__tab-tooltip {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;

    .settings-page__tab {
      flex: 1;
      width: 100%;
    }
  }

  &__tab {
    @include mixins.segmented-item($disabled-opacity: 0.4);

    flex: 1 1 0;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  @include breakpoints.media-under-lg {
    &__tabs {
      display: flex;
      gap: var(--space-4);
    }

    &__tab {
      padding: var(--space-4) var(--space-8);
      font-size: var(--text-caption);
    }
  }

  @include breakpoints.media-under-sm {
    &__tabs {
      padding: var(--space-4);
    }
  }
}
</style>
