<script setup lang="ts">
import { toRef } from 'vue'
import { provideStagePaused } from './viewerControls'

const props = withDefaults(defineProps<{
  paused?: boolean
}>(), {
  paused: false,
})

provideStagePaused(toRef(props, 'paused'))
</script>

<template>
  <slot />
</template>
