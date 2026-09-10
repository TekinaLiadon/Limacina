<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import Check from '@/06-shared/components/svg/Check.vue'

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
const shown = ref(false)
const openUp = ref(false)
const maxHeight = computed((): string => `${props.maxVisible * 40 + 12}px`)

const triggerTitle = computed((): string => {
  if (props.modelValue.length === 0) return props.placeholder
  if (props.modelValue.length === 1) {
    const selected = props.options.find((option) => option.value === props.modelValue[0])
    return selected?.title ?? props.modelValue[0]
  }
  return `Выбрано: ${props.modelValue.length}`
})

function computeDirection(): void {
  if (!rootRef.value) return
  const rect = rootRef.value.getBoundingClientRect()
  const optionsHeight = props.maxVisible * 40 + 12
  const spaceBelow = window.innerHeight - rect.bottom
  openUp.value = spaceBelow < optionsHeight && rect.top > spaceBelow
}

function toggle(): void {
  if (props.disabled) return
  if (!shown.value) computeDirection()
  shown.value = !shown.value
}

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

function handleClickOutside(e: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    shown.value = false
  }
}

onMounted((): void => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount((): void => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="rootRef" class="multi-select" :class="{ shown, disabled, 'multi-select--up': openUp }">
    <div class="multi-select__value" :style="`width: ${width}`" @click="toggle">
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
      <div v-if="shown" class="multi-select-options" :style="{ maxHeight }">
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
.multi-select {
  position: relative;
  cursor: pointer;

  &__value {
    border: none;
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-input);
    transition: border-radius 0.25s ease-out, background-color 0.2s ease;
    height: var(--control-height);
    display: flex;
    align-items: center;
    gap: var(--space-8);
    text-align: left;
    padding: 0 var(--control-padding-x);
    color: var(--login-text-primary);
    background-color: var(--surface-input);
    font-size: var(--text-body-sm);
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
    transition: background-color 0.2s ease, color 0.2s ease;

    svg {
      width: 12px;
      height: 12px;
    }

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }
  }

  &:not(.disabled):hover .multi-select__value {
    background-color: var(--surface-hover);
  }

  &.shown .multi-select__value {
    border-radius: var(--radius-input) var(--radius-input) 0 0;
  }

  &.shown.multi-select--up .multi-select__value {
    border-radius: 0 0 var(--radius-input) var(--radius-input);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
}

.multi-select--up .multi-select-options {
  top: auto;
  bottom: 100%;
  border-radius: var(--radius-input) var(--radius-input) 0 0;
}

.multi-select--up .multi-select-options-enter-from,
.multi-select--up .multi-select-options-leave-to {
  transform: translateY(10px);
}

.multi-select-options {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: var(--login-bg-form);
  border-radius: 0 0 var(--radius-input) var(--radius-input);
  padding: var(--space-4) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  z-index: 100;
  box-shadow: var(--elevation-modal);
  overflow-y: auto;

  &__item {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-8) var(--control-padding-x);
    transition: background 0.15s;

    &:hover {
      background: var(--surface-hover);
    }
  }

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
    transition: background 0.2s ease;
    flex-shrink: 0;

    svg {
      width: 12px;
      height: 10px;
      color: var(--text-on-accent);
    }
  }

  &__item--selected &__check {
    background: var(--login-accent);
  }

  &__img {
    width: 20px;
    height: 20px;
  }

  &__item-title {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }

  &-enter-active,
  &-leave-active {
    transition: all 0.2s ease;
  }

  &-enter-from,
  &-leave-to {
    opacity: 0;
    transform: translateY(-10px);
  }

  &-enter-to,
  &-leave-from {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
