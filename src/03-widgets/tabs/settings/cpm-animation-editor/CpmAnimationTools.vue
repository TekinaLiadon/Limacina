<script setup lang="ts">
import { ref } from 'vue'
import { Input } from '@/06-shared'
import type { CpmAnimationEditorApi } from '@/04-features'
import ToolIconButton from '../ToolIconButton.vue'
import BoneTree from './BoneTree.vue'
import BonePoseForm from './BonePoseForm.vue'
import AnimationProperties from './AnimationProperties.vue'

const props = defineProps<{
  editor: CpmAnimationEditorApi
}>()

const isCollapsed = ref<boolean>(false)
const fraction = ref<number>(0.5)

const toggle = (): void => {
  isCollapsed.value = !isCollapsed.value
}

const onFraction = (value: number | null): void => {
  if (value === null) return
  fraction.value = Math.min(0.9, Math.max(0.1, value))
}

const insertFraction = (): void => {
  props.editor.insertPoseAtFraction(fraction.value)
}

const onGhostBefore = (value: number | null): void => {
  if (value === null) return
  props.editor.setGhostFrames(value, props.editor.ghostAfter.value)
}

const onGhostAfter = (value: number | null): void => {
  if (value === null) return
  props.editor.setGhostFrames(props.editor.ghostBefore.value, value)
}
</script>

<template>
  <aside
    class="cpm-editor-tools"
    :class="{ 'cpm-editor-tools--collapsed': isCollapsed }"
    aria-label="Настройки анимации"
  >
    <div class="cpm-editor-tools__head">
      <span v-if="!isCollapsed" class="cpm-editor-tools__title">Настройки</span>
      <ToolIconButton
        :label="isCollapsed ? 'Показать настройки' : 'Скрыть настройки'"
        :aria-expanded="!isCollapsed"
        @click="toggle"
      >
        <svg class="cpm-editor-tools__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </ToolIconButton>
    </div>

    <div v-show="!isCollapsed" class="cpm-editor-tools__body">
      <section class="cpm-editor-tools__section">
        <h3 class="cpm-editor-tools__section-title">Кости</h3>
        <BoneTree
          :rows="editor.boneRows.value"
          :selected-id="editor.selectedBoneId.value"
          @select="editor.selectBone"
        />
      </section>

      <section class="cpm-editor-tools__section">
        <h3 class="cpm-editor-tools__section-title">Поза</h3>
        <BonePoseForm
          :bone-name="editor.selectedBoneName.value"
          :pose="editor.selectedBonePose.value"
          :can-mirror="editor.canMirrorPose.value"
          :can-smooth="editor.canSmoothTrack.value"
          :can-revert="editor.canRevertBoneStep.value"
          :rotation-pivot="editor.rotationPivot.value"
          @rotate="editor.setBoneRotation"
          @move="editor.setBonePosition"
          @visible="editor.setBoneVisible"
          @mirror="editor.mirrorPose"
          @smooth="editor.smoothTrack"
          @revert="editor.revertBoneStep"
          @pivot="editor.setRotationPivot"
        />
      </section>

      <section class="cpm-editor-tools__section">
        <h3 class="cpm-editor-tools__section-title">Свойства анимации</h3>
        <AnimationProperties :editor="editor" />
      </section>

      <div class="cpm-editor-tools__ghosts">
        <span class="cpm-editor-tools__label">Призраки</span>
        <label class="cpm-editor-tools__ghost">
          <span class="cpm-editor-tools__ghost-label">до</span>
          <Input
            class="cpm-editor-tools__number"
            :model-value="editor.ghostBefore.value"
            :options="{ type: 'number', size: 'compact', align: 'center' }"
            :min="0"
            :max="8"
            :step="1"
            aria-label="Кадров до текущего"
            @change="onGhostBefore"
          />
        </label>
        <label class="cpm-editor-tools__ghost">
          <span class="cpm-editor-tools__ghost-label">после</span>
          <Input
            class="cpm-editor-tools__number"
            :model-value="editor.ghostAfter.value"
            :options="{ type: 'number', size: 'compact', align: 'center' }"
            :min="0"
            :max="8"
            :step="1"
            aria-label="Кадров после текущего"
            @change="onGhostAfter"
          />
        </label>
      </div>

      <div class="cpm-editor-tools__fraction">
        <span class="cpm-editor-tools__label">Доля пути между ключами</span>
        <div class="cpm-editor-tools__fraction-row">
          <Input
            class="cpm-editor-tools__number"
            :model-value="fraction"
            :options="{ type: 'number', size: 'compact', align: 'center' }"
            :min="0.1"
            :max="0.9"
            :step="0.1"
            aria-label="Доля пути между ключами"
            @change="onFraction"
          />
          <button type="button" class="cpm-editor-tools__fraction-insert" @click="insertFraction">
            Вставить позу
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.cpm-editor-tools {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: var(--cpm-editor-side-width);
  min-height: 0;
  padding: var(--space-8);

  @include breakpoints.media-under-md {
    width: min(var(--cpm-editor-side-width), 45vw);
  }

  &--collapsed {
    width: var(--space-48);

    .cpm-editor-tools__head {
      justify-content: center;
    }

    .cpm-editor-tools__chevron {
      transform: rotate(180deg);
    }
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    flex-shrink: 0;
  }

  &__title {
    padding-left: var(--space-8);
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-secondary);
  }

  &__chevron {
    transition: transform var(--duration-base) var(--ease-out);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    min-height: 0;
    padding: var(--space-4) var(--space-8) var(--space-8);
    overflow-y: auto;
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
  }

  &__section-title {
    margin: 0;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--login-text-muted);
  }

  &__label {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__ghosts {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    flex-wrap: wrap;
  }

  &__ghost {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  &__ghost-label {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__number {
    flex: 0 0 auto;
    width: calc(var(--space-48) + var(--space-24));
  }

  &__fraction {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__fraction-row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  &__fraction-insert {
    flex-shrink: 0;
    height: var(--control-height-sm);
    padding: 0 var(--space-8);
    border: none;
    border-radius: var(--radius-button);
    background: var(--surface-light);
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-caption);
    white-space: nowrap;
    cursor: pointer;

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }
}
</style>
