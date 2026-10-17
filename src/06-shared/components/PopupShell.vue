<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { pushEscapeHandler } from '@/06-shared/utils/escapeStack'
import { useFocusTrap } from '@/06-shared/utils/useFocusTrap'

const props = defineProps<{
  visible: boolean
  persistent?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  panelClass?: string
  overlayClass?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const panelRef = ref<HTMLDivElement | null>(null)

useFocusTrap(panelRef, (): boolean => props.visible)

let unregisterEscape: (() => void) | null = null

watch(
  (): boolean => props.visible,
  (visible: boolean): void => {
    if (visible) {
      unregisterEscape = pushEscapeHandler((): void => emit('close'))
      return
    }
    unregisterEscape?.()
    unregisterEscape = null
  },
  { immediate: true },
)

onBeforeUnmount((): void => {
  unregisterEscape?.()
  unregisterEscape = null
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div
        v-if="persistent || visible"
        v-show="!persistent || visible"
        class="popup-shell__overlay"
        :class="overlayClass"
        @click.self="emit('close')"
      >
        <div
          ref="panelRef"
          class="popup-shell__panel popup-panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
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
