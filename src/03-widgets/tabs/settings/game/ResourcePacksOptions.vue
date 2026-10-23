<script setup lang="ts">
import { Skeleton } from '@/06-shared'
import type { GameOptions } from '@/05-entities'
import { GameCheckboxField } from './fields'

const props = withDefaults(defineProps<{
  options: GameOptions
  availablePacks: string[]
  isLoading?: boolean
}>(), {
  isLoading: false,
})

const emit = defineEmits<{ 'update:options': [GameOptions] }>()

const packLabel = (packId: string): string => packId.replace(/^file\//, '')

const isPackEnabled = (packId: string): boolean => props.options.resourcePacks.includes(packId)

const togglePack = (packId: string): void => {
  const current = props.options.resourcePacks
  emit('update:options', {
    ...props.options,
    resourcePacks: isPackEnabled(packId)
      ? current.filter((p) => p !== packId)
      : [...current, packId],
  })
}
</script>

<template>
  <div class="resource-packs-options">
    <template v-if="isLoading">
      <Skeleton v-for="index in 3" :key="index" variant="line" aria-hidden="true" />
    </template>
    <template v-else>
      <p v-if="availablePacks.length === 0" class="resource-packs-options__empty">
        В папке resourcepacks нет ресурсных пакетов
      </p>
      <GameCheckboxField
        v-for="packId in availablePacks"
        :key="packId"
        :label="packLabel(packId)"
        :model-value="isPackEnabled(packId)"
        @update:model-value="togglePack(packId)"
      />
    </template>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.resource-packs-options {
  @include mixins.settings-fields-grid;

  &__empty {
    @include mixins.caption-hint(left);
  }
}
</style>
