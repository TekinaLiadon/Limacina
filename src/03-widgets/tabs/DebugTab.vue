<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useDebugConsole } from '@/04-features'
import { Icon } from '@/06-shared'

const { logs, handleCopy } = useDebugConsole()

const parentRef = ref<HTMLDivElement | null>(null)
const isAutoScroll = ref<boolean>(true)
const LINE_HEIGHT = 20

const virtualizer = useVirtualizer(
  computed(() => ({
    count: logs.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => LINE_HEIGHT,
    overscan: 100,
  }))
)

const scrollToBottom = (): void => {
  if (logs.value.length === 0) return
  if (!parentRef.value) return
  parentRef.value.scrollTop = parentRef.value.scrollHeight
}

const toggleAutoScroll = (): void => {
  isAutoScroll.value = !isAutoScroll.value
  if (isAutoScroll.value) {
    scrollToBottom()
  }
}

onMounted(async (): Promise<void> => {
  await nextTick()
  if (logs.value.length > 0) {
    virtualizer.value.scrollToIndex(logs.value.length - 1, { align: 'end' })
  }
})

watch(() => logs.value.length, async (): Promise<void> => {
  if (isAutoScroll.value) {
    await nextTick()
    scrollToBottom()
  }
})
</script>

<template>
  <div class="debug-tab">
    <div
      ref="parentRef"
      class="debug-tab__scroll"
    >
      <div
        :style="{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }"
      >
        <div
          v-for="row in virtualizer.getVirtualItems()"
          :key="row.index"
          :data-debug-index="row.index"
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
          <span :class="logs[row.index].isError ? 'debug-tab__text--error' : 'debug-tab__text'" class="debug-tab__text">
            {{ logs[row.index].line }}
          </span>
          <span class="debug-tab__cursor">&#9612;</span>
        </div>
      </div>
    </div>

    <div class="debug-tab__actions">
      <button
        class="debug-tab__autoscroll"
        :class="{ 'debug-tab__autoscroll--off': !isAutoScroll }"
        @click="toggleAutoScroll"
      >
        <Icon type="chevron-down" />
      </button>
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
  background: var(--debug-bg);
  border-radius: var(--radius-card);
  overflow: hidden;

  &__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: scroll;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 20px;
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
    white-space: pre;
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
    &--normal, & {
      color: var(--debug-text);
    }

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

  &__autoscroll {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--debug-btn-border);
    border-radius: 6px;
    background: var(--debug-btn-bg);
    color: var(--debug-accent);
    cursor: pointer;
    transition: all 0.15s ease;

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
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: all 0.15s ease;

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
