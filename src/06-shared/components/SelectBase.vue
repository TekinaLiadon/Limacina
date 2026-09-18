<script setup lang="ts">
import { ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import { useDropdownPanel } from '@/06-shared/utils/useDropdownPanel'

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  title: string
  width?: string | undefined
  maxVisible?: number
  disabled?: boolean
  openUp?: boolean
  isSelected?: (value: string) => boolean
}>(), {
  maxVisible: 3,
  disabled: false,
  openUp: false,
})

const emit = defineEmits<{
  select: [value: string]
}>()

defineSlots<{
  trailing(): unknown
  'option-leading'(props: { option: DropdownOption }): unknown
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const { shown, openUp, maxHeight, panelRef, toggle, close } = useDropdownPanel(
  rootRef,
  (): boolean => props.disabled,
  (): number => props.maxVisible,
  (): boolean => props.openUp,
)

defineExpose({ close })
</script>

<template>
  <div ref="rootRef" class="select-base" :class="{ shown, disabled, 'select-base--up': openUp }">
    <div
      class="select-base__value"
      role="button"
      tabindex="0"
      :aria-expanded="shown"
      aria-haspopup="listbox"
      :aria-disabled="disabled"
      :style="width !== undefined ? `width: ${width}` : undefined"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="select-base__title">{{ title }}</span>
      <slot name="trailing" />
    </div>
    <Transition name="select-base-options">
      <div v-if="shown" ref="panelRef" class="select-base-options" :style="{ maxHeight }">
        <div
          v-for="option in props.options"
          :key="option.value"
          class="select-base-options__item"
          :class="{ 'select-base-options__item--selected': isSelected?.(option.value) }"
          @click="emit('select', option.value)"
        >
          <slot name="option-leading" :option="option" />
          <img
            v-if="option.img"
            class="select-base-options__img"
            :src="option.img"
            alt=""
          />
          <span class="select-base-options__item-title">{{ option.title }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.select-base {
  position: relative;
  cursor: pointer;

  &__value {
    @include mixins.dropdown-trigger;

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

  &.shown.select-base--up &__value {
    border-radius: 0 0 var(--radius-input) var(--radius-input);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
}

.select-base--up .select-base-options {
  @include mixins.options-panel-up;
}

.select-base-options {
  @include mixins.options-panel;

  &__item--selected &__item-title {
    color: var(--login-text-primary);
  }
}
</style>
