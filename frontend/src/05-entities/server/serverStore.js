import { defineStore } from "pinia";
import ky from "ky";

export const useServerStore = defineStore("server", {
    state: () => ({
        serverInfo: {}
    }),
    actions: {
        async getServerInfo() {
            const response = await ky(`https://api.mcsrvstat.us/2/play.mclucky.net`)
            const result = await response.json()
            this.serverInfo = result
            return true
        }
    }
});