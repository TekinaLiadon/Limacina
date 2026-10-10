<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button, Checkbox, Dropdown, Input, Preloader, Skeleton, useFocusTrap } from '@/06-shared'
import type { JavaDistribution } from '@/05-entities'
import LoadErrorRow from '@/03-widgets/common/LoadErrorRow.vue'
import { alternativeJavaModelDefaults, useAlternativeJavaModels, type AlternativeJavaModelProps } from './alternativeJavaModels'

const props = withDefaults(defineProps<{
  visible: boolean
  distributions: JavaDistribution[]
  isDownloading: boolean
  isDistributionsLoading: boolean
  distributionsError: string
  versionError: string
} & AlternativeJavaModelProps>(), { ...alternativeJavaModelDefaults })

const emit = defineEmits<{
  close: []
  download: []
  retry: []
  'update:selectedDistribution': [string]
  'update:replaceDefault': [boolean]
  'update:versionInput': [string]
}>()

const { selectedDistribution, replaceDefault, versionInput } = useAlternativeJavaModels(props)

const popupRef = ref<HTMLDivElement | null>(null)

useFocusTrap(popupRef, (): boolean => props.visible)

const dropdownOptions = computed((): { title: string; value: string }[] =>
  props.distributions.map((d) => ({ title: d.name, value: d.name })),
)

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
        <div ref="popupRef" class="alt-java-popup popup-panel" role="dialog" aria-modal="true" aria-label="Загрузка Java">
          <template v-if="!isDownloading">
            <h3 class="alt-java-popup__title">Загрузка Java</h3>
            <div class="alt-java-popup__form">
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label eyebrow">Вендор</span>
                <Dropdown
                  v-if="distributions.length > 0"
                  v-model="selectedDistribution"
                  :options="dropdownOptions"
                  width="100%"
                />
                <Skeleton
                  v-else-if="isDistributionsLoading"
                  variant="line"
                  height="var(--control-height)"
                  aria-hidden="true"
                />
                <LoadErrorRow
                  v-else-if="distributionsError"
                  :message="distributionsError"
                  :is-loading="isDistributionsLoading"
                  @retry="emit('retry')"
                />
                <span v-else class="alt-java-popup__empty">
                  Доступные дистрибутивы не найдены
                </span>
              </div>
              <div class="alt-java-popup__field">
                <span class="alt-java-popup__label eyebrow">Версия Java</span>
                <Input
                  v-model="versionInput"
                  :options="{ placeholder: 'Авто (на основе MC)' }"
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
                  v-focus
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
              <Preloader local text="Загрузка" />
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

  &__actions {
    display: flex;
    gap: var(--space-8);
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
    position: relative;
    min-height: var(--skeleton-card-height);
  }
}
</style>
