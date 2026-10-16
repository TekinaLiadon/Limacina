<script setup lang="ts">
import { watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { SettingsTabs } from '@/03-widgets'
import { useProjectSettings, useSettingsDirtyGuard } from '@/04-features'

const router = useRouter()
const route = useRoute()

const { config, isLoaded } = useProjectSettings()
useSettingsDirtyGuard()

watch((): boolean => isLoaded.value && !config.value.online, (offline) => {
  if (offline && route.name === 'SettingsAccount') router.replace({ name: 'SettingsLauncher' })
}, { immediate: true })
</script>

<template>
  <div class="settings-page">
    <h2 class="settings-page__title heading-display">Настройки</h2>

    <SettingsTabs>
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </SettingsTabs>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.settings-page {
  @include mixins.page-scaffold(var(--page-max-width-wide));

  flex: 1;
  min-height: 0;
  height: 0;

  &__title {
    margin-bottom: var(--title-gap);
  }
}
</style>
