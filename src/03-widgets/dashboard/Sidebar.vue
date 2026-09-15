<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconButton } from '@/06-shared'
import { useSettingsNav } from '@/04-features'
import type { TabItem, TabKey } from '@/03-widgets/types'

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
        :class="{
          'sidebar__item--active': activeTab === item.key,
          'sidebar__item--disabled': item.disabled,
        }"
        @click="!item.disabled && emit('navigate', item.key)"
      >
        <IconButton tag="span" :icon="item.icon" />
        <span class="sidebar__label">{{ item.label }}</span>
      </button>

      <div class="sidebar__group">
        <button
          class="sidebar__item"
          :class="{ 'sidebar__item--active': activeTab === 'settings' }"
          type="button"
          @click="toggleSettings"
        >
          <IconButton tag="span" icon="settings" />
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

        <div v-if="isSettingsExpanded" class="sidebar__subitems">
          <button
            v-for="item in settingsItems"
            :key="item.key"
            type="button"
            class="sidebar__subitem"
            :class="{
              'sidebar__subitem--active': activeTab === 'settings' && settingsSubTab === item.routeName,
              'sidebar__subitem--locked': !item.isAvailable,
            }"
            :title="item.isAvailable ? undefined : item.reason"
            @click="item.isAvailable && emit('navigate-settings', item.routeName)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <button
        v-if="showDebug"
        class="sidebar__item"
        :class="{ 'sidebar__item--active': activeTab === 'debug' }"
        type="button"
        @click="emit('navigate', 'debug')"
      >
        <IconButton tag="span" icon="settings" />
        <span class="sidebar__label">Дебаг</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

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
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-12) var(--space-4) var(--space-4);
    border-radius: var(--radius-button);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    text-align: left;
    width: 100%;

    &:hover:not(&--disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      color: var(--login-text-primary);
      background: var(--surface-light);
      box-shadow: var(--elevation-inset);
    }

    &--disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .icon-btn {
      width: var(--control-height-sm);
      height: var(--control-height-sm);
      flex-shrink: 0;
      background-color: transparent;
      box-shadow: none;

      &__icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    &:hover:not(&--disabled) .icon-btn {
      background-color: var(--surface-hover);
      box-shadow: var(--elevation-inset);

      .icon-btn__icon {
        color: var(--login-text-primary);
      }
    }

    &--active .icon-btn {
      background-color: var(--accent-active-bg);
      box-shadow: var(--elevation-inset);

      .icon-btn__icon {
        color: var(--accent-text);
      }
    }
  }

  &__chevron {
    margin-left: auto;
    flex-shrink: 0;
    transition: transform 0.2s ease;

    &--open {
      transform: rotate(180deg);
    }
  }

  &__subitems {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-left: var(--space-16);
  }

  &__subitem {
    display: block;
    width: 100%;
    padding: var(--space-4) var(--space-12);
    border: none;
    border-radius: var(--radius-button);
    background: transparent;
    font-family: inherit;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    text-align: left;
    color: var(--login-text-secondary);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;

    &:hover:not(&--locked) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      color: var(--login-text-primary);
      background: var(--surface-light);
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
