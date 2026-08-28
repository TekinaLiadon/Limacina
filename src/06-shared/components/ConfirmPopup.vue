<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  message: string
  visible: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-popup">
      <div v-if="visible" class="confirm-popup-overlay" @click.self="emit('cancel')">
        <div class="confirm-popup">
          <p class="confirm-popup__message">{{ message }}</p>
          <div class="confirm-popup__actions">
            <Button class="btn-primary confirm-popup__btn" @click="emit('confirm')">
              Да
            </Button>
            <Button
              class="btn-quiet confirm-popup__btn"
              @click="emit('cancel')"
            >
              Нет
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.confirm-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.confirm-popup {
  background: var(--login-bg-form);
  border-radius: var(--radius-modal);
  padding: var(--card-padding);
  box-shadow: var(--elevation-modal);
  max-width: 360px;
  width: 100%;

  &__message {
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-regular);
    color: var(--login-text-secondary);
    margin: 0 0 var(--space-24) 0;
    text-align: center;
  }

  &__actions {
    display: flex;
    gap: var(--space-8);
  }

  &__btn {
    flex: 1;
    min-height: 40px;
  }
}

.confirm-popup-enter-active,
.confirm-popup-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-popup-enter-from,
.confirm-popup-leave-to {
  opacity: 0;
}
</style>
