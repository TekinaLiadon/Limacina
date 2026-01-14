<script setup>
import {computed, ref, watch} from "vue";
import DropdownOptions from "@/06-shared/components/DropdownOptions.vue";

const props = defineProps(["options", "modelValue", "shown", 'width']);

const emit = defineEmits(["update:modelValue"]);

const shown = ref(false);
const value = ref(props.options[0]?.value);
const data = computed({
  get() {
    return props.modelValue;
  },

  set(value) {
    return emit("update:modelValue", value);
  },
});
watch(value, () => updateValue(value));

function updateValue(value) {
  emit("update:modelValue", value);
}
</script>

<template>
  <div class="dropdown" :class="{ shown }">
    <div class="dropdown__value"
         @click="shown = !shown"
         :style="`width: ${width}`"
    >
      {{ props.modelValue }}
    </div>
    <DropdownOptions
        :options="props.options"
        v-model:shown="shown"
        v-model="data"
        :style="`width: ${width}`" />
  </div>
</template>

<style lang="scss">
.dropdown {
  position: relative;
  cursor: pointer;

  &__value {
    /*background-color: #cdcdcd;*/
    border: 1px solid #cdcdcd;
    border-radius: 10px;
    transition: border-radius 0.25s ease-out;
    height: 35px;
    align-content: center;
  }
}
.shown {
  .dropdown__value {
    border-radius: 10px 10px 0 0;
  }
}
</style>
