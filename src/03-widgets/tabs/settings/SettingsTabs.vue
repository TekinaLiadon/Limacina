<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button, Tooltip, useRovingTabs } from '@/06-shared'
import { useSettingsNav } from '@/04-features'

const router = useRouter()
const route = useRoute()

const { items: tabs } = useSettingsNav()

const settingsTabPanelId = 'settings-tabpanel'

const tabId = (key: string): string => `settings-tab-${key}`

const activeTabKey = computed<string | null>(() => {
  const active = tabs.value.find((tab) => tab.routeName === route.name)
  return active?.key ?? null
})

const { handleKeydown: handleTabsKeydown } = useRovingTabs<string>({
  tabs: (): typeof tabs.value => tabs.value,
  isActive: (key: string): boolean => activeTabKey.value === key,
  tabId,
})
</script>

<template>
  <div class="settings-tabs">
    <div class="settings-tabs__list" role="tablist" aria-label="Настройки" @keydown="handleTabsKeydown">
      <Tooltip
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-tabs__tab-tooltip"
        :content="tab.reason"
        :disabled="tab.isAvailable"
      >
        <Button
          :id="tabId(tab.key)"
          class="settings-tabs__tab"
          :class="{ 'settings-tabs__tab--active': route.name === tab.routeName }"
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
      class="settings-tabs__panel"
      role="tabpanel"
      :aria-labelledby="activeTabKey !== null ? tabId(activeTabKey) : undefined"
    >
      <slot />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.settings-tabs {
  &__list {
    @include mixins.segmented;

    display: none;
    margin-bottom: var(--tabs-gap);
  }

  &__tab-tooltip {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;

    .settings-tabs__tab {
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

  &__panel {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  @include breakpoints.media-under-lg {
    &__list {
      display: flex;
      gap: var(--space-4);
    }

    &__tab {
      padding: var(--space-4) var(--space-8);
      font-size: var(--text-caption);
    }
  }

  @include breakpoints.media-under-sm {
    &__list {
      padding: var(--space-4);
    }
  }
}
</style>
