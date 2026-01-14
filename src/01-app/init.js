import {useServerStore} from "@/05-entities/server/serverStore.js";
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import {sleep} from "@/06-shared/utils/utils.js";


export default async () => {
    const serverStore = useServerStore()
    const coreStore = useCoreStore()

    if(!coreStore.isLoading) return

    const loading = await Promise.all( [
        serverStore.getServerInfo(),
        coreStore.getHomeDir()
    ])
    await sleep(200)
    coreStore.$patch((state) => {
        state.isLoading = false
    })
}