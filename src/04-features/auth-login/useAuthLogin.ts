import {ref, onMounted} from 'vue'
import {useCoreStore, useNotificationStore} from '@/05-entities'
import {authLogins, authSaved, authLogin} from '@/06-shared/api'
import type {AuthUserData, LoginForm} from '@/05-entities/core/types'

export function useAuthLogin() {
    const coreStore = useCoreStore()
    const notification = useNotificationStore()
    const isLoading = ref<boolean>(false)
    const errorMessage = ref<string>('')
    const logins = ref<string[]>([])
    const formData = ref<LoginForm>({
        username: '',
        password: '',
        rememberMe: false,
    })

    const loadSavedCredentials = async (): Promise<void> => {
        if (coreStore.isLoggedIn) return

        try {
            logins.value = await authLogins(coreStore.currentProject)
            const saved = await authSaved(coreStore.currentProject)
            if (!saved) return

            formData.value.username = saved.username
            formData.value.password = saved.password
            formData.value.rememberMe = true
        } catch (e: unknown) {
            console.error(e)
        }
    }

    const handleLogin = async (): Promise<void> => {
        isLoading.value = true
        errorMessage.value = ''

        try {
            const authData: AuthUserData = {
                projectName: coreStore.currentProject,
                username: formData.value.username,
                password: formData.value.password,
                rememberMe: formData.value.rememberMe,
            }
            await authLogin(authData)
            coreStore.isLoggedIn = true
            notification.show('Авторизация прошла успешно')
        } catch (e: unknown) {
            console.error(e)
            errorMessage.value = String(e)
        } finally {
            isLoading.value = false
        }
    }

    onMounted(loadSavedCredentials)

    return {
        isLoading,
        errorMessage,
        logins,
        formData,
        handleLogin,
    }
}
