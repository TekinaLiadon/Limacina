<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button, Skeleton, useDropdownPanel } from '@/06-shared'
import Identicon from './Identicon.vue'

const props = defineProps<{
  isLoading: boolean
  logins: string[]
  selectedUsername: string
  hasSession: boolean
  loginsError: string
  serverOffline: boolean
}>()

const emit = defineEmits<{
  'launch': []
  'select': [username: string]
  'delete-account': [username: string]
  'show-login': []
  'retry-logins': []
}>()

const switcherRef = ref<HTMLDivElement | null>(null)
const { shown: menuOpen, openUp, maxHeight, panelRef, toggle: toggleMenu, close: closeMenu } = useDropdownPanel(
  switcherRef,
  (): boolean => props.isLoading,
  (): number => 6,
)

const menuItems = (): HTMLButtonElement[] =>
  Array.from(panelRef.value?.querySelectorAll<HTMLButtonElement>('.launch-scene__menu-item') ?? [])

const focusTrigger = (): void => {
  switcherRef.value?.querySelector<HTMLButtonElement>('.launch-scene__switcher-btn')?.focus()
}

const moveMenuFocus = (delta: number): void => {
  const items = menuItems()
  if (items.length === 0) return
  const currentIndex = items.findIndex((item) => item === document.activeElement)
  const nextIndex = (currentIndex + delta + items.length) % items.length
  items[nextIndex]?.focus()
}

const handleMenuKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveMenuFocus(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveMenuFocus(-1)
  }
}

watch(menuOpen, (open: boolean): void => {
  if (open) {
    void nextTick((): void => {
      const items = menuItems()
      const active = items.find((item) => item.classList.contains('launch-scene__menu-item--active'))
      ;(active ?? items[0])?.focus({ preventScroll: true })
    })
    return
  }
  const panel = panelRef.value
  if (panel && panel.contains(document.activeElement)) focusTrigger()
})

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
  <div class="launch-scene__actions">
    <template v-if="loginsError && !hasSession">
      <div class="launch-scene__error">
        Не удалось загрузить список аккаунтов: {{ loginsError }}
      </div>
      <Button
        class="btn-secondary btn-block"
        :is-disabled="isLoading"
        @click="emit('retry-logins')"
      >
        Повторить
      </Button>
    </template>
    <div v-if="serverOffline" class="launch-scene__error">
      Сервер лаунчера недоступен — запуск заблокирован, ждём восстановления соединения
    </div>
    <Button
      class="btn-primary btn-lg btn-block"
      :is-disabled="!hasSession || serverOffline"
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
        :aria-expanded="menuOpen"
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
        <div
          v-if="menuOpen"
          ref="panelRef"
          class="launch-scene__menu"
          :style="{ maxHeight }"
          role="group"
          aria-label="Аккаунты"
          @keydown="handleMenuKeydown"
        >
          <template v-if="isLoading && logins.length === 0">
            <Skeleton
              v-for="index in 3"
              :key="`skeleton-${index}`"
              variant="list-item"
              icon-shape="circle"
              :lines="1"
              flat
              size="sm"
            />
          </template>
          <template v-else>
            <div v-if="loginsError" class="launch-scene__menu-error">
              Не удалось загрузить список аккаунтов
            </div>
            <div
              v-for="login in logins"
              :key="login"
              class="launch-scene__menu-row"
            >
              <button
                type="button"
                class="launch-scene__menu-item"
                :class="{ 'launch-scene__menu-item--active': login === selectedUsername }"
                @click="selectAccount(login)"
              >
                <Identicon :username="login" :size="28" />
                <span class="launch-scene__menu-name">{{ login }}</span>
                <span v-if="login === selectedUsername" class="launch-scene__menu-check">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                    <path d="M4 10L8 14L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </button>
              <button
                v-if="login !== selectedUsername"
                type="button"
                class="launch-scene__menu-delete"
                :disabled="isLoading"
                aria-label="Удалить аккаунт"
                @click="emit('delete-account', login)"
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
</template>

<style lang="scss">
.launch-scene {
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

  &__menu-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  &__menu-row &__menu-item {
    flex: 1;
    min-width: 0;
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
