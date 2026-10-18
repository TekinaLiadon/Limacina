export interface CpmTabItem {
  id: string
  label: string
  disabled?: boolean
}

export interface CpmTabbedPanelData {
  tabs: string[]
  [tab: string]: unknown
}
