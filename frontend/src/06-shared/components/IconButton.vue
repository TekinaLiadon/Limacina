<script setup>
import Icon from "@/06-shared/components/Icon.vue";

const props = defineProps({
  icon: String,
  tag: {
    type: String,
    default: "button",
  },
  up: Boolean,
  down: Boolean,
});
</script>

<template>
  <component :is="props.tag" class="icon-btn">
    <Icon
      :type="icon"
      class="icon-btn__icon"
      :up="props.up"
      :down="props.down"
    />
  </component>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.icon-btn {
  cursor: pointer;
  width: 50px;
  height: 50px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: var(--item-grey);
  border: none;
  transition: all 0.2s;

  &__icon {
    font-size: 24px;
    width: 24px;
    height: 24px;
    color: var(--landing-text);
  }

  @include breakpoints.media-under-sm {
    width: 40px;
    height: 40px;
  }
}

.active .icon-btn,
.icon-btn:hover {
  background-color: rgba(0, 0, 0, 1);
}
</style>
