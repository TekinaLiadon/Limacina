<script setup lang="ts">
import { ref } from 'vue'
import { SUBTABS_ARIA_LABEL } from './model-tab/copy'
import { MODEL_SUB_TABS, type ModelSubTab } from './model-tab/subTabs'
import ModelTabCpm from './model-tab/ModelTabCpm.vue'
import ModelTabBbmodel from './model-tab/ModelTabBbmodel.vue'
import ModelTabFigura from './model-tab/ModelTabFigura.vue'

const activeSubTab = ref<ModelSubTab>('cpm')
</script>

<template>
  <div class="model-tab">
    <div class="model-tab__modes" role="group" :aria-label="SUBTABS_ARIA_LABEL">
      <button
        v-for="subTab in MODEL_SUB_TABS"
        :key="subTab.value"
        type="button"
        class="model-tab__mode-btn"
        :class="{ 'model-tab__mode-btn--active': activeSubTab === subTab.value }"
        :aria-pressed="activeSubTab === subTab.value"
        :title="subTab.title"
        @click="activeSubTab = subTab.value"
      >
        {{ subTab.label }}
      </button>
    </div>

    <ModelTabCpm v-if="activeSubTab === 'cpm'" />
    <ModelTabBbmodel v-if="activeSubTab === 'bbmodel'" />
    <ModelTabFigura v-if="activeSubTab === 'figura'" />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.model-tab {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__modes {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
  }

  &__mode-btn {
    @include mixins.mode-toggle-button;

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__viewer-empty {
    @include mixins.caption-hint;
  }

  &__playback {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__layer-panel {
    width: 100%;
  }
}
</style>
