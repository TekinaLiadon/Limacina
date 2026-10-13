<script setup lang="ts">
import { Button } from '@/06-shared'
import ModrinthIcon from './ModrinthIcon.vue'
import ModrinthInstallActions from './ModrinthInstallActions.vue'
import ModrinthUpdateBadge from './ModrinthUpdateBadge.vue'

const props = defineProps<{
  variant: 'installed' | 'catalog'
  iconUrl: string | null
  title: string
  versionText: string
  updateVersion: string
  isInstalled: boolean
  isBusy: boolean
  isBusyAny: boolean
  metaText: string
  description?: string
}>()

const emit = defineEmits<{
  update: []
  install: []
  uninstall: []
  details: []
}>()
</script>

<template>
  <article class="modrinth-tab__row">
    <ModrinthIcon :src="props.iconUrl" :title="props.title" />
    <div class="modrinth-tab__row-info">
      <div class="modrinth-tab__row-head">
        <span class="modrinth-tab__row-title">{{ props.title }}</span>
        <span v-if="props.versionText" class="modrinth-tab__badge">{{ props.versionText }}</span>
        <ModrinthUpdateBadge v-if="props.updateVersion" :version="props.updateVersion" />
      </div>
      <p v-if="props.description" class="modrinth-tab__row-description">{{ props.description }}</p>
      <span class="modrinth-tab__row-meta">{{ props.metaText }}</span>
    </div>
    <div class="modrinth-tab__row-actions">
      <ModrinthInstallActions
        :is-installed="props.isInstalled"
        :update-version="props.updateVersion"
        :is-busy="props.isBusy"
        :is-busy-any="props.isBusyAny"
        @update="emit('update')"
        @install="emit('install')"
      />
      <Button
        v-if="props.variant === 'installed'"
        class="btn-danger"
        :is-loading="props.isBusy"
        :is-disabled="props.isBusyAny"
        @click="emit('uninstall')"
      >
        Удалить
      </Button>
      <Button v-else class="btn-secondary" @click="emit('details')">Подробнее</Button>
    </div>
  </article>
</template>
