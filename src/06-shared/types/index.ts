export interface InputOptions {
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  label?: string
  list?: string[]
  readonly?: boolean
  disabled?: boolean
}

export interface DropdownOption {
  title: string
  value: string
  img?: string
}

export interface IconProps {
  type?: string
  up?: boolean
  down?: boolean
  left?: boolean
  right?: boolean
}

export interface IconButtonProps {
  icon: string
  tag?: string
  up?: boolean
  down?: boolean
}

export interface PopupOptions {
  header?: string
}


export interface SliderOptions {
  min: number
  max: number
  step: number
  label: string
  unit: string
}
