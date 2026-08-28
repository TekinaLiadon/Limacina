<script setup lang="ts">
import { Input } from '@/06-shared'

defineProps<{
  config: {
    mcVersion: string
    modLoader: string
    loaderVersion: string
    jvmArgs: string
  }
}>()

const fields = [
  { key: 'mcVersion' as const, label: 'Версия Minecraft', placeholder: '1.21.1', disabled: true },
  { key: 'modLoader' as const, label: 'Загрузчик модов', placeholder: 'neoforge', disabled: true },
  { key: 'loaderVersion' as const, label: 'Версия загрузчика', placeholder: 'Не указана' },
  { key: 'jvmArgs' as const, label: 'JVM аргументы', placeholder: '-XX:+UseG1GC, -XX:MaxGCPauseMillis=50' },
]
</script>

<template>
  <div class="project-info-fields">
    <Input
      v-for="field in fields"
      :key="field.key"
      :model-value="config[field.key]"
      :options="{ label: field.label, placeholder: field.placeholder, disabled: field?.disabled }"
    />
  </div>
</template>

<style lang="scss">
.project-info-fields {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
}
</style>
