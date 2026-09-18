<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useDebugConsole } from '@/04-features'
import type { ConsoleLog } from '@/05-entities'
import { Icon } from '@/06-shared'

const { logs, filteredLogs, searchQuery, onlyErrors, linesCount, streamError, startConsoleStream, handleCopy } = useDebugConsole()

const logAt = (index: number): ConsoleLog | undefined => filteredLogs.value[index]

const isRetrying = ref<boolean>(false)
const retryStream = async (): Promise<void> => {
  if (isRetrying.value) return
  isRetrying.value = true
  try {
    await startConsoleStream()
  } finally {
    isRetrying.value = false
  }
}

const parentRef = ref<HTMLDivElement | null>(null)
const isAutoScroll = ref<boolean>(true)
const BOTTOM_THRESHOLD = 40

const virtualizer = useVirtualizer(
  computed(() => ({
    count: filteredLogs.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => 20,
    measureElement: (el: HTMLElement): number => el.getBoundingClientRect().height,
    overscan: 50,
  })),
)

const measureRow = (el: Element | ComponentPublicInstance | null): void => {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}

const scrollToBottom = (): void => {
  const lastIndex = filteredLogs.value.length - 1
  if (lastIndex < 0) return
  virtualizer.value.scrollToIndex(lastIndex, { align: 'end' })
}

const enableAutoScroll = (): void => {
  isAutoScroll.value = true
  scrollToBottom()
}

const onScroll = (): void => {
  const el = parentRef.value
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isAutoScroll.value = distanceToBottom < BOTTOM_THRESHOLD
}

onMounted((): void => {
  parentRef.value?.addEventListener('scroll', onScroll, { passive: true })
  void nextTick()
    .then(() => scrollToBottom())
})

onBeforeUnmount((): void => {
  parentRef.value?.removeEventListener('scroll', onScroll)
})

watch(() => filteredLogs.value.length, async (): Promise<void> => {
  if (!isAutoScroll.value) return
  await nextTick()
  scrollToBottom()
})
</script>

