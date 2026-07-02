<template>
  <component :is="tag">
    <slot />
  </component>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import smoothReflow from 'vue-smooth-reflow'
import type { SmoothHeightOptions } from '@/06-shared/types'

export default defineComponent({
  mixins: [smoothReflow],
  props: {
    tag: { default: 'div', type: String as () => string },
    options: {
      type: Object as () => SmoothHeightOptions,
      default: () => ({
        property: ['height'],
        transition: 'height .35s ease-in-out',
      }),
    },
  },
  mounted() {
    ;(this as any).$smoothReflow(this.options)
  },
})
</script>
