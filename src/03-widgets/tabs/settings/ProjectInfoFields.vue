<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'

defineProps<{
  config: {
    mcVersion: string
    modLoader: string
    loaderVersion: string
    jvmArgs: string
    autoJoinServer: boolean
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
      @update:model-value="config[field.key] = $event"
    />
    <Checkbox
      class="span-full"
      :model-value="config.autoJoinServer"
      label="Автозаход на сервер при запуске"
      @update:model-value="config.autoJoinServer = $event"
    />
  </div>
</template>

<style lang="scss">
.project-info-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--settings-column-width)), 1fr));
  gap: var(--element-gap);
  align-items: center;
  grid-column: 1 / -1;

  > .span-full {
    grid-column: 1 / -1;
    margin-top: var(--space-12);
    justify-self: center;
  }
}
</style>
