<script setup lang="ts">
import { Button, Dropdown, Checkbox } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities/core/types'

const props = defineProps<{
  visible: boolean
  distributions: JavaDistribution[]
  isDownloading: boolean
  javaVersion: string
}>()

const emit = defineEmits<{
  close: []
  download: []
}>()

const selectedDistribution = defineModel<string>('selectedDistribution', { default: '' })
const replaceDefault = defineModel<boolean>('replaceDefault', { default: false })
const versionInput = defineModel<string>('versionInput', { default: '' })

const dropdownOptions = () =>
  props.distributions.map((d) => ({ title: d.name, value: d.name }))
</script>

<template>
  <Teleport to="body">
    <Transition name="alt-java-popup">
      <div v-if="visible" class="alt-java-popup-overlay" @click.self="emit('close')">
        <div class="alt-java-popup">
          <template v-if="!isDownloading">
            <h3 class="alt-java-popup__title">Загрузка Java</h3>
            <div class="alt-java-popup__form">
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label">Вендор</span>
                <Dropdown
                  v-model="selectedDistribution"
                  :options="dropdownOptions()"
                  width="100%"
                />
              </div>
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label">Версия Java</span>
                <input
                  v-model="versionInput"
                  class="alt-java-popup__input"
                  type="text"
                  placeholder="Авто (на основе MC)"
                />
              </div>
              <Checkbox
                v-model="replaceDefault"
                label="Заменить Java по умолчанию"
              />
              <div class="alt-java-popup__actions">
                <Button class="btn-yellow alt-java-popup__btn" @click="emit('download')">
                  Загрузить
                </Button>
                <Button
                  class="btn-yellow alt-java-popup__btn alt-java-popup__btn--cancel"
                  @click="emit('close')"
                >
                  Отмена
                </Button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="alt-java-popup__loading">
              <img src="@/01-app/preloader/preloader.svg" alt="" class="alt-java-popup__spinner" />
              <div class="alt-java-popup__loading-text">Загрузка</div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.alt-java-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.alt-java-popup {
  background: var(--login-bg-form);
  border: 1px solid var(--login-border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px var(--login-shadow-strong);
  max-width: 400px;
  width: 100%;

  &__title {
    font-size: 18px;
    font-weight: 600;
    color: var(--login-text-primary);
    margin: 0 0 20px 0;
    text-align: center;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__label {
    font-size: 14px;
    color: var(--yellow);
    font-weight: 400;
  }

  &__input {
    border: 1px solid var(--login-border);
    border-radius: 10px;
    height: 40px;
    padding: 0 14px;
    color: var(--login-text-primary);
    background-color: rgba(255, 255, 255, 0.06);
    font-size: 14px;
    outline: none;
    width: 100%;
    box-sizing: border-box;

    &::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }

    &:focus {
      border-color: var(--yellow);
    }
  }

  &__actions {
    display: flex;
    gap: 10px;
  }

  &__btn {
    flex: 1;
    height: 44px;
    font-size: 14px;
    font-weight: 600;

    &--cancel {
      background: transparent;
      border: 1px solid var(--login-border);
      color: var(--login-text-primary);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }
    }
  }

  &__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 0;
  }

  &__spinner {
    max-width: 80px;
    width: 100%;
  }

  &__loading-text {
    margin-top: 16px;
    font-size: 16px;
    color: var(--login-text-primary);
  }
}

.alt-java-popup-enter-active,
.alt-java-popup-leave-active {
  transition: opacity 0.2s ease;
}

.alt-java-popup-enter-from,
.alt-java-popup-leave-to {
  opacity: 0;
}
</style>
