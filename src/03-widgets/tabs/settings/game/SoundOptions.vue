<script setup lang="ts">
import type { GameOptions } from '@/05-entities'
import GameSliderField from './GameSliderField.vue'

const props = defineProps<{
  options: GameOptions
}>()

const emit = defineEmits<{ 'update:options': [GameOptions] }>()

const patch = <K extends keyof GameOptions>(key: K, value: GameOptions[K]): void => {
  emit('update:options', { ...props.options, [key]: value })
}
</script>

<template>
  <div class="sound-options">
    <GameSliderField
      label="Общая громкость"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundMaster"
      @update:model-value="patch('soundMaster', $event)"
    />
    <GameSliderField
      label="Музыка"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundMusic"
      @update:model-value="patch('soundMusic', $event)"
    />
    <GameSliderField
      label="Музыкальные блоки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundRecord"
      @update:model-value="patch('soundRecord', $event)"
    />
    <GameSliderField
      label="Погода"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundWeather"
      @update:model-value="patch('soundWeather', $event)"
    />
    <GameSliderField
      label="Блоки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundBlock"
      @update:model-value="patch('soundBlock', $event)"
    />
    <GameSliderField
      label="Враждебные существа"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundHostile"
      @update:model-value="patch('soundHostile', $event)"
    />
    <GameSliderField
      label="Дружелюбные существа"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundNeutral"
      @update:model-value="patch('soundNeutral', $event)"
    />
    <GameSliderField
      label="Игроки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundPlayer"
      @update:model-value="patch('soundPlayer', $event)"
    />
    <GameSliderField
      label="Окружение"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundAmbient"
      @update:model-value="patch('soundAmbient', $event)"
    />
    <GameSliderField
      label="Речь"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundVoice"
      @update:model-value="patch('soundVoice', $event)"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.sound-options {
  @include mixins.settings-fields-grid;
}
</style>
