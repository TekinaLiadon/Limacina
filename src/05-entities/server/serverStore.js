import { defineStore } from "pinia";
import ky from "ky";

export const useServerStore = defineStore("server", {
    state: () => ({
        serverInfo: {},
        serverName: import.meta.env.VITE_APP_SERVER_NAME,
        serverList: [
            {
                name: import.meta.env.VITE_APP_SERVER_NAME,
                urlLauncher: import.meta.env.VITE_APP_URL_LAUNCHER,
                urlStatus: import.meta.env.VITE_APP_URL_STATUS,
            }
        ]
    }),
    getters: {
      currentServer() {
          return this.serverList.find((el) => el.name === this.serverName)
      }
    },
    actions: {
        async getServerInfo(url = '') {
            const response = await ky(`https://api.mcstatus.io/v2/status/java/${url || this.currentServer.urlStatus}`) // https://api.mcsrvstat.us/2/
            const result = await response.json()
            this.serverInfo = result
            return result
        }
    }
});