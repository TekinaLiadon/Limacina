<script setup lang="ts">
import Check from "@/06-shared/components/svg/Check.vue";

defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <label class="checkbox" :class="{ 'checkbox--disabled': disabled }">
    <input
      type="checkbox"
      class="checkbox__input"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="checkbox__box">
      <Check v-if="modelValue" />
    </span>
    <span v-if="label" class="checkbox__label">{{ label }}</span>
  </label>
</template>

<style lang="scss">
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;

  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &__input {
    display: none;
  }

  &__box {
    width: 20px;
    height: 20px;
    border: 2px solid var(--login-border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;

    .checkbox__input:checked + & {
      background: var(--yellow);
      border-color: var(--yellow);
    }

    .checkbox:hover & {
      border-color: var(--login-border-hover);
    }
  }

  &__icon {
    width: 12px;
    height: 10px;
    color: var(--login-bg-primary);
  }

  &__label {
    font-size: 14px;
    color: var(--login-text-primary);
  }
}
</style>
