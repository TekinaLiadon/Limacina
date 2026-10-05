import type { Directive } from 'vue'

export const vFocus: Directive<HTMLElement, string | undefined> = {
  mounted: (el, binding): void => {
    const target = binding.value === undefined ? el : el.querySelector<HTMLElement>(binding.value)
    target?.focus()
  },
}

declare module 'vue' {
  interface GlobalDirectives {
    vFocus: typeof vFocus
  }
}
