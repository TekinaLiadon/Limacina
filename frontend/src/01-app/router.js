import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: "/",
            name: "Home",
            component: () => import("@/02-pages/Home.vue"),
        },
        {
            path: "/home",
            name: "Home2",
            component: () => import("@/02-pages/Home.vue"),
        },
        {
            path: "/profile",
            name: "Profile",
            component: () => import("@/02-pages/Profile.vue"),
        },
    ],
});
export default router;