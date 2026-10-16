<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'

interface PaginationItem {
  key: string
  page: number | null
}

const props = defineProps<{
  currentPage: number
  totalPages: number
  isSearching: boolean
}>()

const emit = defineEmits<{
  select: [page: number]
}>()

const paginationItems = computed((): PaginationItem[] => {
  const pages = props.totalPages
  const current = props.currentPage
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => ({ key: `page-${index + 1}`, page: index + 1 }))
  }
  const result: PaginationItem[] = [{ key: 'page-1', page: 1 }]
  const start = Math.max(2, current - 1)
  const end = Math.min(pages - 1, current + 1)
  if (start > 2) result.push({ key: 'gap-start', page: null })
  for (let page = start; page <= end; page += 1) result.push({ key: `page-${page}`, page })
  if (end < pages - 1) result.push({ key: 'gap-end', page: null })
  result.push({ key: `page-${pages}`, page: pages })
  return result
})
</script>

<template>
  <div class="modrinth-pagination">
    <Button
      class="btn-quiet modrinth-pagination__page"
      aria-label="Предыдущая страница"
      :is-disabled="props.currentPage === 1 || props.isSearching"
      @click="emit('select', props.currentPage - 1)"
    >
      ‹
    </Button>
    <template v-for="item in paginationItems" :key="item.key">
      <span v-if="item.page === null" class="modrinth-pagination__page-gap">...</span>
      <Button
        v-else
        class="btn-quiet modrinth-pagination__page"
        :class="{ 'modrinth-pagination__page--active': item.page === props.currentPage }"
        :aria-current="item.page === props.currentPage ? 'page' : undefined"
        :is-disabled="props.isSearching"
        @click="emit('select', item.page)"
      >
        {{ item.page }}
      </Button>
    </template>
    <Button
      class="btn-quiet modrinth-pagination__page"
      aria-label="Следующая страница"
      :is-disabled="props.currentPage === props.totalPages || props.isSearching"
      @click="emit('select', props.currentPage + 1)"
    >
      ›
    </Button>
  </div>
</template>

<style lang="scss">
.modrinth-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-4);

  &__page {
    min-width: var(--control-height-sm);
    padding: 0 var(--space-8);

    &--active {
      background: var(--accent-active-bg);
      color: var(--accent-text);
      box-shadow: var(--elevation-inset);
    }
  }

  &__page-gap {
    color: var(--login-text-muted);
  }
}
</style>
