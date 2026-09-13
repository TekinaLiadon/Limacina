<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox, Dropdown, Input } from '@/06-shared'
import { useJvmPresets } from '@/04-features'

const props = defineProps<{
  config: {
    mcVersion: string
    modLoader: string
    loaderVersion: string
    jvmArgs: string
    javaVersion: number | null
    autoJoinServer: boolean
  }
}>()

const fields = [
  { key: 'mcVersion' as const, label: 'Версия Minecraft', placeholder: '1.21.1', disabled: true },
  { key: 'modLoader' as const, label: 'Загрузчик модов', placeholder: 'neoforge', disabled: true },
  { key: 'loaderVersion' as const, label: 'Версия загрузчика', placeholder: 'Не указана' },
]

const { presetOptions, activePresetId, applyPreset } = useJvmPresets(
  computed(() => props.config),
)
</script>

<template>
  <div class="project-info-fields">
    <Input
      v-for="field in fields"
      :key="field.key"
      :model-value="config[field.key]"
      :options="{ label: field.label, placeholder: field.placeholder, disabled: field?.disabled ?? false }"
      @update:model-value="config[field.key] = $event"
    />
    <div class="project-info-fields__jvm">
      <Input
        :model-value="config.jvmArgs"
        :options="{ label: 'JVM аргументы', placeholder: '-XX:+UseG1GC, -XX:MaxGCPauseMillis=50' }"
        @update:model-value="config.jvmArgs = $event"
      />
      <div class="project-info-fields__preset">
        <span class="project-info-fields__preset-label">Пресет оптимизации</span>
        <Dropdown
          :options="presetOptions"
          :model-value="activePresetId"
          @update:model-value="applyPreset"
        />
      </div>
    </div>
    <Checkbox
      class="span-full"
      :model-value="config.autoJoinServer"
      label="Автозаход на сервер при запуске"
      @update:model-value="config.autoJoinServer = $event"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.project-info-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--settings-column-width)), 1fr));
  gap: var(--element-gap);
  align-items: center;
  grid-column: 1 / -1;

  &__jvm {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__preset {
    @include mixins.settings-row-body;
  }

  &__preset-label {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--login-text-muted);
  }

  &__preset .dropdown {
    flex-shrink: 0;

    .dropdown__value {
      min-width: 200px;
    }
  }

  > .span-full {
    grid-column: 1 / -1;
    margin-top: var(--space-12);
    justify-self: center;
  }
}
</style>
