<script setup lang="ts">
import { Skeleton } from '@/06-shared'
import type { GameOptions } from '@/05-entities'
import GameCheckboxField from './GameCheckboxField.vue'

const props = withDefaults(defineProps<{
  options: GameOptions
  availablePacks: string[]
  isLoading?: boolean
}>(), {
  isLoading: false,
})

const isPackEnabled = (pack: string): boolean => props.options.resourcePacks.includes(pack)

const togglePack = (pack: string): void => {
  if (isPackEnabled(pack)) {
    props.options.resourcePacks = props.options.resourcePacks.filter((p) => p !== pack)
    return
  }
  props.options.resourcePacks.push(pack)
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
        v-for="pack in availablePacks"
        :key="pack"
        :label="pack"
        :model-value="isPackEnabled(pack)"
        @update:model-value="togglePack(pack)"
      />
    </template>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.resource-packs-options {
  @include mixins.settings-fields-grid;

  &__empty {
    @include mixins.caption-hint;

    text-align: left;
  }
}
</style>
