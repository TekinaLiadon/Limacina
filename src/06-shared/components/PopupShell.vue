<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useFocusTrap } from '@/06-shared/utils/useFocusTrap'

const props = defineProps<{
  visible: boolean
  persistent?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  panelClass?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const panelRef = ref<HTMLDivElement | null>(null)

useFocusTrap(panelRef, (): boolean => props.visible)

function handleKeydown(e: KeyboardEvent): void {
  if (props.visible && e.key === 'Escape') emit('close')
}

onMounted((): void => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount((): void => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div
        v-if="persistent || visible"
        v-show="!persistent || visible"
        class="popup-shell__overlay"
        @click.self="emit('close')"
      >
        <div
          ref="panelRef"
          class="popup-shell__panel popup-panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
          :aria-label="ariaLabel"
          :aria-labelledby="ariaLabelledBy"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.popup-shell__overlay {
  @include mixins.popup-overlay;
}
</style>
