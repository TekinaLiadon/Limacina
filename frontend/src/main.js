import {createApp} from 'vue'
import router from "@/01-app/router.js";
import App from './App.vue'
import './style.css';


createApp(App).use(router).mount('#app')
