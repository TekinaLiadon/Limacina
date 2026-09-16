<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, ProgressBar, Skeleton, useDropdownPanel } from '@/06-shared'
import AuthTabsWidget from './AuthTabsWidget.vue'
import StepProgress from '../login/StepProgress.vue'
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
  showAuth: boolean
  showBack: boolean
}>(), {
  sessionUsername: null,
  serverOffline: false,
  loginError: '',
  selectError: '',
  isInterrupted: false,
})

const emit = defineEmits<{
  'update:activeTab': [tab: AuthSubTab]
  'launch': []
  'select': [username: string]
  'delete-account': [username: string]
  'show-login': []
  'cancel': []
  'auth-back': []
  'minimize': []
}>()

const switcherRef = ref<HTMLDivElement | null>(null)
const { shown: menuOpen, openUp, maxHeight, toggle: toggleMenu, close: closeMenu } = useDropdownPanel(
  switcherRef,
  (): boolean => props.isLoading,
  (): number => 6,
)

const avatarLetter = computed((): string => props.username.charAt(0).toUpperCase())

const accountLabel = computed((): string =>
  props.hasSession ? 'Текущий аккаунт' : 'Выберите аккаунт',
)

const isLaunchingGame = computed((): boolean => {
  const last = props.steps[props.steps.length - 1]
  return last?.status === 'active'
})

const progressLabel = computed((): string =>
  isLaunchingGame.value ? 'Запуск игры' : 'Подготовка запуска',
)

const selectAccount = (username: string): void => {
  if (props.isLoading || username === props.selectedUsername) return
  closeMenu()
  emit('select', username)
}

const openLoginForm = (): void => {
  closeMenu()
  emit('show-login')
}
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

    <template v-else>
      <template v-if="sessionUsername">
        <div class="launch-scene__session">
          <span class="launch-scene__session-dot"></span>
          <div class="launch-scene__account-info">
            <span class="eyebrow">Игра запущена</span>
            <p class="launch-scene__name">{{ sessionUsername }}</p>
          </div>
        </div>
        <p class="launch-scene__hint">
          Лаунчер можно свернуть в трей — игра продолжит работать
        </p>
        <div class="launch-scene__actions">
          <Button class="btn-secondary btn-lg btn-block" @click="emit('minimize')">
            Свернуть в трей
          </Button>
        </div>
      </template>

      <template v-else>
        <div class="launch-scene__account">
          <span class="launch-scene__avatar">{{ avatarLetter }}</span>
          <div class="launch-scene__account-info">
            <span class="eyebrow">{{ accountLabel }}</span>
            <p class="launch-scene__name">{{ username }}</p>
          </div>
        </div>

        <div v-if="selectError || (!isLaunching && loginError)" class="launch-scene__error">
          {{ selectError || loginError }}
        </div>

        <Transition name="launch-scene-swap" mode="out-in">
          <div v-if="isLaunching" key="progress" class="launch-scene__progress">
            <div class="launch-scene__progress-header">
              <span class="eyebrow">{{ progressLabel }}</span>
              <ProgressBar :progress="progress" />
            </div>

            <StepProgress :steps="steps" hide-completed />

            <p v-if="isInterrupted" class="launch-scene__hint">
              Запуск был прерван перезагрузкой окна — отмените и запустите заново
            </p>

            <p v-if="isLaunchingGame" class="launch-scene__hint">
              Игра запускается — окно откроется автоматически
            </p>

            <Button
              class="btn-quiet btn-block"
              :is-disabled="isCancelPending"
              @click="emit('cancel')"
            >
              {{ isCancelPending ? 'Завершаем текущий шаг…' : 'Отменить запуск' }}
            </Button>
          </div>

          <div v-else key="actions" class="launch-scene__actions">
            <div v-if="serverOffline ?? false" class="launch-scene__error">
              Сервер лаунчера недоступен — запуск заблокирован, ждём восстановления соединения
            </div>
            <Button
              class="btn-primary btn-lg btn-block"
              :is-disabled="!hasSession || (serverOffline ?? false)"
              @click="emit('launch')"
            >
              Играть
            </Button>

          <div
            ref="switcherRef"
            class="launch-scene__switcher"
            :class="{ 'launch-scene__switcher--up': openUp }"
          >
            <Button
              class="btn-secondary btn-lg btn-block launch-scene__switcher-btn"
              @click="toggleMenu"
            >
              <span>Сменить аккаунт</span>
              <svg
                class="launch-scene__chevron"
                :class="{ 'launch-scene__chevron--open': menuOpen }"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </Button>

            <Transition name="launch-scene-menu">
              <div v-if="menuOpen" class="launch-scene__menu" :style="{ maxHeight }">
                <template v-if="isLoading && logins.length === 0">
                  <Skeleton
                    v-for="index in 3"
                    :key="`skeleton-${index}`"
                    class="launch-scene__menu-skeleton"
                    variant="list-item"
                    icon-shape="circle"
                    :lines="1"
                  />
                </template>
                <template v-else>
                <div
                  v-for="login in logins"
                  :key="login"
                  class="launch-scene__menu-item"
                  :class="{ 'launch-scene__menu-item--active': login === selectedUsername }"
                  role="button"
                  tabindex="0"
                  @click="selectAccount(login)"
                  @keydown.enter="selectAccount(login)"
                >
                  <span class="launch-scene__menu-avatar">{{ login.charAt(0).toUpperCase() }}</span>
                  <span class="launch-scene__menu-name">{{ login }}</span>
                  <span v-if="login === selectedUsername" class="launch-scene__menu-check">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M4 10L8 14L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                  <button
                    v-else
                    type="button"
                    class="launch-scene__menu-delete"
                    :disabled="isLoading"
                    aria-label="Удалить аккаунт"
                    @click.stop="emit('delete-account', login)"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>

                <button
                  type="button"
                  class="launch-scene__menu-item launch-scene__menu-item--new"
                  @click="openLoginForm"
                >
                  <span class="launch-scene__menu-plus">+</span>
                  Ввести новый
                </button>
                </template>
              </div>
            </Transition>
          </div>
        </div>
        </Transition>
      </template>
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
    width: 12px;
    height: 12px;
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

  &__avatar {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-size: var(--text-heading-sm);
    font-weight: var(--weight-medium);
    line-height: 1;
    flex-shrink: 0;
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

  &__menu-skeleton {
    gap: var(--space-8);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-button);
    background: transparent;
    box-shadow: none;

    &.skeleton .skeleton__icon {
      width: 28px;
      height: 28px;
    }

    &.skeleton .skeleton__body {
      gap: 0;
    }

    &.skeleton .skeleton__line {
      height: calc(var(--text-body-sm) * var(--leading-body-sm));
    }
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

  &__menu-avatar {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    line-height: 1;
    flex-shrink: 0;
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
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-circle);
    background: var(--accent-active-bg);
    color: var(--accent-text);
    flex-shrink: 0;
  }

  &__menu-delete {
    width: 28px;
    height: 28px;
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
    width: 28px;
    height: 28px;
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
