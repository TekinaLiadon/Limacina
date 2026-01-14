<script setup>

</script>

<template>
  <div class="gallery">
    <img src="https://picsum.photos/id/1004/400/400" alt="a lovely kiss in the night">
    <img src="https://picsum.photos/id/1013/400/400" alt="a women inside a car">
    <img src="https://picsum.photos/id/1066/400/400" alt="a baby">
  </div>
</template>

<style lang="scss">
.gallery  {

  display: grid;
  width: 220px;
}
.gallery > img {
  grid-area: 1/1;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border: 10px solid #f2f2f2;
  box-shadow: 0 0 4px #0007;
  animation: slide 12s infinite;
}
.gallery > img:last-child {
  animation-name: slide-last;
}

.gallery > img:nth-child(2) { animation-delay: -4s; }
.gallery > img:nth-child(3) { animation-delay: -8s; }


@keyframes slide {
  0%     {transform: translateX(0%)  ;z-index: 2;}
  16.66% {transform: translateX(120%);z-index: 2;}
  16.67% {transform: translateX(120%);z-index: 1;}
  33.34% {transform: translateX(0%)  ;z-index: 1;}
  66.33% {transform: translateX(0%)  ;z-index: 1;}
  66.34% {transform: translateX(0%)  ;z-index: 2;}
  100%   {transform: translateX(0%)  ;z-index: 2;}
}
@keyframes slide-last {
  0%     {transform: translateX(0%)  ;z-index: 2;}
  16.66% {transform: translateX(120%);z-index: 2;}
  16.67% {transform: translateX(120%);z-index: 1;}
  33.34% {transform: translateX(0%)  ;z-index: 1;}
  83.33% {transform: translateX(0%)  ;z-index: 1;}
  83.34% {transform: translateX(0%)  ;z-index: 2;}
  100%   {transform: translateX(0%)  ;z-index: 2;}
}



body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-content: center;
  background: #CDB380;
  overflow: hidden;
}
</style>