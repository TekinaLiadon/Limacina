<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CpmAnimationEditorApi } from '@/04-features'
import ToolIconButton from '../ToolIconButton.vue'
import EditorTimeline from './EditorTimeline.vue'
import FrameColorPicker from './FrameColorPicker.vue'

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

const displayFrame = computed((): number => {
  const count = props.editor.frameCount.value
  if (count <= 0) return 0
  if (!props.editor.isScrubbing.value) return Math.min(props.editor.currentFrame.value, count - 1)
  return Math.min(count - 1, Math.floor(props.editor.scrubProgress.value * count))
})

const currentColor = computed((): string | null =>
  props.editor.frameColors.value.get(props.editor.currentFrame.value) ?? null,
)

const setFrameColor = (color: string | null): void => {
  props.editor.setFrameColor(props.editor.currentFrame.value, color)
}

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
          {{ displayFrame + 1 }} / {{ Math.max(editor.frameCount.value, 1) }}
        </span>
      </div>

      <FrameColorPicker
        v-if="editor.frameCount.value > 0"
        :color="currentColor"
        :disabled="editor.isScrubbing.value"
        @select="setFrameColor"
      />

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
        :frame-colors="editor.frameColors.value"
        :is-playing="editor.isPlaying.value"
        :is-scrubbing="editor.isScrubbing.value"
        :scrub-progress="editor.scrubProgress.value"
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
        @add-frame="editor.insertFrame"
        @add-step="editor.insertStep"
        @begin-scrub="editor.beginScrub"
        @scrub="editor.scrubTo"
        @end-scrub="editor.endScrub"
        @move-frame="editor.moveFrame"
      />
    </div>
  </section>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-editor-timeline {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-8) var(--space-8);

  &--collapsed {
    padding-bottom: var(--space-4);

    .cpm-editor-timeline__chevron {
      transform: rotate(180deg);
    }
  }

  &__head {
    display: flex;
    align-items: center;
    gap: var(--space-4);

    .tool-icon-button {
      width: var(--space-24);
      height: var(--space-24);
    }
  }

  &__title {
    margin-right: auto;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--login-text-secondary);
  }

  &__summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
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
    gap: var(--space-4);
  }
}
</style>
