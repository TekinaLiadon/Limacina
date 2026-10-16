<script setup lang="ts">
import { useIntegrityCheck } from '@/04-features'
import SettingsSection from '../SettingsSection.vue'
import IntegrityCheck from '../IntegrityCheck.vue'

const {
  steps,
  progress,
  isChecking,
  isCheckingNow,
  isPopupHidden,
  report,
  errorMessage,
  hasErrors,
  isClean,
  resultText,
  handleCheck,
  closeResult,
} = useIntegrityCheck()
</script>

<template>
  <SettingsSection title="Обслуживание" storage-key="project-maintenance">
    <IntegrityCheck
      :is-checking="isChecking"
      :is-checking-now="isCheckingNow"
      :is-popup-hidden="isPopupHidden"
      :steps="steps"
      :progress="progress"
      :report="report"
      :error-message="errorMessage"
      :has-errors="hasErrors"
      :is-clean="isClean"
      :result-text="resultText"
      @check="handleCheck"
      @close="closeResult"
    />
  </SettingsSection>
</template>
