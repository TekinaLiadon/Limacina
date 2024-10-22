<script setup>
import {computed, ref, watch} from "vue";
import DropdownOptions from "@/06-shared/components/DropdownOptions.vue";

const props = defineProps(["options", "modelValue", "shown"]);

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
    <div class="dropdown__value" @click="shown = !shown">
      {{ props.modelValue }}
    </div>
    <DropdownOptions :options="props.options" v-model:shown="shown" v-model="data" />
  </div>
</template>

<style lang="scss">
.dropdown {
  position: relative;

  &__value {
    background-color: var(--grey-text-db);
    border-radius: 10px;
  }
}
</style>
