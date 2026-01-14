<script setup>
import IconButton from "@/06-shared/components/IconButton.vue";

const items = [
  {
    icon: "home",
    link: "home",
  },
  {
    icon: "referals",
    link: "profile",
  },
  {
    icon: "settings",
    link: "settings",
  },
];

</script>

<template>
  <div class="sidebar">
    <router-link v-for="item in items" :key="item.href" :to="item.link">
      <IconButton tag="span" :icon="item.icon" />
    </router-link>
    <IconButton class="sidebar__exit-btn" icon="exit" @click="Quit" />
  </div>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding-top: 75px;

  &__exit-btn {
    flex-shrink: 0;
    margin-top: auto;

    .icon {
      color: #696b73;
    }
  }

  @include breakpoints.media-under-lg {
    flex-direction: row;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px 20px;
    position: fixed;
    bottom: 0;
    width: 100%;
    background-color: var(--grey);
    padding: 10px 0;
    left: 0;
    z-index: 10;
  }

  @include breakpoints.media-under-sm {
    /*margin: 0 -10px;*/

    &__exit-btn {
      display: none;
    }
  }
}
</style>
