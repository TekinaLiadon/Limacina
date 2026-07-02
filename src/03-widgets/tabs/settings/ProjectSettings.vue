<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input } from '@/06-shared'
import DualRangeSlider from './DualRangeSlider.vue'

const props = defineProps<{
  config: {
    mcVersion: string
    modLoader: string
    loaderVersion: string
    javaPath: string
    jvmArgs: string
    memoryRange: [number, number]
  }
  maxMemoryLimit: number
  isSaving: boolean
}>()

const emit = defineEmits<{
  browseJava: []
  save: []
}>()

const memoryRange = computed({
  get: () => props.config.memoryRange,
  set: (val: [number, number]) => { props.config.memoryRange = val },
})

const readOnlyFields = [
  { key: 'mcVersion' as const, label: 'Версия Minecraft', placeholder: '1.21.1' },
  { key: 'modLoader' as const, label: 'Загрузчик модов', placeholder: 'neoforge' },
  { key: 'loaderVersion' as const, label: 'Версия загрузчика', placeholder: 'Не указана' },
  { key: 'jvmArgs' as const, label: 'JVM аргументы', placeholder: '-XX:+UseG1GC, -XX:MaxGCPauseMillis=50' },
]
</script>

<template>
  <div class="project-settings">
    <div
      v-for="field in readOnlyFields"
      :key="field.key"
      class="project-settings__field"
    >
      <Input
        :model-value="config[field.key]"
        :options="{ label: field.label, placeholder: field.placeholder, disabled: true }"
      />
    </div>

    <div class="project-settings__field">
      <span class="project-settings__label">Путь к Java</span>
      <div class="project-settings__java-row">
        <Input
          :model-value="config.javaPath"
          :options="{ placeholder: 'Выберите папку', disabled: true }"
        />
        <Button class="btn-yellow project-settings__browse-btn" @click="emit('browseJava')">
          Обзор
        </Button>
      </div>
    </div>

    <div class="project-settings__slider">
      <DualRangeSlider
        v-model="memoryRange"
        :min="512"
        :max="maxMemoryLimit"
        :step="512"
        label="Память (min — max)"
        unit="M"
      />
    </div>

    <Button
      class="btn-yellow project-settings__btn"
      :is-loading="isSaving"
      :is-disabled="isSaving"
      @click="emit('save')"
    >
      Сохранить
    </Button>
  </div>
</template>

<style lang="scss">
.project-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__label {
    font-size: 14px;
    color: var(--yellow);
    font-weight: 400;
  }

  &__java-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;

    .input__core {
      flex: 1;
    }
  }

  &__browse-btn {
    height: 40px;
    padding: 0 20px;
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__slider {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 8px;
  }
}
</style>
