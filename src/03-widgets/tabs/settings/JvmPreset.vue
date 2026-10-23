<script setup lang="ts">
import { computed } from 'vue'
import { Dropdown } from '@/06-shared'
import { useJvmPresets } from '@/04-features'

const props = defineProps<{
  jvmArgs: string
  javaVersion: number | null
}>()

const emit = defineEmits<{
  'update:jvmArgs': [value: string]
}>()

const jvmConfig = computed<{ jvmArgs: string; javaVersion: number | null }>({
  get: (): { jvmArgs: string; javaVersion: number | null } => ({
    jvmArgs: props.jvmArgs,
    javaVersion: props.javaVersion,
  }),
  set: (value: { jvmArgs: string; javaVersion: number | null }): void => {
    emit('update:jvmArgs', value.jvmArgs)
  },
})

const { presetOptions, activePresetId, applyPreset } = useJvmPresets(jvmConfig)
</script>

<template>
  <div class="jvm-preset">
    <span class="jvm-preset__text">Пресет</span>
    <Dropdown
      class="jvm-preset__control"
      :options="presetOptions"
      :model-value="activePresetId"
      @update:model-value="applyPreset"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.jvm-preset {
  @include mixins.settings-row-body;

  &__control {
    flex: 1;
    min-width: 0;
  }
}
</style>
