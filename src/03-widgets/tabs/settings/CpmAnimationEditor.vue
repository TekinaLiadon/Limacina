<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Input } from '@/06-shared'
import {
  useCpmEditorScene,
  type CpmAnimationEditorApi,
  type CpmEditorBridge,
} from '@/04-features'
import BoneTree from './cpm-animation-editor/BoneTree.vue'
import BonePoseForm from './cpm-animation-editor/BonePoseForm.vue'
import EditorTimeline from './cpm-animation-editor/EditorTimeline.vue'
import AnimationProperties from './cpm-animation-editor/AnimationProperties.vue'

const props = defineProps<{
  editor: CpmAnimationEditorApi
  bridge: CpmEditorBridge
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

useCpmEditorScene(props.editor, props.bridge)

const isVanillaPose = computed((): boolean => props.editor.animation.value?.kind === 'vanilla-pose')
const fraction = ref<number>(0.5)

const onFraction = (value: number | null): void => {
  if (value === null) return
  fraction.value = Math.min(0.9, Math.max(0.1, value))
}

const insertFraction = (): void => {
  props.editor.insertPoseAtFraction(fraction.value)
}

const onNameChange = (event: Event): void => {
  props.editor.setName((event.target as HTMLInputElement).value)
}

const onGhostBefore = (value: number | null): void => {
  if (value === null) return
  props.editor.setGhostFrames(value, props.editor.ghostAfter.value)
}

const onGhostAfter = (value: number | null): void => {
  if (value === null) return
  props.editor.setGhostFrames(props.editor.ghostBefore.value, value)
}

const finish = (): void => {
  void props.editor.stopEditing()
}

const remove = (): void => {
  void props.editor.deleteCurrentAnimation()
}
</script>

<template>
  <section class="cpm-editor">
    <div class="cpm-editor__head">
      <label class="cpm-editor__name">
        <span class="cpm-editor__label">Имя анимации</span>
        <input
          class="cpm-editor__input"
          type="text"
          aria-label="Имя анимации"
          :readonly="isVanillaPose"
          :value="editor.animation.value?.name ?? ''"
          @change="onNameChange"
        />
      </label>
      <div class="cpm-editor__meta">
        <Button
          class="btn-quiet cpm-editor__delete"
          aria-label="Удалить анимацию"
          @click="remove"
        >
          Удалить
        </Button>
        <Button class="btn-quiet cpm-editor__done" @click="finish">
          Завершить
        </Button>
      </div>
    </div>

    <div v-if="editor.saveErrors.value.length > 0" class="cpm-editor__errors" role="alert">
      <p v-for="error in editor.saveErrors.value" :key="error" class="cpm-editor__error">
        {{ error }}
      </p>
    </div>
    <p v-if="editor.saveWarnings.value.length > 0" class="cpm-editor__warning">
      {{ editor.saveWarnings.value.join(' ') }}
    </p>

    <div class="cpm-editor__body">
      <section class="cpm-editor__section">
        <h3 class="cpm-editor__section-title">Кости</h3>
        <BoneTree
          :rows="editor.boneRows.value"
          :selected-id="editor.selectedBoneId.value"
          @select="editor.selectBone"
        />
      </section>

      <section class="cpm-editor__section">
        <h3 class="cpm-editor__section-title">Поза</h3>
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
    </div>

    <section class="cpm-editor__section">
      <h3 class="cpm-editor__section-title">Свойства анимации</h3>
      <AnimationProperties :editor="editor" />
    </section>

    <div class="cpm-editor__ghosts">
      <span class="cpm-editor__label">Призраки</span>
      <label class="cpm-editor__ghost">
        <span class="cpm-editor__ghost-label">до</span>
        <Input
          class="cpm-editor__number"
          :model-value="editor.ghostBefore.value"
          :options="{ type: 'number', size: 'compact', align: 'center' }"
          :min="0"
          :max="8"
          :step="1"
          aria-label="Кадров до текущего"
          @change="onGhostBefore"
        />
      </label>
      <label class="cpm-editor__ghost">
        <span class="cpm-editor__ghost-label">после</span>
        <Input
          class="cpm-editor__number"
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

    <div class="cpm-editor__fraction">
      <span class="cpm-editor__label">Доля пути между ключами</span>
      <Input
        class="cpm-editor__number"
        :model-value="fraction"
        :options="{ type: 'number', size: 'compact', align: 'center' }"
        :min="0.1"
        :max="0.9"
        :step="0.1"
        aria-label="Доля пути между ключами"
        @change="onFraction"
      />
      <button type="button" class="cpm-editor__fraction-insert" @click="insertFraction">
        Вставить позу
      </button>
    </div>

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
      :speed="speed"
      :can-speed-down="canSpeedDown"
      :can-speed-up="canSpeedUp"
      :is-looped="isLooped"
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

    <p v-if="editor.isSimpleMode.value" class="cpm-editor__hint">
      Позы ставятся на границах секунд, промежуточные кадры достраивает интерполятор.
      Переключитесь в покадровый режим, чтобы править отдельные кадры.
    </p>
  </section>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.cpm-editor {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  padding: var(--space-12);

  &__head {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--space-12);
  }

  &__name {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1 1 auto;
    min-width: 0;
  }

  &__label {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__input {
    min-width: 0;
    width: 100%;
    height: var(--control-height-sm);
    padding: 0 var(--space-8);
    border: none;
    border-radius: var(--radius-input);
    background: var(--surface-input);
    box-shadow: var(--elevation-inset);
    color: var(--login-text-primary);
    font-family: inherit;
    font-size: var(--text-body-sm);

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-shrink: 0;
  }

  &__delete,
  &__done {
    flex-shrink: 0;
  }

  &__errors {
    @include mixins.error-box;

    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__error {
    margin: 0;
  }

  &__warning {
    @include mixins.caption-hint;

    text-align: left;
  }

  &__hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }

  &__body {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-16);

    @include breakpoints.media-under-md {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    min-width: 0;
  }

  &__section-title {
    margin: 0;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-secondary);
  }

  &__ghosts {
    display: flex;
    align-items: center;
    gap: var(--space-16);
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
    align-items: center;
    gap: var(--space-12);
    flex-wrap: wrap;
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
