<script setup lang="ts">
import { ref } from 'vue'
import type { CpmAnimationEditorApi } from '@/04-features'
import ToolIconButton from '../ToolIconButton.vue'
import EditorTimeline from './EditorTimeline.vue'

const props = defineProps<{
  editor: CpmAnimationEditorApi
  speed: number
  canSpeedDown: boolean
  canSpeedUp: boolean
  isLooped: boolean
}>()

const emit = defineEmits<{
  'speed-down': []
  'speed-up': []
  'toggle-loop': []
}>()

const isCollapsed = ref<boolean>(false)

const toggle = (): void => {
  isCollapsed.value = !isCollapsed.value
}
</script>

<template>
  <section
    class="cpm-editor-timeline"
    :class="{ 'cpm-editor-timeline--collapsed': isCollapsed }"
  >
    <div class="cpm-editor-timeline__head">
      <span class="cpm-editor-timeline__title">Кадры</span>

      <div v-if="isCollapsed" class="cpm-editor-timeline__summary">
        <ToolIconButton
          :label="editor.isPlaying.value ? 'Пауза' : 'Воспроизвести'"
          @click="editor.togglePlayback"
        >
          <svg v-if="editor.isPlaying.value" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </ToolIconButton>
        <span class="cpm-editor-timeline__frame">
          {{ editor.currentFrame.value + 1 }} / {{ editor.frameCount.value }}
        </span>
      </div>

      <ToolIconButton
        :label="isCollapsed ? 'Показать кадры' : 'Скрыть кадры'"
        :aria-expanded="!isCollapsed"
        @click="toggle"
      >
        <svg class="cpm-editor-timeline__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </ToolIconButton>
    </div>

    <div v-show="!isCollapsed" class="cpm-editor-timeline__body">
      <EditorTimeline
        :frame-count="editor.frameCount.value"
        :duration-ms="editor.animationData.value?.duration ?? 1000"
        :simple-mode="editor.isSimpleMode.value"
        :current-frame="editor.currentFrame.value"
        :keys="editor.selectedBoneKeys.value"
        :beads="editor.timeBeads.value"
        :bead-mode="editor.beadMode.value"
        :is-playing="editor.isPlaying.value"
        :can-add-key="editor.canAddKey.value"
        :can-remove-key="editor.canRemoveKey.value"
        :can-copy-key="editor.canCopyKey.value"
        :can-paste-key="editor.canPasteKey.value"
        :can-jump-to-previous-key="editor.canJumpToPreviousKey.value"
        :can-jump-to-next-key="editor.canJumpToNextKey.value"
        :can-undo="editor.canUndo.value"
        :can-redo="editor.canRedo.value"
        :speed="props.speed"
        :can-speed-down="props.canSpeedDown"
        :can-speed-up="props.canSpeedUp"
        :is-looped="props.isLooped"
        @frame="editor.goToFrame"
        @toggle-play="editor.togglePlayback"
        @step="editor.stepFrame"
        @jump-key="editor.jumpToKey"
        @add-key="editor.addKey"
        @remove-key="editor.removeKey"
        @copy-key="editor.copyKey"
        @paste-key="editor.pasteKey"
        @speed-down="emit('speed-down')"
        @speed-up="emit('speed-up')"
        @toggle-loop="emit('toggle-loop')"
        @undo="editor.undo"
        @redo="editor.redo"
        @bead-mode="editor.setBeadMode"
        @bead-start="editor.beginBeadDrag"
        @bead-drag="editor.dragBead"
        @bead-end="editor.endBeadDrag"
        @simple-mode="editor.setSimpleMode"
        @second="editor.goToSecond"
      />

      <p v-if="editor.isSimpleMode.value" class="cpm-editor-timeline__hint">
        Позы ставятся на границах секунд, промежуточные кадры достраивает интерполятор.
        Переключитесь в покадровый режим, чтобы править отдельные кадры.
      </p>
    </div>
  </section>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-editor-timeline {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12) var(--space-12);

  &--collapsed {
    padding-bottom: var(--space-8);

    .cpm-editor-timeline__chevron {
      transform: rotate(180deg);
    }
  }

  &__head {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  &__title {
    margin-right: auto;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-secondary);
  }

  &__summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
  }

  &__frame {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    font-variant-numeric: tabular-nums;
  }

  &__chevron {
    transition: transform var(--duration-base) var(--ease-out);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }
}
</style>
