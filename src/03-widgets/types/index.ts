import type { TabKey } from '@/05-entities'
import type { IconType } from '@/06-shared/types'

export type { TabKey }

export interface TabItem {
  key: TabKey
  icon: IconType
  label: string
  disabled?: boolean
}

