<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import { useDropdownPanel } from '@/06-shared/utils/useDropdownPanel'
import { randomId } from '../utils/utils'

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
  'trigger-overlay'(): unknown
  'option-leading'(props: { option: DropdownOption }): unknown
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const { shown, openUp, maxHeight, panelRef, toggle, close } = useDropdownPanel(
  rootRef,
  (): boolean => props.disabled,
  (): number => props.maxVisible,
  (): boolean => props.openUp,
)

const listboxId = randomId()
const activeIndex = ref(0)

watch(shown, (isShown: boolean): void => {
  if (!isShown) return
  const selectedIndex = props.options.findIndex((option) => props.isSelected?.(option.value) ?? false)
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : 0
})

const moveActive = (delta: number): void => {
  const count = props.options.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

const handleTriggerKeydown = (event: KeyboardEvent): void => {
  if (props.disabled) return
  if (!shown.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      toggle()
    }
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const option = props.options[activeIndex.value]
    if (option) emit('select', option.value)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

defineExpose({ close })
</script>

<template>
  <div
    ref="rootRef"
    class="select-base"
    :class="{ shown, disabled, 'select-base--up': openUp }"
    :style="width !== undefined ? `width: ${width}` : undefined"
  >
    <div
      class="select-base__value"
      role="button"
      tabindex="0"
      :aria-expanded="shown"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-activedescendant="shown ? `${listboxId}-opt-${activeIndex}` : undefined"
      :aria-disabled="disabled"
      @click="toggle"
      @keydown="handleTriggerKeydown"
    >
      <span class="select-base__title">{{ title }}</span>
      <slot name="trailing" />
    </div>
    <slot name="trigger-overlay" />
    <div v-if="shown" ref="panelRef" :id="listboxId" class="select-base-options" role="listbox" :style="{ maxHeight }">
      <div
        v-for="(option, index) in props.options"
        :key="option.value"
        :id="`${listboxId}-opt-${index}`"
        class="select-base-options__item"
        :class="{
          'select-base-options__item--selected': isSelected?.(option.value),
          'select-base-options__item--active': shown && index === activeIndex,
        }"
        role="option"
        :aria-selected="isSelected?.(option.value) ?? false"
        @click="emit('select', option.value)"
        @mousemove="activeIndex = index"
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

  &__item--active {
    background: var(--surface-hover);
    color: var(--login-text-primary);
  }

  &__item--selected &__item-title {
    color: var(--login-text-primary);
  }
}
</style>
