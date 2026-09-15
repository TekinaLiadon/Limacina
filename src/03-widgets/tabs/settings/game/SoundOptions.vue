<script setup lang="ts">
import type { GameOptions } from '@/05-entities'
import GameNumberField from './GameNumberField.vue'

defineProps<{
  options: GameOptions
}>()
</script>

<template>
  <div class="sound-options">
    <GameNumberField
      label="Общая громкость"
      :min="0"
      :max="1"
      :model-value="options.soundMaster"
      @update:model-value="options.soundMaster = $event"
    />
    <GameNumberField
      label="Музыка"
      :min="0"
      :max="1"
      :model-value="options.soundMusic"
      @update:model-value="options.soundMusic = $event"
    />
    <GameNumberField
      label="Музыкальные блоки"
      :min="0"
      :max="1"
      :model-value="options.soundRecord"
      @update:model-value="options.soundRecord = $event"
    />
    <GameNumberField
      label="Погода"
      :min="0"
      :max="1"
      :model-value="options.soundWeather"
      @update:model-value="options.soundWeather = $event"
    />
    <GameNumberField
      label="Блоки"
      :min="0"
      :max="1"
      :model-value="options.soundBlock"
      @update:model-value="options.soundBlock = $event"
    />
    <GameNumberField
      label="Враждебные существа"
      :min="0"
      :max="1"
      :model-value="options.soundHostile"
      @update:model-value="options.soundHostile = $event"
    />
    <GameNumberField
      label="Дружелюбные существа"
      :min="0"
      :max="1"
      :model-value="options.soundNeutral"
      @update:model-value="options.soundNeutral = $event"
    />
    <GameNumberField
      label="Игроки"
      :min="0"
      :max="1"
      :model-value="options.soundPlayer"
      @update:model-value="options.soundPlayer = $event"
    />
    <GameNumberField
      label="Окружение"
      :min="0"
      :max="1"
      :model-value="options.soundAmbient"
      @update:model-value="options.soundAmbient = $event"
    />
    <GameNumberField
      label="Речь"
      :min="0"
      :max="1"
      :model-value="options.soundVoice"
      @update:model-value="options.soundVoice = $event"
    />
  </div>
</template>

<style lang="scss">
.sound-options {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
  width: 100%;
  max-width: var(--settings-row-width);
  margin-inline: auto;
}
</style>
