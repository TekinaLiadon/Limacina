import { defineComponent, h, type Plugin, type VNode } from 'vue'
import { mount } from '@vue/test-utils'

export interface WithSetupResult<T> {
  result: T
  unmount: () => void
}

export function withSetup<T>(composable: () => T, plugins: Plugin[] = []): WithSetupResult<T> {
  let result: T | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        result = composable()
        return (): VNode => h('div')
      },
    }),
    { global: { plugins } },
  )
  return {
    result: result as T,
    unmount: (): void => {
      wrapper.unmount()
    },
  }
}
