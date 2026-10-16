<script setup lang="ts">
import SettingsSection from '../SettingsSection.vue'
import ServerConnect from '../ServerConnect.vue'

defineProps<{
  url: string
  isLoading: boolean
}>()

const emit = defineEmits<{
  get: []
  copy: []
}>()
</script>

<template>
  <SettingsSection title="Подключение к серверу" storage-key="project-connect">
    <ServerConnect
      :url="url"
      :is-loading="isLoading"
      @get="emit('get')"
      @copy="emit('copy')"
    />
  </SettingsSection>
</template>
