<script setup lang="ts">
import { computed } from 'vue'
import { Dropdown, Input, type DropdownOption } from '@/06-shared'
import SettingsSection from '../SettingsSection.vue'
import MemorySlider from '../MemorySlider.vue'
import JvmPreset from '../JvmPreset.vue'

const props = defineProps<{
  javaVersion: number | null
  memoryRange: [number, number]
  jvmArgs: string
  maxMemoryLimit: number
  jvmArgsError: string
  cpuCores: number | null
  availableCpuCores: number
}>()

const emit = defineEmits<{
  'update:memoryRange': [value: [number, number]]
  'update:jvmArgs': [value: string]
  'update:cpuCores': [value: number | null]
}>()

const AUTO_CPU_CORES = 'auto'

const cpuCoresOptions = computed((): DropdownOption[] => {
  const options: DropdownOption[] = [{ value: AUTO_CPU_CORES, title: 'Авто (JVM определит сама)' }]
  for (let cores = 1; cores <= props.availableCpuCores; cores++) {
    options.push({ value: String(cores), title: String(cores) })
  }
  return options
})

const cpuCoresValue = computed((): string => (props.cpuCores === null ? AUTO_CPU_CORES : String(props.cpuCores)))

const handleCpuCoresSelect = (value: string): void => {
  emit('update:cpuCores', value === AUTO_CPU_CORES ? null : Number(value))
}
</script>

<template>
  <SettingsSection title="Запуск" storage-key="project-run">
    <div class="settings-grid">
      <MemorySlider
        :model-value="memoryRange"
        :max="maxMemoryLimit"
        @update:model-value="emit('update:memoryRange', $event)"
      />

      <div class="project-run__cores">
        <div class="project-run__cores-row">
          <span class="project-run__cores-label">Ядра CPU</span>
          <Dropdown
            class="project-run__cores-control"
            :options="cpuCoresOptions"
            :model-value="cpuCoresValue"
            @update:model-value="handleCpuCoresSelect"
          />
        </div>
        <p class="project-run__cores-hint">
          Авто — JVM сама определит число ядер CPU. При выбранном значении N фоновый пул игры получит N−1 потоков.
        </p>
        <p v-if="cpuCores === 1" class="project-run__cores-warning">
          Одно ядро переключит сборщик мусора JVM на SerialGC
        </p>
      </div>

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
  &__cores {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__cores-row {
    @include mixins.settings-row-body;
  }

  &__cores-control {
    min-width: var(--settings-control-min-width);
  }

  &__cores-hint {
    @include mixins.caption-hint(left);
  }

  &__cores-warning {
    @include mixins.error-box;

    margin: 0;
  }

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
