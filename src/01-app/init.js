
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import {sleep} from "@/06-shared/utils/utils.js";


export default async () => {
    const coreStore = useCoreStore()

    if(!coreStore.isLoading) return

    await sleep(200)
    coreStore.$patch((state) => {
        state.isLoading = false
    })
}