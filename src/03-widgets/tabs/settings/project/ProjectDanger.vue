<script setup lang="ts">
import SettingsSection from '../SettingsSection.vue'
import DangerActionButton from '../DangerActionButton.vue'

defineProps<{
  canDelete: boolean
  isClearing: boolean
  isDeleting: boolean
}>()

const emit = defineEmits<{
  'clear-config': []
  'delete-project': []
}>()
</script>

<template>
  <SettingsSection title="Опасная зона" storage-key="project-danger">
    <div class="project-danger__actions">
      <DangerActionButton
        label="Очистить конфиги игры"
        :is-loading="isClearing"
        @action="emit('clear-config')"
      />
      <DangerActionButton
        v-if="canDelete"
        class="project-danger__button"
        label="Удалить проект"
        :is-loading="isDeleting"
        @action="emit('delete-project')"
      />
    </div>
  </SettingsSection>
</template>

<style lang="scss">
.project-danger {
  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__button {
    width: 100%;
  }
}
</style>
