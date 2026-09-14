<script setup lang="ts">
import { computed } from 'vue'
import { Dropdown } from '@/06-shared'
import { useJvmPresets } from '@/04-features'

const props = defineProps<{
  config: {
    jvmArgs: string
    javaVersion: number | null
  }
}>()

const { presetOptions, activePresetId, applyPreset } = useJvmPresets(
  computed(() => props.config),
)
</script>

<template>
  <div class="jvm-preset">
    <span class="jvm-preset__text">Пресет</span>
    <Dropdown
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

  .dropdown {
    flex-shrink: 0;

    .dropdown__value {
      min-width: 200px;
    }
  }
}
</style>
