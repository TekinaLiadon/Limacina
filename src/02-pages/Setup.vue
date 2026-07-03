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
        <h1 class="setup-title">Настройка лаунчера</h1>
        <p class="setup-description">Укажите папку для хранения файлов лаунчера</p>

        <div class="form-group">
          <Input
            v-model="selectedPath"
            :options="{ placeholder: 'Выберите папку', readonly: true }"
          />
        </div>

        <div v-if="fullDisplayPath" class="setup-preview">
          <span class="setup-preview__label">Путь установки:</span>
          <span class="setup-preview__path">{{ fullDisplayPath }}</span>
        </div>

        <div class="form-actions">
          <Button class="btn-yellow btn-setup" @click="selectFolder">
            Обзор
          </Button>

          <Button
            class="btn-yellow btn-save"
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
  justify-content: flex-start;
  padding: 0;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(
            ellipse at top left,
            rgba(108, 127, 216, 0.08) 0%,
            transparent 50%
    );
    pointer-events: none;
  }
}

.setup-container {
  width: 50%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  position: relative;
  z-index: 1;
}

.setup-form {
  width: 100%;
  max-width: 480px;
  background: var(--login-bg-form);
  backdrop-filter: blur(12px);
  border: 1px solid var(--login-border);
  border-radius: 12px;
  padding: 56px 48px;
  box-shadow: 0 8px 32px var(--login-shadow),
  inset 0 1px 0 rgba(255, 255, 255, 0.05);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    bottom: -1px;
    background: linear-gradient(
            135deg,
            var(--login-accent) 0%,
            transparent 30%,
            transparent 70%,
            var(--login-accent) 100%
    );
    border-radius: 12px;
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: -1;
  }

  &:hover::before {
    opacity: 0.2;
  }
}

.setup-title {
  font-size: 38px;
  font-weight: 700;
  color: var(--login-text-primary);
  text-transform: uppercase;
  margin: 0 0 40px 0;
  text-shadow: 0 2px 8px var(--login-shadow);
  letter-spacing: 1.5px;
}

.setup-description {
  color: var(--login-text-secondary);
  margin: 0 0 32px 0;
  font-size: 15px;
}

.form-group {
  margin-bottom: 24px;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.btn-setup {
  width: 100%;
  height: 48px;
  font-size: 15px;
  background: transparent;
  color: var(--login-text-secondary);
  border: 1px solid rgba(176, 184, 212, 0.2);
  transition: all 0.3s ease;

  &:hover {
    color: var(--login-text-primary);
    border-color: var(--login-border-hover);
    background: rgba(108, 127, 216, 0.08);
  }
}

.btn-save {
  width: 100%;
  height: 52px;
  font-size: 16px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px var(--login-accent-glow);
  }

  &:active {
    transform: translateY(0);
  }
}

.setup-preview {
  margin-bottom: 28px;
  padding: 12px 16px;
  background: rgba(108, 127, 216, 0.08);
  border: 1px solid var(--login-border);
  border-radius: 8px;

  &__label {
    display: block;
    font-size: 12px;
    color: var(--login-text-muted);
    margin-bottom: 4px;
  }

  &__path {
    display: block;
    font-size: 14px;
    color: var(--login-text-primary);
    word-break: break-all;
    font-family: monospace;
  }
}

@media (max-width: 1024px) {
  .setup-container {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .setup-screen {
    padding: 20px;
  }

  .setup-container {
    min-height: auto;
    padding: 20px;
  }

  .setup-form {
    padding: 40px 32px;
  }

  .setup-title {
    font-size: 32px;
  }
}
</style>
