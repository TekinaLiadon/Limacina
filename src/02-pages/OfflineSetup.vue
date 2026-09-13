<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { OfflineProfileForm } from '@/03-widgets'
import { useAddProfile } from '@/04-features'
import type { ProjectConfig } from '@/05-entities/core/types'

const router = useRouter()

const {
  offlineForm,
  mcVersionOptions,
  loaderOptions,
  loaderVersionOptions,
  needsLoaderVersion,
  isLoadingMcVersions,
  isLoadingLoaderVersions,
  isSubmitting,
  isOfflineValid,
  errorMessage,
  selectKind,
  submitOffline,
} = useAddProfile()

onMounted(() => {
  void selectKind('offline')
})

const handleOfflineSubmit = async (): Promise<void> => {
  const config: ProjectConfig | null = await submitOffline()
  if (config) router.push({ name: 'Accounts' })
}
</script>

<template>
  <div class="offline-setup">
    <div class="offline-setup__container">
      <div class="offline-setup__form">
        <span class="offline-setup__eyebrow eyebrow">Первый запуск</span>
        <h1 class="offline-setup__title heading-display">Создание профиля</h1>
        <p class="offline-setup__description">
          Офлайн-сборка: создайте профиль одиночной игры, чтобы продолжить
        </p>

        <OfflineProfileForm
          :form="offlineForm"
          :mc-version-options="mcVersionOptions"
          :loader-options="loaderOptions"
          :loader-version-options="loaderVersionOptions"
          :needs-loader-version="needsLoaderVersion"
          :is-loading-mc-versions="isLoadingMcVersions"
          :is-loading-loader-versions="isLoadingLoaderVersions"
          :is-submitting="isSubmitting"
          :is-valid="isOfflineValid"
          :error-message="errorMessage"
          :can-go-back="false"
          @submit="handleOfflineSubmit"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.offline-setup {
  min-height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--layout-padding);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
    background-size: 80px 80px;
    mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    pointer-events: none;
  }
}

.offline-setup__container {
  width: 100%;
  max-width: var(--page-max-width);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.offline-setup__form {
  width: 100%;
  background: var(--login-bg-form);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-modal);
  padding: var(--page-padding-y) var(--page-padding-x);
  box-shadow: var(--elevation-modal);
  text-align: left;
}

.offline-setup__eyebrow {
  display: block;
  margin-bottom: var(--space-12);
}

.offline-setup__title {
  font-size: var(--text-heading);
  margin: 0 0 var(--space-12) 0;
}

.offline-setup__description {
  color: var(--login-text-muted);
  margin: 0 0 var(--title-gap) 0;
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
}

@include breakpoints.media-under-md {
  .offline-setup__form {
    padding: var(--space-32) var(--space-24);
  }
}
</style>
