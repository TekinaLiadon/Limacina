<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'
import { useSkinSettings } from '@/04-features'
import SkinViewer from './SkinViewer.vue'

const { skinUrl, errorMessage, selectSkin, resetSkin } = useSkinSettings()

const hasSkin = computed((): boolean => skinUrl.value !== '')
</script>

<template>
  <div class="skin-settings">
    <div v-if="hasSkin" class="skin-settings__preview">
      <SkinViewer :skin-url="skinUrl" />
    </div>

    <div v-if="errorMessage" class="skin-settings__error">
      {{ errorMessage }}
    </div>

    <div class="skin-settings__actions">
      <Button class="btn-yellow skin-settings__btn" @click="selectSkin">
        {{ hasSkin ? 'Заменить скин' : 'Загрузить скин' }}
      </Button>
      <Button
        v-if="hasSkin"
        class="btn-yellow skin-settings__btn skin-settings__btn--reset"
        @click="resetSkin"
      >
        Удалить
      </Button>
    </div>

    <p class="skin-settings__hint">
      Формат: .png, не более 256 КБ
    </p>
  </div>
</template>

<style lang="scss">
.skin-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__preview {
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--login-border);
  }

  &__error {
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 13px;
  }

  &__actions {
    display: flex;
    gap: 10px;

    .skin-settings__btn {
      flex: 1;
      height: 44px;
      font-size: 14px;
      font-weight: 500;

      &--reset {
        flex: 0 0 auto;
        padding: 0 24px;
      }
    }
  }

  &__hint {
    margin: 0;
    font-size: 12px;
    color: var(--login-text-muted);
    text-align: center;
  }
}
</style>
