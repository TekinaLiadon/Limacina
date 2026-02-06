import { defineStore } from "pinia";

export const useCoreStore = defineStore("core", {
  state: () => ({
    isLoading: true,
  }),
});