<template>
  <div class="debug-tab">
    <div class="debug-tab__filters">
      <input
        v-model="searchQuery"
        class="debug-tab__search"
        type="text"
        placeholder="Поиск по логам"
      >
      <button
        class="debug-tab__errors-toggle"
        :class="{ 'debug-tab__errors-toggle--active': onlyErrors }"
        @click="onlyErrors = !onlyErrors"
      >
        Только ошибки
      </button>
    </div>

    <div v-if="streamError" class="debug-tab__stream-error">
      <span class="debug-tab__stream-error-text">Стриминг логов недоступен: {{ streamError }}</span>
      <button
        class="debug-tab__retry-btn"
        type="button"
        :disabled="isRetrying"
        @click="retryStream"
      >
        Повторить
      </button>
    </div>

    <div v-if="filteredLogs.length === 0" class="debug-tab__empty">
      {{ logs.length === 0 ? 'Логов пока нет' : 'Под фильтр ничего не подошло' }}
    </div>
    <div
      v-else
      ref="parentRef"
      class="debug-tab__scroll"
    >
      <div
        :style="{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }"
      >
        <div
          v-for="row in virtualizer.getVirtualItems()"
          :key="row.index"
          :data-index="row.index"
          :ref="measureRow"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${row.start}px)`,
          }"
          class="debug-tab__line"
        >
          <span class="debug-tab__num">{{ String(row.index + 1).padStart(4, ' ') }}</span>
          <span class="debug-tab__text" :class="logAt(row.index)?.isError ? 'debug-tab__text--error' : undefined">
            {{ logAt(row.index)?.line }}<span class="debug-tab__cursor">&#9612;</span>
          </span>
        </div>
      </div>
    </div>

    <div class="debug-tab__actions">
      <div class="debug-tab__actions-left">
        <button
          class="debug-tab__autoscroll"
          :class="{ 'debug-tab__autoscroll--off': !isAutoScroll }"
          aria-label="К последней строке"
          @click="enableAutoScroll"
        >
          <Icon type="chevron-down" />
        </button>
        <span class="debug-tab__count">{{ linesCount }} строк</span>
      </div>
      <button class="debug-tab__copy-btn" @click="handleCopy">
        Копировать
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.debug-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  text-align: left;
  background: var(--debug-bg);
  border-radius: var(--radius-card);
  overflow: hidden;

  &__filters {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-12);
    border-bottom: 1px solid var(--debug-border);
    background: var(--debug-actions-bg);
  }

  &__search {
    flex: 1;
    min-width: 0;
    height: var(--debug-control-height);
    padding: 0 var(--space-8);
    background: var(--debug-btn-bg);
    color: var(--debug-text);
    border: 1px solid var(--debug-btn-border);
    border-radius: var(--debug-radius);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    letter-spacing: normal;

    &::placeholder {
      color: var(--debug-line-num);
    }

    &:focus {
      border-color: var(--debug-accent);
    }
  }

  &__errors-toggle {
    padding: var(--space-4) var(--space-12);
    background: var(--debug-btn-bg);
    color: var(--debug-text);
    border: 1px solid var(--debug-btn-border);
    border-radius: var(--debug-radius);
    cursor: pointer;
    font-size: var(--text-caption);
    font-family: inherit;
    white-space: nowrap;
    transition: all var(--duration-fast) var(--ease-out);

    &:hover {
      background: var(--debug-btn-hover-bg);
      border-color: var(--debug-btn-hover-border);
    }

    &--active {
      background: var(--debug-btn-active-bg);
      color: var(--debug-error);
      border-color: var(--debug-error);
    }
  }

  &__stream-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-12);
    border-bottom: 1px solid var(--debug-border);
    background: var(--debug-actions-bg);
  }

  &__stream-error-text {
    min-width: 0;
    color: var(--debug-error);
    font-size: var(--text-caption);
  }

  &__retry-btn {
    flex-shrink: 0;
    padding: var(--space-4) var(--space-12);
    background: var(--debug-btn-bg);
    color: var(--debug-error);
    border: 1px solid var(--debug-error);
    border-radius: var(--debug-radius);
    cursor: pointer;
    font-size: var(--text-caption);
    font-family: inherit;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-out);

    &:hover {
      background: var(--debug-btn-hover-bg);
    }

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
  }

  &__empty {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-16);
    color: var(--debug-line-num);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-align: center;
  }

  &__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: scroll;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--debug-font-size);
    line-height: var(--debug-line-height);
    letter-spacing: normal;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__line {
    display: flex;
    align-items: baseline;
    padding: 0 var(--space-12);
  }

  &__num {
    color: var(--debug-line-num);
    min-width: var(--space-40);
    text-align: right;
    padding-right: var(--space-12);
    user-select: none;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  &__text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--debug-text);

    &--error {
      color: var(--debug-error);
      font-weight: 500;
    }
  }

  &__cursor {
    opacity: 0;
    color: var(--debug-text);
    display: inline;
  }

  &__actions {
    padding: var(--space-8) var(--space-12);
    border-top: 1px solid var(--debug-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--debug-actions-bg);
  }

  &__actions-left {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  &__count {
    color: var(--debug-line-num);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  &__autoscroll {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--debug-control-height);
    height: var(--debug-control-height);
    border: 1px solid var(--debug-btn-border);
    border-radius: var(--debug-radius);
    background: var(--debug-btn-bg);
    color: var(--debug-accent);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);

    &:hover {
      background: var(--debug-btn-hover-bg);
      border-color: var(--debug-btn-hover-border);
    }

    &--off {
      color: var(--debug-line-num);
    }
  }

  &__copy-btn {
    padding: var(--space-4) var(--space-16);
    background: var(--debug-btn-bg);
    color: var(--debug-text);
    border: 1px solid var(--debug-btn-border);
    border-radius: var(--debug-radius);
    cursor: pointer;
    font-size: var(--text-caption);
    font-family: inherit;
    transition: all var(--duration-fast) var(--ease-out);

    &:hover {
      background: var(--debug-btn-hover-bg);
      border-color: var(--debug-btn-hover-border);
    }

    &:active {
      background: var(--debug-btn-active-bg);
    }
  }
}
</style>
