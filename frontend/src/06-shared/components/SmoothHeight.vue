<template>
  <component :is="tag">
    <slot />
  </component>
</template>

<script>
import smoothReflow from "vue-smooth-reflow";

export default {
  mixins: [smoothReflow],
  props: {
    tag: { default: "div", type: String },
    options: {
      type: Object,
      default: () => ({
        property: ["height"],
        transition: "height .35s ease-in-out",
      }),
    },
  },
  mounted() {
    this.$smoothReflow(this.options);
  },
};
</script>
