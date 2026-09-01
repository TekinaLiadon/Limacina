import type { TabKey } from '@/05-entities/core/types'

export type { TabKey }



export interface TabItem {
  key: TabKey
  icon: string
  label: string
  disabled?: boolean
}

