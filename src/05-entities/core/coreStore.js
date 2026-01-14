import { defineStore } from "pinia";

export const useCoreStore = defineStore("core", {
  state: () => ({
    isLoading: true,
    homeDir: ''
  }),
  actions: {
    async getHomeDir() {
      try{
        const dir = await CheckDir()
        this.homeDir = dir
        return dir
      } catch (e){
        return ''
      }
    }
  }
});
