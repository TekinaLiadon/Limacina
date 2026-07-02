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
  top: 24px;
  right: 24px;
  z-index: 2000;
  background: var(--login-bg-form);
  border: 1px solid var(--login-border);
  border-radius: 12px;
  padding: 14px 24px;
  box-shadow: 0 8px 24px var(--login-shadow-strong);
  max-width: 360px;

  &__text {
    font-size: 14px;
    font-weight: 500;
    color: var(--green);
    line-height: 130%;
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
