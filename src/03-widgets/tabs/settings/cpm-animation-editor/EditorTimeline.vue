<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref } from 'vue'
import {
  buildSimpleFrames,
  frameColorLabel,
  frameToTimeMs,
  type EditorBeadMode,
  type EditorTimeBead,
} from '@/04-features'
import { Input } from '@/06-shared'
import ToolIconButton from '../ToolIconButton.vue'
import {
  TIMELINE_DEFAULT_PX_PER_FRAME,
  TIMELINE_MAX_PX_PER_FRAME,
  TIMELINE_MIN_PX_PER_FRAME,
  TIMELINE_TRACK_PAD_PX,
  buildTimeTicks,
  clampZoom,
  formatTimeTick,
  frameAtPointer,
  frameOffsetPx,
  pickTickStep,
  playheadOffsetPx,
  scrubProgressAtPointer,
  timeOffsetPx,
  timelineContentWidth,
} from './timelineLayout'

const props = defineProps<{
  frameCount: number
  durationMs: number
  simpleMode: boolean
  currentFrame: number
  keys: number[]
  beads: EditorTimeBead[]
  beadMode: EditorBeadMode
  frameColors: ReadonlyMap<number, string>
  isPlaying: boolean
  isScrubbing: boolean
  scrubProgress: number
  canAddKey: boolean
  canRemoveKey: boolean
  canCopyKey: boolean
  canPasteKey: boolean
  canJumpToPreviousKey: boolean
  canJumpToNextKey: boolean
  canUndo: boolean
  canRedo: boolean
  speed: number
  canSpeedDown: boolean
  canSpeedUp: boolean
  isLooped: boolean
}>()

const emit = defineEmits<{
  frame: [frame: number]
  'toggle-play': []
  step: [delta: number]
  'jump-key': [direction: -1 | 1]
  'add-key': []
  'remove-key': []
  'copy-key': []
  'paste-key': []
  'speed-down': []
  'speed-up': []
  'toggle-loop': []
  'bead-mode': [mode: EditorBeadMode]
  'bead-start': [fromFrame: number, toFrame: number]
  'bead-drag': [deltaFrames: number]
  'bead-end': []
  'simple-mode': [enabled: boolean]
  second: [seconds: number]
  'add-frame': []
  'add-step': []
  undo: []
  redo: []
  'begin-scrub': []
  scrub: [progress: number]
  'end-scrub': []
  'move-frame': [fromFrame: number, toFrame: number]
}>()

const allFrames = computed((): number[] =>
  Array.from({ length: props.frameCount }, (_, index) => index),
)

const simpleFrames = computed(() => buildSimpleFrames(props.frameCount, props.durationMs))

const frames = computed((): number[] =>
  props.simpleMode ? simpleFrames.value.map((item) => item.frame) : allFrames.value,
)

const simpleSeconds = computed((): Map<number, number> =>
  new Map(simpleFrames.value.map((item) => [item.frame, item.seconds])),
)

const formatSeconds = (seconds: number): string => {
  const rounded = Math.round(seconds * 10) / 10
  return Number.isInteger(rounded) ? `${rounded} с` : `${rounded.toFixed(1)} с`
}

const frameHeadline = (frame: number): string => {
  if (!props.simpleMode) return `Кадр ${frame + 1}`
  return formatSeconds(simpleSeconds.value.get(frame) ?? 0)
}

const pxPerFrame = ref<number>(TIMELINE_DEFAULT_PX_PER_FRAME)
const scrollRef = ref<HTMLDivElement | null>(null)
const contentRef = ref<HTMLDivElement | null>(null)

const trackWidth = computed((): number =>
  timelineContentWidth(props.frameCount, pxPerFrame.value),
)

const ticks = computed((): { ms: number; left: number; label: string }[] => {
  const frameCount = Math.max(props.frameCount, 1)
  const step = pickTickStep(props.durationMs, frameCount * pxPerFrame.value)
  return buildTimeTicks(props.durationMs, step).map((ms) => ({
    ms,
    left: timeOffsetPx(ms, props.durationMs, frameCount, pxPerFrame.value),
    label: formatTimeTick(ms),
  }))
})

