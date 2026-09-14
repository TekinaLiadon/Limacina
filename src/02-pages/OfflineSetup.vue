<script setup lang="ts">
import { AddProfileTab } from '@/03-widgets'
</script>

<template>
  <div class="offline-setup">
    <div class="offline-setup__container">
      <div class="offline-setup__form">
        <span class="offline-setup__eyebrow eyebrow">Первый запуск</span>
        <AddProfileTab embedded />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.offline-setup {
  min-height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--layout-padding);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
    background-size: 80px 80px;
    mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    pointer-events: none;
  }
}

.offline-setup__container {
  width: 100%;
  max-width: var(--page-max-width);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.offline-setup__form {
  width: 100%;
  background: var(--login-bg-form);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-modal);
  padding: var(--page-padding-y) var(--page-padding-x);
  box-shadow: var(--elevation-modal);
  text-align: left;
}

.offline-setup__eyebrow {
  display: block;
  margin-bottom: var(--space-12);
}

@include breakpoints.media-under-md {
  .offline-setup__form {
    padding: var(--space-32) var(--space-24);
  }
}
</style>
