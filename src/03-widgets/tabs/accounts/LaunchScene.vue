<script setup lang="ts">
import { computed } from 'vue'
import AuthTabsWidget from './AuthTabsWidget.vue'
import Identicon from './Identicon.vue'
import LaunchSessionScene from './LaunchSessionScene.vue'
import LaunchProgressScene from './LaunchProgressScene.vue'
import LaunchActionsScene from './LaunchActionsScene.vue'
import type { AuthSubTab, StepProgressItem } from '@/05-entities'

const props = withDefaults(defineProps<{
  activeTab: AuthSubTab
  username: string
  selectedUsername: string
  hasSession: boolean
  logins: string[]
  isLoading: boolean
  isLaunching: boolean
  isCancelPending: boolean
  isInterrupted?: boolean
  progress: number
  steps: StepProgressItem[]
  sessionUsername?: string | null
  serverOffline?: boolean
  loginError?: string
  selectError?: string
  loginsError?: string
  showAuth: boolean
  showBack: boolean
}>(), {
  sessionUsername: null,
  serverOffline: false,
  loginError: '',
  selectError: '',
  loginsError: '',
  isInterrupted: false,
})

const emit = defineEmits<{
  'update:activeTab': [tab: AuthSubTab]
  'launch': []
  'select': [username: string]
  'delete-account': [username: string]
  'show-login': []
  'retry-logins': []
  'cancel': []
  'auth-back': []
  'minimize': []
}>()

const accountLabel = computed((): string =>
  props.hasSession ? 'Текущий аккаунт' : 'Выберите аккаунт',
)

const displayName = computed((): string => props.hasSession ? props.username : 'Не выбрано')
</script>

<template>
  <div class="launch-scene">
    <div v-if="showAuth" class="launch-scene__auth">
      <AuthTabsWidget
        :active-tab="activeTab"
        :show-back="showBack"
        @update:active-tab="emit('update:activeTab', $event)"
        @back="emit('auth-back')"
      />
    </div>

    <LaunchSessionScene
      v-else-if="sessionUsername"
      :session-username="sessionUsername"
      @minimize="emit('minimize')"
    />

    <template v-else>
      <div class="launch-scene__account">
        <Identicon v-if="hasSession" :username="username" :size="64" />
        <div class="launch-scene__account-info">
          <span class="eyebrow">{{ accountLabel }}</span>
          <p class="launch-scene__name">{{ displayName }}</p>
        </div>
      </div>

      <div v-if="selectError || (!isLaunching && loginError)" class="launch-scene__error">
        {{ selectError || loginError }}
      </div>

      <Transition name="launch-scene-swap" mode="out-in">
        <LaunchProgressScene
          v-if="isLaunching"
          key="progress"
          :progress="progress"
          :steps="steps"
          :is-interrupted="isInterrupted ?? false"
          :is-cancel-pending="isCancelPending"
          @cancel="emit('cancel')"
        />
        <LaunchActionsScene
          v-else
          key="actions"
          :is-loading="isLoading"
          :logins="logins"
          :selected-username="selectedUsername"
          :has-session="hasSession"
          :logins-error="loginsError ?? ''"
          :server-offline="serverOffline ?? false"
          @launch="emit('launch')"
          @select="emit('select', $event)"
          @delete-account="emit('delete-account', $event)"
          @show-login="emit('show-login')"
          @retry-logins="emit('retry-logins')"
        />
      </Transition>
    </template>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.launch-scene {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  &__auth {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  &__session {
    display: flex;
    align-items: center;
    gap: var(--space-16);
    margin-bottom: var(--title-gap);
    padding: var(--space-16);
    border-radius: var(--radius-card);
    background: var(--accent-subtle);
  }

  &__session-dot {
    width: var(--indicator-dot-size-lg);
    height: var(--indicator-dot-size-lg);
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    flex-shrink: 0;
  }

  &__account {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-16);
    margin-bottom: var(--title-gap);
  }

  &__account-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  &__name {
    font-family: var(--font-display);
    font-size: var(--text-heading-sm);
    line-height: var(--leading-heading);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-heading);
    color: var(--login-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__switcher {
    position: relative;
  }

  &__switcher-btn {
    justify-content: space-between;
  }

  &__chevron {
    flex-shrink: 0;
    transition: transform var(--duration-base) var(--ease-out);

    &--open {
      transform: rotate(180deg);
    }
  }

  &__menu {
    position: absolute;
    top: calc(100% + var(--space-4));
    left: 0;
    right: 0;
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--login-bg-form);
    border-radius: var(--radius-input);
    box-shadow: var(--elevation-modal);
    overflow-y: auto;
    transform-origin: top center;
  }

  &__switcher--up &__menu {
    top: auto;
    bottom: calc(100% + var(--space-4));
    transform-origin: bottom center;
  }

  &__menu-error {
    padding: var(--space-8) var(--space-12);
    font-size: var(--text-caption);
    color: var(--error);
  }

  &__menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    padding: var(--space-8) var(--space-12);
    border: none;
    border-radius: var(--radius-button);
    background: transparent;
    font-family: inherit;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &--active {
      color: var(--login-text-primary);
      background: var(--accent-subtle);
    }
  }

  &__menu-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-medium);
  }

  &__menu-check {
    width: var(--menu-action-size);
    height: var(--menu-action-size);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-circle);
    background: var(--accent-active-bg);
    color: var(--accent-text);
    flex-shrink: 0;
  }

  &__menu-delete {
    width: var(--menu-action-size);
    height: var(--menu-action-size);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-circle);
    background: transparent;
    color: var(--login-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);
    flex-shrink: 0;

    &:hover:not(:disabled) {
      background: var(--delete-bg);
      color: var(--delete-text);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__menu-plus {
    width: var(--menu-action-size);
    height: var(--menu-action-size);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-circle);
    box-shadow: var(--elevation-inset);
    color: var(--login-text-muted);
    flex-shrink: 0;
  }

  &__progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }

  &__progress-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__hint {
    margin: 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-muted);
  }

  &__error {
    @include mixins.error-box;

    margin-bottom: var(--space-16);
  }
}

.launch-scene-swap-enter-active {
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
}

.launch-scene-swap-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.launch-scene-swap-enter-from {
  opacity: 0;
  transform: translateY(var(--space-8));
}

.launch-scene-swap-leave-to {
  opacity: 0;
}

.launch-scene-menu-enter-active,
.launch-scene-menu-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.launch-scene-menu-enter-from,
.launch-scene-menu-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
