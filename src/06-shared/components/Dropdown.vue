<script setup lang="ts">
import { computed, ref } from 'vue'
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

const shown = ref(false)
const maxHeight = computed((): string => `${props.maxVisible * 40 + 12}px`)

function selectOption(value: string): void {
  emit('update:modelValue', value)
  shown.value = false
}

</script>

<template>
  <div class="dropdown" :class="{ shown, disabled }">
    <div class="dropdown__value"
         @click="!disabled && (shown = !shown)"
         :style="`width: ${width}`"
    >
      {{ props.modelValue }}
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
    border: 1px solid var(--login-border);
    border-radius: 10px;
    transition: border-radius 0.25s ease-out;
    height: 40px;
    align-content: center;
    padding: 0 14px;
    color: var(--login-text-primary);
    background-color: rgba(255, 255, 255, 0.06);
    font-size: 14px;
  }

  &.shown .dropdown__value {
    border-radius: 10px 10px 0 0;
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
  border: 1px solid var(--login-border);
  border-top: none;
  border-radius: 0 0 10px 10px;
  padding: 6px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 100;
  box-shadow: 0 8px 24px var(--login-shadow-strong);
  overflow-y: auto;

  &__item {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    transition: background 0.15s;

    &:hover {
      background: rgba(108, 127, 216, 0.15);
    }
  }

  &__img {
    width: 20px;
    height: 20px;
  }

  &__item-title {
    font-size: 14px;
    line-height: 130%;
    color: var(--login-text-primary);
  }

  // anim
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
