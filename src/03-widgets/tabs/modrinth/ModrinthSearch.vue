<script setup lang="ts">
import { Button, Dropdown, Input, MultiSelect } from '@/06-shared'
import { MODRINTH_CATEGORIES, MODRINTH_SORTS } from '@/04-features'

const props = defineProps<{
  query: string
  sort: string
  categories: string[]
  isSearching: boolean
}>()

const emit = defineEmits<{
  'update:query': [query: string]
  'update:sort': [sort: string]
  'update:categories': [categories: string[]]
  search: []
}>()

const sortOptions = MODRINTH_SORTS.map((option) => ({
  title: option.label,
  value: option.value,
}))

const categoryOptions = MODRINTH_CATEGORIES.map((option) => ({
  title: option.label,
  value: option.value,
}))
</script>

<template>
  <div class="modrinth-search">
    <Input
      :model-value="props.query"
      class="modrinth-search__input"
      :options="{ placeholder: 'Поиск модов Modrinth' }"
      @update:model-value="emit('update:query', $event)"
      @keydown.enter="emit('search')"
    />
    <div class="modrinth-search__controls">
      <Dropdown
        :model-value="props.sort"
        class="modrinth-search__sort"
        :options="sortOptions"
        width="var(--filter-control-width)"
        @update:model-value="emit('update:sort', $event)"
      />
      <MultiSelect
        :model-value="props.categories"
        class="modrinth-search__categories"
        :options="categoryOptions"
        placeholder="Категории"
        width="var(--filter-control-width)"
        clearable
        @update:model-value="emit('update:categories', $event)"
      />
      <Button class="btn-primary" :is-loading="props.isSearching" @click="emit('search')">
        Найти
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.modrinth-search {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;

  &__input {
    flex: 1 1 var(--filter-control-width);
    min-width: var(--filter-control-width);
  }

  &__controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    min-width: 0;
  }
}
</style>
