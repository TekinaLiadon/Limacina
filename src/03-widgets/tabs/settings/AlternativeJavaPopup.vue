<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Button, Checkbox, Dropdown, Skeleton, useFocusTrap } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities'

const props = defineProps<{
  visible: boolean
  distributions: JavaDistribution[]
  isDownloading: boolean
  isDistributionsLoading: boolean
  distributionsError: string
  javaVersion: string
  versionError: string
}>()

const emit = defineEmits<{
  close: []
  download: []
  retry: []
}>()

const selectedDistribution = defineModel<string>('selectedDistribution', { default: '' })
const replaceDefault = defineModel<boolean>('replaceDefault', { default: false })
const versionInput = defineModel<string>('versionInput', { default: '' })

const popupRef = ref<HTMLDivElement | null>(null)

useFocusTrap(popupRef, (): boolean => props.visible)

const dropdownOptions = () =>
  props.distributions.map((d) => ({ title: d.name, value: d.name }))

function handleKeydown(e: KeyboardEvent): void {
  if (props.visible && !props.isDownloading && e.key === 'Escape') emit('close')
}

onMounted((): void => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount((): void => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="alt-java-popup-overlay" @click.self="emit('close')">
        <div ref="popupRef" class="alt-java-popup popup-panel" role="dialog" aria-modal="true">
          <template v-if="!isDownloading">
            <h3 class="alt-java-popup__title">Загрузка Java</h3>
            <div class="alt-java-popup__form">
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label eyebrow">Вендор</span>
                <Dropdown
                  v-if="distributions.length > 0"
                  v-model="selectedDistribution"
                  :options="dropdownOptions()"
                  width="100%"
                />
                <Skeleton
                  v-else-if="isDistributionsLoading"
                  variant="line"
                  height="var(--control-height)"
                  aria-hidden="true"
                />
                <div v-else-if="distributionsError" class="alt-java-popup__error">
                  <span>{{ distributionsError }}</span>
                  <Button
                    class="btn-quiet alt-java-popup__retry"
                    @click="emit('retry')"
                  >
                    Повторить
                  </Button>
                </div>
                <span v-else class="alt-java-popup__empty">
                  Доступные дистрибутивы не найдены
                </span>
              </div>
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label eyebrow">Версия Java</span>
                <input
                  v-model="versionInput"
                  class="alt-java-popup__input"
                  type="text"
                  placeholder="Авто (на основе MC)"
                />
                <span v-if="versionError" class="alt-java-popup__version-error">
                  {{ versionError }} — будет использована версия по умолчанию
                </span>
              </div>
              <Checkbox
                v-model="replaceDefault"
                label="Заменить Java по умолчанию"
              />
              <div class="alt-java-popup__actions">
                <Button
                  class="btn-primary alt-java-popup__btn"
                  :is-disabled="distributions.length === 0 || selectedDistribution === ''"
                  @click="emit('download')"
                >
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
              <img src="@/06-shared/components/preloader.svg" alt="" class="alt-java-popup__spinner" />
              <div class="alt-java-popup__loading-text">Загрузка</div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.alt-java-popup-overlay {
  @include mixins.popup-overlay;
}

.alt-java-popup {
  @include mixins.popup-card;

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
    transition: box-shadow var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out);

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

  &__error {
    @include mixins.error-box;

    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  &__retry {
    min-height: var(--control-height-sm);
    flex-shrink: 0;
    color: var(--error);
  }

  &__empty {
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
  }

  &__version-error {
    font-size: var(--text-caption);
    color: var(--error);
    text-align: left;
    word-break: break-word;
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
</style>
