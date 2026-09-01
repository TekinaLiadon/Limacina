import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'Accounts',
      component: () => import('@/02-pages/Accounts.vue'),
    },
    {
      path: '/add-profile',
      name: 'AddProfile',
      component: () => import('@/02-pages/AddProfile.vue'),
    },
    {
      path: '/settings',
      component: () => import('@/02-pages/Settings.vue'),
      children: [
        {
          path: '',
          redirect: { name: 'SettingsLauncher' },
        },
        {
          path: 'launcher',
          name: 'SettingsLauncher',
          component: () => import('@/02-pages/settings/LauncherPage.vue'),
        },
        {
          path: 'project',
          name: 'SettingsProject',
          component: () => import('@/02-pages/settings/ProjectPage.vue'),
        },
        {
          path: 'skin',
          name: 'SettingsSkin',
          component: () => import('@/02-pages/settings/SkinPage.vue'),
        },
        {
          path: 'model',
          name: 'SettingsModel',
          component: () => import('@/02-pages/settings/ModelPage.vue'),
        },
      ],
    },
    {
      path: '/debug',
      name: 'Debug',
      component: () => import('@/02-pages/Debug.vue'),
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('@/02-pages/Setup.vue'),
    },
  ],
})

export default router
