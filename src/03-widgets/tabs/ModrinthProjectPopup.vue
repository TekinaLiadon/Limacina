<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button, MarkdownText, useFocusTrap } from '@/06-shared'
import ModrinthIcon from './ModrinthIcon.vue'
import { useModrinth, MODRINTH_CATEGORY_LABELS } from '@/04-features'
import type { ModrinthSearchHit, ModrinthProjectDetails, ModrinthVersion } from '@/05-entities/modrinth/types'

const props = withDefaults(defineProps<{
  visible: boolean
  hit: ModrinthSearchHit | null
  isInstalled?: boolean
  updateVersion?: string
  isBusy?: boolean
  isBusyAny?: boolean
}>(), {
  isInstalled: false,
  updateVersion: '',
  isBusy: false,
  isBusyAny: false,
})

const emit = defineEmits<{
  close: []
  install: []
  update: []
}>()

const { fetchProjectDetails } = useModrinth()

const popupRef = ref<HTMLDivElement | null>(null)

useFocusTrap(popupRef, (): boolean => props.visible)

const details = ref<ModrinthProjectDetails | null>(null)
const isLoading = ref(false)
const expandedChangelogs = ref<Set<string>>(new Set())

const sideLabels: Record<string, string> = {
  required: 'обязателен',
  optional: 'опционален',
  unsupported: 'не поддерживается',
  unknown: 'неизвестно',
}

const versionTypeLabels: Record<string, string> = {
  release: 'релиз',
  beta: 'бета',
  alpha: 'альфа',
}

const authorText = computed((): string => {
  const { hit } = props
  if (hit === null || hit.author === null) return ''
  return `Автор: ${hit.author}`
})

const statText = computed((): string => {
  const { hit } = props
  if (hit === null) return ''
  return `${formatNumber(hit.downloads)} загрузок · ${formatNumber(hit.follows)} подписчиков`
})

const sideText = computed((): string => {
  const project = details.value?.project
  if (!project) return ''
  return `Клиент: ${sideLabels[project.client_side ?? 'unknown'] ?? project.client_side} · Сервер: ${sideLabels[project.server_side ?? 'unknown'] ?? project.server_side}`
})

const links = computed((): Array<{ label: string; url: string }> => {
  const project = details.value?.project
  if (!project) return []
  const result: Array<{ label: string; url: string }> = []
  if (project.source_url) result.push({ label: 'Исходный код', url: project.source_url })
  if (project.issues_url) result.push({ label: 'Сообщить об ошибке', url: project.issues_url })
  if (project.wiki_url) result.push({ label: 'Вики', url: project.wiki_url })
  if (project.discord_url) result.push({ label: 'Discord', url: project.discord_url })
  return result
})

const licenseText = computed((): string => {
  const license = details.value?.project.license
  if (!license) return ''
  return license.name ?? license.id
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value)
}

function formatDate(value: string | null): string {
  if (value === null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU')
}

async function loadDetails(): Promise<void> {
  const { hit } = props
  if (hit === null) return
  isLoading.value = true
  details.value = null
  expandedChangelogs.value = new Set()
  await fetchProjectDetails(hit.project_id).then((result) => {
    details.value = result
  })
  isLoading.value = false
}

function hasChangelog(version: ModrinthVersion): boolean {
  return version.changelog !== null && version.changelog !== ''
}

function toggleChangelog(versionId: string): void {
  const next = new Set(expandedChangelogs.value)
  if (next.has(versionId)) {
    next.delete(versionId)
  } else {
    next.add(versionId)
  }
  expandedChangelogs.value = next
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) void loadDetails()
  },
)

function handleEsc(e: KeyboardEvent): void {
  if (props.visible && e.key === 'Escape') emit('close')
}

onMounted((): void => {
  window.addEventListener('keydown', handleEsc)
})

onBeforeUnmount((): void => {
  window.removeEventListener('keydown', handleEsc)
})

