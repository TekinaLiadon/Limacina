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
                <span class="alt-java-popup__label eyebrow">Вендор</span>
                <Dropdown
                  v-model="selectedDistribution"
                  :options="dropdownOptions()"
                  width="100%"
                />
              </div>
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label eyebrow">Версия Java</span>
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
                <Button class="btn-primary alt-java-popup__btn" @click="emit('download')">
                  Загрузить
                </Button>
                <Button
                  class="btn-quiet alt-java-popup__btn"
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
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.alt-java-popup {
  background: var(--login-bg-form);
  border-radius: var(--radius-modal);
  padding: var(--card-padding);
  box-shadow: var(--elevation-modal);
  max-width: 400px;
  width: 100%;

  &__title {
    font-family: var(--font-display);
    font-size: var(--text-subheading);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-heading);
    color: var(--login-text-primary);
    margin: 0 0 var(--space-20) 0;
    text-align: center;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    text-align: left;
  }

  &__input {
    border: none;
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-input);
    height: var(--control-height);
    padding: 0 var(--control-padding-x);
    color: var(--login-text-primary);
    background-color: var(--surface-input);
    font-family: inherit;
    font-size: var(--text-body-sm);
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: box-shadow 0.2s ease, background-color 0.2s ease;

    &::placeholder {
      color: var(--login-text-muted);
    }

    &:hover {
      background-color: var(--surface-hover);
    }

    &:focus {
      box-shadow: var(--elevation-inset-strong);
    }
  }

  &__actions {
    display: flex;
    gap: var(--space-8);
  }

  &__btn {
    flex: 1;
    min-height: var(--control-height);
  }

  &__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-20) 0;
  }

  &__spinner {
    max-width: 80px;
    width: 100%;
  }

  &__loading-text {
    margin-top: var(--element-gap);
    font-size: var(--text-body-sm);
    color: var(--login-text-secondary);
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
