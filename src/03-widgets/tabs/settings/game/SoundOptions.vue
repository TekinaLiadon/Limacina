<script setup lang="ts">
import type { GameOptions } from '@/05-entities'
import GameSliderField from './GameSliderField.vue'

defineProps<{
  options: GameOptions
}>()
</script>

<template>
  <div class="sound-options">
    <GameSliderField
      label="Общая громкость"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundMaster"
      @update:model-value="options.soundMaster = $event"
    />
    <GameSliderField
      label="Музыка"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundMusic"
      @update:model-value="options.soundMusic = $event"
    />
    <GameSliderField
      label="Музыкальные блоки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundRecord"
      @update:model-value="options.soundRecord = $event"
    />
    <GameSliderField
      label="Погода"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundWeather"
      @update:model-value="options.soundWeather = $event"
    />
    <GameSliderField
      label="Блоки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundBlock"
      @update:model-value="options.soundBlock = $event"
    />
    <GameSliderField
      label="Враждебные существа"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundHostile"
      @update:model-value="options.soundHostile = $event"
    />
    <GameSliderField
      label="Дружелюбные существа"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundNeutral"
      @update:model-value="options.soundNeutral = $event"
    />
    <GameSliderField
      label="Игроки"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundPlayer"
      @update:model-value="options.soundPlayer = $event"
    />
    <GameSliderField
      label="Окружение"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundAmbient"
      @update:model-value="options.soundAmbient = $event"
    />
    <GameSliderField
      label="Речь"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.soundVoice"
      @update:model-value="options.soundVoice = $event"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.sound-options {
  @include mixins.settings-fields-grid;
}
</style>