function handleLink(url: string): void {
  void openUrl(url)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="modrinth-popup-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
        <div ref="popupRef" class="modrinth-popup popup-panel" role="dialog" aria-modal="true">
          <div class="modrinth-popup__head">
            <ModrinthIcon :src="hit?.icon_url ?? null" :title="hit?.title ?? '?'" size="lg" />
            <div class="modrinth-popup__head-info">
              <h3 class="modrinth-popup__title">{{ hit?.title }}</h3>
              <p v-if="authorText" class="modrinth-popup__meta">{{ authorText }}</p>
              <p v-if="statText" class="modrinth-popup__meta">{{ statText }}</p>
            </div>
            <Button
              v-if="updateVersion"
              class="btn-primary modrinth-popup__action"
              :is-loading="isBusy ?? false"
              :is-disabled="isBusyAny ?? false"
              @click="emit('update')"
            >
              Обновить
            </Button>
            <Button
              v-else-if="!isInstalled"
              class="btn-primary modrinth-popup__action"
              :is-loading="isBusy ?? false"
              :is-disabled="isBusyAny ?? false"
              @click="emit('install')"
            >
              Скачать
            </Button>
            <span v-else class="modrinth-popup__installed-badge">Установлен</span>
            <Button class="btn-quiet modrinth-popup__close" @click="emit('close')">
              Закрыть
            </Button>
          </div>

          <div v-if="isLoading" class="modrinth-popup__loading">
            <span class="modrinth-popup__spinner" aria-hidden="true" />
            <span>Загрузка информации...</span>
          </div>

          <div v-else-if="details" class="modrinth-popup__content">
            <div class="modrinth-popup__info">
              <p class="modrinth-popup__info-row">
                <span class="modrinth-popup__info-item">{{ sideText }}</span>
                <span v-if="licenseText" class="modrinth-popup__info-item">Лицензия: {{ licenseText }}</span>
              </p>
              <p class="modrinth-popup__info-row">
                <span class="modrinth-popup__info-item">Создан: {{ formatDate(details.project.date_created) }}</span>
                <span class="modrinth-popup__info-item">Обновлён: {{ formatDate(details.project.date_modified) }}</span>
              </p>
              <div v-if="details.project.categories.length > 0" class="modrinth-popup__chips">
                <span v-for="category in details.project.categories" :key="category" class="modrinth-popup__chip">
                  {{ MODRINTH_CATEGORY_LABELS[category] ?? category }}
                </span>
              </div>
            </div>

            <p class="modrinth-popup__description">{{ details.project.description }}</p>

            <MarkdownText class="modrinth-popup__body" :source="details.project.body" />

            <h4 class="modrinth-popup__versions-title">Версии ({{ details.versions.length }})</h4>
            <div class="modrinth-popup__versions">
              <div v-for="version in details.versions" :key="version.id" class="modrinth-popup__version">
                <span class="modrinth-popup__version-number">{{ version.version_number }}</span>
                <span class="modrinth-popup__version-meta">
                  {{ versionTypeLabels[version.version_type] ?? version.version_type }} ·
                  {{ version.loaders.join(', ') }} ·
                  {{ formatDate(version.date_published) }} ·
                  {{ formatNumber(version.downloads) }} загрузок
                </span>
                <Button
                  v-if="hasChangelog(version)"
                  class="btn-quiet modrinth-popup__changelog-toggle"
                  @click="toggleChangelog(version.id)"
                >
                  {{ expandedChangelogs.has(version.id) ? 'Скрыть изменения' : 'Изменения' }}
                </Button>
                <MarkdownText
                  v-if="hasChangelog(version) && expandedChangelogs.has(version.id)"
                  class="modrinth-popup__changelog"
                  :source="version.changelog ?? ''"
                />
              </div>
            </div>
          </div>

          <p v-else class="modrinth-popup__error">Не удалось загрузить информацию о моде</p>

          <div v-if="links.length > 0" class="modrinth-popup__footer">
            <Button
              v-for="link in links"
              :key="link.url"
              class="btn-secondary modrinth-popup__link"
              @click="handleLink(link.url)"
            >
              {{ link.label }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
  text-align: left;
}

.modrinth-popup {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
  width: min(720px, calc(100vw - var(--space-16) * 2));
  height: min(85vh, 720px);
  background: var(--login-bg-form);
  border-radius: var(--radius-modal);
  padding: var(--card-padding);
  box-shadow: var(--elevation-modal);

  &__head {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    flex-shrink: 0;
  }

  &__head-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__title {
    font-size: var(--text-title);
    line-height: var(--leading-title);
    overflow-wrap: anywhere;
  }

  &__meta {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__close {
    flex-shrink: 0;
  }

  &__action {
    flex-shrink: 0;
  }

  &__installed-badge {
    flex-shrink: 0;
    padding: var(--space-4) var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    color: var(--accent-text);
    font-size: var(--text-caption);
    white-space: nowrap;
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
    flex: 1 1 0;
    height: 0;
    overflow-y: auto;
    padding-right: var(--space-4);
  }

  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    padding: var(--space-24) 0;
  }

  &__spinner {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-circle);
    border: 2px solid var(--surface-light);
    border-top-color: var(--accent-primary);
    animation: modrinth-popup-spin var(--duration-spin) linear infinite;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }

  &__info-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-12);
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-body);
  }

  &__info-item {
    color: var(--login-text-secondary);
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  &__chip {
    padding: var(--space-4) var(--space-8);
    border-radius: var(--radius-badge);
    background: var(--surface-light);
    color: var(--login-text-muted);
    font-size: var(--text-caption);
  }

  &__description {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--leading-body);
  }

  &__body {
    font-size: var(--text-caption);
    line-height: var(--leading-body);
    color: var(--login-text-secondary);
    padding: var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }

  &__versions-title {
    margin: 0;
    font-size: var(--text-subtitle);
  }

  &__versions {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__version {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    text-align: left;
  }

  &__version-number {
    font-weight: var(--weight-semibold);
    overflow-wrap: anywhere;
  }

  &__version-meta {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__changelog-toggle {
    min-height: var(--control-height-sm);
    padding: var(--space-4) var(--space-12);
  }

  &__changelog {
    width: 100%;
    max-height: calc(var(--space-48) * 5);
    overflow-y: auto;
    text-align: left;
    font-size: var(--text-caption);
    line-height: var(--leading-body);
    color: var(--login-text-secondary);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }


  &__footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: var(--space-4);
    padding-top: var(--space-8);
    border-top: 1px solid var(--surface-light);
  }

  &__link {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  &__error {
    margin: 0;
    color: var(--error);
  }
}

@keyframes modrinth-popup-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
