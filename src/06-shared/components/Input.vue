<script setup lang="ts">
import { computed, ref, useAttrs, watch } from 'vue'
import { randomId } from '@/06-shared/utils/utils'
import { useDropdownPanel } from '@/06-shared/utils/useDropdownPanel'
import { useListboxNavigation } from '@/06-shared/utils/useListboxNavigation'
import type { InputOptions } from '@/06-shared/types'
import OpenEye from '@/06-shared/components/svg/OpenEye.vue'
import ClosedEye from '@/06-shared/components/svg/ClosedEye.vue'

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

const id = randomId()
const showPassword = ref(false)
const inputRef = ref<HTMLDivElement | null>(null)
const {
  shown: showDropdown,
  open: openDropdown,
  openUp,
  maxHeight,
  panelRef,
  close: closeDropdown,
} = useDropdownPanel(
  inputRef,
  (): boolean => false,
  (): number => 7,
)

const listboxId = randomId()

const inputType = computed((): string => {
  if (props.options?.type === 'password') return showPassword.value ? 'text' : 'password'

  return props.options?.type || 'text'
})

const filteredList = computed((): string[] => {
  if (!props.options?.list?.length) return []

  const val = (props.modelValue || '').toLowerCase()
  return props.options.list.filter(item => item.toLowerCase().includes(val))
})

const data = computed({
  get: (): string => props.modelValue,
  set: (value: string): void => {
    emit('update:modelValue', value)
    if (props.options?.list?.length) void openDropdown()
  },
})

const openList = (): void => {
  if (!props.options?.list?.length) return
  void openDropdown()
}

const selectItem = (item: string): void => {
  emit('update:modelValue', item)
  closeDropdown()
}

const { activeIndex, resetActive, navigationActions } = useListboxNavigation(
  (): number => filteredList.value.length,
  panelRef,
  (index: number): void => {
    const item = filteredList.value[index]
    if (item !== undefined) selectItem(item)
  },
)

watch(showDropdown, (shown: boolean): void => {
  if (shown) resetActive(0)
})

watch(filteredList, (): void => {
  resetActive(0)
})

const handleInputKeydown = (event: KeyboardEvent): void => {
  if (!showDropdown.value || filteredList.value.length === 0) return
  const action = navigationActions[event.key]
  if (!action) return
  event.preventDefault()
  action()
}
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
               :aria-activedescendant="showDropdown && filteredList.length > 0 ? `${listboxId}-opt-${activeIndex}` : undefined"
               @focus="openList"
               @input="openList"
               @keydown="handleInputKeydown"
               @focusout="closeDropdown"
        />
        <div
          v-if="showDropdown && filteredList.length"
          ref="panelRef"
          :id="listboxId"
          class="input__dropdown"
          :class="{ 'input__dropdown--up': openUp }"
          role="listbox"
          :style="{ maxHeight }"
        >
          <div
            v-for="(item, index) in filteredList"
            :key="item"
            :id="`${listboxId}-opt-${index}`"
            class="input__dropdown-item"
            :class="{ 'input__dropdown-item--active': index === activeIndex }"
            role="option"
            :aria-selected="item === data"
            @mousedown.prevent="selectItem(item)"
            @mousemove="activeIndex = index"
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
    overflow-y: auto;
    z-index: var(--z-dropdown);
    box-shadow: var(--elevation-modal);
  }

  &__dropdown--up {
    @include mixins.options-panel-up;

    margin-top: 0;
    margin-bottom: var(--space-4);
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
