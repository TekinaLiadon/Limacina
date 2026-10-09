<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon, Tooltip } from '@/06-shared'
import { useSettingsNav } from '@/04-features'
import type { TabItem } from '@/03-widgets/types'
import type { TabKey } from '@/05-entities'

const props = defineProps<{
  activeTab: TabKey
  settingsSubTab?: string
  showDebug?: boolean
  showMods?: boolean
}>()

const emit = defineEmits<{
  navigate: [key: TabKey]
  'navigate-settings': [routeName: string]
}>()

const { items: settingsItems } = useSettingsNav()

const isSettingsExpanded = ref<boolean>(false)

watch((): TabKey => props.activeTab, (tab) => {
  if (tab === 'settings') isSettingsExpanded.value = true
}, { immediate: true })

const toggleSettings = (): void => {
  if (props.activeTab !== 'settings') {
    isSettingsExpanded.value = true
    emit('navigate', 'settings')
    return
  }
  isSettingsExpanded.value = !isSettingsExpanded.value
}

const items = computed<TabItem[]>((): TabItem[] => {
  const base: TabItem[] = [
    { key: 'accounts', icon: 'home', label: 'Аккаунты' },
    { key: 'add-profile', icon: 'referals', label: 'Добавить профиль' },
  ]
  if (props.showMods === true) {
    base.push({ key: 'mods', icon: 'puzzle', label: 'Моды' })
  }
  return base
})
</script>

<template>
  <div class="sidebar">
    <div class="sidebar__tabs">
      <button
        v-for="item in items"
        :key="item.key"
        class="sidebar__item"
        :class="{ 'sidebar__item--active': activeTab === item.key }"
        @click="emit('navigate', item.key)"
      >
        <span class="sidebar__icon"><Icon :type="item.icon" /></span>
        <span class="sidebar__label">{{ item.label }}</span>
      </button>

      <div class="sidebar__group">
        <button
          class="sidebar__item"
          :class="{ 'sidebar__item--active': activeTab === 'settings' }"
          type="button"
          :aria-expanded="isSettingsExpanded"
          @click="toggleSettings"
        >
          <span class="sidebar__icon"><Icon type="settings" /></span>
          <span class="sidebar__label">Настройки</span>
          <svg
            class="sidebar__chevron"
            :class="{ 'sidebar__chevron--open': isSettingsExpanded }"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <div class="sidebar__subitems" :class="{ 'sidebar__subitems--closed': !isSettingsExpanded }">
          <div class="sidebar__subitems-inner">
            <Tooltip
              v-for="item in settingsItems"
              :key="item.key"
              class="sidebar__subitem-tooltip"
              :content="item.reason"
              :disabled="item.isAvailable"
            >
              <button
                type="button"
                class="sidebar__subitem"
                :class="{
                  'sidebar__subitem--active': activeTab === 'settings' && settingsSubTab === item.routeName,
                  'sidebar__subitem--locked': !item.isAvailable,
                }"
                @click="item.isAvailable && emit('navigate-settings', item.routeName)"
              >
                {{ item.label }}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <button
        v-if="showDebug"
        class="sidebar__item"
        :class="{ 'sidebar__item--active': activeTab === 'debug' }"
        type="button"
        @click="emit('navigate', 'debug')"
      >
        <span class="sidebar__icon"><Icon type="settings" /></span>
        <span class="sidebar__label">Дебаг</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';
@use '@/01-app/assets/mixins';

%sidebar-link {
  width: 100%;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--login-text-secondary);
  font-family: inherit;
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
  font-weight: var(--weight-medium);
  text-align: left;
  cursor: pointer;
}

%sidebar-link-state {
  color: var(--login-text-primary);
  background: var(--surface-light);
}

.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--sidebar-width);
  background: var(--login-bg-form);
  border-radius: var(--radius-card);
  box-shadow: var(--elevation-card);
  padding: var(--panel-padding-y) var(--panel-padding-x);

  &__tabs {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1;
  }

  &__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__item {
    @extend %sidebar-link;

    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-12) var(--space-4) var(--space-4);
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out);

    &:hover {
      @extend %sidebar-link-state;
    }

    &--active {
      @extend %sidebar-link-state;

      box-shadow: var(--elevation-inset);
    }

    .sidebar__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: var(--control-height-sm);
      height: var(--control-height-sm);
      border-radius: var(--radius-circle);
      cursor: pointer;
      transition: background-color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out), transform var(--duration-fast) var(--ease-out);

      .icon {
        font-size: var(--icon-size);
        color: var(--login-text-secondary);
      }
    }

    &:hover .sidebar__icon {
      background-color: var(--surface-hover);
      box-shadow: var(--elevation-inset);
      transform: translateX(var(--space-2));

      .icon {
        color: var(--login-text-primary);
      }
    }

    &--active .sidebar__icon {
      background-color: var(--accent-active-bg);
      box-shadow: var(--elevation-inset);

      .icon {
        color: var(--accent-text);
      }
    }
  }

  &__chevron {
    margin-left: auto;
    flex-shrink: 0;
    transition: transform var(--duration-base) var(--ease-out);

    &--open {
      transform: rotate(180deg);
    }
  }

  &__subitems {
    @include mixins.collapsible;
  }

  &__subitems-inner {
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-left: var(--space-16);
  }

  &__subitem-tooltip {
    display: block;
    width: 100%;

    .sidebar__subitem {
      width: 100%;
    }
  }

  &__subitem {
    @extend %sidebar-link;

    display: block;
    padding: var(--space-4) var(--space-12);
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    &:hover:not(&--locked) {
      @extend %sidebar-link-state;
    }

    &--active {
      @extend %sidebar-link-state;

      box-shadow: var(--elevation-inset);
    }

    &--locked {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @include breakpoints.media-under-lg {
    width: 100%;
    flex-direction: row;

    &__tabs {
      flex-direction: row;
      gap: var(--space-4);
      overflow-x: auto;
    }

    &__group {
      flex: 1 1 0;
      min-width: 0;
    }

    &__subitems {
      display: none;
    }

    &__item {
      flex: 1 1 0;
      min-width: 0;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-8) var(--space-12);
      border-radius: var(--radius-card);
    }

    &__chevron {
      display: none;
    }

    &__label {
      font-size: var(--text-caption);
    }
  }

  @include breakpoints.media-under-sm {
    &__label {
      display: none;
    }
  }
}
</style>
