<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import Check from '@/06-shared/components/svg/Check.vue'
import SelectBase from './SelectBase.vue'

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  modelValue: string[]
  width?: string
  maxVisible?: number
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
  openUp?: boolean
}>(), {
  maxVisible: 3,
  disabled: false,
  placeholder: 'Не выбрано',
  clearable: false,
  openUp: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

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
  <SelectBase
    :options="props.options"
    :title="triggerTitle"
    :width="width"
    :max-visible="props.maxVisible"
    :disabled="props.disabled"
    :open-up="props.openUp"
    :is-selected="isSelected"
    @select="toggleOption"
  >
    <template #trailing>
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
    </template>
    <template #option-leading="{ option }">
      <span
        class="multi-select__check"
        :class="{ 'multi-select__check--selected': isSelected(option.value) }"
      >
        <Check v-if="isSelected(option.value)" />
      </span>
    </template>
  </SelectBase>
</template>

<style lang="scss">
.multi-select__clear {
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

.multi-select__check {
  width: 18px;
  height: 18px;
  box-shadow: var(--elevation-inset);
  background: var(--surface-input);
  border-radius: var(--radius-badge);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--duration-base) var(--ease-out);
  flex-shrink: 0;
}

.multi-select__check--selected {
  background: var(--login-accent);
}
</style>
