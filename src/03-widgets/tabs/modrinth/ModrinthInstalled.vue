<script setup lang="ts">
import { computed } from 'vue'
import { Button, Skeleton } from '@/06-shared'
import type { ModrinthInstalledMod } from '@/05-entities'
import ModrinthRow from './ModrinthRow.vue'

const props = defineProps<{
  mods: ModrinthInstalledMod[]
  updates: Record<string, string>
  installingId: string | null
  isLoading: boolean
  isOpeningFolder: boolean
  isCheckingUpdates: boolean
  actionError: string
  installedError: string
}>()

const emit = defineEmits<{
  'open-folder': []
  'check-updates': []
  update: [projectId: string]
  uninstall: [projectId: string]
}>()

const errorTexts = computed((): string[] => {
  const texts = [props.actionError, props.installedError]
  return Array.from(new Set(texts.filter((text: string): boolean => text !== '')))
})
</script>

<template>
  <div class="modrinth-installed">
    <div class="modrinth-installed__head">
      <Button
        class="btn-secondary"
        :is-loading="props.isOpeningFolder"
        :is-disabled="props.isOpeningFolder"
        @click="emit('open-folder')"
      >
        Открыть папку модов
      </Button>
      <Button
        class="btn-secondary"
        :is-loading="props.isCheckingUpdates"
        :is-disabled="props.isCheckingUpdates || props.mods.length === 0"
        @click="emit('check-updates')"
      >
        Проверить обновления
      </Button>
    </div>

    <div v-for="text in errorTexts" :key="text" class="modrinth-installed__error">{{ text }}</div>

    <div v-if="props.isLoading" class="modrinth-installed__list" aria-hidden="true">
      <div v-for="index in 5" :key="index" class="modrinth-row">
        <Skeleton variant="list-item" icon-shape="square" :lines="4" flat size="lg" />
      </div>
    </div>
    <p v-else-if="props.mods.length === 0 && !props.installedError" class="modrinth-installed__empty">
      Пока ничего не установлено, найдите моды в каталоге
    </p>
    <div v-else class="modrinth-installed__list">
      <ModrinthRow
        v-for="mod in props.mods"
        :key="mod.project_id"
        variant="installed"
        :icon-url="mod.icon_url"
        :title="mod.title"
        :version-text="mod.version_number"
        :update-version="props.updates[mod.project_id] ?? ''"
        :is-installed="true"
        :is-busy="props.installingId === mod.project_id"
        :is-busy-any="props.installingId !== null"
        :meta-text="mod.filename"
        @update="emit('update', mod.project_id)"
        @uninstall="emit('uninstall', mod.project_id)"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-installed {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__empty {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__error {
    @include mixins.error-box;
  }
}
</style>
