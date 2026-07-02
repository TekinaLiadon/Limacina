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
    grid-gap: 10px;

    .label {
      margin-bottom: 5px;
      grid-gap: 10px;
      display: flex;
      flex-direction: column;
        color: var(--yellow);
        font-size: 14px;
        font-weight: 400;

    }
  }

  &__text {
    padding: 15px;
    font-size: 12px;
    line-height: 130%;
    color: var(--login-text-primary);
    border-radius: 8px;
    border: 1px solid var(--login-border);
    background-color: rgba(255, 255, 255, 0.06);
    font-family: inherit;
    transition: all .2s;
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

    &:focus {
      border-color: var(--login-border-hover);
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
    margin-top: 4px;
    background: var(--login-bg-form);
    border: 1px solid var(--login-border);
    border-radius: 8px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 100;
    box-shadow: 0 8px 24px var(--login-shadow-strong);
  }

  &__dropdown-item {
    padding: 10px 15px;
    font-size: 12px;
    color: var(--login-text-primary);
    cursor: pointer;
    transition: background 0.15s;

    &:first-child {
      border-radius: 8px 8px 0 0;
    }

    &:last-child {
      border-radius: 0 0 8px 8px;
    }

    &:hover {
      background: rgba(108, 127, 216, 0.15);
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
    color: var(--grey-text-db);
    transition: color 0.2s;

    &:hover {
      color: var(--yellow);
    }
  }

  &.error {
    color: var(--red);
    border-color: var(--red);
  }

  &__error {
    margin-top: 10px;
    font-size: 14px;
    line-height: 130%;
    font-weight: 400;
    color: var(--red);
  }

}
</style>
