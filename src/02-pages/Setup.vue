<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'
import { initializeLauncher } from '@/06-shared/api'
import { Button, Input } from '@/06-shared'
import { open } from '@tauri-apps/plugin-dialog'

const router = useRouter()
const coreStore = useCoreStore()
const { defaultParentPath, launcherName } = storeToRefs(coreStore)
const selectedPath = ref<string>('')
const isLoading = ref<boolean>(false)

watch(defaultParentPath, (val: string | null) => {
  if (val) selectedPath.value = val
}, { immediate: true })

const fullDisplayPath = computed((): string => {
  if (!selectedPath.value || !launcherName.value) return ''

  const sep: string = selectedPath.value.includes('\\') ? '\\' : '/'
  return `${selectedPath.value}${sep}${launcherName.value}`
})

const selectFolder = async (): Promise<void> => {
  const selected = await open({ directory: true })
  if (selected) selectedPath.value = selected
}

const save = async (): Promise<void> => {
  isLoading.value = true
  try {
    const config = await initializeLauncher(selectedPath.value)
    coreStore.launcherConfig = config
    coreStore.hasLauncherConfig = true
    router.push('/')
  } catch (e: unknown) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="setup-screen">
    <div class="setup-container">
      <div class="setup-form">
        <span class="setup-eyebrow eyebrow">Первый запуск</span>
        <h1 class="setup-title heading-display">Настройка лаунчера</h1>
        <p class="setup-description">Укажите папку для хранения файлов лаунчера</p>

        <div class="form-group">
          <Input
            v-model="selectedPath"
            :options="{ placeholder: 'Выберите папку', readonly: true }"
          />
        </div>

        <div v-if="fullDisplayPath" class="setup-preview">
          <span class="setup-preview__label eyebrow">Путь установки</span>
          <span class="setup-preview__path">{{ fullDisplayPath }}</span>
        </div>

        <div class="form-actions">
          <Button class="btn-secondary btn-block btn-setup" @click="selectFolder">
            Обзор
          </Button>

          <Button
            class="btn-primary btn-lg btn-block"
            :is-loading="isLoading"
            :is-disabled="isLoading || !selectedPath"
            @click="save"
          >
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.setup-screen {
  min-height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-20);
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

.setup-container {
  width: 100%;
  max-width: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.setup-form {
  width: 100%;
  max-width: 480px;
  background: var(--login-bg-form);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-modal);
  padding: var(--space-40) var(--space-32);
  box-shadow: var(--elevation-modal);
  text-align: left;
}

.setup-eyebrow {
  margin-bottom: var(--space-12);
}

.setup-title {
  font-size: var(--text-heading);
  margin: 0 0 var(--space-12) 0;
}

.setup-description {
  color: var(--login-text-muted);
  margin: 0 0 var(--space-32) 0;
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
}

.form-group {
  margin-bottom: var(--space-16);
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.btn-setup {
  min-height: 44px;
}

.setup-preview {
  margin-bottom: var(--space-24);
  padding: var(--space-12);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);
  border-radius: var(--radius-card);

  &__label {
    display: block;
    margin-bottom: var(--space-4);
  }

  &__path {
    display: block;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    word-break: break-all;
    font-family: var(--font-mono);
    letter-spacing: normal;
  }
}

@media (max-width: 768px) {
  .setup-form {
    padding: var(--space-32) var(--space-24);
  }
}
</style>
