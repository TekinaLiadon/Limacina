<script setup lang="ts">
import type { GameChatVisibility, GameOptions } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import GameSliderField from './GameSliderField.vue'
import GameDropdownField from './GameDropdownField.vue'
import GameCheckboxField from './GameCheckboxField.vue'

defineProps<{
  options: GameOptions
}>()

const visibilityOptions: DropdownOption[] = [
  { title: 'Полный', value: 'full' },
  { title: 'Только команды', value: 'system' },
  { title: 'Скрыт', value: 'hidden' },
]
</script>

<template>
  <div class="chat-options">
    <GameDropdownField
      label="Видимость чата"
      :options="visibilityOptions"
      :model-value="options.chatVisibility"
      @update:model-value="options.chatVisibility = $event as GameChatVisibility"
    />
    <GameSliderField
      label="Масштаб чата"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatScale"
      @update:model-value="options.chatScale = $event"
    />
    <GameSliderField
      label="Ширина чата"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatWidth"
      @update:model-value="options.chatWidth = $event"
    />
    <GameSliderField
      label="Прозрачность фона"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatOpacity"
      @update:model-value="options.chatOpacity = $event"
    />
    <GameSliderField
      label="Межстрочный интервал"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatLineSpacing"
      @update:model-value="options.chatLineSpacing = $event"
    />
    <GameSliderField
      label="Задержка сообщений"
      :min="0"
      :max="6"
      :step="0.5"
      :model-value="options.chatDelay"
      @update:model-value="options.chatDelay = $event"
    />
    <GameSliderField
      label="Прозрачность фона текста"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.textBackgroundOpacity"
      @update:model-value="options.textBackgroundOpacity = $event"
    />
    <GameCheckboxField
      label="Цвета в чате"
      :model-value="options.chatColors"
      @update:model-value="options.chatColors = $event"
    />
    <GameCheckboxField
      label="Ссылки в чате"
      :model-value="options.chatLinks"
      @update:model-value="options.chatLinks = $event"
    />
    <GameCheckboxField
      label="Спрашивать перед открытием ссылок"
      :model-value="options.chatLinksPrompt"
      @update:model-value="options.chatLinksPrompt = $event"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.chat-options {
  @include mixins.settings-fields-grid;
}
</style>
