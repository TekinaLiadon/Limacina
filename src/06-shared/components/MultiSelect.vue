<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import Check from '@/06-shared/components/svg/Check.vue'
import { useDropdownPanel } from '@/06-shared/utils/useDropdownPanel'

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  modelValue: string[]
  width?: string
  maxVisible?: number
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
}>(), {
  maxVisible: 3,
  disabled: false,
  placeholder: 'Не выбрано',
  clearable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const { shown, openUp, maxHeight, panelRef, toggle } = useDropdownPanel(
  rootRef,
  (): boolean => props.disabled,
  (): number => props.maxVisible,
)

const triggerTitle = computed((): string => {
  if (props.modelValue.length === 0) return props.placeholder
  const [first] = props.modelValue
  if (props.modelValue.length === 1 && first !== undefined) {
    const selected = props.options.find((option) => option.value === first)
    return selected?.title ?? first
  }
  return `Выбрано: ${props.modelValue.length}`
})

function isSelected(value: string): boolean {
  return props.modelValue.includes(value)
}

function toggleOption(value: string): void {
  emit('update:modelValue', isSelected(value)
    ? props.modelValue.filter((item) => item !== value)
    : [...props.modelValue, value])
}

function clear(): void {
  emit('update:modelValue', [])
}
</script>

<template>
  <div ref="rootRef" class="multi-select" :class="{ shown, disabled, 'multi-select--up': openUp }">
    <div
      class="multi-select__value"
      role="button"
      tabindex="0"
      :aria-expanded="shown"
      aria-haspopup="listbox"
      :aria-disabled="props.disabled"
      :style="`width: ${width}`"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="multi-select__title">{{ triggerTitle }}</span>
      <button
        v-if="clearable && modelValue.length > 0 && !disabled"
        class="multi-select__clear"
        type="button"
        aria-label="Очистить"
        @click.stop="clear"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <Transition name="multi-select-options">
      <div v-if="shown" ref="panelRef" class="multi-select-options" :style="{ maxHeight }">
        <div
          v-for="option in props.options"
          :key="option.value"
          class="multi-select-options__item"
          :class="{ 'multi-select-options__item--selected': isSelected(option.value) }"
          @click="toggleOption(option.value)"
        >
          <span class="multi-select-options__check">
            <Check v-if="isSelected(option.value)" />
          </span>
          <img
            v-if="option.img"
            class="multi-select-options__img"
            :src="option.img"
            alt=""
          />
          <span class="multi-select-options__item-title">{{ option.title }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.multi-select {
  position: relative;
  cursor: pointer;

  &__value {
    @include mixins.dropdown-trigger;

    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  &__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__clear {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: var(--radius-badge);
    background: transparent;
    color: var(--login-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    svg {
      width: 12px;
      height: 12px;
    }

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }
  }

  &:not(.disabled):hover &__value {
    background-color: var(--surface-hover);
  }

  &.shown &__value {
    border-radius: var(--radius-input) var(--radius-input) 0 0;
  }

  &.shown.multi-select--up &__value {
    border-radius: 0 0 var(--radius-input) var(--radius-input);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
}

.multi-select--up .multi-select-options {
  @include mixins.options-panel-up;
}

.multi-select-options {
  @include mixins.options-panel;

  &__item--selected &__item-title {
    color: var(--login-text-primary);
  }

  &__check {
    width: 18px;
    height: 18px;
    border: none;
    box-shadow: var(--elevation-inset);
    background: var(--surface-input);
    border-radius: var(--radius-badge);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--duration-base) var(--ease-out);
    flex-shrink: 0;
  }

  &__item--selected &__check {
    background: var(--login-accent);
  }
}
</style>
