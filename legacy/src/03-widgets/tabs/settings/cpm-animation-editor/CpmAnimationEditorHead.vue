<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'
import type { CpmAnimationEditorApi } from '@/04-features'

const props = defineProps<{
  editor: CpmAnimationEditorApi
  isSaving: boolean
  saveError: string
}>()

const emit = defineEmits<{
  save: []
}>()

const isVanillaPose = computed((): boolean => props.editor.animation.value?.kind === 'vanilla-pose')

const errors = computed((): string[] => {
  const list = [...props.editor.saveErrors.value]
  if (props.saveError !== '') list.push(props.saveError)
  return list
})

const onNameChange = (event: Event): void => {
  props.editor.setName((event.target as HTMLInputElement).value)
}

const exit = (): void => {
  void props.editor.stopEditing()
}
</script>

<template>
  <header class="cpm-editor-head">
    <div class="cpm-editor-head__row">
      <label class="cpm-editor-head__name">
        <span class="cpm-editor-head__label">Имя анимации</span>
        <input
          class="cpm-editor-head__input"
          type="text"
          aria-label="Имя анимации"
          :readonly="isVanillaPose"
          :value="editor.animation.value?.name ?? ''"
          @change="onNameChange"
        />
      </label>
      <div class="cpm-editor-head__meta">
        <Button class="btn-quiet cpm-editor-head__exit" @click="exit">
          Выйти
        </Button>
        <Button
          class="btn-primary cpm-editor-head__save"
          :is-loading="isSaving"
          @click="emit('save')"
        >
          Сохранить
        </Button>
      </div>
    </div>

    <div v-if="errors.length > 0" class="cpm-editor-head__errors" role="alert">
      <p v-for="error in errors" :key="error" class="cpm-editor-head__error">
        {{ error }}
      </p>
    </div>
    <p v-if="editor.saveWarnings.value.length > 0" class="cpm-editor-head__warning">
      {{ editor.saveWarnings.value.join(' ') }}
    </p>
  </header>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-editor-head {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);

  &__row {
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

  &__exit,
  &__save {
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

    margin: 0;
    text-align: left;
  }
}
</style>
