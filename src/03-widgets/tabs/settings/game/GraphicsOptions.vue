<script setup lang="ts">
import type { GameCloudsMode, GameOptions } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import GameSliderField from './GameSliderField.vue'
import GameDropdownField from './GameDropdownField.vue'
import GameCheckboxField from './GameCheckboxField.vue'

defineProps<{
  options: GameOptions
}>()

const graphicsModeOptions: DropdownOption[] = [
  { title: 'Быстрая', value: '0' },
  { title: 'Красивая', value: '1' },
  { title: 'Потрясающая', value: '2' },
  { title: 'Ручная', value: '3' },
]

const mipmapOptions: DropdownOption[] = [
  { title: 'Выкл', value: '0' },
  { title: '1', value: '1' },
  { title: '2', value: '2' },
  { title: '3', value: '3' },
  { title: '4', value: '4' },
]

const particlesOptions: DropdownOption[] = [
  { title: 'Все', value: '0' },
  { title: 'Уменьшенные', value: '1' },
  { title: 'Минимум', value: '2' },
]

const cloudsOptions: DropdownOption[] = [
  { title: 'Включены', value: 'true' },
  { title: 'Упрощённые', value: 'fast' },
  { title: 'Выключены', value: 'false' },
]

const guiScaleOptions: DropdownOption[] = [
  { title: 'Авто', value: '0' },
  { title: '1', value: '1' },
  { title: '2', value: '2' },
  { title: '3', value: '3' },
  { title: '4', value: '4' },
]
</script>

<template>
  <div class="graphics-options">
    <GameSliderField
      label="Угол обзора (FOV)"
      :min="30"
      :max="110"
      :model-value="options.fov"
      @update:model-value="options.fov = $event"
    />
    <GameSliderField
      label="Яркость"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.gamma"
      @update:model-value="options.gamma = $event"
    />
    <GameSliderField
      label="Дальность прорисовки (чанки)"
      :min="2"
      :max="32"
      :model-value="options.renderDistance"
      @update:model-value="options.renderDistance = $event"
    />
    <GameSliderField
      label="Дальность симуляции (чанки)"
      :min="5"
      :max="32"
      :model-value="options.simulationDistance"
      @update:model-value="options.simulationDistance = $event"
    />
    <GameSliderField
      label="Максимум FPS"
      :min="10"
      :max="260"
      :step="10"
      :model-value="options.maxFps"
      @update:model-value="options.maxFps = $event"
    />
    <GameDropdownField
      label="Графика"
      :options="graphicsModeOptions"
      :model-value="String(options.graphicsMode)"
      @update:model-value="options.graphicsMode = Number($event)"
    />
    <GameDropdownField
      label="Детализация текстур (mipmap)"
      :options="mipmapOptions"
      :model-value="String(options.mipmapLevels)"
      @update:model-value="options.mipmapLevels = Number($event)"
    />
    <GameDropdownField
      label="Частицы"
      :options="particlesOptions"
      :model-value="String(options.particles)"
      @update:model-value="options.particles = Number($event)"
    />
    <GameDropdownField
      label="Облака"
      :options="cloudsOptions"
      :model-value="options.renderClouds"
      @update:model-value="options.renderClouds = $event as GameCloudsMode"
    />
    <GameDropdownField
      label="Масштаб интерфейса"
      :options="guiScaleOptions"
      :model-value="String(options.guiScale)"
      @update:model-value="options.guiScale = Number($event)"
    />
    <GameCheckboxField
      label="Вертикальная синхронизация"
      :model-value="options.enableVsync"
      @update:model-value="options.enableVsync = $event"
    />
    <GameCheckboxField
      label="Тени существ"
      :model-value="options.entityShadows"
      @update:model-value="options.entityShadows = $event"
    />
    <GameCheckboxField
      label="Мягкое освещение"
      :model-value="options.ao"
      @update:model-value="options.ao = $event"
    />
    <GameCheckboxField
      label="Полный экран при запуске"
      :model-value="options.fullscreen"
      @update:model-value="options.fullscreen = $event"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.graphics-options {
  @include mixins.settings-fields-grid;
}
</style>
