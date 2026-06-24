<script setup>
import {ref} from "vue";
import Button from "@/06-shared/components/Button.vue";
import {invoke} from '@tauri-apps/api/core';
import Input from "@/06-shared/components/Input.vue";
import Console from "@/03-widgets/Console.vue";

const isLoading = ref(false)
const errorMessage = ref('')

const formData = ref({
  username: '',
  password: '',
  rememberMe: false
});

const downloadMinecraft = async () => {
  await invoke("download_java")
  await invoke('download_minecraft')
  await invoke('download_server_mods')
}

const startMinecraft = async () => {
  await invoke('start_minecraft', {
    username: formData.value.username,
    accessToken: "5730aacc7d65c752b53ca07500e247",
  })
}

const handleLogin = async () => {
  isLoading.value = true
  try {
    await invoke('load_settings_project', {
      projectName: "Cordelia"
    })
    await downloadMinecraft()
    await startMinecraft()
  } catch (e) {
    console.error(e)
    errorMessage.value = String(e)
  } finally {
    isLoading.value = false
  }
}
const start = async () => {
  isLoading.value = !isLoading.value

  await invoke('get_forge', {
    mcVersion: "1.16.5"
  });
  await invoke('download_minecraft_version', {
    version: "1.16.5"
  })
  await invoke('download_all_files')
  await invoke('start_jvm', {
    username: formData.value.username,
    accessToken: "5730aacc7d65c752b53ca07500e247",
    typeMinecraft: "forge",
    mc_version: "1.16.5"
  });
}

</script>

<template>
  <div class="login-screen">
    <div class="login-container">
      <div class="login-form">
        <h1 class="login-title">Вход</h1>

        <div class="form-group">
          <Input
              v-model="formData.username"
              :options="{
              placeholder: 'Никнейм',
            }"
          />
        </div>

        <div class="form-group">
          <Input
              v-model="formData.password"
              :options="{
              placeholder: 'Пароль',
              type: 'password'
            }"
          />
        </div>

        <div class="form-group">
          <label class="checkbox-wrapper">
            <input
                type="checkbox"
                v-model="formData.rememberMe"
                class="checkbox-input"
            />
            <span class="checkbox-label">Сохранить данные</span>
          </label>
        </div>

        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

        <div class="form-actions">
          <Button class="btn-yellow btn-login" :is-loading="isLoading" :is-disabled="isLoading" @protected-click="handleLogin">
            Войти
          </Button>

          <Button class="btn-register">
            Регистрация
          </Button>
        </div>
      </div>
    </div>
    <Console />
  </div>
</template>

<style lang="scss">
.login-screen {
  min-height: 100vh;
  width: 100%;
  background: linear-gradient(135deg, var(--login-bg-primary) 0%, var(--login-bg-secondary) 100%);
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

.login-container {
  width: 50%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  position: relative;
  z-index: 1;
}

.login-form {
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

.login-title {
  font-size: 38px;
  font-weight: 700;
  color: var(--login-text-primary);
  text-transform: uppercase;
  margin: 0 0 40px 0;
  text-shadow: 0 2px 8px var(--login-shadow);
  letter-spacing: 1.5px;
}

.form-group {
  margin-bottom: 24px;

  &:last-of-type {
    margin-bottom: 32px;
  }
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.checkbox-input {
  width: 20px;
  height: 20px;
  margin: 0;
  margin-right: 12px;
  cursor: pointer;
  accent-color: var(--login-accent);

  &:focus {
    outline: 2px solid var(--login-border-hover);
    outline-offset: 2px;
  }
}

.checkbox-label {
  color: var(--login-text-secondary);
  font-size: 15px;
  transition: color 0.2s ease;

  .checkbox-wrapper:hover & {
    color: var(--login-text-primary);
  }
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.error-message {
  color: var(--error);
  font-size: 13px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 8px;
  word-break: break-word;
}

.btn-login {
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

.btn-register {
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

@media (max-width: 1024px) {
  .login-container {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .login-screen {
    padding: 20px;
  }

  .login-container {
    min-height: auto;
    padding: 20px;
  }

  .login-form {
    padding: 40px 32px;
  }

  .login-title {
    font-size: 32px;
  }
}
</style>
