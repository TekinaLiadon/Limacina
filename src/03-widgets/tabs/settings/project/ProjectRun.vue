<script setup lang="ts">
import { Input } from '@/06-shared'
import SettingsSection from '../SettingsSection.vue'
import MemorySlider from '../MemorySlider.vue'
import JvmPreset from '../JvmPreset.vue'

defineProps<{
  javaVersion: number | null
  memoryRange: [number, number]
  jvmArgs: string
  maxMemoryLimit: number
  jvmArgsError: string
}>()

const emit = defineEmits<{
  'update:memoryRange': [value: [number, number]]
  'update:jvmArgs': [value: string]
}>()
</script>

<template>
  <SettingsSection title="Запуск" storage-key="project-run">
    <div class="settings-grid">
      <MemorySlider
        :model-value="memoryRange"
        :max="maxMemoryLimit"
        @update:model-value="emit('update:memoryRange', $event)"
      />

      <JvmPreset
        class="settings-row"
        :jvm-args="jvmArgs"
        :java-version="javaVersion"
        @update:jvm-args="emit('update:jvmArgs', $event)"
      />

      <div class="project-run__jvm">
        <Input
          :model-value="jvmArgs"
          :options="{ label: 'JVM аргументы', placeholder: '-XX:+UseG1GC, -XX:MaxGCPauseMillis=50' }"
          @update:model-value="emit('update:jvmArgs', $event)"
        />
        <p v-if="jvmArgsError" class="project-run__jvm-error">{{ jvmArgsError }}</p>
      </div>
    </div>
  </SettingsSection>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.project-run {
  &__jvm {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__jvm-error {
    @include mixins.error-box;

    margin: 0;
  }
}
</style>
