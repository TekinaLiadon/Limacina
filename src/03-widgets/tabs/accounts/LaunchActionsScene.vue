<script setup lang="ts">
import { ref } from 'vue'
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
        <div v-if="menuOpen" ref="panelRef" class="launch-scene__menu" :style="{ maxHeight }">
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
              class="launch-scene__menu-item"
              :class="{ 'launch-scene__menu-item--active': login === selectedUsername }"
              role="button"
              tabindex="0"
              @click="selectAccount(login)"
              @keydown.enter="selectAccount(login)"
              @keydown.space.prevent="selectAccount(login)"
            >
              <Identicon :username="login" :size="28" />
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
</template>
