<script setup lang="ts">
import { Checkbox } from '@/06-shared'
import { useSettingsStore } from '@/05-entities'

const settingsStore = useSettingsStore()
</script>

<template>
  <div class="launcher-settings">
    <div class="launcher-settings__field">
      <Checkbox
        v-model="settingsStore.animationsEnabled"
        label="Включить анимации"
      />
    </div>
  </div>
</template>

<style lang="scss">
.launcher-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
}
</style>
