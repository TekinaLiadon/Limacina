<script setup>
import {nextTick, ref} from "vue";
import Button from "@/06-shared/components/Button.vue";
import {invoke} from '@tauri-apps/api/core';
import Input from "@/06-shared/components/Input.vue";
import {listen} from '@tauri-apps/api/event';
import Console from "@/03-widgets/Console.vue";

const isLoading = ref(false)
const isConsole = ref(false)

const formData = ref({
  username: '',
  password: '',
  rememberMe: false
});
const debug = ref('Test')
const start = async () => {
  isLoading.value = !isLoading.value
  /*const result1 = await invoke('get_forge', {
    mcVersion: "1.20.1"
  }); */ //TODO проверка если уже скачено
  /*await listen('successDownloadMinecraft', async () => {
    await invoke('get_fabric', {
      mcVersion: "1.20.1"
    })
  })*/
  debug.value = 'Скачивание 4092 файлов Minecraft'
  debug.value = await invoke('download_minecraft_version', {
    version: "1.20.1"
  })
  debug.value = await invoke('get_fabric', {
    mcVersion: "1.20.1"
  })
  /*
  await listen('totalFile', (event) => {
    fileInfo.value.total = event.payload
  });
  await listen('numberFile', (event) => {
    const { file, number } = event.payload
    console.log(`Загружается файл ${number}: ${file}`);
  });
  await listen('progress', (event) => {
    const { percent, read, total } = event.payload
    progress.value.percent = percent
    progress.value.read = read
    progress.value.total = total
  });
   */
  debug.value = await invoke('download_all_files')
  isConsole.value = !isConsole.value
  await nextTick()
  debug.value = await invoke('start_jvm', {
    username: formData.value.username,
    accessToken: "5730aacc7d65c752b53ca07500e247",
    typeMinecraft: "fabric"
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

        <div class="form-actions">
          <Button class="btn-yellow btn-login" :is-loading="isLoading" :is-disabled="isLoading" @click="start">
            Войти
          </Button>

          <Button class="btn-register">
            Регистрация
          </Button>
        </div>
      </div>
    </div>
    <div style="font-size: 28px; color: wheat;" v-if="!isConsole">
      {{ debug }}
    </div>
    <Console v-else />
  </div>
</template>

<style lang="scss">
$color-bg-primary: #1a1d2e;
$color-bg-secondary: #16213e;
$color-bg-form: rgba(26, 29, 46, 0.95);
$color-border: rgba(139, 172, 255, 0.25);
$color-border-hover: rgba(139, 172, 255, 0.5);

$color-text-primary: #e8eaf6;
$color-text-secondary: #b0b8d4;
$color-text-muted: #7a82a0;

$color-accent-primary: #6c7fd8;
$color-accent-hover: #8b9fe8;
$color-accent-glow: rgba(108, 127, 216, 0.4);

$color-shadow: rgba(0, 0, 0, 0.3);
$color-shadow-strong: rgba(0, 0, 0, 0.6);

.login-screen {
  min-height: 100vh;
  width: 100%;
  background: linear-gradient(135deg, $color-bg-primary 0%, $color-bg-secondary 100%);
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
  background: $color-bg-form;
  backdrop-filter: blur(12px);
  border: 1px solid $color-border;
  border-radius: 12px;
  padding: 56px 48px;
  box-shadow: 0 8px 32px $color-shadow,
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
            $color-accent-primary 0%,
            transparent 30%,
            transparent 70%,
            $color-accent-primary 100%
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
  color: $color-text-primary;
  text-transform: uppercase;
  margin: 0 0 40px 0;
  text-shadow: 0 2px 8px $color-shadow;
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
  accent-color: $color-accent-primary;

  &:focus {
    outline: 2px solid $color-border-hover;
    outline-offset: 2px;
  }
}

.checkbox-label {
  color: $color-text-secondary;
  font-size: 15px;
  transition: color 0.2s ease;

  .checkbox-wrapper:hover & {
    color: $color-text-primary;
  }
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
    box-shadow: 0 6px 24px $color-accent-glow;
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
  color: $color-text-secondary;
  border: 1px solid rgba(176, 184, 212, 0.2);
  transition: all 0.3s ease;

  &:hover {
    color: $color-text-primary;
    border-color: $color-border-hover;
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