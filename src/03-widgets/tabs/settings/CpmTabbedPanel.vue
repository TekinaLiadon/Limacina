<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Checkbox } from '@/06-shared'
import type { CpmTabItem, CpmTabbedPanelData } from './cpmTabbedPanel'

const props = withDefaults(defineProps<{
  data: CpmTabbedPanelData
  modelValue: string[]
  title: string
  countPrefix?: string
  selectionLabel?: string
  emptyLabel?: string
  emptyDataLabel?: string
  showSelection?: boolean
}>(), {
  countPrefix: 'Выбрано',
  selectionLabel: 'Выбрано',
  emptyLabel: 'Ничего не выбрано',
  emptyDataLabel: 'Нет данных',
  showSelection: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const isTabItem = (value: unknown): value is CpmTabItem => {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<CpmTabItem>
  return typeof item.id === 'string' && typeof item.label === 'string'
}

const itemsFor = (tab: string): CpmTabItem[] => {
  const value = props.data[tab]
  return Array.isArray(value) ? value.filter(isTabItem) : []
}

const tabs = computed((): string[] =>
  props.data.tabs.filter((tab) => itemsFor(tab).length > 0),
)

const activeTab = ref<string | null>(null)

watch(
  tabs,
  (list: string[]): void => {
    if (list.length === 0) {
      activeTab.value = null
      return
    }
    const current = activeTab.value
    if (current === null || !list.includes(current)) {
      activeTab.value = list[0] ?? null
    }
  },
  { immediate: true },
)

const activeItems = computed((): CpmTabItem[] =>
  activeTab.value === null ? [] : itemsFor(activeTab.value),
)

const allItems = computed((): CpmTabItem[] =>
  tabs.value.flatMap((tab) => itemsFor(tab)),
)

const itemsById = computed((): Map<string, CpmTabItem> =>
  new Map(allItems.value.map((item) => [item.id, item])),
)

const selectedIds = computed((): Set<string> => new Set(props.modelValue))

const selectedItems = computed((): CpmTabItem[] =>
  props.modelValue
    .map((id) => itemsById.value.get(id))
    .filter((item): item is CpmTabItem => item !== undefined),
)

const countLabel = computed((): string =>
  `${props.countPrefix}: ${selectedItems.value.length} из ${allItems.value.length}`,
)

const isSelected = (id: string): boolean => selectedIds.value.has(id)

const selectedInTab = (tab: string): number =>
  itemsFor(tab).filter((item) => selectedIds.value.has(item.id)).length

const selectTab = (tab: string): void => {
  activeTab.value = tab
}

const toggle = (id: string): void => {
  const item = itemsById.value.get(id)
  if (!item || item.disabled) return
  const next = isSelected(id)
    ? props.modelValue.filter((value) => value !== id)
    : [...props.modelValue, id]
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="cpm-tabbed-panel">
    <div class="cpm-tabbed-panel__head">
      <div class="cpm-tabbed-panel__title">
        <span>{{ title }}</span>
        <span class="cpm-tabbed-panel__count">{{ countLabel }}</span>
      </div>
      <div v-if="$slots.actions" class="cpm-tabbed-panel__actions">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="tabs.length > 0" class="cpm-tabbed-panel__filters" role="group" :aria-label="title">
      <button
        v-for="tab in tabs"
        :key="tab"
        class="cpm-tabbed-panel__filter"
        type="button"
        :aria-pressed="tab === activeTab"
        @click="selectTab(tab)"
      >
        <span class="cpm-tabbed-panel__filter-label">{{ tab }}</span>
        <span class="cpm-tabbed-panel__filter-count">{{ selectedInTab(tab) }}/{{ itemsFor(tab).length }}</span>
      </button>
    </div>

    <div v-if="activeItems.length > 0" class="cpm-tabbed-panel__list">
      <div
        v-for="item in activeItems"
        :key="item.id"
        class="cpm-tabbed-panel__item"
        :class="{ 'cpm-tabbed-panel__item--selected': isSelected(item.id) }"
      >
        <Checkbox
          :model-value="isSelected(item.id)"
          :label="item.label"
          :disabled="item.disabled ?? false"
          @update:model-value="toggle(item.id)"
        />
      </div>
    </div>

    <div v-if="tabs.length === 0" class="cpm-tabbed-panel__empty">{{ emptyDataLabel }}</div>

    <div v-if="showSelection && tabs.length > 0" class="cpm-tabbed-panel__tray">
      <span class="cpm-tabbed-panel__tray-label">{{ selectionLabel }}</span>
      <div class="cpm-tabbed-panel__tray-items">
        <button
          v-for="item in selectedItems"
          :key="item.id"
          class="cpm-tabbed-panel__selected"
          type="button"
          :aria-label="`Убрать ${item.label}`"
          @click="toggle(item.id)"
        >
          <span class="cpm-tabbed-panel__selected-name">{{ item.label }}</span>
          <span class="cpm-tabbed-panel__selected-x" aria-hidden="true">×</span>
        </button>
        <span v-if="selectedItems.length === 0" class="cpm-tabbed-panel__tray-empty">{{ emptyLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-tabbed-panel {
  @include mixins.tool-panel;

  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
  padding: var(--space-8);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__title {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
    color: var(--login-text-primary);
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
  }

  &__count {
    color: var(--login-text-muted);
    font-size: var(--text-caption);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    flex-wrap: wrap;
  }

  &__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  &__filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border: none;
    border-radius: var(--radius-button);
    background: var(--surface-light);
    color: var(--login-text-muted);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &[aria-pressed="true"] {
      background: var(--accent-active-bg);
      color: var(--login-text-primary);

      .cpm-tabbed-panel__filter-count {
        background: var(--accent-fill);
        color: var(--text-on-accent-fill);
      }
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__filter-count {
    @include mixins.badge-count;
  }

  &__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-4);
    max-height: var(--options-max-height);
    overflow-y: auto;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-4) var(--space-8);
    border-radius: var(--radius-input);
    background: var(--surface-subtle);
    transition: background-color var(--duration-base) var(--ease-out);

    &:hover {
      background: var(--surface-hover);
    }

    &--selected {
      background: var(--accent-subtle);
    }

    &--selected:hover {
      background: var(--accent-active-bg);
    }
  }

  &__item .checkbox {
    flex: 1;
    min-width: 0;
  }

  &__item .checkbox__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }

  &__empty {
    padding: var(--space-8) 0;
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    text-align: center;
  }

  &__tray {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    padding-top: var(--space-8);
    border-top: 1px solid var(--border-subtle);
  }

  &__tray-label {
    flex-shrink: 0;
    padding-top: var(--space-4);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__tray-items {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: var(--space-4);
    min-width: 0;
  }

  &__selected {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    max-width: 100%;
    padding: var(--space-2) var(--space-8);
    border: 1px solid var(--accent-active-bg);
    border-radius: var(--radius-button);
    background: var(--accent-subtle);
    color: var(--login-text-primary);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out);

    &:hover {
      background: var(--accent-active-bg);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__selected-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__selected-x {
    color: var(--login-text-muted);
    font-size: var(--text-body-sm);
    line-height: 1;
  }

  &__selected:hover .cpm-tabbed-panel__selected-x {
    color: var(--error);
  }

  &__tray-empty {
    padding-top: var(--space-4);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }
}
</style>
