<script setup lang="ts">
import { Button } from '@/06-shared'
import AlternativeJavaPopup from './AlternativeJavaPopup.vue'
import type { JavaDistribution } from '@/05-entities'

defineProps<{
  distributions: JavaDistribution[]
  isDownloading: boolean
  popupVisible: boolean
  javaVersion: string
}>()

const emit = defineEmits<{
  'open-popup': []
  download: []
  'close-popup': []
}>()

const selectedDistribution = defineModel<string>('selectedDistribution', { default: '' })
const replaceDefault = defineModel<boolean>('replaceDefault', { default: false })
const versionInput = defineModel<string>('versionInput', { default: '' })
</script>

<template>
  <div class="alt-java-button">
    <span class="alt-java-button__text">Загрузить другую Java</span>
    <Button class="btn-secondary alt-java-button__btn" @click="emit('open-popup')">
      Выбрать
    </Button>
    <AlternativeJavaPopup
      :visible="popupVisible"
      :distributions="distributions"
      :is-downloading="isDownloading"
      :java-version="javaVersion"
      v-model:selected-distribution="selectedDistribution"
      v-model:replace-default="replaceDefault"
      v-model:version-input="versionInput"
      @close="emit('close-popup')"
      @download="emit('download')"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
.alt-java-button {
  @include mixins.settings-row-body;
}
</style>
