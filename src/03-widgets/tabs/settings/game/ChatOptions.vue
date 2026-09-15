<script setup lang="ts">
import type { GameChatVisibility, GameOptions } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import GameNumberField from './GameNumberField.vue'
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
    <GameNumberField
      label="Масштаб чата"
      :min="0"
      :max="1"
      :model-value="options.chatScale"
      @update:model-value="options.chatScale = $event"
    />
    <GameNumberField
      label="Ширина чата"
      :min="0"
      :max="1"
      :model-value="options.chatWidth"
      @update:model-value="options.chatWidth = $event"
    />
    <GameNumberField
      label="Прозрачность фона"
      :min="0"
      :max="1"
      :model-value="options.chatOpacity"
      @update:model-value="options.chatOpacity = $event"
    />
    <GameNumberField
      label="Межстрочный интервал"
      :min="0"
      :max="1"
      :model-value="options.chatLineSpacing"
      @update:model-value="options.chatLineSpacing = $event"
    />
    <GameNumberField
      label="Задержка сообщений"
      :min="0"
      :max="6"
      :model-value="options.chatDelay"
      @update:model-value="options.chatDelay = $event"
    />
    <GameNumberField
      label="Прозрачность фона текста"
      :min="0"
      :max="1"
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
.chat-options {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
  width: 100%;
  max-width: var(--settings-row-width);
  margin-inline: auto;
}
</style>
