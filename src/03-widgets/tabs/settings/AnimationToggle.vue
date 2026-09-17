<script setup lang="ts">
import { Checkbox } from '@/06-shared'
import { useAnimationSettings } from '@/04-features'

const { animationsEnabled, toggleAnimations } = useAnimationSettings()
</script>

<template>
  <div class="animation-toggle">
    <Checkbox
      :model-value="animationsEnabled"
      label="Анимации интерфейса"
      @update:model-value="toggleAnimations()"
    />
    <span class="animation-toggle__hint">
      Плавные переходы и эффекты. При первом запуске отключаются автоматически,
      если система сообщает о сниженном движении.
    </span>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.animation-toggle {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  max-width: var(--settings-row-width);

  &__hint {
    @include mixins.caption-hint;

    text-align: left;
  }
}
</style>
