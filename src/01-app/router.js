import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: "/",
            name: "Home",
            component: () => import("@/02-pages/Home.vue"),
            alias: "/home",
        },
        {
            path: "/setup",
            name: "Setup",
            component: () => import("@/02-pages/Setup.vue"),
        },
        {
            path: "/profile",
            name: "Profile",
            component: () => import("@/02-pages/Profile.vue"),
        },
        {
            path: "/settings",
            name: "Settings",
            component: () => import("@/02-pages/Profile.vue"),
        },
    ],
});
export default router;