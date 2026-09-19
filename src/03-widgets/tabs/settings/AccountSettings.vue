<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input } from '@/06-shared'
import { useAccountSettings } from '@/04-features'
import SettingsInfoRow from './SettingsInfoRow.vue'

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
    <div class="settings-grid">
      <div class="section-label span-full">Аккаунт</div>
      <SettingsInfoRow
        class="settings-row span-full"
        label="Никнейм"
        :value="username"
      />
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Смена пароля</div>
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
      <div v-if="!passwordsMatch" class="account-settings__error span-full">
        Пароли не совпадают
      </div>
      <div v-else-if="isSamePassword" class="account-settings__error span-full">
        Новый пароль совпадает с текущим
      </div>
      <div v-else-if="errorMessage" class="account-settings__error span-full">
        {{ errorMessage }}
      </div>
      <Button
        class="btn-primary btn-lg account-settings__submit span-full"
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
@use '@/01-app/assets/mixins';
.account-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__error {
    @include mixins.error-box;
  }

  &__submit {
    justify-self: center;
    width: 100%;
    max-width: var(--settings-row-width);
  }

  &__hint {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    text-align: center;
  }
}
</style>
