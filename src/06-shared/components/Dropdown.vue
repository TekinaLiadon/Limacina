<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import { useDropdownPanel } from '@/06-shared/utils/useDropdownPanel'

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
const { shown, openUp, maxHeight, toggle, close } = useDropdownPanel(
  rootRef,
  (): boolean => props.disabled,
  (): number => props.maxVisible,
)

const selectedTitle = computed((): string => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  return selected?.title ?? props.modelValue
})

function selectOption(value: string): void {
  emit('update:modelValue', value)
  close()
}
</script>

<template>
  <div ref="rootRef" class="dropdown" :class="{ shown, disabled, 'dropdown--up': openUp }">
    <div
      class="dropdown__value"
      role="button"
      tabindex="0"
      :aria-expanded="shown"
      aria-haspopup="listbox"
      :aria-disabled="props.disabled"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
      :style="`width: ${width}`"
    >
      <span class="dropdown__title">{{ selectedTitle }}</span>
      <slot name="trailing" />
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
@use '@/01-app/assets/mixins';

.dropdown {
  position: relative;
  cursor: pointer;

  &__value {
    @include mixins.dropdown-trigger;

    align-content: center;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  &__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:not(.disabled):hover &__value {
    background-color: var(--surface-hover);
  }

  &.shown &__value {
    border-radius: var(--radius-input) var(--radius-input) 0 0;
  }

  &.shown.dropdown--up &__value {
    border-radius: 0 0 var(--radius-input) var(--radius-input);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
}

.dropdown--up .dropdown-options {
  @include mixins.options-panel-up;
}

.dropdown-options {
  @include mixins.options-panel;
}
</style>
