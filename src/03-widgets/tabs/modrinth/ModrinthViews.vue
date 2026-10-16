<script setup lang="ts">
import { useRovingTabs } from '@/06-shared'
import type { ModsView } from '@/03-widgets/types'

const props = defineProps<{
  activeView: ModsView
  installedCount: number
  updatesCount: number
}>()

const emit = defineEmits<{
  'update:activeView': [view: ModsView]
}>()

const viewTabs: Array<{ key: ModsView; label: string }> = [
  { key: 'catalog', label: 'Каталог' },
  { key: 'installed', label: 'Установленные' },
]

const { handleKeydown } = useRovingTabs<ModsView>({
  tabs: (): Array<{ key: ModsView; label: string }> => viewTabs,
  isActive: (key: ModsView): boolean => props.activeView === key,
  tabId: (key: ModsView): string => `modrinth-view-${key}`,
  select: (key: ModsView): void => {
    emit('update:activeView', key)
  },
})
</script>

<template>
  <div class="modrinth-views" role="tablist" aria-label="Режим модов" @keydown="handleKeydown">
    <button
      v-for="view in viewTabs"
      :id="`modrinth-view-${view.key}`"
      :key="view.key"
      type="button"
      role="tab"
      class="modrinth-views__view"
      :class="{ 'modrinth-views__view--active': props.activeView === view.key }"
      :aria-selected="props.activeView === view.key"
      :tabindex="props.activeView === view.key ? 0 : -1"
      aria-controls="modrinth-view-panel"
      @click="emit('update:activeView', view.key)"
    >
      {{ view.label }}
      <template v-if="view.key === 'installed'">
        <span class="modrinth-views__view-count">{{ props.installedCount }}</span>
        <span v-if="props.updatesCount > 0" class="modrinth-views__view-updates">{{ props.updatesCount }}</span>
      </template>
    </button>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-views {
  @include mixins.segmented;

  align-self: flex-start;

  &__view {
    @include mixins.segmented-item($disabled-opacity: null, $hover-exclude-active: true);

    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-16);
    font-family: inherit;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out);
  }

  &__view-count {
    @include mixins.badge-count;
  }

  &__view-updates {
    @include mixins.badge-count($background: var(--accent-active-bg), $color: var(--accent-text));

    font-weight: var(--weight-medium);
  }
}
</style>
