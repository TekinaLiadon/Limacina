import { defineStore } from "pinia";
import ky from "ky";

export const useServerStore = defineStore("server", {
    state: () => ({
        serverInfo: {}
    }),
    actions: {
        async getServerInfo() {
            const result = await ky(`https://api.mcsrvstat.us/2/play.mclucky.net`).json()
            this.serverInfo = result
        }
    }
});