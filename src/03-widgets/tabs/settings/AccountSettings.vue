<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input } from '@/06-shared'
import { useAccountSettings } from '@/04-features'

const {
  username,
  isOffline,
  oldPassword,
  newPassword,
  confirmPassword,
  passwordsMatch,
  isSamePassword,
  isFormValid,
  isChanging,
  errorMessage,
  handleChangePassword,
} = useAccountSettings()

const isDisabled = computed((): boolean => isOffline.value || !isFormValid.value)
</script>

<template>
  <div class="account-settings">
    <div class="account-settings__section">
      <div class="section-label">Аккаунт</div>
      <Input
        :model-value="username"
        :options="{ label: 'Никнейм', placeholder: 'Никнейм', disabled: true }"
      />
    </div>

    <div class="account-settings__section">
      <div class="section-label">Смена пароля</div>
      <Input
        v-model="oldPassword"
        :options="{ label: 'Текущий пароль', placeholder: 'Текущий пароль', type: 'password' }"
      />
      <Input
        v-model="newPassword"
        :options="{ label: 'Новый пароль', placeholder: 'Новый пароль', type: 'password' }"
      />
      <Input
        v-model="confirmPassword"
        :options="{ label: 'Повторите новый пароль', placeholder: 'Повторите новый пароль', type: 'password' }"
      />
      <div v-if="!passwordsMatch" class="account-settings__error">
        Пароли не совпадают
      </div>
      <div v-else-if="isSamePassword" class="account-settings__error">
        Новый пароль совпадает с текущим
      </div>
      <div v-else-if="errorMessage" class="account-settings__error">
        {{ errorMessage }}
      </div>
      <Button
        class="btn-primary btn-lg btn-block"
        :is-loading="isChanging"
        :is-disabled="isDisabled"
        @click="handleChangePassword"
      >
        Сменить пароль
      </Button>
    </div>

    <p class="account-settings__hint">
      После смены пароля все сессии на других устройствах будут завершены
    </p>
  </div>
</template>

<style lang="scss">
.account-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__error {
    color: var(--error);
    font-size: var(--text-body-sm);
    text-align: left;
    padding: var(--space-12);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    border-radius: var(--radius-badge);
    word-break: break-word;
  }

  &__hint {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    text-align: center;
  }
}
</style>
