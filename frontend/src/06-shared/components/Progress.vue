<script setup>
import {computed} from "vue";

const props = defineProps(['total', 'current'])


const precent = computed(() => {
  const download = !props.total ? 100 : props.current / props.total * 100
  return 440 - (440 * download) / 100
})
</script>

<template>
  <div class="progressbar">
    <svg class="progressbar__svg">
      <circle cx="80" cy="80" r="70"
              class="progressbar__svg-circle circle-css shadow-css"
              :style="`stroke-dashoffset: ${precent}`"
      >
      </circle>
    </svg>
    <span class="progressbar__text shadow-css">Загрузка</span>
  </div>
</template>

<style lang="scss">
$color-black: hsl(0, 0%, 5%);
$color-color: hsl(0, 0%, 100%);
$color-css: hsl(200, 100%, 60%);


* {
  box-sizing: border-box;
}


.container__progressbars {
  display: flex;
  justify-content: space-around;
  align-items: center;
  flex-wrap: wrap;
  min-width: 270px;
  width: 100%;
  min-height: 100%;
}

.progressbar {
  position: relative;
  width: 170px;
  height: 170px;
  margin: 1em;
  transform: rotate(-90deg);
}

.progressbar__svg {
  position: relative;
  width: 100%;
  height: 100%;
}

.progressbar__svg-circle {
  width: 100%;
  height: 100%;
  fill: none;
  stroke-width: 10;
  stroke-dasharray: 440;
  stroke-dashoffset: 440;
  stroke: $color-css;
  stroke-linecap: round;
  transform: translate(5px, 5px); // stroke-width / 2
  transition: stroke-dashoffset 0.01s ease-in-out;
}

.progressbar__text {
  position: absolute;
  top: 50%;
  left: 50%;
  padding: 0.25em 0.5em;
  color: black;
  font-family: Arial, Helvetica, sans-serif;
  border-radius: 0.25em;
  transform: translate(-50%, -50%) rotate(90deg);
}


</style>