<script setup>
import {reactive} from 'vue'
import {Greet} from '../../wailsjs/go/main/App'
import Input from "@/06-shared/components/Input.vue";
import Button from "@/06-shared/components/Button.vue";

const data = reactive({
  name: "",
  resultText: "Please enter your name below 👇",
})

function greet() {
  Greet(data.name).then(result => {
    data.resultText = result
  })
}
</script>

<template>
<div class="login">
  <div class="login__center">
  <div class="login__form">
    <h2 style="margin: 20px 0 0 0">Авторизация</h2>
    <Input v-model="data.name" :options="{
      placeholder: 'Логин',
    }"
    />
    <Input v-model="data.name" :options="{
      placeholder: 'Пароль',
    }"
           type="password"
    />
    <Button @click="greet" class="btn-yellow">
      Войти
    </Button>
  </div>
  </div>
</div>
</template>

<style lang="scss">
.login {

  &__center {
    height: 100%;
    align-items: center;
    justify-content: center;
    display: flex;
  }

  &__form {
    max-width: 300px;
    width: 300px;
    margin: auto;
    align-items: center;
    justify-content: center;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 15px;
    background-color: rgba(51, 51, 51, 0.7);
    border-radius: 15px;
  }
}


</style>