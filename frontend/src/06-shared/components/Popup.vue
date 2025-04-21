<script setup>
import SmoothHeight from "@/06-shared/components/SmoothHeight.vue";

const props = defineProps(["visible", "maxWidth", 'options', 'height']);

const emit = defineEmits(["update:visible", "close"]);

function close() {
  emit("update:visible", false);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <Transition name="popup-toggle">
      <div v-if="visible" class="popup-mask">
        <div class="popup" :style="{ maxWidth }">
          <div class="popup__header">
            <span class="h2 h2--adaptive" v-if="options?.header">
                {{ options?.header }}
            </span>
            <div v-if="$slots.header" class="popup__header">
              <slot name="header" />
            </div>
            </div>
          <div class="popup__close" @click="close">
<!--            <Icon type="close-circle" />-->
          </div>
          <div class="popup__content" :style="{height}" :class="{'popup__content--flex': height,}">
            <SmoothHeight>
            <slot></slot>
            </SmoothHeight>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.popup-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}

.popup {
  max-height: 95%;
  min-height: 70%;
  display: flex;
  flex-direction: column;
  border-radius: 30px;
  background-color: var(--white);
  position: relative;
  padding: 40px;
  width: 90%;
  max-width: 460px;

  &__header {
    margin-bottom: 20px;
    text-align: center;
  }

  &__close {
    cursor: pointer;
    font-size: 24px;
    position: absolute;
    top: 15px;
    right: 15px;
  }

  &__content {
    overflow: auto;

    &--flex {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  @include breakpoints.media-under-lg{
    padding: 20px;

    &__header {
      margin: 0 auto;
      max-width: 90%;
    }

    &__close {
      top: 10px;
      right: 10px;
    }
  }
}

// anim
.popup-toggle {
  &-enter-active,
  &-leave-active,
  &-enter-active .popup,
  &-leave-active .popup {
    transition: all 0.3s ease;
  }

  &-enter-from,
  &-leave-to {
    opacity: 0;

    .popup {
      transform: scale(0.7);
    }
  }

  &-enter-to,
  &-leave-from {
    opacity: 1;

    .popup {
      transform: scale(1);
    }
  }
}

</style>
