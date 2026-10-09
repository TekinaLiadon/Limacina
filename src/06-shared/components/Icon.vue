<script setup lang="ts">
import type { Component } from 'vue'
import type { IconType } from '@/06-shared/types'
import ArrowRight from './svg/ArrowRight.vue'
import ChevronDown from './svg/ChevronDown.vue'
import Home from './svg/Home.vue'
import Puzzle from './svg/Puzzle.vue'
import Referals from './svg/Referals.vue'
import Settings from './svg/Settings.vue'

const ICONS: Record<IconType, Component> = {
  home: Home,
  referals: Referals,
  settings: Settings,
  puzzle: Puzzle,
  'chevron-down': ChevronDown,
  'arrow-right': ArrowRight,
}

defineProps<{
  type: IconType
}>()
</script>

<template>
  <component :is="ICONS[type]" />
</template>

<style lang="scss">
.icon {
  transition: all var(--duration-base) var(--ease-out);
  display: inline-block;
  width: 1em;
  height: 1em;
  fill: currentColor;
  flex-shrink: 0;
}
</style>
