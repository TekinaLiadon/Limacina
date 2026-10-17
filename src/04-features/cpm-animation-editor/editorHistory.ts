import type { EditorAnimationState } from './types'

export const EDITOR_HISTORY_LIMIT = 100

export interface EditorHistoryEntry {
  label: string
  state: EditorAnimationState
}

export interface EditorHistory {
  entries: EditorHistoryEntry[]
  index: number
  limit: number
}

export function createEditorHistory(
  state: EditorAnimationState,
  label = 'Начальное состояние',
  limit: number = EDITOR_HISTORY_LIMIT,
): EditorHistory {
  return {
    entries: [{ label, state }],
    index: 0,
    limit: Math.max(1, limit),
  }
}

export function commitEditorHistory(
  history: EditorHistory,
  state: EditorAnimationState,
  label: string,
): EditorHistory {
  const entries = history.entries.slice(0, history.index + 1)
  entries.push({ label, state })
  const overflow = Math.max(0, entries.length - history.limit)
  const trimmed = overflow > 0 ? entries.slice(overflow) : entries
  return {
    entries: trimmed,
    index: trimmed.length - 1,
    limit: history.limit,
  }
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  if (history.index <= 0) return history
  return { ...history, index: history.index - 1 }
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  if (history.index >= history.entries.length - 1) return history
  return { ...history, index: history.index + 1 }
}

export function canUndoEditorHistory(history: EditorHistory): boolean {
  return history.index > 0
}

export function canRedoEditorHistory(history: EditorHistory): boolean {
  return history.index < history.entries.length - 1
}

export function currentEditorState(history: EditorHistory): EditorAnimationState {
  const entry = history.entries[history.index]
  if (!entry) throw new Error('История редактора пуста')
  return entry.state
}
