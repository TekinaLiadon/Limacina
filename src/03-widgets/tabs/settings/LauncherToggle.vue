<script setup lang="ts">

defineProps<{
  modelValue: boolean
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="launcher-toggles__item">
    <label class="launcher-toggles__toggle">
      <input
        type="checkbox"
        :checked="modelValue"
        class="launcher-toggles__checkbox"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="launcher-toggles__label">{{ label }}</span>
    </label>
  </div>
</template>

<style lang="scss">
.launcher-toggles__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.launcher-toggles__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.launcher-toggles__checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--yellow);
  cursor: pointer;
}

.launcher-toggles__label {
  font-size: 14px;
  color: var(--login-text-primary);
  cursor: pointer;
}
</style>