const currentSecond = computed((): number => {
  if (props.simpleMode) {
    const seconds = simpleSeconds.value.get(props.currentFrame)
    if (seconds !== undefined) return Math.round(seconds * 10) / 10
  }
  return Math.round((frameToTimeMs(props.currentFrame, props.frameCount, props.durationMs) / 1000) * 10) / 10
})

const durationSeconds = computed((): number => Math.max(props.durationMs / 1000, 0.5))

const playheadLeft = computed((): number => playheadOffsetPx(
  props.isScrubbing
    ? props.scrubProgress
    : props.frameCount > 0 ? props.currentFrame / props.frameCount : 0,
  props.frameCount,
  pxPerFrame.value,
))

const zoomLabel = computed((): string =>
  `${Math.round((pxPerFrame.value / TIMELINE_DEFAULT_PX_PER_FRAME) * 100)}%`,
)

const canZoomOut = computed((): boolean => pxPerFrame.value > TIMELINE_MIN_PX_PER_FRAME)
const canZoomIn = computed((): boolean => pxPerFrame.value < TIMELINE_MAX_PX_PER_FRAME)

const addFrameLabel = computed((): string =>
  props.simpleMode ? 'Добавить полсекунды' : 'Вставить кадр',
)

const addFrameText = computed((): string =>
  props.simpleMode ? '+ 0,5 с' : '+ кадр',
)

const addFrame = (): void => {
  if (props.simpleMode) {
    emit('add-step')
    return
  }
  emit('add-frame')
}

const frameLeft = (frame: number): number => frameOffsetPx(frame, pxPerFrame.value)

const isKey = (frame: number): boolean => props.keys.includes(frame)

const frameColor = (frame: number): string | null => props.frameColors.get(frame) ?? null

const frameBackground = (frame: number): string => {
  const color = frameColor(frame)
  if (color !== null) return color
  if (frame === props.currentFrame) return 'var(--accent-fill)'
  return 'var(--login-text-muted)'
}

const frameTitle = (frame: number): string => {
  const parts = [frameHeadline(frame)]
  if (isKey(frame)) parts.push('ключ')
  const colorName = frameColorLabel(frameColor(frame))
  if (colorName !== null) parts.push(colorName)
  return parts.join(', ')
}

const beadLeft = (bead: EditorTimeBead): number =>
  frameOffsetPx((bead.fromFrame + bead.toFrame + 1) / 2, pxPerFrame.value)

const beadTitle = (bead: EditorTimeBead): string =>
  props.beadMode === 'single'
    ? `Сдвинуть ключ в кадре ${bead.toFrame + 1}`
    : `Сдвинуть группу ключей ${bead.fromFrame + 1}–${bead.toFrame + 1}`

const contentLeft = (): number => contentRef.value?.getBoundingClientRect().left ?? 0

let scrubActive = false

const onScrubPointerMove = (event: PointerEvent): void => {
  emit('scrub', scrubProgressAtPointer(
    event.clientX,
    contentLeft(),
    pxPerFrame.value,
    Math.max(props.frameCount, 1),
  ))
}

const removeScrubListeners = (): void => {
  window.removeEventListener('pointermove', onScrubPointerMove)
  window.removeEventListener('pointerup', onScrubPointerEnd)
  window.removeEventListener('pointercancel', onScrubPointerEnd)
}

function onScrubPointerEnd(): void {
  if (!scrubActive) return
  scrubActive = false
  removeScrubListeners()
  emit('end-scrub')
}

const onRulerPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0 || props.frameCount <= 0) return
  event.preventDefault()
  removeScrubListeners()
  scrubActive = true
  emit('begin-scrub')
  onScrubPointerMove(event)
  window.addEventListener('pointermove', onScrubPointerMove)
  window.addEventListener('pointerup', onScrubPointerEnd)
  window.addEventListener('pointercancel', onScrubPointerEnd)
}

const onRulerKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    emit('step', -1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    emit('step', 1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    event.stopPropagation()
    emit('frame', 0)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    event.stopPropagation()
    emit('frame', Math.max(props.frameCount - 1, 0))
  }
}

