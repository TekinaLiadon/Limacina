<script setup lang="ts">
import Button from './Button.vue'
import PopupShell from './PopupShell.vue'
import { randomId } from '@/06-shared/utils/utils'

defineProps<{
  message: string
  visible: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const messageId = randomId()
</script>

<template>
  <PopupShell :visible="visible" :aria-labelled-by="messageId" panel-class="confirm-popup" @close="emit('cancel')">
    <p :id="messageId" class="confirm-popup__message">{{ message }}</p>
    <div class="confirm-popup__actions">
      <Button class="btn-primary confirm-popup__btn" @click="emit('confirm')">
        Да
      </Button>
      <Button
        v-focus
        class="btn-quiet confirm-popup__btn confirm-popup__btn--cancel"
        @click="emit('cancel')"
      >
        Нет
      </Button>
    </div>
  </PopupShell>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.confirm-popup {
  @include mixins.popup-card(var(--confirm-popup-max-width));

  &__message {
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-regular);
    color: var(--login-text-secondary);
    margin: 0 0 var(--space-24) 0;
    text-align: center;
  }

  @include mixins.popup-actions('&__btn');
}
</style>
