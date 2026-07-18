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
            <Button class="btn-yellow confirm-popup__btn" @click="emit('confirm')">
              Да
            </Button>
            <Button
              class="btn-yellow confirm-popup__btn confirm-popup__btn--cancel"
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
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.confirm-popup {
  background: var(--login-bg-form);
  border: 1px solid var(--login-border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px var(--login-shadow-strong);
  max-width: 360px;
  width: 100%;

  &__message {
    font-size: 16px;
    font-weight: 500;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-align: center;
    line-height: 140%;
  }

  &__actions {
    display: flex;
    gap: 10px;
  }

  &__btn {
    flex: 1;
    height: 44px;
    font-size: 14px;
    font-weight: 600;

    &--cancel {
      background: transparent;
      border: 1px solid var(--login-border);
      color: var(--login-text-primary);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }
    }
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
