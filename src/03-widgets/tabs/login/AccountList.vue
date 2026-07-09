<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  logins: string[]
}>()

const emit = defineEmits<{
  'open-form': []
}>()
</script>

<template>
  <div class="accounts-tab__list">
    <h2 class="accounts-tab__title">Аккаунты</h2>

    <div v-if="logins.length === 0" class="accounts-tab__empty">
      Нет сохранённых аккаунтов
    </div>

    <div v-else class="accounts-tab__items">
      <div
        v-for="login in logins"
        :key="login"
        class="accounts-tab__item"
      >
        <span class="accounts-tab__avatar">
          {{ login.charAt(0).toUpperCase() }}
        </span>
        <span class="accounts-tab__name">{{ login }}</span>
      </div>
    </div>
  </div>

  <div class="accounts-tab__footer">
    <Button
      class="btn-yellow accounts-tab__add-btn"
      @click="emit('open-form')"
    >
      Добавить новый
    </Button>
  </div>
</template>
