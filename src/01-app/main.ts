import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from '@/01-app/router'
import App from '@/01-app/App.vue'
import { reportError } from '@/06-shared'

const app = createApp(App).use(createPinia()).use(router)

app.config.errorHandler = (err: unknown, _instance: unknown, info: string): void => {
  reportError(`Необработанная ошибка Vue (${info})`, err)
}

window.addEventListener('error', (event: ErrorEvent): void => {
  reportError('Необработанная ошибка', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent): void => {
  reportError('Необработанное отклонение промиса', event.reason)
})

app.mount('#app')
