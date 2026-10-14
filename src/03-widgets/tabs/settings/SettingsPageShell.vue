<script setup lang="ts">
import { Skeleton } from '@/06-shared'
import LoadErrorRow from '@/03-widgets/common/LoadErrorRow.vue'
import SettingsSaveBar from './SettingsSaveBar.vue'

const props = defineProps<{
  isLoading: boolean
  loadError: string
  isSaving: boolean
  isDirty: boolean
}>()

const emit = defineEmits<{
  retry: []
  save: []
}>()
</script>

<template>
  <div class="settings-page-shell">
    <LoadErrorRow :message="props.loadError" :is-loading="props.isLoading" @retry="emit('retry')" />

    <slot name="head" />

    <div v-if="props.isLoading && !$slots.loading" class="settings-page-shell__loading" aria-hidden="true">
      <Skeleton v-for="index in 9" :key="index" variant="line" height="var(--control-height)" />
    </div>
    <slot v-else-if="props.isLoading" name="loading" />
    <template v-else>
      <slot />
    </template>

    <SettingsSaveBar
      :is-saving="props.isSaving"
      :is-loading="props.isLoading"
      :is-dirty="props.isDirty"
      :is-blocked="props.loadError !== ''"
      @save="emit('save')"
    >
      <template v-if="$slots['save-extra']" #extra>
        <slot name="save-extra" />
      </template>
    </SettingsSaveBar>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.settings-page-shell {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__loading {
    @include mixins.settings-fields-grid;
  }
}
</style>
