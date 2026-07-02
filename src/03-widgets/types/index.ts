import type { TabKey } from '@/05-entities/core/types'

export type { TabKey }

export interface SidebarItem {
  icon: string
  link: string
}

export interface HeaderUser {
  title: string
  value: string
}

export interface TabItem {
  key: TabKey
  icon: string
  label: string
  disabled?: boolean
}

export interface RegisterForm {
  login: string
  password: string
  confirmPassword: string
}
