<script setup lang="ts">
import { ref, computed, watch, onActivated } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useDebugConsole, FLUSH_BATCH } from '@/04-features'
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

const scrollToBottom = (smooth = false): void => {
  if (!parentRef.value) return
  if (smooth) {
    const maxDistance = FLUSH_BATCH * LINE_HEIGHT
    const current = parentRef.value.scrollTop
    const target = parentRef.value.scrollHeight - parentRef.value.clientHeight
    const distance = Math.min(target - current, maxDistance)
    if (distance <= 0) return
    parentRef.value.scrollBy({ top: distance, behavior: 'smooth' })
  } else {
    parentRef.value.scrollTop = parentRef.value.scrollHeight
  }
}

const toggleAutoScroll = (): void => {
  isAutoScroll.value = !isAutoScroll.value
  if (isAutoScroll.value) {
    scrollToBottom(false)
  }
}

onActivated((): void => {
  scrollToBottom(false)
})

watch(() => logs.value.length, (): void => {
  if (isAutoScroll.value) {
    requestAnimationFrame(() => scrollToBottom(true))
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
          <span :class="logs[row.index].is_error ? 'debug-tab__text--error' : 'debug-tab__text'" class="debug-tab__text">
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
  background: #0d1117;
  border-radius: 8px;
  overflow: hidden;

  &__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: scroll;
    padding: 0;
    font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    line-height: 20px;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__line {
    display: flex;
    align-items: baseline;
    padding: 0 12px;
    white-space: pre;
  }

  &__num {
    color: #484f58;
    min-width: 40px;
    text-align: right;
    padding-right: 12px;
    user-select: none;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  &__text {
    &--normal, & {
      color: #c9d1d9;
    }

    &--error {
      color: #ff7b72;
      font-weight: 500;
    }
  }

  &__cursor {
    opacity: 0;
    color: #c9d1d9;
    display: inline;
  }

  &__actions {
    padding: 8px 12px;
    border-top: 1px solid #21262d;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #161b22;
  }

  &__autoscroll {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #21262d;
    color: #58a6ff;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: #30363d;
      border-color: #484f58;
    }

    &--off {
      color: #484f58;
    }
  }

  &__copy-btn {
    padding: 5px 14px;
    background: #21262d;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: all 0.15s ease;

    &:hover {
      background: #30363d;
      border-color: #484f58;
    }

    &:active {
      background: #282e33;
    }
  }
}
</style>