const draggingFrame = ref<number | null>(null)
const dragTarget = ref<number | null>(null)
const dragMoved = ref<boolean>(false)
let suppressClickUntil = 0
let dragStartX = 0

const onFramePointerMove = (event: PointerEvent): void => {
  if (draggingFrame.value === null) return
  if (!dragMoved.value && Math.abs(event.clientX - dragStartX) > 3) dragMoved.value = true
  if (!dragMoved.value) return
  dragTarget.value = frameAtPointer(
    event.clientX,
    contentLeft(),
    pxPerFrame.value,
    props.frameCount,
  )
}

const removeFrameListeners = (): void => {
  window.removeEventListener('pointermove', onFramePointerMove)
  window.removeEventListener('pointerup', onFramePointerUp)
  window.removeEventListener('pointercancel', onFramePointerCancel)
}

const resetFrameDrag = (): void => {
  draggingFrame.value = null
  dragTarget.value = null
  dragMoved.value = false
  removeFrameListeners()
}

function onFramePointerUp(): void {
  const fromFrame = draggingFrame.value
  const toFrame = dragTarget.value
  const moved = dragMoved.value
  resetFrameDrag()

  if (fromFrame === null || toFrame === null) return
  if (!moved) return
  if (toFrame === fromFrame) return
  suppressClickUntil = Date.now() + 250
  emit('move-frame', fromFrame, toFrame)
}

function onFramePointerCancel(): void {
  resetFrameDrag()
}

const onFramePointerDown = (event: PointerEvent, frame: number): void => {
  if (event.button !== 0) return
  event.stopPropagation()
  if (props.simpleMode) return
  suppressClickUntil = 0
  dragStartX = event.clientX
  dragMoved.value = false
  draggingFrame.value = frame
  dragTarget.value = frame
  window.addEventListener('pointermove', onFramePointerMove)
  window.addEventListener('pointerup', onFramePointerUp)
  window.addEventListener('pointercancel', onFramePointerCancel)
}

const onFrameClick = (frame: number): void => {
  if (Date.now() < suppressClickUntil) return
  emit('frame', frame)
}

const zoomBy = (delta: number): void => {
  pxPerFrame.value = clampZoom(pxPerFrame.value + delta)
}

const onWheel = (event: WheelEvent): void => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault()
    const container = scrollRef.value
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const oldFrame = (container.scrollLeft + pointerX - TIMELINE_TRACK_PAD_PX) / pxPerFrame.value
    const next = clampZoom(pxPerFrame.value + (event.deltaY < 0 ? 2 : -2))
    if (next === pxPerFrame.value) return
    pxPerFrame.value = next
    void nextTick((): void => {
      container.scrollLeft = Math.max(0, TIMELINE_TRACK_PAD_PX + oldFrame * next - pointerX)
    })
    return
  }

  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.preventDefault()
    if (scrollRef.value !== null) scrollRef.value.scrollLeft += event.deltaY
  }
}

let beadDrag: { startX: number; lastDelta: number } | null = null

const onBeadPointerMove = (event: PointerEvent): void => {
  if (beadDrag === null) return
  const delta = Math.round((event.clientX - beadDrag.startX) / pxPerFrame.value)
  if (delta === beadDrag.lastDelta) return
  beadDrag.lastDelta = delta
  emit('bead-drag', delta)
}

const onBeadPointerUp = (): void => {
  if (beadDrag === null) return
  beadDrag = null
  emit('bead-end')
  window.removeEventListener('pointermove', onBeadPointerMove)
  window.removeEventListener('pointerup', onBeadPointerUp)
}

const onBeadPointerDown = (event: PointerEvent, bead: EditorTimeBead): void => {
  if (event.button !== 0 || props.frameCount <= 0) return
  event.preventDefault()
  beadDrag = { startX: event.clientX, lastDelta: 0 }
  emit('bead-start', bead.fromFrame, bead.toFrame)
  window.addEventListener('pointermove', onBeadPointerMove)
  window.addEventListener('pointerup', onBeadPointerUp)
}

const nudgeBead = (bead: EditorTimeBead, deltaFrames: number): void => {
  emit('bead-start', bead.fromFrame, bead.toFrame)
  emit('bead-drag', deltaFrames)
  emit('bead-end')
}

