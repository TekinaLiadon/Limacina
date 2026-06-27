import { useCoreStore } from "@/05-entities/core/coreStore.js";

export default async () => {
  const coreStore = useCoreStore();
  if (!coreStore.isLoading) return;
  coreStore.$patch((state) => {
    state.isLoading = false;
  });
};