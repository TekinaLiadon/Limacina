import { defineStore } from "pinia";

export const useCoreStore = defineStore("core", {
  state: () => ({
    isLoading: true,
    hasLauncherConfig: null,
    launcherName: "",
    defaultParentPath: "",
    launcherConfig: null,
    version: "",
  }),
});
