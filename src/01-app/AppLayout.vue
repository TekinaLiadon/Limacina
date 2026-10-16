<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Dropdown } from '@/06-shared'
import { useCoreStore, type TabKey } from '@/05-entities'
import { useProjectSwitch, useSettingsNav } from '@/04-features'
import { Sidebar, ServerStatus, ServerUnavailableBanner, ThemeModeToggle } from '@/03-widgets'

const props = defineProps<{
  showDebug: boolean
}>()

interface Tab {
  key: TabKey
  name: string
}

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const { projectOptions, canSwitch, isSwitching: isProjectSwitching, selectProject } = useProjectSwitch()
const { items: settingsNavItems } = useSettingsNav()

const tabs = computed((): Tab[] => {
  const items: Tab[] = [
    { key: 'accounts', name: 'Accounts' },
    { key: 'add-profile', name: 'AddProfile' },
    { key: 'mods', name: 'Mods' },
    { key: 'settings', name: 'SettingsLauncher' },
  ]
  if (props.showDebug) items.push({ key: 'debug', name: 'Debug' })

  return items
})

const settingsRouteNames = computed((): string[] => settingsNavItems.value.map((item) => item.routeName))

const currentTab = computed((): TabKey => {
  const name = route.name as string
  if (settingsRouteNames.value.includes(name)) return 'settings'

  const tab = tabs.value.find((t) => t.name === name)
  return tab?.key ?? 'accounts'
})

const navigateTo = (key: TabKey): void => {
  const tab = tabs.value.find((t) => t.key === key)
  if (tab) router.push({ name: tab.name })
}

const navigateSettings = (routeName: string): void => {
  router.push({ name: routeName })
}
</script>

<template>
  <div class="app-layout">
    <div class="app-layout__header">
      <div v-if="coreStore.hasProjects" class="app-layout__project">
        <Dropdown
          :options="projectOptions"
          :model-value="coreStore.currentProject"
          @update:model-value="selectProject"
          width="var(--header-project-width)"
          :max-visible="6"
          :disabled="!canSwitch || isProjectSwitching"
        >
          <template #trailing>
            <ServerStatus />
          </template>
        </Dropdown>
      </div>
      <ThemeModeToggle variant="icons" />
    </div>

    <div class="app-layout__body">
      <Sidebar
        :active-tab="currentTab"
        :settings-sub-tab="route.name as string"
        :show-debug="showDebug"
        :show-mods="coreStore.isOfflineProject"
        @navigate="navigateTo"
        @navigate-settings="navigateSettings"
      />

      <div class="app-layout__content">
        <div class="app-layout__content-inner">
          <ServerUnavailableBanner />
          <router-view v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component :is="Component" />
            </Transition>
          </router-view>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';
@use '@/01-app/assets/mixins';

.app-layout {
  position: relative;
  height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  flex-direction: column;
  gap: var(--layout-gap);
  padding: var(--layout-padding);
  overflow: hidden;

  &::before {
    @include mixins.grid-backdrop(radial-gradient(ellipse at 50% 0%, black 0%, transparent 80%));

    z-index: var(--z-background);
  }

  &__header {
    position: relative;
    z-index: var(--z-header);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: var(--space-12);
  }

  &__project {
    min-width: var(--sidebar-width);
  }

  &__body {
    position: relative;
    z-index: var(--z-content);
    flex: 1;
    display: flex;
    gap: var(--layout-gap);
    min-height: 0;
  }

  &__content {
    flex: 1;
    min-height: 0;
    background: var(--login-bg-form);
    border-radius: var(--radius-card);
    box-shadow: var(--elevation-card);
    overflow-y: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__content-inner {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  @include breakpoints.media-under-lg {
    --layout-padding: var(--space-16);
    --layout-gap: var(--space-16);

    &__header {
      justify-content: center;
    }

    &__body {
      flex-direction: column-reverse;
    }
  }
}
</style>