onScopeDispose((): void => {
  removeScrubListeners()
  removeFrameListeners()
  window.removeEventListener('pointermove', onBeadPointerMove)
  window.removeEventListener('pointerup', onBeadPointerUp)
})

const onFrameInput = (value: number | null): void => {
  if (value === null) return
  emit('frame', Math.max(0, Math.round(value) - 1))
}

const onSecondInput = (value: number | null): void => {
  if (value === null) return
  emit('second', Math.max(0, value))
}
</script>

<template>
  <div class="cpm-timeline">
    <div class="cpm-timeline__controls">
      <div class="cpm-timeline__edit-mode" role="group" aria-label="Режим редактирования">
        <button
          type="button"
          class="cpm-timeline__edit-btn"
          :class="{ 'cpm-timeline__edit-btn--active': simpleMode }"
          :aria-pressed="simpleMode"
          title="Позы ставятся каждые 0,5 секунды, промежуточные кадры достраивает интерполятор"
          @click="emit('simple-mode', true)"
        >
          Простой
        </button>
        <button
          type="button"
          class="cpm-timeline__edit-btn"
          :class="{ 'cpm-timeline__edit-btn--active': !simpleMode }"
          :aria-pressed="!simpleMode"
          @click="emit('simple-mode', false)"
        >
          Покадровый
        </button>
      </div>

      <button
        type="button"
        class="cpm-timeline__insert"
        :aria-label="addFrameLabel"
        @click="addFrame"
      >
        {{ addFrameText }}
      </button>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <ToolIconButton label="Отменить" :disabled="!canUndo" @click="emit('undo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Повторить" :disabled="!canRedo" @click="emit('redo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 14 20 9 15 4" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
      </ToolIconButton>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <ToolIconButton :label="isPlaying ? 'Пауза' : 'Воспроизвести'" @click="emit('toggle-play')">
        <svg v-if="isPlaying" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Медленнее" icon="minus" :disabled="!canSpeedDown" @click="emit('speed-down')" />
      <span class="cpm-timeline__speed">{{ speed }}×</span>
      <ToolIconButton label="Быстрее" icon="plus" :disabled="!canSpeedUp" @click="emit('speed-up')" />
      <ToolIconButton
        label="Зацикливание"
        :class="{ 'cpm-timeline__loop--active': isLooped }"
        :aria-pressed="isLooped"
        @click="emit('toggle-loop')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      </ToolIconButton>
      <ToolIconButton :label="simpleMode ? 'Предыдущий шаг' : 'Предыдущий кадр'" @click="emit('step', -1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </ToolIconButton>

      <div v-if="simpleMode" class="cpm-timeline__frame">
        <Input
          class="cpm-timeline__number"
          :model-value="currentSecond"
          :options="{ type: 'number', size: 'compact', align: 'center' }"
          :min="0"
          :max="durationSeconds"
          :step="0.5"
          aria-label="Секунда"
          @change="onSecondInput"
        />
        <span class="cpm-timeline__frame-total">с</span>
      </div>

      <div v-else class="cpm-timeline__frame">
        <Input
          class="cpm-timeline__number"
          :model-value="currentFrame + 1"
          :options="{ type: 'number', size: 'compact', align: 'center' }"
          :min="1"
          :max="frameCount"
          :step="1"
          aria-label="Номер кадра"
          @change="onFrameInput"
        />
        <span class="cpm-timeline__frame-total">/ {{ frameCount }}</span>
      </div>

      <ToolIconButton :label="simpleMode ? 'Следующий шаг' : 'Следующий кадр'" @click="emit('step', 1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </ToolIconButton>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <ToolIconButton label="Предыдущий ключ" :disabled="!canJumpToPreviousKey" @click="emit('jump-key', -1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="4" x2="5" y2="20" />
          <polyline points="19 18 11 12 19 6" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Следующий ключ" :disabled="!canJumpToNextKey" @click="emit('jump-key', 1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="4" x2="19" y2="20" />
          <polyline points="5 18 13 12 5 6" />
        </svg>
      </ToolIconButton>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <ToolIconButton label="Поставить ключ" :disabled="!canAddKey" @click="emit('add-key')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 21 12 12 21 3 12Z" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Удалить ключ" :disabled="!canRemoveKey" @click="emit('remove-key')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 21 12 12 21 3 12Z" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Копировать ключ" :disabled="!canCopyKey" @click="emit('copy-key')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </ToolIconButton>
      <ToolIconButton label="Вставить ключ" :disabled="!canPasteKey" @click="emit('paste-key')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M9 14h6" />
          <path d="M12 11v6" />
        </svg>
      </ToolIconButton>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <div class="cpm-timeline__bead-mode" role="group" aria-label="Сдвиг ключей">
        <button
          type="button"
          class="cpm-timeline__mode-btn"
          :class="{ 'cpm-timeline__mode-btn--active': beadMode === 'single' }"
          @click="emit('bead-mode', 'single')"
        >
          Ключ
        </button>
        <button
          type="button"
          class="cpm-timeline__mode-btn"
          :class="{ 'cpm-timeline__mode-btn--active': beadMode === 'proportional' }"
          @click="emit('bead-mode', 'proportional')"
        >
          Группа
        </button>
      </div>

      <span class="cpm-timeline__divider" aria-hidden="true" />

      <div class="cpm-timeline__zoom" role="group" aria-label="Масштаб таймлайна">
        <ToolIconButton label="Уменьшить масштаб" icon="minus" :disabled="!canZoomOut" @click="zoomBy(-4)" />
        <span class="cpm-timeline__zoom-value">{{ zoomLabel }}</span>
        <ToolIconButton label="Увеличить масштаб" icon="plus" :disabled="!canZoomIn" @click="zoomBy(4)" />
      </div>
    </div>

    <div ref="scrollRef" class="cpm-timeline__scroll" @wheel="onWheel">
      <div ref="contentRef" class="cpm-timeline__content" :style="{ width: `${trackWidth}px` }">
        <div class="cpm-timeline__rows">
          <div
            class="cpm-timeline__ruler"
            role="slider"
            tabindex="0"
            aria-label="Позиция воспроизведения"
            :aria-valuemin="1"
            :aria-valuemax="Math.max(frameCount, 1)"
            :aria-valuenow="currentFrame + 1"
            :aria-valuetext="`Кадр ${currentFrame + 1} из ${Math.max(frameCount, 1)}`"
            @pointerdown="onRulerPointerDown"
            @keydown="onRulerKeydown"
          >
            <span
              v-for="tick in ticks"
              :key="tick.ms"
              class="cpm-timeline__tick"
              :style="{ left: `${tick.left}px` }"
            >
              <span class="cpm-timeline__tick-label">{{ tick.label }}</span>
            </span>
          </div>

          <div class="cpm-timeline__frames" role="group" aria-label="Кадры">
            <button
              v-for="frame in frames"
              :key="frame"
              type="button"
              class="cpm-timeline__marker"
              :class="{
                'cpm-timeline__marker--active': frame === currentFrame,
                'cpm-timeline__marker--key': isKey(frame),
                'cpm-timeline__marker--dragging': draggingFrame === frame,
              }"
              :style="{ left: `${frameLeft(frame)}px` }"
              :title="frameTitle(frame)"
              :aria-label="frameTitle(frame)"
              :aria-pressed="frame === currentFrame"
              @click="onFrameClick(frame)"
              @pointerdown="onFramePointerDown($event, frame)"
            >
              <span
                class="cpm-timeline__marker-diamond"
                :style="{ backgroundColor: frameBackground(frame) }"
              />
              <span v-if="isKey(frame)" class="cpm-timeline__marker-key" aria-hidden="true" />
            </button>

            <span
              v-if="dragTarget !== null && dragTarget !== draggingFrame"
              class="cpm-timeline__drop"
              :style="{ left: `${frameLeft(dragTarget)}px` }"
              aria-hidden="true"
            />
          </div>

          <span
            class="cpm-timeline__playhead"
            :style="{ left: `${playheadLeft}px` }"
            aria-hidden="true"
          />
        </div>

        <div v-if="beads.length > 0" class="cpm-timeline__beads">
          <button
            v-for="bead in beads"
            :key="`${bead.fromFrame}-${bead.toFrame}`"
            type="button"
            class="cpm-timeline__bead"
            :style="{ left: `${beadLeft(bead)}px` }"
            :title="beadTitle(bead)"
            :aria-label="beadTitle(bead)"
            @pointerdown="onBeadPointerDown($event, bead)"
            @keydown.left.prevent.stop="nudgeBead(bead, -1)"
            @keydown.right.prevent.stop="nudgeBead(bead, 1)"
          >
            <span class="cpm-timeline__bead-grip" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  &__divider {
    @include mixins.tool-divider;
  }

  &__frame {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__number {
    flex: 0 0 auto;
    width: calc(var(--space-48) + var(--space-24));
  }

  &__frame-total {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__speed,
  &__zoom-value {
    min-width: var(--space-32);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    text-align: center;
  }

  &__loop--active {
    background: var(--surface-active);
    color: var(--accent-fill);
  }

  &__zoom {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__scroll {
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  &__content {
    position: relative;
  }

  &__rows {
    position: relative;
    height: calc(var(--space-24) + var(--space-20));
  }

  &__ruler {
    position: relative;
    height: var(--space-24);
    border-bottom: 1px solid var(--grid-line);
    cursor: ew-resize;
    touch-action: none;

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__tick {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: var(--space-4);
    background: var(--grid-line);
    pointer-events: none;
  }

  &__tick-label {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    color: var(--login-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: 1;
    white-space: nowrap;
    transform: translateX(-50%);
  }

  &__frames {
    position: relative;
    height: var(--space-20);
  }

  &__marker {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-20);
    height: var(--space-20);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    touch-action: none;
    transform: translateX(-50%);

    &:focus-visible {
      border-radius: var(--radius-badge);
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &--dragging {
      opacity: 0.4;
    }

    &--active .cpm-timeline__marker-diamond {
      outline: 1px solid var(--accent-fill);
      outline-offset: 1px;
    }
  }

  &__marker-diamond {
    width: var(--space-12);
    height: var(--space-12);
    border: 1px solid var(--grid-line);
    border-radius: var(--radius-badge);
    box-shadow: var(--elevation-inset);
    transform: rotate(45deg);
  }

  &__marker-key {
    position: absolute;
    bottom: 0;
    left: 50%;
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-circle);
    background: var(--accent-fill);
    transform: translateX(-50%);
  }

  &__playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--error);
    pointer-events: none;
    transform: translateX(-50%);

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      width: var(--space-8);
      height: var(--space-4);
      border-radius: 0 0 var(--radius-badge) var(--radius-badge);
      background: var(--error);
      transform: translateX(-50%);
    }
  }

  &__drop {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent-fill);
    pointer-events: none;
    transform: translateX(-50%);
  }

  &__beads {
    position: relative;
    height: var(--space-8);
    margin-top: var(--space-4);
  }

  &__bead {
    position: absolute;
    top: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-8);
    padding: 0;
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    cursor: ew-resize;
    transform: translateX(-50%);

    &:hover .cpm-timeline__bead-grip {
      background: var(--accent-fill);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__bead-grip {
    width: var(--space-8);
    height: var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--surface-active);
    box-shadow: var(--elevation-inset);
  }

  &__bead-mode {
    @include mixins.segmented;
  }

  &__edit-mode {
    @include mixins.segmented;
  }

  &__edit-btn {
    @include mixins.segmented-item($hover-exclude-active: true);

    padding: 0 var(--space-8);
    height: var(--control-height-sm);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;

    &--active {
      @include mixins.segmented-active;
    }
  }

  &__mode-btn {
    @include mixins.segmented-item;

    padding: 0 var(--space-8);
    height: var(--control-height-sm);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
  }

  &__insert {
    flex-shrink: 0;
    height: var(--control-height-sm);
    padding: 0 var(--space-8);
    border: none;
    border-radius: var(--radius-button);
    background: var(--accent-subtle);
    color: var(--login-text-primary);
    font-family: inherit;
    font-size: var(--text-caption);
    white-space: nowrap;
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
}
</style>
