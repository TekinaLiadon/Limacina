import { createRouter, createWebHashHistory } from 'vue-router'
import { reportError } from '@/06-shared'

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
      component: () => import('@/03-widgets/tabs/AddProfileTab.vue'),
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
          path: 'game',
          name: 'SettingsGame',
          component: () => import('@/03-widgets/tabs/settings/GameSettings.vue'),
        },
        {
          path: 'skin',
          name: 'SettingsSkin',
          component: () => import('@/03-widgets/tabs/settings/SkinSettings.vue'),
        },
        {
          path: 'account',
          name: 'SettingsAccount',
          component: () => import('@/03-widgets/tabs/settings/AccountSettings.vue'),
        },
        {
          path: 'model',
          name: 'SettingsModel',
          component: () => import('@/03-widgets/tabs/settings/CpmSettings.vue'),
        },
      ],
    },
    {
      path: '/mods',
      name: 'Mods',
      component: () => import('@/02-pages/Mods.vue'),
    },
    {
      path: '/debug',
      name: 'Debug',
      component: () => import('@/03-widgets/tabs/DebugTab.vue'),
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('@/02-pages/Setup.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'Accounts' },
    },
  ],
})

export default router

router.onError((error: unknown): void => {
  reportError('Не удалось открыть страницу', error)
})
