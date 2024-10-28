import { defineStore } from "pinia";
import {CheckDir} from "../../../wailsjs/go/main/App.js";

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
