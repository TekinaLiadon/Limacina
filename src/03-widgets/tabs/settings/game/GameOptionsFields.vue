<script setup lang="ts">
import type { GameOptions } from '@/05-entities'
import { GameCheckboxField, GameDropdownField, GameSliderField, createOptionsPatch } from './fields'
import type { GameOptionField } from './options'

const props = defineProps<{
  fields: GameOptionField[]
  options: GameOptions
}>()

const emit = defineEmits<{ 'update:options': [GameOptions] }>()

const patch = createOptionsPatch(props, emit)
</script>

<template>
  <div class="game-options-fields">
    <template v-for="field in fields" :key="field.key">
      <GameSliderField
        v-if="field.kind === 'slider'"
        :label="field.label"
        :min="field.min"
        :max="field.max"
        :step="field.step ?? 1"
        :model-value="options[field.key]"
        @update:model-value="patch(field.key, $event)"
      />
      <GameCheckboxField
        v-else-if="field.kind === 'checkbox'"
        :label="field.label"
        :model-value="options[field.key]"
        @update:model-value="patch(field.key, $event)"
      />
      <GameDropdownField
        v-else
        :label="field.label"
        :options="field.options"
        :model-value="field.read(options)"
        @update:model-value="patch(field.key, field.write($event))"
      />
    </template>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-options-fields {
  @include mixins.settings-fields-grid;
}
</style>
