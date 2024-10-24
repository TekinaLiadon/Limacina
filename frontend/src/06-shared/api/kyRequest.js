import ky from "ky";

const kyRequest = ky.create({
    prefixUrl: `${import.meta.env.VITE_APP_BACKEND_URL}/api`,
    timeout: 30000,
});

const request = async (setting) => {
    const api = kyRequest.extend((options) => {
        return ({
            headers: {
                /*Authorization: `Bearer ${userStore.adminToken || userStore.bearerToken}`,*/
                /*"Locale": userStore.lang || "en",*/
            },
            method: setting?.type || "GET",
            json: setting?.json
        })
    })
    const url = setting.query ? `${setting.url}?${new URLSearchParams(setting.query)}`: setting.url
    try {
        const result = await api(url).json()
        return {data: result.data, meta: result.meta}
    } catch (err) {
        const error = await err.response.json()
        throw error?.error || error?.message
    }
}
export default request