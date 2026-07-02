<script setup lang="ts">
import type { DropdownOption } from '@/06-shared/types'

const props = defineProps<{
  options: DropdownOption[]
  shown: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:shown': [value: boolean]
  'newValue': [value: string]
}>()

function updateValue(value: string): void {
  emit('update:modelValue', value)
  emit('newValue', value)
  emit('update:shown', false)
}
</script>

<template>
  <Transition name="dropdown-options">
    <div v-if="props.shown" class="dropdown-options">
      <div
        v-for="option in props.options"
        :key="option.value"
        class="dropdown-options__item"
        @click="updateValue(option.value)"
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
</template>

<style lang="scss">
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
}

// anim
.dropdown-options {
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
