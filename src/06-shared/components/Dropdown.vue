<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  modelValue: string
  width?: string
  maxVisible?: number
  disabled?: boolean
}>(), {
  maxVisible: 3,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const shown = ref(false)
const maxHeight = computed((): string => `${props.maxVisible * 40 + 12}px`)

const selectedTitle = computed((): string => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  return selected?.title ?? props.modelValue
})

function selectOption(value: string): void {
  emit('update:modelValue', value)
  shown.value = false
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
  <div ref="rootRef" class="dropdown" :class="{ shown, disabled }">
    <div class="dropdown__value"
         @click="!disabled && (shown = !shown)"
         :style="`width: ${width}`"
    >
      {{ selectedTitle }}
    </div>
    <Transition name="dropdown-options">
      <div v-if="shown" class="dropdown-options" :style="{ maxHeight }">
        <div
          v-for="option in props.options"
          :key="option.value"
          class="dropdown-options__item"
          @click="selectOption(option.value)"
        >
          <img
            v-if="option.img"
            class="dropdown-options__img"
            :src="option.img"
            alt=""
          />
          <span class="dropdown-options__item-title">{{ option.title }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
.dropdown {
  position: relative;
  cursor: pointer;

  &__value {
    border: none;
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-input);
    transition: border-radius 0.25s ease-out, background-color 0.2s ease;
    height: var(--control-height);
    align-content: center;
    text-align: left;
    padding: 0 var(--control-padding-x);
    color: var(--login-text-primary);
    background-color: var(--surface-input);
    font-size: var(--text-body-sm);
  }

  &:not(.disabled):hover .dropdown__value {
    background-color: var(--surface-hover);
  }

  &.shown .dropdown__value {
    border-radius: var(--radius-input) var(--radius-input) 0 0;
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
}

.dropdown-options {
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
