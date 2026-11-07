<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCoreStore, useOptionalModsStore } from '@/05-entities'
import { Checkbox } from '@/06-shared'
import SettingsSection from '../SettingsSection.vue'

const props = defineProps<{
  optionalMods: string[]
}>()

const emit = defineEmits<{
  'update:optionalMods': [value: string[]]
}>()

const optionalModsStore = useOptionalModsStore()
const coreStore = useCoreStore()
const { list } = storeToRefs(optionalModsStore)
const { projectConfig } = storeToRefs(coreStore)

const isVisible = computed((): boolean => {
  const entries = list.value
  const project = projectConfig.value
  return (
    entries !== null &&
    entries.length > 0 &&
    project !== null &&
    project.online === true &&
    project.modLoader !== 'vanilla'
  )
})

const fileName = (path: string): string => {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

const isChecked = (path: string): boolean => props.optionalMods.includes(path)

const toggle = (path: string, value: boolean): void => {
  emit(
    'update:optionalMods',
    value
      ? [...props.optionalMods, path]
      : props.optionalMods.filter((entry) => entry !== path),
  )
}
</script>

<template>
  <SettingsSection v-if="isVisible" title="Необязательные моды" storage-key="project-optional-mods">
    <div class="project-mods">
      <div class="project-mods__list">
        <div
          v-for="entry in list ?? []"
          :key="entry.path"
          class="project-mods__item"
        >
          <Checkbox
            :model-value="isChecked(entry.path)"
            :label="fileName(entry.path)"
            @update:model-value="toggle(entry.path, $event)"
          />
        </div>
      </div>
      <p class="project-mods__hint">
        Эти моды можно не устанавливать. Отключённые моды убираются из игры при запуске и не перекачиваются при включении
      </p>
    </div>
  </SettingsSection>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.project-mods {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__item {
    width: 100%;
  }

  &__item .checkbox {
    width: 100%;
  }

  &__hint {
    @include mixins.caption-hint(left);
  }
}
</style>
