<script setup lang="ts">
import { computed } from 'vue'
import { Button, PopupShell } from '@/06-shared'
import type {
  ModrinthExportMod,
  ModrinthExportReport,
  ModrinthImportPreview,
  ModrinthImportReport,
  ModrinthModsetEntry,
  ModrinthModsetStatus,
} from '@/05-entities'
import type { ModrinthModsetView } from '@/04-features'

const props = defineProps<{
  visible: boolean
  view: ModrinthModsetView | null
  exportReport: ModrinthExportReport | null
  importPreview: ModrinthImportPreview | null
  importReport: ModrinthImportReport | null
  installedIds: Set<string>
  isBusy: boolean
  actionError: string
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const STATUS_LABELS: Record<ModrinthModsetStatus, string> = {
  ready: 'Готов к установке',
  skipped: 'Пропущен',
  installed: 'Установлен',
  already_installed: 'Уже установлен',
  failed: 'Ошибка',
}

const title = computed((): string => {
  if (props.view === 'export') return 'Сохранить набор'
  if (props.view === 'import-preview') return 'Импорт набора'
  return 'Отчёт импорта'
})

const confirmLabel = computed((): string => (props.view === 'export' ? 'Сохранить' : 'Установить'))

const showConfirm = computed((): boolean => props.view === 'export' || props.view === 'import-preview')

const exportMods = computed((): ModrinthExportMod[] => props.exportReport?.mods ?? [])

const unresolved = computed((): ModrinthExportReport['unresolved'] => props.exportReport?.unresolved ?? [])

const isImportPreview = computed((): boolean => props.view === 'import-preview')

const importEntries = computed((): ModrinthModsetEntry[] | null => {
  if (isImportPreview.value) return props.importPreview?.entries ?? null
  if (props.view === 'import-report') return props.importReport?.entries ?? null
  return null
})

function entryName(entry: ModrinthExportMod | ModrinthModsetEntry): string {
  return entry.title ?? entry.filename ?? entry.slug ?? entry.project_id ?? 'Неизвестный мод'
}

function entryVersion(entry: ModrinthExportMod | ModrinthModsetEntry): string {
  const version = entry.version_number
  return version ? version : 'версия не указана'
}

function isEntryInstalled(entry: ModrinthModsetEntry): boolean {
  if (entry.project_id === null || entry.project_id === undefined) return false
  return props.installedIds.has(entry.project_id)
}

function entryKey(entry: ModrinthExportMod | ModrinthModsetEntry, index: number): string {
  return `${entry.project_id ?? entry.slug ?? entry.filename ?? index}-${index}`
}
</script>

<template>
  <PopupShell :visible="props.visible" aria-label="Набор модов" panel-class="modrinth-modset-popup" @close="emit('close')">
    <h3 class="modrinth-modset-popup__title">{{ title }}</h3>

    <div v-if="props.view === 'export'" class="modrinth-modset-popup__list">
      <div v-for="(mod, index) in exportMods" :key="entryKey(mod, index)" class="modrinth-modset-popup__row">
        <span class="modrinth-modset-popup__name">{{ entryName(mod) }}</span>
        <span class="modrinth-modset-popup__version">{{ entryVersion(mod) }}</span>
      </div>

      <div v-if="unresolved.length > 0" class="modrinth-modset-popup__unresolved">
        <h4 class="modrinth-modset-popup__unresolved-title">Не вошли</h4>
        <p v-for="item in unresolved" :key="item.filename" class="modrinth-modset-popup__unresolved-row">
          {{ item.filename }} — {{ item.reason }}
        </p>
      </div>
    </div>

    <div v-else-if="importEntries" class="modrinth-modset-popup__list">
      <div
        v-for="(entry, index) in importEntries"
        :key="entryKey(entry, index)"
        class="modrinth-modset-popup__row"
      >
        <div class="modrinth-modset-popup__row-head">
          <span class="modrinth-modset-popup__name">{{ entryName(entry) }}</span>
          <span class="modrinth-modset-popup__version">{{ entryVersion(entry) }}</span>
        </div>
        <div class="modrinth-modset-popup__row-status">
          <span class="modrinth-modset-popup__status" :class="`modrinth-modset-popup__status--${entry.status}`">
            {{ STATUS_LABELS[entry.status] }}
          </span>
          <span
            v-if="isImportPreview && entry.status === 'ready' && isEntryInstalled(entry)"
            class="modrinth-modset-popup__status"
          >
            Уже установлен
          </span>
          <span v-if="entry.message" class="modrinth-modset-popup__message">{{ entry.message }}</span>
        </div>
      </div>
    </div>

    <div v-if="props.actionError" class="modrinth-modset-popup__error">{{ props.actionError }}</div>

    <div class="modrinth-modset-popup__actions">
      <Button
        v-if="showConfirm"
        v-focus
        class="btn-primary modrinth-modset-popup__confirm"
        :is-loading="props.isBusy"
        :is-disabled="props.isBusy"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </Button>
      <Button class="btn-quiet modrinth-modset-popup__close" @click="emit('close')">Закрыть</Button>
    </div>
  </PopupShell>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-modset-popup {
  @include mixins.popup-card(none, var(--modrinth-popup-width));

  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
  height: var(--modrinth-popup-height);
  text-align: left;

  &__title {
    margin: 0;
    font-size: var(--text-heading-sm);
    line-height: var(--leading-heading);
    overflow-wrap: anywhere;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1 1 0;
    height: 0;
    overflow-y: auto;
    padding-right: var(--space-4);
  }

  &__row {
    @include mixins.subtle-card(var(--space-8) var(--space-12));

    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
  }

  &__name {
    font-weight: var(--weight-medium);
    overflow-wrap: anywhere;
  }

  &__version {
    @include mixins.caption-hint(right);

    flex-shrink: 0;
  }

  &__row-status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  &__status {
    @include mixins.badge;
  }

  &__status--failed {
    color: var(--error);
  }

  &__message {
    @include mixins.caption-hint(left);

    overflow-wrap: anywhere;
  }

  &__unresolved {
    @include mixins.subtle-card(var(--space-8) var(--space-12));

    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__unresolved-title {
    margin: 0;
    font-size: var(--text-subheading);
  }

  &__unresolved-row {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-body);
    color: var(--login-text-secondary);
    overflow-wrap: anywhere;
  }

  &__error {
    @include mixins.error-box;

    flex-shrink: 0;
  }

  &__actions {
    display: flex;
    gap: var(--space-8);
    flex-shrink: 0;
  }

  &__confirm,
  &__close {
    flex: 1;
    min-height: var(--control-height);
  }
}
</style>
