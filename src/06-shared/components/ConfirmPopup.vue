<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button, useFocusTrap } from '@/06-shared'

const props = defineProps<{
  message: string
  visible: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const popupRef = ref<HTMLDivElement | null>(null)

useFocusTrap(popupRef, (): boolean => props.visible)

function handleKeydown(e: KeyboardEvent): void {
  if (props.visible && e.key === 'Escape') emit('cancel')
}

watch((): boolean => props.visible, (visible) => {
  if (visible) window.addEventListener('keydown', handleKeydown)
  else window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="confirm-popup-overlay" @click.self="emit('cancel')">
        <div ref="popupRef" class="confirm-popup popup-panel" role="dialog" aria-modal="true">
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
  z-index: var(--z-popup);
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
    min-height: var(--control-height);
  }
}
</style>
