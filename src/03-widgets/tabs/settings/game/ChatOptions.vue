<script setup lang="ts">
import type { GameChatVisibility, GameOptions } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import GameSliderField from './GameSliderField.vue'
import GameDropdownField from './GameDropdownField.vue'
import GameCheckboxField from './GameCheckboxField.vue'

const props = defineProps<{
  options: GameOptions
}>()

const emit = defineEmits<{ 'update:options': [GameOptions] }>()

const patch = <K extends keyof GameOptions>(key: K, value: GameOptions[K]): void => {
  emit('update:options', { ...props.options, [key]: value })
}

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
      @update:model-value="patch('chatVisibility', $event as GameChatVisibility)"
    />
    <GameSliderField
      label="Масштаб чата"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatScale"
      @update:model-value="patch('chatScale', $event)"
    />
    <GameSliderField
      label="Ширина чата"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatWidth"
      @update:model-value="patch('chatWidth', $event)"
    />
    <GameSliderField
      label="Прозрачность фона"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatOpacity"
      @update:model-value="patch('chatOpacity', $event)"
    />
    <GameSliderField
      label="Межстрочный интервал"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.chatLineSpacing"
      @update:model-value="patch('chatLineSpacing', $event)"
    />
    <GameSliderField
      label="Задержка сообщений"
      :min="0"
      :max="6"
      :step="0.5"
      :model-value="options.chatDelay"
      @update:model-value="patch('chatDelay', $event)"
    />
    <GameSliderField
      label="Прозрачность фона текста"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="options.textBackgroundOpacity"
      @update:model-value="patch('textBackgroundOpacity', $event)"
    />
    <GameCheckboxField
      label="Цвета в чате"
      :model-value="options.chatColors"
      @update:model-value="patch('chatColors', $event)"
    />
    <GameCheckboxField
      label="Ссылки в чате"
      :model-value="options.chatLinks"
      @update:model-value="patch('chatLinks', $event)"
    />
    <GameCheckboxField
      label="Спрашивать перед открытием ссылок"
      :model-value="options.chatLinksPrompt"
      @update:model-value="patch('chatLinksPrompt', $event)"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.chat-options {
  @include mixins.settings-fields-grid;
}
</style>
