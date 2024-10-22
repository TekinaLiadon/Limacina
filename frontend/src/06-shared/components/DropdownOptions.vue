<script setup>
const props = defineProps(["options", "shown"]);

const emit = defineEmits(["update:modelValue", "update:shown", "newValue"]);

function show() {
  emit("update:shown", true);
}
function hide() {
  emit("update:shown", false);
}
function updateValue(value) {
  emit("update:modelValue", value);
  emit('newValue', value)
  hide();
}
</script>

<template>
  <Transition name="dropdown-options">
    <div v-if="props.shown" class="dropdown-options">
      <div
        v-for="option in props.options"
        class="dropdown-options__item"
        @click="updateValue(option.value)"
      >
        <img
          v-if="option.img"
          class="dropdown-options__img"
          :src="option.img"
          alt=""
        />
        <span class="dropdown-options__item-title">{{ option.title }}</span>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss">
.dropdown-options {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: var(--white);
  border-radius: 0 0 30px 30px;
  padding: 5px 20px 10px 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;

  &__item {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__img {
    width: 20px;
    height: 20px;
  }

  &__item-title {
    font-size: 16px;
    line-height: 130%;
  }
}

// anim
.dropdown-options {
  &-enter-active,
  &-leave-active {
    transition: all 0.2s ease;
  }

  &-enter-from,
  &-leave-to {
    opacity: 0;
    transform: translateY(-10px);
  }

  &-enter-to,
  &-leave-from {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
