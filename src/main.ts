import {createApp} from 'vue'
import {createPinia} from "pinia";
import router from "@/01-app/router.js";
import App from './App.vue'
import './style.css';

const pinia = createPinia();
createApp(App).use(pinia).use(router).mount('#app')
