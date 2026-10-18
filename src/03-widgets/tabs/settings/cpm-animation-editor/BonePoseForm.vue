<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'
import type { EditorPose } from '@/04-features'

const AXES = ['x', 'y', 'z'] as const

type Axis = (typeof AXES)[number]

defineProps<{
  boneName: string | null
  pose: EditorPose | null
  canMirror: boolean
  canSmooth: boolean
  canRevert: boolean
}>()

const emit = defineEmits<{
  rotate: [axis: 'x' | 'y' | 'z', value: number]
  move: [axis: 'x' | 'y' | 'z', value: number]
  visible: [visible: boolean]
  mirror: []
  smooth: []
  revert: []
}>()

const displayValue = (value: number): number => Math.round(value * 100) / 100

const onRotate = (value: number | null, axis: Axis): void => {
  if (value === null) return
  emit('rotate', axis, value)
}

const onMove = (value: number | null, axis: Axis): void => {
  if (value === null) return
  emit('move', axis, value)
}
</script>

<template>
  <div v-if="pose" class="cpm-pose">
    <p class="cpm-pose__bone">{{ boneName }}</p>

    <div class="cpm-pose__group">
      <span class="cpm-pose__label">Поворот</span>
      <div class="cpm-pose__axes">
        <label v-for="axis in AXES" :key="axis" class="cpm-pose__field">
          <span class="cpm-pose__axis">{{ axis.toUpperCase() }}</span>
          <Input
            class="cpm-pose__number"
            :model-value="displayValue(pose.rotation[axis])"
            :options="{ type: 'number', size: 'compact' }"
            :step="1"
            :aria-label="`Поворот ${axis.toUpperCase()}`"
            @change="onRotate($event, axis)"
          />
        </label>
      </div>
    </div>

    <div class="cpm-pose__group">
      <span class="cpm-pose__label">Смещение</span>
      <div class="cpm-pose__axes">
        <label v-for="axis in AXES" :key="axis" class="cpm-pose__field">
          <span class="cpm-pose__axis">{{ axis.toUpperCase() }}</span>
          <Input
            class="cpm-pose__number"
            :model-value="displayValue(pose.pos[axis])"
            :options="{ type: 'number', size: 'compact' }"
            :step="0.1"
            :aria-label="`Смещение ${axis.toUpperCase()}`"
            @change="onMove($event, axis)"
          />
        </label>
      </div>
    </div>

    <Checkbox
      :model-value="pose.show"
      label="Видимость"
      @update:model-value="emit('visible', $event)"
    />

    <div class="cpm-pose__actions">
      <button
        type="button"
        class="cpm-pose__action"
        :disabled="!canRevert"
        aria-label="Вернуть к предыдущему шагу"
        @click="emit('revert')"
      >
        Шаг назад
      </button>
      <button
        type="button"
        class="cpm-pose__action"
        :disabled="!canMirror"
        @click="emit('mirror')"
      >
        Зеркально
      </button>
      <button
        type="button"
        class="cpm-pose__action"
        :disabled="!canSmooth"
        @click="emit('smooth')"
      >
        Сгладить
      </button>
    </div>

    <p class="cpm-pose__hint">
      Тяните кость в сцене, чтобы сместить её; круговые стрелки у гизмо поворачивают кость вокруг своей оси.
    </p>
  </div>

  <p v-else class="cpm-pose__empty">Выберите кость в дереве или в сцене</p>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-pose {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  &__bone {
    margin: 0;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }

  &__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__label {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__axes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-8);
  }

  &__field {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  &__axis {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__number {
    flex: 1 1 auto;
    min-width: 0;
  }

  &__empty {
    @include mixins.caption-hint;

    text-align: left;
  }

  &__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-12);
  }

  &__hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }

  &__action {
    height: var(--control-height-sm);
    padding: 0 var(--space-8);
    border: none;
    border-radius: var(--radius-button);
    background: var(--surface-light);
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
}
</style>
