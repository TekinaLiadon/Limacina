<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useAttrs, watch } from 'vue'
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

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const rootClass = computed((): string | string[] | undefined => {
  const value = attrs.class
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value as string[]
  return undefined
})
const inputAttrs = computed((): Record<string, unknown> => {
  const { class: _rootClass, ...rest } = attrs
  return rest
})

const id = ref('')
const showPassword = ref(false)
const showDropdown = ref(false)
const activeSuggest = ref(0)
const inputRef = ref<HTMLDivElement | null>(null)

const listboxId = randomId()

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

watch(showDropdown, (shown: boolean): void => {
  if (shown) activeSuggest.value = 0
})

watch(filteredList, (): void => {
  activeSuggest.value = 0
})

const handleInputKeydown = (event: KeyboardEvent): void => {
  if (!showDropdown.value || filteredList.value.length === 0) return
  if (event.key === 'Escape') {
    event.preventDefault()
    showDropdown.value = false
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeSuggest.value = (activeSuggest.value + 1) % filteredList.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeSuggest.value = (activeSuggest.value - 1 + filteredList.value.length) % filteredList.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = filteredList.value[activeSuggest.value]
    if (item !== undefined) selectItem(item)
  }
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
  <div class="input__core" :class="rootClass">
    <div class="input__field">
      <label v-if="options?.label" class="label" :for="id">
        {{options?.label}}
      </label>
      <div class="input__wrapper" ref="inputRef">
        <input class="input__text"
               :class="{
                 'input__text--password': options?.type === 'password',
                 'input__text--disabled': options?.disabled,
               }"
               v-bind="inputAttrs"
               :placeholder="options?.placeholder"
               :type="inputType"
               v-model="data"
               :id="id"
               :readonly="options?.readonly"
               :disabled="options?.disabled"
               role="combobox"
               :aria-expanded="showDropdown && filteredList.length > 0"
               aria-haspopup="listbox"
               :aria-controls="listboxId"
               :aria-activedescendant="showDropdown && filteredList.length > 0 ? `${listboxId}-opt-${activeSuggest}` : undefined"
               @focus="options?.list?.length && (showDropdown = true)"
               @input="options?.list?.length && (showDropdown = true)"
               @keydown="handleInputKeydown"
               @focusout="showDropdown = false"
        />
        <div v-if="showDropdown && filteredList.length" :id="listboxId" class="input__dropdown" role="listbox">
          <div
            v-for="(item, index) in filteredList"
            :key="item"
            :id="`${listboxId}-opt-${index}`"
            class="input__dropdown-item"
            :class="{ 'input__dropdown-item--active': index === activeSuggest }"
            role="option"
            :aria-selected="item === data"
            @mousedown.prevent="selectItem(item)"
            @mousemove="activeSuggest = index"
          >
            {{ item }}
          </div>
        </div>
        <button
          v-if="options?.type === 'password'"
          type="button"
          class="input__eye"
          :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
          :aria-pressed="showPassword"
          @click="showPassword = !showPassword"
        >
          <OpenEye v-if="!showPassword" />
          <ClosedEye v-else />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

$input-row-container: 420px;

.input {
  &__core {
    container-type: inline-size;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);

    .label {
      @include mixins.eyebrow;

      margin-bottom: var(--space-4);
      display: block;
      text-align: left;
    }
  }

  @container (min-width: $input-row-container) {
    .input__field {
      flex-direction: row;
      align-items: center;
      gap: var(--space-12);

      .label {
        margin-bottom: 0;
        flex: 0 0 auto;
        max-width: 40%;
      }
    }
  }

  &__text {
    padding: var(--space-8) var(--control-padding-x);
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-primary);
    border-radius: var(--radius-input);
    border: none;
    box-shadow: var(--elevation-inset);
    background-color: var(--surface-input);
    font-family: inherit;
    transition: box-shadow var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out);
    width: 100%;
    min-height: var(--control-height);
    box-sizing: border-box;

    &--password {
      padding-right: var(--control-icon-area);
    }

    &--disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &::placeholder {
      color: var(--login-text-muted);
    }

    &[type='number'] {
      appearance: textfield;
      -moz-appearance: textfield;

      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    }

    &[type='password'] {
      &::-ms-reveal,
      &::-ms-clear {
        display: none;
      }
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
    max-height: var(--options-max-height);
    overflow-y: auto;
    z-index: var(--z-dropdown);
    box-shadow: var(--elevation-modal);
  }

  &__dropdown-item {
    padding: var(--space-8) var(--control-padding-x);
    font-size: var(--text-body-sm);
    color: var(--login-text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);

    &:hover,
    &--active {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }
  }

  &__eye {
    position: absolute;
    right: var(--control-padding-x);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--login-text-muted);
    transition: color var(--duration-base) var(--ease-out);

    &:hover {
      color: var(--login-text-primary);
    }
  }

}
</style>
