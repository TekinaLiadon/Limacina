<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox, Dropdown, Input } from '@/06-shared'
import {
  EDITOR_INTERPOLATOR_OPTIONS,
  EDITOR_KIND_OPTIONS,
  EDITOR_VANILLA_POSE_OPTIONS,
  type CpmAnimationEditorApi,
} from '@/04-features'
import type { CPMAnimationInterpolator, CPMAnimationKind } from '@/05-entities'

const props = defineProps<{
  editor: CpmAnimationEditorApi
}>()

const data = computed(() => props.editor.animationData.value)
const isGesture = computed((): boolean => data.value?.kind === 'gesture')
const isVanilla = computed((): boolean => data.value?.kind === 'vanilla-pose')
const poseValue = computed((): string =>
  props.editor.vanillaPoseIndex.value === null ? '' : String(props.editor.vanillaPoseIndex.value),
)

const textValue = (event: Event): string => (event.target as HTMLInputElement).value

const onKind = (value: string): void => props.editor.setKind(value as CPMAnimationKind)
const onPose = (value: string): void => props.editor.setVanillaPose(Number(value))
const onInterpolator = (value: string): void =>
  props.editor.setInterpolator(value as CPMAnimationInterpolator)
const onDuration = (value: number | null): void => {
  if (value === null) return
  props.editor.setDuration(value)
}
const onFrames = (value: number | null): void => {
  if (value === null) return
  void props.editor.setFrameCount(value)
}
const onPriority = (value: number | null): void => {
  if (value === null) return
  props.editor.setPriority(value)
}
const onOrder = (value: number | null): void => {
  if (value === null) return
  props.editor.setOrder(value)
}
const onGroup = (event: Event): void => props.editor.setGroup(textValue(event))
</script>

<template>
  <div v-if="data" class="cpm-props">
    <div class="cpm-props__row">
      <div class="cpm-props__field cpm-props__trigger">
        <span class="cpm-props__label">Триггер</span>
        <Dropdown
          :options="EDITOR_KIND_OPTIONS"
          :model-value="data.kind"
          :max-visible="7"
          @update:model-value="onKind"
        />
      </div>

      <div v-if="isVanilla" class="cpm-props__field cpm-props__pose">
        <span class="cpm-props__label">Ванильная поза</span>
        <Dropdown
          :options="EDITOR_VANILLA_POSE_OPTIONS"
          :model-value="poseValue"
          :max-visible="8"
          @update:model-value="onPose"
        />
      </div>
    </div>

    <p v-if="isVanilla && editor.vanillaPoseHint.value" class="cpm-props__hint">
      {{ editor.vanillaPoseHint.value }}
    </p>

    <div class="cpm-props__row">
      <label class="cpm-props__field">
        <span class="cpm-props__label">Длительность, мс</span>
        <Input
          class="cpm-props__number"
          :model-value="data.duration"
          :options="{ type: 'number', size: 'compact' }"
          :min="1"
          :max="65535"
          :step="1"
          aria-label="Длительность"
          @change="onDuration"
        />
      </label>

      <label class="cpm-props__field">
        <span class="cpm-props__label">Кадров</span>
        <span class="cpm-props__frames">
          <Input
            class="cpm-props__number"
            :model-value="editor.frameCount.value"
            :options="{ type: 'number', size: 'compact' }"
            :min="1"
            :max="255"
            :step="1"
            aria-label="Количество кадров"
            @change="onFrames"
          />
          <button
            type="button"
            class="cpm-props__insert"
            aria-label="Вставить кадр"
            @click="editor.insertFrame()"
          >
            + кадр
          </button>
        </span>
      </label>

      <div class="cpm-props__field cpm-props__interpolator">
        <span class="cpm-props__label">Интерполятор</span>
        <Dropdown
          :options="EDITOR_INTERPOLATOR_OPTIONS"
          :model-value="data.interpolator"
          :max-visible="7"
          @update:model-value="onInterpolator"
        />
      </div>
    </div>

    <div class="cpm-props__toggles">
      <Checkbox
        v-if="isGesture"
        :model-value="data.loop"
        label="Зацикливание"
        @update:model-value="editor.setLoop"
      />
      <Checkbox
        :model-value="data.additive"
        label="Аддитивность"
        @update:model-value="editor.setAdditive"
      />
      <Checkbox
        v-if="isVanilla"
        :model-value="editor.isPreviewEnabled.value"
        label="Превью"
        @update:model-value="editor.setPreviewEnabled"
      />
    </div>

    <details class="cpm-props__advanced">
      <summary class="cpm-props__summary">Продвинутое</summary>
      <div class="cpm-props__row">
        <label class="cpm-props__field">
          <span class="cpm-props__label">Приоритет</span>
          <Input
            class="cpm-props__number"
            :model-value="data.priority"
            :options="{ type: 'number', size: 'compact' }"
            :min="-128"
            :max="127"
            :step="1"
            aria-label="Приоритет"
            @change="onPriority"
          />
        </label>

        <label class="cpm-props__field">
          <span class="cpm-props__label">Порядок</span>
          <Input
            class="cpm-props__number"
            :model-value="data.order ?? 0"
            :options="{ type: 'number', size: 'compact' }"
            :min="-128"
            :max="127"
            :step="1"
            :disabled="data.command ?? false"
            aria-label="Порядок"
            @change="onOrder"
          />
        </label>

        <label class="cpm-props__field">
          <span class="cpm-props__label">Группа</span>
          <input
            class="cpm-props__input"
            type="text"
            aria-label="Группа"
            :value="data.group ?? ''"
            @change="onGroup"
          />
        </label>
      </div>

      <div class="cpm-props__toggles">
        <Checkbox
          :model-value="data.mustFinish ?? false"
          label="До конца"
          @update:model-value="editor.setMustFinish"
        />
        <Checkbox
          :model-value="data.command ?? false"
          label="Команда"
          @update:model-value="editor.setCommand"
        />
        <Checkbox
          :model-value="data.hidden"
          label="Скрыта"
          @update:model-value="editor.setHidden"
        />
      </div>
    </details>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-props {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  &__row {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--space-16);
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    flex: 1 1 auto;
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
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__number {
    flex: 1 1 auto;
    min-width: 0;
  }

  &__frames {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  &__insert {
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

  &__hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }

  &__toggles {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-16);
  }

  &__advanced {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  &__summary {
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    cursor: pointer;

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }
}
</style>
