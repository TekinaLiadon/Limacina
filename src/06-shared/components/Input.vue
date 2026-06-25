<script setup>
import {computed, nextTick, onMounted, onUnmounted, ref} from "vue";
import { randomId } from "@/06-shared/utils/utils";

const props = defineProps(["modelValue", 'options']);

const emit = defineEmits(["update:modelValue"]);

const id = ref("");
const showPassword = ref(false);
const showDropdown = ref(false);
const inputRef = ref(null);

const inputType = computed(() => {
  if (props.options?.type === 'password') {
    return showPassword.value ? 'text' : 'password';
  }
  return props.options?.type || 'text';
});

const filteredList = computed(() => {
  if (!props.options?.list?.length) return []
  const val = (data.value || '').toLowerCase()
  return props.options.list.filter(item =>
    item.toLowerCase().includes(val)
  )
});

const data = computed({
  get() {
    return props.modelValue;
  },

  set(value) {
    emit("update:modelValue", value);
    if (props.options?.list?.length) {
      showDropdown.value = true
    }
  },
});

const selectItem = (item) => {
  emit("update:modelValue", item)
  showDropdown.value = false
}

const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

const handleClickOutside = (e) => {
  if (inputRef.value && !inputRef.value.contains(e.target)) {
    showDropdown.value = false
  }
};

onMounted(() => {
  id.value = randomId();
  document.addEventListener('click', handleClickOutside)
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
});
</script>

<template>
  <div class="d-flex d-flex-colum input__core">
  <label class="label" :for="id">
    {{options?.label}}
  </label>
  <div class="input__wrapper" ref="inputRef">
  <input class="input__text"
         :class="{'input__text--password': options?.type === 'password'}"
         v-bind="$attrs"
         :placeholder="options?.placeholder"
         :type="inputType"
         v-model="data"
         :id="id"
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
    @click="togglePassword"
    tabindex="-1"
  >
    <svg v-if="!showPassword" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
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
    color: var(--grey-text-db);
    border-radius: 8px;
    border: 1px solid var(--grey-stroke);
    background-color: var(--grey);
    font-family: inherit;
    transition: all .2s;
    width: 100%;
    box-sizing: border-box;

    &--password {
      padding-right: 44px;
    }

    &::placeholder {
      color: var(--landing-text);
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
