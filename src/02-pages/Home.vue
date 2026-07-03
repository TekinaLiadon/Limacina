<script setup lang="ts">
import {computed, ref, watch, nextTick} from 'vue'
import {useCoreStore} from '@/05-entities'
import {Sidebar, LoginTab, RegisterTab, AddServerTab, SettingsTab, DebugTab} from '@/03-widgets'
import {Dropdown} from '@/06-shared'
import type {DropdownOption} from '@/06-shared/types'
import type {TabKey} from '@/05-entities/core/types'
import anime from 'animejs'

const coreStore = useCoreStore()
const tabRef = ref<HTMLDivElement | null>(null)
const currentTab = ref<TabKey>('login')

const projectOptions = computed((): DropdownOption[] => {
  return coreStore.projects.map((p) => ({title: p, value: p}))
})

const tabComponent = computed(() => {
  const map: Record<TabKey, typeof LoginTab> = {
    'login': LoginTab,
    'add-server': AddServerTab,
    'register': RegisterTab,
    'settings': SettingsTab,
    'debug': DebugTab,
  }
  return map[currentTab.value]
})

watch(() => coreStore.activeTab, (newTab: TabKey) => {
  if (newTab === currentTab.value) return
  if (!tabRef.value) {
    currentTab.value = newTab
    return;
  }

  transitionAnimation(newTab)
})

const transitionAnimation = (newTab: TabKey) => {
  anime({
    targets: tabRef.value,
    opacity: [1, 0],
    translateX: [0, -12],
    duration: 150,
    easing: 'easeInQuad',
    complete: () => {
      currentTab.value = newTab
      nextTick(() => {
        if (!tabRef.value) return

        anime({
          targets: tabRef.value,
          opacity: [0, 1],
          translateX: [12, 0],
          duration: 200,
          easing: 'easeOutQuad',
        })
      })
    },
  })
}
</script>

<template>
  <div class="home">
    <div class="home__header">
      <div class="home__project">
        <Dropdown
            :options="projectOptions"
            v-model="coreStore.currentProject"
            :width="'220px'"
        />
      </div>
    </div>

    <div class="home__body">
      <Sidebar/>

      <div class="home__tab-content">
        <div ref="tabRef" class="home__tab-inner">
          <keep-alive>
            <component :is="tabComponent"/>
          </keep-alive>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.home {
  height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  &__project {
    min-width: 220px;
  }

  &__body {
    flex: 1;
    display: flex;
    gap: 24px;
    min-height: 0;
  }

  &__tab-content {
    flex: 1;
    min-height: 0;
    background: var(--login-bg-form);
    border: 1px solid var(--login-border);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  &__tab-inner {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  @include breakpoints.media-under-lg {
    padding: 16px;
    padding-bottom: 100px;

    &__header {
      justify-content: center;
    }

    &__body {
      flex-direction: column;
    }
  }
}
</style>
