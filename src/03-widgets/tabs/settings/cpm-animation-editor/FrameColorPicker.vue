<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDropdownPanel } from '@/06-shared'
import { FRAME_COLOR_OPTIONS, frameColorLabel } from '@/04-features'

const props = withDefaults(defineProps<{
  color: string | null
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  select: [color: string | null]
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const { shown, panelRef, toggle, close } = useDropdownPanel(
  rootRef,
  (): boolean => props.disabled,
  (): number => 1,
)

const label = computed((): string => {
  const name = frameColorLabel(props.color)
  return name === null ? 'Цвет кадра не задан' : `Цвет кадра: ${name}`
})

const choose = (color: string | null): void => {
  emit('select', color)
  close()
}
</script>

<template>
  <div ref="rootRef" class="cpm-frame-color">
    <button
      type="button"
      class="cpm-frame-color__trigger"
      :class="{ 'cpm-frame-color__trigger--empty': color === null }"
      :style="color === null ? undefined : { backgroundColor: color }"
      :aria-label="label"
      :aria-expanded="shown"
      :disabled="disabled"
      @click.stop="toggle"
    />

    <div
      v-if="shown"
      ref="panelRef"
      class="cpm-frame-color__panel"
      role="group"
      aria-label="Цвет кадра"
    >
      <button
        v-for="option in FRAME_COLOR_OPTIONS"
        :key="option.value"
        type="button"
        class="cpm-frame-color__swatch"
        :class="{ 'cpm-frame-color__swatch--selected': color === option.value }"
        :style="{ backgroundColor: option.value }"
        :aria-label="option.label"
        :aria-pressed="color === option.value"
        @click.stop="choose(option.value)"
      />
      <button
        type="button"
        class="cpm-frame-color__swatch cpm-frame-color__swatch--clear"
        aria-label="Без цвета"
        :aria-pressed="color === null"
        @click.stop="choose(null)"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-frame-color {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;

  &__trigger {
    position: relative;
    width: var(--space-20);
    height: var(--space-20);
    padding: 0;
    border: 1px solid var(--grid-line);
    border-radius: var(--radius-circle);
    background: var(--surface-light);
    cursor: pointer;
    transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);

    &:hover:not(:disabled) {
      transform: scale(1.1);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &--empty::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 60%;
      height: 1px;
      background: var(--login-text-muted);
      transform: translate(-50%, -50%) rotate(45deg);
    }
  }

  &__panel {
    @include mixins.options-panel;

    top: auto;
    right: 0;
    bottom: calc(100% + var(--space-4));
    left: auto;
    width: max-content;
    flex-direction: row;
    overflow: visible;
    padding: var(--space-8);
  }

  &__swatch {
    width: var(--space-20);
    height: var(--space-20);
    padding: 0;
    border: 1px solid var(--grid-line);
    border-radius: var(--radius-badge);
    cursor: pointer;

    &:hover {
      transform: scale(1.1);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &--selected {
      outline: 1px solid var(--accent-fill);
      outline-offset: 1px;
    }

    &--clear {
      position: relative;
      background: var(--surface-light);

      &::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 60%;
        height: 1px;
        background: var(--login-text-muted);
        transform: translate(-50%, -50%) rotate(45deg);
      }
    }
  }
}
</style>
