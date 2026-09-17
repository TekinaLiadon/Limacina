<script setup lang="ts">
defineProps<{
  message: string
  visible: boolean
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="push-notification">
      <div v-if="visible" class="push-notification">
        <span class="push-notification__text">{{ message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.push-notification {
  position: fixed;
  top: var(--space-24);
  right: var(--space-24);
  z-index: var(--z-notification);
  background: var(--login-bg-form);
  border-radius: var(--radius-card);
  padding: var(--space-16) var(--space-20);
  box-shadow: var(--elevation-modal);
  max-width: 360px;

  &__text {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }
}

.push-notification-enter-active,
.push-notification-leave-active {
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
}

.push-notification-enter-from,
.push-notification-leave-to {
  opacity: 0;
  transform: translateX(var(--space-20));
}
</style>
