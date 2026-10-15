import type { Directive } from 'vue'

export const vFocus: Directive<HTMLElement> = {
  mounted: (el): void => {
    el.focus()
  },
}

declare module 'vue' {
  interface GlobalDirectives {
    vFocus: typeof vFocus
  }
}
