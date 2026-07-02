<script setup lang="ts">
import { ref, computed } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useDebugConsole } from '@/04-features'

const { logs, handleCopy } = useDebugConsole()

const parentRef = ref<HTMLDivElement | null>(null)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: logs.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => 20,
    overscan: 20,
  }))
)

const scrollToBottom = (): void => {
  if (!parentRef.value) return
  parentRef.value.scrollTop = parentRef.value.scrollHeight
}

scrollToBottom()
</script>

<template>
  <div class="debug-tab">
    <div ref="parentRef" class="debug-tab__scroll">
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
    justify-content: flex-end;
    background: #161b22;
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
