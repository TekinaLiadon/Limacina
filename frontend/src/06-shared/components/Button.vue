<script setup>

const props = defineProps(["label", 'isDisabled', 'isLoading']);
const emit = defineEmits(["protected-click"])

const handleClick = () => {
  if (!props.isDisabled && !props.isLoading) emit("protected-click");
}
</script>

<template>
  <button class="btn" :aria-label="props.label" :class="{
      disabled: isDisabled,
      loading: isLoading,
    }"
          @click="handleClick"
  >
    <slot></slot>
  </button>
</template>

<style lang="scss">
.btn {
  display: flex;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in;
  outline: none;
  background: transparent;
  cursor: pointer;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &.btn-land-white {
    padding: 10px 30px;
    font-family: "Poppins", sans-serif;
    font-weight: 500;
    font-size: 18px;
    line-height: 24px;
    color: var(--white);
    border-radius: 60px;
    border: 1px solid var(--white);
    background: var(--half-blue);

    &:hover {
      box-shadow: 0 0 0 1px var(--white);
      font-weight: 600;
    }

    &.rounded {
      padding: 12px;
      border-radius: 50%;
    }
  }

  &.btn-yellow {
    padding: 10px 20px;
    font-family: "Poppins", sans-serif;
    font-weight: 500;
    font-size: 18px;
    line-height: 24px;
    color: var(--yellow);
    border-radius: 60px;
    border: 1px solid var(--yellow);
    background: transparent;

    &:hover {
      color: var(--transparent-white);
      border: 1px solid var(--transparent-white);
    }

    &.rounded {
      padding: 12px;
      border-radius: 50%;
    }
  }

  &.btn-db-green {
    display: inline-flex;
    align-items: center;
    padding: 10px 20px;
    font-family: "RisingSun", sans-serif;
    font-size: 14px;
    font-weight: 600;
    color: rgba(33, 37, 43, 1);
    border-radius: 60px;
    background-color: var(--yellow);
    border: 1px solid transparent;
    min-width: 120px;

    .icon {
      margin-left: 14px;
      font-size: 12px;
      font-weight: 600;
    }

    &:hover {
      background-color: var(--yellow-2);
    }

    &.loading {
      position: relative;
      background-color: var(--grey);
      color: var(--blue3);
      pointer-events: none;

      &::before {
        position: absolute;
        content: "";
        display: inline-block;
        width: 21px;
        height: 21px;
        transition: border 0.3s ease;
        animation: btn-preloader 1.5s ease infinite;
        vertical-align: middle;
        border: 3px solid transparent;
        border-radius: 50%;
        color: #131313;
        left: 10px;
      }
    }

    &.disabled {
      border-color: var(--grey-stroke);
      background-color: var(--item-grey);
      color: var(--landing-text);
    }

  }
}
</style>
