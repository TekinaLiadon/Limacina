<script setup lang="ts">
import type { GameCloudsMode, GameOptions } from '@/05-entities'
import { GameCheckboxField, GameDropdownField, GameSliderField, createOptionsPatch } from './fields'
import { cloudsOptions, graphicsModeOptions, guiScaleOptions, mipmapOptions, particlesOptions } from './options'

const props = defineProps<{ options: GameOptions }>()
const emit = defineEmits<{ 'update:options': [GameOptions] }>()
const patch = createOptionsPatch(props, emit)
</script>

<template>
  <div class="graphics-options">
    <GameSliderField
      label="Угол обзора (FOV)"
      :min="30"
      :max="110"
      :model-value="options.fov"
      @update:model-value="patch('fov', $event)"
    />
    <GameSliderField
      label="Яркость"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.gamma"
      @update:model-value="patch('gamma', $event)"
    />
    <GameSliderField
      label="Дальность прорисовки (чанки)"
      :min="2"
      :max="32"
      :model-value="options.renderDistance"
      @update:model-value="patch('renderDistance', $event)"
    />
    <GameSliderField
      label="Дальность симуляции (чанки)"
      :min="5"
      :max="32"
      :model-value="options.simulationDistance"
      @update:model-value="patch('simulationDistance', $event)"
    />
    <GameSliderField
      label="Максимум FPS"
      :min="10"
      :max="260"
      :step="10"
      :model-value="options.maxFps"
      @update:model-value="patch('maxFps', $event)"
    />
    <GameDropdownField
      label="Графика"
      :options="graphicsModeOptions"
      :model-value="String(options.graphicsMode)"
      @update:model-value="patch('graphicsMode', Number($event))"
    />
    <GameDropdownField
      label="Детализация текстур (mipmap)"
      :options="mipmapOptions"
      :model-value="String(options.mipmapLevels)"
      @update:model-value="patch('mipmapLevels', Number($event))"
    />
    <GameDropdownField
      label="Частицы"
      :options="particlesOptions"
      :model-value="String(options.particles)"
      @update:model-value="patch('particles', Number($event))"
    />
    <GameDropdownField
      label="Облака"
      :options="cloudsOptions"
      :model-value="options.renderClouds"
      @update:model-value="patch('renderClouds', $event as GameCloudsMode)"
    />
    <GameDropdownField
      label="Масштаб интерфейса"
      :options="guiScaleOptions"
      :model-value="String(options.guiScale)"
      @update:model-value="patch('guiScale', Number($event))"
    />
    <GameCheckboxField
      label="Вертикальная синхронизация"
      :model-value="options.enableVsync"
      @update:model-value="patch('enableVsync', $event)"
    />
    <GameCheckboxField
      label="Тени существ"
      :model-value="options.entityShadows"
      @update:model-value="patch('entityShadows', $event)"
    />
    <GameCheckboxField
      label="Мягкое освещение"
      :model-value="options.ao"
      @update:model-value="patch('ao', $event)"
    />
    <GameCheckboxField
      label="Полный экран при запуске"
      :model-value="options.fullscreen"
      @update:model-value="patch('fullscreen', $event)"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.graphics-options {
  @include mixins.settings-fields-grid;
}
</style>
