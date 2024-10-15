<script setup>
import {computed, onMounted, ref} from "vue";
import { randomId } from "@/06-shared/utils/utils";

const props = defineProps(["modelValue", 'options']);

const emit = defineEmits(["update:modelValue"]);

const id = ref("");

const data = computed({
  get() {
    return props.modelValue;
  },

  set(value) {
    return emit("update:modelValue", value);
  },
});

onMounted(() => {
  id.value = randomId();
});
</script>

<template>
  <div class="d-flex d-flex-colum input__core">
  <label class="label" :for="id">
    {{options?.label}}
  </label>
  <input class="input__text"
         v-bind="$attrs"
         :placeholder="options?.placeholder"
         v-model="data"
         :id="id"
  />
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
    /*width: 100%;*/
    font-family: inherit;
    transition: all .2s;

    &::placeholder {
      color: var(--landing-text);
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
