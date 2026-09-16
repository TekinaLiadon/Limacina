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
  <label
    class="checkbox"
    :class="{ 'checkbox--disabled': disabled }"
    role="checkbox"
    :aria-checked="modelValue"
  >
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
  position: relative;

  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  &__box {
    width: 18px;
    height: 18px;
    border: none;
    box-shadow: var(--elevation-inset);
    background: var(--surface-input);
    border-radius: var(--radius-badge);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out);
    flex-shrink: 0;

    .checkbox__input:checked + & {
      background: var(--login-accent);
      box-shadow: var(--elevation-inset);
    }

    .checkbox__input:focus-visible + & {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    .checkbox:hover & {
      box-shadow: var(--elevation-inset-strong);
    }
  }

  &__label {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }
}
</style>
