<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'
import { buildSimpleFrames, frameToTimeMs, type EditorBeadMode, type EditorTimeBead } from '@/04-features'
import { Input } from '@/06-shared'
import ToolIconButton from '../ToolIconButton.vue'

const props = defineProps<{
  frameCount: number
  durationMs: number
  simpleMode: boolean
  currentFrame: number
  keys: number[]
  beads: EditorTimeBead[]
  beadMode: EditorBeadMode
  isPlaying: boolean
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
  undo: []
  redo: []
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

const showNumber = (frame: number): boolean =>
  props.frameCount <= 24 || frame % 5 === 0

const formatSeconds = (seconds: number): string =>
  Number.isInteger(seconds) ? `${seconds} с` : `${seconds.toFixed(1)} с`

const cellLabel = (frame: number): string => {
  if (!props.simpleMode) return showNumber(frame) ? String(frame + 1) : ''
  const seconds = simpleSeconds.value.get(frame)
  if (seconds !== undefined) return formatSeconds(seconds)
  return formatSeconds(Math.round((frameToTimeMs(frame, props.frameCount, props.durationMs) / 1000) * 10) / 10)
}

const currentSecond = computed((): number =>
  Math.round((frameToTimeMs(props.currentFrame, props.frameCount, props.durationMs) / 1000) * 10) / 10,
)

const durationSeconds = computed((): number => Math.max(props.durationMs / 1000, 1))

const isKey = (frame: number): boolean => props.keys.includes(frame)

const beadLeft = (bead: EditorTimeBead): string => {
  const frameCount = Math.max(props.frameCount, 1)
  return `${(((bead.fromFrame + bead.toFrame + 1) / 2) / frameCount) * 100}%`
}

const beadTitle = (bead: EditorTimeBead): string =>
  props.beadMode === 'single'
    ? `Сдвинуть ключ в кадре ${bead.toFrame + 1}`
    : `Сдвинуть группу ключей ${bead.fromFrame + 1}–${bead.toFrame + 1}`

const ruler = ref<HTMLDivElement | null>(null)
let beadDrag: { startX: number; cellWidth: number; lastDelta: number } | null = null

const onBeadPointerMove = (event: PointerEvent): void => {
  if (beadDrag === null) return
  const delta = Math.round((event.clientX - beadDrag.startX) / beadDrag.cellWidth)
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
  const rulerElement = ruler.value
  const cell = rulerElement?.querySelector<HTMLElement>('.cpm-timeline__cell')
  const fallbackWidth = (rulerElement?.getBoundingClientRect().width ?? 0) / props.frameCount
  const cellWidth = cell ? cell.getBoundingClientRect().width + 1 : fallbackWidth
  if (cellWidth <= 0) return
  event.preventDefault()
  beadDrag = { startX: event.clientX, cellWidth, lastDelta: 0 }
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
      <ToolIconButton :label="simpleMode ? 'Предыдущая секунда' : 'Предыдущий кадр'" @click="emit('step', -1)">
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
          :step="1"
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

      <ToolIconButton :label="simpleMode ? 'Следующая секунда' : 'Следующий кадр'" @click="emit('step', 1)">
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
    </div>

    <div ref="ruler" class="cpm-timeline__ruler" role="group" aria-label="Шкала кадров">
      <button
        v-for="frame in frames"
        :key="frame"
        type="button"
        class="cpm-timeline__cell"
        :class="{
          'cpm-timeline__cell--active': frame === currentFrame,
          'cpm-timeline__cell--key': isKey(frame),
        }"
        :aria-label="simpleMode ? `Время ${cellLabel(frame)}` : `Кадр ${frame + 1}`"
        :aria-pressed="frame === currentFrame"
        @click="emit('frame', frame)"
      >
        {{ cellLabel(frame) }}
      </button>
    </div>

    <div v-if="beads.length > 0" class="cpm-timeline__beads">
      <button
        v-for="bead in beads"
        :key="`${bead.fromFrame}-${bead.toFrame}`"
        type="button"
        class="cpm-timeline__bead"
        :style="{ left: beadLeft(bead) }"
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
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__controls {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__divider {
    @include mixins.tool-divider;
  }

  &__frame {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
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

  &__speed {
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

  &__ruler {
    display: flex;
    gap: 1px;
    overflow-x: auto;
    padding-bottom: var(--space-8);
  }

  &__cell {
    position: relative;
    flex: 1 0 var(--space-16);
    height: var(--control-height-sm);
    border: none;
    border-radius: var(--radius-badge);
    background: var(--surface-light);
    color: var(--login-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    cursor: pointer;

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &--active {
      background: var(--surface-active);
      color: var(--login-text-primary);
      box-shadow: var(--elevation-inset);
    }

    &--key::after {
      content: '';
      position: absolute;
      bottom: var(--space-4);
      left: 50%;
      width: var(--space-4);
      height: var(--space-4);
      border-radius: var(--radius-circle);
      background: var(--accent-fill);
      transform: translateX(-50%);
    }
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

  &__beads {
    position: relative;
    height: var(--space-12);
    margin-top: calc(var(--space-4) * -1);
  }

  &__bead {
    position: absolute;
    top: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-16);
    height: var(--space-12);
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
}
</style>
