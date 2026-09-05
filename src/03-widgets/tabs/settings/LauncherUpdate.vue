<script setup lang="ts">
import { computed } from 'vue'
import { Button, Dropdown } from '@/06-shared'
import type { DropdownOption } from '@/06-shared/types'
import { useLauncherUpdate } from '@/04-features'

const {
  versions,
  selectedVersion,
  currentVersion,
  isLoading,
  isApplying,
  isApplyDisabled,
  selectVersion,
  handleApplyVersion,
} = useLauncherUpdate()

const versionOptions = computed((): DropdownOption[] =>
  versions.value.map((entry): DropdownOption => ({
    value: entry.version,
    title: entry.version === currentVersion.value ? `${entry.version} — текущая` : entry.version,
  }))
)
</script>

<template>
  <div class="launcher-update">
    <span class="launcher-update__label eyebrow">Версия лаунчера</span>

    <div class="launcher-update__row">
      <Dropdown
        :options="versionOptions"
        :model-value="selectedVersion"
        :disabled="isLoading || isApplying"
        @update:model-value="selectVersion"
      />
      <Button
        class="btn-secondary launcher-update__apply"
        :is-loading="isApplying"
        :is-disabled="isApplyDisabled"
        @click="handleApplyVersion"
      >
        Откатить
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.launcher-update {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__label {
    display: block;
    text-align: left;
  }

  &__row {
    display: flex;
    gap: var(--space-8);
    align-items: center;

    .dropdown {
      flex: 1;
      min-width: 0;
    }
  }

  &__apply {
    min-height: var(--control-height);
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
