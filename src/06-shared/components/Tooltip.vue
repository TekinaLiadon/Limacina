<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const SHOW_DELAY_MS = 300
const VIEWPORT_MARGIN = 8
const GAP = 6

let tooltipCounter = 0

const props = withDefaults(defineProps<{
  content: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const bubbleId = `tooltip-bubble-${++tooltipCounter}`

const rootRef = ref<HTMLElement | null>(null)
const bubbleRef = ref<HTMLElement | null>(null)
const shown = ref<boolean>(false)
const bubbleStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

let showTimer: number | null = null

const isTouchOnly = (): boolean => window.matchMedia('(hover: none)').matches

const updatePosition = (): void => {
  const root = rootRef.value
  const bubble = bubbleRef.value
  if (!root || !bubble) return
  const rect = root.getBoundingClientRect()
  const bubbleRect = bubble.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const showAbove =
    spaceBelow < bubbleRect.height + GAP + VIEWPORT_MARGIN &&
    rect.top > spaceBelow
  const top = showAbove
    ? rect.top - bubbleRect.height - GAP
    : rect.bottom + GAP
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - bubbleRect.width / 2, VIEWPORT_MARGIN),
    window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN,
  )
  bubbleStyle.value = { left: `${left}px`, top: `${top}px` }
}

const open = async (): Promise<void> => {
  shown.value = true
  await nextTick()
  updatePosition()
}

const scheduleShow = (): void => {
  if (props.disabled || props.content.trim() === '' || shown.value || isTouchOnly()) return
  if (showTimer !== null) return
  showTimer = window.setTimeout((): void => {
    showTimer = null
    void open()
  }, SHOW_DELAY_MS)
}

const hide = (): void => {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  shown.value = false
}

const handleKeydown = (e: KeyboardEvent): void => {
  if (shown.value && e.key === 'Escape') hide()
}

const handleScroll = (): void => {
  if (shown.value) hide()
}

watch((): boolean => props.disabled, (disabled) => {
  if (disabled) hide()
})

onMounted((): void => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('scroll', handleScroll, true)
})

onBeforeUnmount((): void => {
  hide()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('scroll', handleScroll, true)
})
</script>

<template>
  <span
    ref="rootRef"
    class="tooltip"
    :aria-describedby="shown ? bubbleId : undefined"
    @mouseenter="scheduleShow"
    @mouseleave="hide"
    @focusin="scheduleShow"
    @focusout="hide"
    @mousedown="hide"
  >
    <slot />
    <Transition name="tooltip-fade">
      <span
        v-show="shown"
        :id="bubbleId"
        ref="bubbleRef"
        role="tooltip"
        class="tooltip__bubble"
        :style="bubbleStyle"
      >
        {{ props.content }}
      </span>
    </Transition>
  </span>
</template>

<style lang="scss">
.tooltip {
  display: inline-flex;
  min-width: 0;
}

.tooltip__bubble {
  position: fixed;
  z-index: var(--z-tooltip);
  max-width: 280px;
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-badge);
  background: var(--login-bg-form);
  box-shadow: var(--elevation-modal), inset 0 0 0 1px var(--grid-line);
  color: var(--login-text-primary);
  font-size: var(--text-caption);
  line-height: var(--leading-body-sm);
  text-align: left;
  overflow-wrap: anywhere;
  pointer-events: none;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}
</style>
