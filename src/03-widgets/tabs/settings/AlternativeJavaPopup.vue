<script setup lang="ts">
import { computed } from 'vue'
import { Button, Checkbox, Dropdown, Input, PopupShell, Preloader, ProgressBar, Skeleton } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities'
import LoadErrorRow from '@/03-widgets/common/LoadErrorRow.vue'
import { alternativeJavaModelDefaults, useAlternativeJavaModels, type AlternativeJavaModelProps } from './alternativeJavaModels'

const BYTES_PER_MB = 1024 * 1024

const props = withDefaults(defineProps<{
  visible: boolean
  distributions: JavaDistribution[]
  isDownloading: boolean
  downloaded?: number
  total?: number
  phase?: 'download' | 'extract'
  isDistributionsLoading: boolean
  distributionsError: string
  versionError: string
} & AlternativeJavaModelProps>(), { ...alternativeJavaModelDefaults, downloaded: 0, total: 0, phase: 'download' })

const emit = defineEmits<{
  close: []
  download: []
  cancel: []
  retry: []
  'update:selectedDistribution': [string]
  'update:replaceDefault': [boolean]
  'update:versionInput': [string]
}>()

const { selectedDistribution, replaceDefault, versionInput } = useAlternativeJavaModels(props)

const dropdownOptions = computed((): { title: string; value: string }[] =>
  props.distributions.map((d) => ({ title: d.name, value: d.name })),
)

const downloadProgress = computed((): number => {
  if (props.total <= 0) return 0
  return (props.downloaded / props.total) * 100
})

const isExtractPhase = computed((): boolean => props.phase === 'extract')

const hasTotal = computed((): boolean => props.total > 0)

const formatMegabytes = (bytes: number): string => {
  const value = (bytes / BYTES_PER_MB).toFixed(1)
  return value.endsWith('.0') ? value.slice(0, -2) : value
}

const downloadedLabel = computed((): string => `Скачано: ${formatMegabytes(props.downloaded)} МБ`)
</script>

<template>
  <PopupShell :visible="visible" aria-label="Загрузка Java" panel-class="alt-java-popup" @close="emit('close')">
    <template v-if="!isDownloading">
      <h3 class="alt-java-popup__title">Загрузка Java</h3>
      <div class="alt-java-popup__form">
        <div class="alt-java-popup__field">
          <span class="alt-java-popup__label eyebrow">Вендор</span>
          <Dropdown
            v-if="distributions.length > 0"
            v-model="selectedDistribution"
            :options="dropdownOptions"
            width="100%"
          />
          <Skeleton
            v-else-if="isDistributionsLoading"
            variant="line"
            height="var(--control-height)"
            aria-hidden="true"
          />
          <LoadErrorRow
            v-else-if="distributionsError"
            :message="distributionsError"
            :is-loading="isDistributionsLoading"
            @retry="emit('retry')"
          />
          <span v-else class="alt-java-popup__empty">
            Доступные дистрибутивы не найдены
          </span>
        </div>
        <div class="alt-java-popup__field">
          <span class="alt-java-popup__label eyebrow">Версия Java</span>
          <Input
            v-model="versionInput"
            :options="{ placeholder: 'Авто (на основе MC)' }"
          />
          <span v-if="versionError" class="alt-java-popup__version-error">
            {{ versionError }}, будет использована версия по умолчанию
          </span>
        </div>
        <Checkbox
          v-model="replaceDefault"
          label="Заменить Java по умолчанию"
        />
        <div class="alt-java-popup__actions">
          <Button
            class="btn-primary alt-java-popup__btn"
            :is-disabled="distributions.length === 0 || selectedDistribution === ''"
            @click="emit('download')"
          >
            Загрузить
          </Button>
          <Button
            v-focus
            class="btn-quiet alt-java-popup__btn"
            @click="emit('close')"
          >
            Отмена
          </Button>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="alt-java-popup__loading">
        <span v-if="isExtractPhase" class="alt-java-popup__phase">Распаковка…</span>
        <template v-else>
          <ProgressBar
            v-if="hasTotal"
            :progress="downloadProgress"
            aria-label="Прогресс загрузки Java"
          />
          <div v-else class="alt-java-popup__preloader-area">
            <Preloader local text="Загрузка" />
          </div>
          <span v-if="!hasTotal" class="alt-java-popup__downloaded">{{ downloadedLabel }}</span>
        </template>
        <div class="alt-java-popup__actions">
          <Button
            v-focus
            class="btn-quiet alt-java-popup__btn"
            @click="emit('cancel')"
          >
            Отмена
          </Button>
        </div>
      </div>
    </template>
  </PopupShell>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.alt-java-popup {
  @include mixins.popup-card;

  &__title {
    @include mixins.popup-title;

    margin: 0 0 var(--space-20) 0;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    text-align: left;
  }

  &__empty {
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
  }

  &__version-error {
    font-size: var(--text-caption);
    color: var(--error);
    text-align: left;
    word-break: break-word;
  }

  @include mixins.popup-actions('&__btn');

  &__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__preloader-area {
    position: relative;
    min-height: var(--skeleton-card-height);
  }

  &__phase {
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
    text-align: left;
  }

  &__downloaded {
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
}
</style>
