<script setup lang="ts">
import {onMounted, onUnmounted, watch} from 'vue'

const props = defineProps<{
  message: string
  visible: boolean
  duration?: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

let timer: ReturnType<typeof setTimeout> | null = null

const startTimer = (): void => {
  clearTimer()
  timer = setTimeout(() => {
    emit('update:visible', false)
  }, props.duration ?? 3000)
}

const clearTimer = (): void => {
  if (!timer) return

  clearTimeout(timer)
  timer = null
}

watch(() => props.visible, (val: boolean) => {
  if (val) startTimer()
  else clearTimer()
})

onMounted((): void => {
  if (props.visible) startTimer()
})

onUnmounted((): void => {
  clearTimer()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="push-notification">
      <div v-if="visible" class="push-notification">
        <span class="push-notification__text">{{ message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.push-notification {
  position: fixed;
  top: var(--space-24);
  right: var(--space-24);
  z-index: 2000;
  background: var(--login-bg-form);
  border-radius: var(--radius-card);
  padding: var(--space-16) var(--space-20);
  box-shadow: var(--elevation-modal);
  max-width: 360px;

  &__text {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }
}

.push-notification-enter-active,
.push-notification-leave-active {
  transition: all 0.3s ease;
}

.push-notification-enter-from,
.push-notification-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
