# Форк без офлайна (server-only)

Карта границ «серверный функционал vs офлайн» для форка лаунчера без офлайн-профилей. Полную карту по всем файлам бека и фронта собирает TASK-587; здесь фиксируются границы, актуализируемые задачами рефакторинга TASK-581–TASK-586 по мере их выполнения.

## Терминология

- **Офлайн-профиль** — `ProjectConfig.online = false`: проект запускается без сервера лаунчера (локальный authlib-шим, `auth::offline`, локальный скин).
- **Офлайн-сборка** — `is_offline_build()` / пустой `LAUNCHER_SERVER_URL`: лаунчер собран вообще без сервера (гейт Setup, отключённые обновления). Это отдельный флаг: он остаётся в серверном форке и не удаляется вместе с офлайн-профилями.

## Флаги coreStore (`05-entities/core`)

Флаги сборки и профиля не смешиваются в одном computed — у каждого свой смысл и свой набор потребителей, комбинации пишутся явно в месте использования:

- **Сборка**: `offlineBuild` (writable, гидрируется из `get_app_init_data`) и позитивный computed `isServerBuild = !offlineBuild`. Потребители: `useAppInit` (гейт проверки обновлений), `LauncherPage.vue` (секция «Обновление лаунчера»), `needsOfflineSetup` (гейт офлайн-сборки) и — в комбинации с профильным флагом — `createServerPoller`, `ServerUnavailableBanner`, `useAccountsPage` (`isServerOffline`).
- **Профиль**: `isOnlineProject` / `isOfflineProject` (`ProjectConfig.online === true/false`, чисто по конфигу проекта). Потребители: `useAppNavigation`, `App.vue` (`:show-mods`), `useAccountSettings`, `useOfflineLogin`, `useUserContent` (гейт серверных списков контента), `useOfflineSkinSettings`.

Серверным операциям, зависящим от обоих флагов (пуллер статуса, баннер недоступности, блокировка запуска), комбинация нужна явно: `coreStore.isServerBuild && coreStore.isOnlineProject`. В серверном форке офлайн-профилей не останется, и комбинация вырождается в `isOnlineProject`; сам флаг сборки (`offlineBuild`/`isServerBuild`/`needsOfflineSetup`) при вырезании офлайн-профилей не трогается.

## Пайплайн запуска (`commands/start.rs`)

Единственная точка касания пайплайна запуска с офлайном — `offline::AuthlibLaunch` (`src-tauri/src/offline/launch.rs`):

- `offline::AuthlibLaunch::resolve(&project_config, &username, &uuid).await` — для серверного профиля возвращает `resolved_server_url()`, для офлайн-профиля поднимает локальный Yggdrasil-шим (`SkinServer`) и отдаёт его URL; при недоступности скина/агента офлайн-запуск продолжается без него (ошибка логируется).
- `authlib.server_url()` — URL для `-javaagent` в `spawn_game_process`.
- `authlib.stop_on_game_exit(process.exited_flag())` — останавливает шим по флагу выхода игры (серверный профиль — no-op). При сбое запуска процесса шим останавливается через `Drop` самого ресурса.

Сигнатуры `start_minecraft_inner` / `spawn_game_step` офлайн-типов не содержат. Вырезание офлайна из пайплайна: удалить модуль `src-tauri/src/offline/` целиком и заменить в `commands/start.rs` вызов `AuthlibLaunch::resolve` + `server_url()` + `stop_on_game_exit()` на прямой `project_config.resolved_server_url()` — поведение серверного профиля при этом не меняется (authlib-инжект, события `game-started`/`game-exit`, трей, Discord живут вне этой границы).

Тесты границы: `src-tauri/src/offline/launch.rs` (`offline::launch::tests`).

## Авторизация и выбор аккаунта (`commands/auth_offline.rs`)

Вся офлайн-обработка авторизации и выбора аккаунта собрана в один модуль `src-tauri/src/commands/auth_offline.rs`:

- `login(state, project, username, remember_me)` — офлайн-ветка `login_account` (guard пустого ника, `auth::offline`, сохранение сессии и логина);
- `refresh(state, project, username)` — офлайн-ветка `auth_refresh_flow`;
- `select(username)` — источник `AuthData` для офлайн-ветки `select_account` (`commands/user_content.rs`);
- `reject_offline_session(session, reason)` — guard на sentinel-токен `OFFLINE_ACCESS_TOKEN` в `change_password_flow`;
- `reject_offline_project(project, reason)` — offline-bail резолвера `project_server_url`, через который проходят `restore_session`/`register_account`/`change_password_session` (и мягкий skip инвалидации в `delete_account_flow`).

Онлайн-пути содержат ровно по одной входной проверке `project.online` на границе команды (`login_account`, `auth_refresh_flow`, `select_account_flow`); внутри онлайн-цепочек офлайн-условий нет. Ретраи `with_session_retry` при 401 с офлайн-токеном получают чистую ошибку `OfflineProfile` из `restore_and_persist_session` и не повторяют запрос.

Вырезание офлайна: удалить модуль `commands/auth_offline.rs` вместе с его тестами (`auth_offline_tests`), убрать пять однолинейных вызовов — dispatch в `login_account`/`auth_refresh_flow`/`select_account_flow`, guard в `change_password_flow`, bail в `project_server_url` — и офлайн-сценарии из `account_flow_tests` (`commands/auth.rs`). Сценарии онлайн-пути при этом не меняются.

Тесты границы: `auth_offline_tests` в самом модуле; офлайн-кейсы `account_flow_tests` (`commands/auth.rs`); `select_account_tests` (`commands/user_content.rs`); `session_retry_tests` (`launcher_server/mod.rs`).

## Создание профиля (`04-features/add-profile`)

Серверный и офлайн-пути создания профиля разделены по модулям:

