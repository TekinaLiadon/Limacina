import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from '@/01-app/router'
import App from '@/01-app/App.vue'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')
