<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { randomId } from '@/06-shared/utils/utils'
import type { InputOptions } from '@/06-shared/types'
import OpenEye from "@/06-shared/components/svg/OpenEye.vue";
import ClosedEye from "@/06-shared/components/svg/ClosedEye.vue";

const props = defineProps<{
  modelValue: string
  options?: InputOptions
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const id = ref('')
const showPassword = ref(false)
const showDropdown = ref(false)
const inputRef = ref<HTMLDivElement | null>(null)

const inputType = computed(() => {
  if (props.options?.type === 'password') return showPassword.value ? 'text' : 'password'

  return props.options?.type || 'text'
})

const filteredList = computed(() => {
  if (!props.options?.list?.length) return []

  const val = (data.value || '').toLowerCase()
  return props.options.list.filter(item =>
    item.toLowerCase().includes(val)
  )
})

const data = computed({
  get: () => props.modelValue,
  set: (value) =>  {
    emit('update:modelValue', value)
    if (props.options?.list?.length) {
      showDropdown.value = true
    }
  },
})

const selectItem = (item: string): void => {
  emit('update:modelValue', item)
  showDropdown.value = false
}

const handleClickOutside = (e: MouseEvent): void => {
  if (inputRef.value && !inputRef.value.contains(e.target as Node)) {
    showDropdown.value = false
  }
}

onMounted((): void => {
  id.value = randomId()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted((): void => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="d-flex d-flex-colum input__core">
  <label class="label" :for="id">
    {{options?.label}}
  </label>
  <div class="input__wrapper" ref="inputRef">
  <input class="input__text"
         :class="{
           'input__text--password': options?.type === 'password',
           'input__text--disabled': options?.disabled,
         }"
         v-bind="$attrs"
         :placeholder="options?.placeholder"
         :type="inputType"
         v-model="data"
         :id="id"
         :readonly="options?.readonly"
         :disabled="options?.disabled"
         @focus="options?.list?.length && (showDropdown = true)"
         @input="options?.list?.length && (showDropdown = true)"
  />
  <div v-if="showDropdown && filteredList.length" class="input__dropdown">
    <div
      v-for="item in filteredList"
      :key="item"
      class="input__dropdown-item"
      @mousedown.prevent="selectItem(item)"
    >
      {{ item }}
    </div>
  </div>
  <button
    v-if="options?.type === 'password'"
    type="button"
    class="input__eye"
    @click="showPassword = !showPassword"
    tabindex="-1"
  >
    <OpenEye v-if="!showPassword" />
    <ClosedEye v-else />
  </button>
  </div>
  </div>
</template>

<style lang="scss">
.input {
  &__core {
    gap: var(--space-8);

    .label {
      margin-bottom: var(--space-4);
      display: block;
      color: var(--login-text-muted);
      font-size: var(--text-caption);
      line-height: var(--leading-caption);
      font-weight: var(--weight-medium);
      letter-spacing: var(--tracking-eyebrow);
      text-transform: uppercase;
      text-align: left;
    }
  }

  &__text {
    padding: 11px 12px;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-primary);
    border-radius: var(--radius-input);
    border: none;
    box-shadow: var(--elevation-inset);
    background-color: var(--surface-input);
    font-family: inherit;
    transition: box-shadow 0.2s ease, background-color 0.2s ease;
    width: 100%;
    box-sizing: border-box;

    &--password {
      padding-right: 44px;
    }

    &--disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &::placeholder {
      color: var(--login-text-muted);
    }

    &:hover:not(&--disabled) {
      background-color: var(--surface-hover);
    }

    &:focus {
      box-shadow: var(--elevation-inset-strong);
      outline: none;
    }
  }

  &__wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  &__dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: var(--space-4);
    background: var(--login-bg-form);
    border-radius: var(--radius-input);
    padding: var(--space-4) 0;
    max-height: 200px;
    overflow-y: auto;
    z-index: 100;
    box-shadow: var(--elevation-modal);
  }

  &__dropdown-item {
    padding: 9px 12px;
    font-size: var(--text-body-sm);
    color: var(--login-text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }
  }

  &__eye {
    position: absolute;
    right: 12px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--login-text-muted);
    transition: color 0.2s;

    &:hover {
      color: var(--login-text-primary);
    }
  }

  &.error {
    color: var(--error);
    box-shadow: inset 0 0 0 1px var(--error-border);
  }

  &__error {
    margin-top: var(--space-8);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-regular);
    color: var(--error);
  }

}
</style>