- `useAddProfile.ts` — серверная форма (`serverForm`, `isServerValid`, `submitServer`) и общие для обоих сабмитов `isSubmitting`/`errorMessage`. Офлайн-типов и веток не содержит.
- `useOfflineProfileForm.ts` — вся офлайн-форма: `offlineForm`, загрузка списков версий (`getMinecraftVersions`/`getLoaderVersions` используются только здесь), `submitOffline`, `kind`/`selectKind` (переключатель «Сервер/Одиночная игра» существует только при наличии офлайна). Общие `isSubmitting`/`errorMessage` приходят контекстом.
- `applyCreatedProfile.ts` — общий пост-сабмит (добавление проекта в стор + `finalizeSession`); остаётся в серверном форке.

Вырезание офлайна: удалить `useOfflineProfileForm.ts` и `03-widgets/tabs/profile/OfflineProfileForm.vue`, в `AddProfileTab.vue` убрать офлайн-вкладку, переключатель типов и деструктуризацию, в барреле фич снять экспорт. `useAddProfile` не трогается.

## Гейт needsOfflineSetup (`04-features/setup`)

Единственное место потребления `coreStore.needsOfflineSetup` (кроме определения в сторе) — `useOfflineSetup.ts`:

- `useOfflineSetup()` — визард Setup: `step` (1 «Папка установки» → 2 «Профиль»), `needsProfile`, переходы по `hasLauncherConfig` (шаг 2 либо `replace('/')`).
- `startOfflineSetupRedirect()` — сторож уровня приложения (запускается из `useAppNavigation`, once-guard): принудительный `replace` на Setup, пока гейт активен.

`useSetup` — только шаг 1 (выбор папки + `initializeLauncher`), без офлайн-условий и роутинга. `useAppInit` редиректит только по отсутствию конфига (`/setup`); офлайн-гейт на старте срабатывает сторожем.

Гейт живёт на флаге офлайн-сборки, а не офлайн-профиля, поэтому в серверном форке НЕ удаляется: пустая офлайн-сборка продолжает попадать в Setup и требовать профиль (уже только серверный).

## Скины (`04-features/skin-settings`)

Серверный пайплайн и офлайн-персистенция разделены по модулям:

- `useSkinSettings.ts` — серверный путь (`list_skins`, `upload`, `setActiveSkin`, `getProfileSkin`) и общая механика превью: blob-URL-менеджмент, race guard, сессии загрузки (`runSkinLoad` — счётчик `isSkinLoading`), валидация размера. Офлайн-веток и офлайн-API не содержит: для офлайн-проекта серверные шаги — no-op.
- `useOfflineSkinSettings.ts` — обёртка над `useSkinSettings` (возвращает `{ ...settings, resetSkin }`): загрузка локального скина (`getOfflineSkin` + `getOfflineSkinModel` с флагом `restoringOfflineModel`), очередь автосохранения `saveOfflineSkin` (триггеры — смена модели и появление новых байтов файла), `deleteOfflineSkin` в подтверждённом сбросе. Онлайн-режим — no-op поверх серверного пути.

`SkinSettings.vue` потребляет обёртку; офлайн-ветки шаблона (подсказка локального профиля, скрытие кнопки «Сохранить» и списка загруженных скинов) живут на `isOffline`.

Вырезание офлайна: удалить `useOfflineSkinSettings.ts`, в `SkinSettings.vue` взять `useSkinSettings` напрямую из барреля и убрать `isOffline`-ветки шаблона. `useSkinSettings` не трогается.

Тесты границ: `__tests__/useOfflineSkinSettings.test.ts` удаляется вместе с модулем; `__tests__/useSkinSettings.test.ts` остаётся (включая тест «does not touch the offline skin storage»).

## Мелкие офлайн-ветки (`04-features/*`)

- **Вход** (`accounts`): `useAuth` — серверная валидация (`isLoginValid` требует пароль), `submitLogin` (ядро сабмита с guard на `isLoading`) и серверная обёртка `handleLogin`. `useOfflineLogin.ts` оборачивает оба: офлайн-валидация без пароля + офлайн-`handleLogin`. Форк: удалить `useOfflineLogin.ts`, в `AuthTabsWidget.vue` взять `isLoginValid`/`handleLogin` напрямую из `useAuth` и убрать офлайн-ветки шаблона («Играть», скрытие пароля/чекбокса/вкладок).
- **Навигация настроек** (`settings-nav`): `useSettingsNav` строит серверную цепочку доступности (loadError → needsInit → needsAuth); `offlineSettingsNav.ts` накладывает офлайн-режим (блокирует вкладку «Аккаунт» с причиной «Недоступно в офлайн-режиме», открывает остальные до init/auth). Форк: удалить `offlineSettingsNav.ts`, убрать строку-обёртку в `useSettingsNav` и офлайн-тест интеграции.
- **Модель CPM** (`cpm-settings`): `useCpmSettings` — серверный путь (отправка на сервер, лимиты, слои); `useOfflineCpmModel.ts` — кнопка «Сохранить в игру» (payload с байтами в поле `SavePlayerModelPayload.data`; поле — контракт бека и остаётся, записывается только офлайн-юнитом). Форк: удалить `useOfflineCpmModel.ts`, в `CpmSettings.vue` убрать кнопку, офлайн-подсказку и `isOffline`-ветки шаблона.

Тесты границ: `__tests__/useOfflineProfileForm.test.ts`, `__tests__/useOfflineLogin.test.ts`, `__tests__/offlineSettingsNav.test.ts`, `__tests__/useOfflineCpmModel.test.ts` — удаляются вместе со своими модулями. `__tests__/useOfflineSetup.test.ts` остаётся в форке: гейт офлайн-сборки не удаляется.
