import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('@/02-pages/Home.vue'),
      alias: '/home',
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('@/02-pages/Setup.vue'),
    },
  ],
})

export default router
