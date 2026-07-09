<script setup lang="ts">
import { PushNotification } from '@/06-shared'
import { useAuthRegister } from '@/04-features'
import AccountList from '@/03-widgets/tabs/login/AccountList.vue'
import RegisterForm from '@/03-widgets/tabs/login/RegisterForm.vue'

const {
  isLoading,
  errorMessage,
  successMessage,
  logins,
  showForm,
  formData,
  passwordsMatch,
  isValid,
  handleSubmit,
  openForm,
} = useAuthRegister()
</script>

<template>
  <div class="accounts-tab">
    <PushNotification
      :visible="!!successMessage"
      :message="successMessage"
      @update:visible="successMessage = ''"
    />

    <AccountList
      v-if="!showForm"
      :logins="logins"
      @open-form="openForm"
    />

    <RegisterForm
      v-else
      :form-data="formData"
      :is-loading="isLoading"
      :error-message="errorMessage"
      :passwords-match="passwordsMatch"
      :is-valid="isValid"
      @submit="handleSubmit"
    />
  </div>
</template>

<style lang="scss">
.accounts-tab {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 40px;
  display: flex;
  flex-direction: column;
  height: 100%;

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__list {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  &__empty {
    color: var(--login-text-secondary);
    font-size: 14px;
    text-align: center;
    padding: 40px 0;
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--login-border);
    border-radius: 12px;
    transition: all 0.2s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--login-accent);
    }
  }

  &__avatar {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--login-accent);
    color: var(--white);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    flex-shrink: 0;
  }

  &__name {
    font-size: 16px;
    font-weight: 500;
    color: var(--login-text-primary);
  }

  &__footer {
    padding-top: 20px;
    flex-shrink: 0;
  }

  &__add-btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__error {
    font-size: 12px;
    color: var(--error);

    &--box {
      padding: 10px 14px;
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      border-radius: 8px;
      font-size: 13px;
      word-break: break-word;
    }
  }

  &__actions {
    margin-top: 8px;
  }

  &__submit-btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
}
</style>
