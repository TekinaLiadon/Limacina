<script setup lang="ts">
import { watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button, Tooltip } from '@/06-shared'
import { useProjectSettings, useSettingsNav } from '@/04-features'

const router = useRouter()
const route = useRoute()

const { config, isLoaded } = useProjectSettings()
const { items: tabs } = useSettingsNav()

watch((): boolean => isLoaded.value && !config.value.online, (offline) => {
  if (offline && route.name === 'SettingsAccount') router.replace({ name: 'SettingsLauncher' })
})
</script>

<template>
  <div class="settings-page">
    <h2 class="settings-page__title heading-display">Настройки</h2>

    <div class="settings-page__tabs" role="tablist">
      <Tooltip
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-page__tab-tooltip"
        :content="tab.reason"
        :disabled="tab.isAvailable"
      >
        <Button
          class="settings-page__tab"
          :class="{ 'settings-page__tab--active': route.name === tab.routeName }"
          role="tab"
          :aria-selected="route.name === tab.routeName"
          :is-disabled="!tab.isAvailable"
          @click="tab.isAvailable && router.push({ name: tab.routeName })"
        >
          {{ tab.label }}
        </Button>
      </Tooltip>
    </div>

    <div class="settings-page__content">
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
    flex: 1 1 0;
    min-width: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--login-text-muted);
    white-space: normal;
    overflow-wrap: anywhere;

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      @include mixins.segmented-active;
    }

    &.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
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
