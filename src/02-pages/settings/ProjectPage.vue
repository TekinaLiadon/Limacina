<script setup lang="ts">
import { computed } from 'vue'
import { useProjectSettings } from '@/04-features'
import { ProjectInfoFields, JavaPathPicker, MemorySlider } from '@/03-widgets'
import { Button } from '@/06-shared'

const {
  config,
  maxMemoryLimit,
  isSaving,
  selectJavaFolder,
  handleSave,
} = useProjectSettings()

const memoryRange = computed({
  get: () => config.value.memoryRange,
  set: (val: [number, number]) => { config.value.memoryRange = val },
})
</script>

<template>
  <div class="project-settings">
    <ProjectInfoFields :config="config" />
    <JavaPathPicker :java-path="config.javaPath" @browse="selectJavaFolder" />
    <MemorySlider v-model="memoryRange" :max="maxMemoryLimit" />

    <Button
      class="btn-yellow project-settings__btn"
      :is-loading="isSaving"
      :is-disabled="isSaving"
      @click="handleSave"
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
