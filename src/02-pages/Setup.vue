<script setup lang="ts">
import { AddProfileTab, SetupPathStep } from '@/03-widgets'
import { useOfflineSetup } from '@/04-features'

const { step, needsProfile } = useOfflineSetup()
</script>

<template>
  <div class="setup-screen">
    <div class="setup-container">
      <div class="setup-card">
        <div v-if="needsProfile" class="setup-steps">
          <span class="setup-steps__item" :class="{ 'setup-steps__item--active': step === 1 }">Папка установки</span>
          <span class="setup-steps__arrow">-&gt;</span>
          <span class="setup-steps__item" :class="{ 'setup-steps__item--active': step === 2 }">Профиль</span>
        </div>

        <SetupPathStep v-if="step === 1" />
        <AddProfileTab v-else embedded />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';
@use '@/01-app/assets/mixins';

.setup-screen {
  @include mixins.fullscreen-page;
}

.setup-container {
  width: 100%;
  max-width: var(--page-max-width);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: var(--z-content);
}

.setup-card {
  @include mixins.fullscreen-card;

  backdrop-filter: blur(var(--popup-overlay-blur));
  text-align: left;
}

.setup-steps {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  margin-bottom: var(--space-24);

  &__item {
    @include mixins.eyebrow;

    font-family: var(--font-eyebrow);
    font-feature-settings: "tnum" on;

    &--active {
      color: var(--login-text-primary);
    }
  }

  &__arrow {
    color: var(--login-text-muted);
  }
}

@include breakpoints.media-under-md {
  .setup-card {
    padding: var(--space-32) var(--space-24);
  }
}
</style>
