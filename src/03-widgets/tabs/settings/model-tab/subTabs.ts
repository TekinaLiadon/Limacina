import { MODEL_TAB_LABELS, MODEL_TAB_TITLES } from './copy'

export type ModelSubTab = 'cpm' | 'bbmodel' | 'figura'

interface ModelSubTabItem {
  value: ModelSubTab
  label: string
  title: string
}

export const MODEL_SUB_TABS: readonly ModelSubTabItem[] = [
  { value: 'cpm', label: MODEL_TAB_LABELS.cpm, title: MODEL_TAB_TITLES.cpm },
  { value: 'bbmodel', label: MODEL_TAB_LABELS.blockbench, title: MODEL_TAB_TITLES.blockbench },
  { value: 'figura', label: MODEL_TAB_LABELS.figura, title: MODEL_TAB_TITLES.figura },
]
