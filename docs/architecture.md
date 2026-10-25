# Архитектура лаунчера Limacina

Карта системы для навигации по коду. Тут описано устройство: слои фронтенда, модули бекенда, IPC-поверхность, потоки данных, файлы на диске. Поведение экранов живёт в `docs/functional-spec.md`, дизайн-система в `docs/ui-spec.md`.

## 1. Общая картина

Лаунчер это приложение Tauri 2: один процесс, внутри Rust-бекенд и webview с Vue 3. Общение идёт через IPC: фронт вызывает команды бека, бек шлёт фронту события.

```
┌────────────────────────── Tauri-процесс ──────────────────────────┐
│                                                                   │
│   Vue 3 (webview)                    Rust                         │
│   ┌─────────────────────────┐        ┌──────────────────────┐     │
│   │ 02-pages  (маршруты)    │        │ commands/  (IPC)     │     │
│   │    v                    │        │    v                 │     │
│   │ 03-widgets (экраны)     │  IPC   │ minecraft/ java/     │     │
│   │    v                    │ <----> │ auth/ modrinth/      │     │
│   │ 04-features (логика)    │команды │ launcher_server/ ... │     │
│   │    v                    │события │    v                 │     │
│   │ 05-entities (сторы)     │        │ state/  utils/       │     │
│   │    v                    │        └──────────────────────┘     │
│   │ 06-shared (UI, IPC-API) │                                     │
│   └─────────────────────────┘                                     │
└───────────────────────────────────────────────────────────────────┘
        |                                      |
        v                                      v
  сервер лаунчера, Mojang,              game-процесс (spawn),
  Adoptium/Foojay, Modrinth,            локальный skin-шим (offline),
  Discord (локальный IPC)               файлы в ~/{LAUNCHER_NAME}/
```

Единственная точка IPC на фронте это слой `06-shared/api`: типизированные обёртки над `invoke()` и `listen()`. Компоненты и композаблы не зовут Tauri напрямую.

## 2. Внешние системы

| Система | Зачем нужна | Где в коде |
|---|---|---|
| Сервер лаунчера `limacina` | Своя авторизация (JWT), конфиг проекта, синхронизация файлов клиента и модов по SHA-1, скины и модели игроков, манифест автообновления | `auth/`, `launcher_server/`, `updater/` |
| Mojang | Манифесты версий и ассетов, клиент и библиотеки, правила (`rules`) | `minecraft/vanilla/` |
| Adoptium / Foojay | Скачивание Java: основной канал и альтернативные дистрибутивы | `java/` |
| Modrinth | Каталог модов: поиск, установка, обновление | `modrinth/`, фронт `04-features/modrinth` |
| Discord | Rich Presence через локальный IPC, без C SDK | `discord.rs` |
| authlib-injector | Java-агент для кастомной аутентификации (Yggdrasil). Для офлайн-профилей `offline/` поднимает поверх него локальный skin-шим | `offline/`, `minecraft/process.rs` |

## 3. Сервер и офлайн

В коде два независимых "офлайна", путать их нельзя:

* **Офлайн-профиль**, `ProjectConfig.online = false`: проект без сервера лаунчера. Запуск по нику, скины и модели хранятся локально, для скина поднимается локальный authlib-шим.
* **Офлайн-сборка**, `is_offline_build()` при пустом `LAUNCHER_SERVER_URL`: бинарник вообще без сервера. Отключает автообновление и включает гейт Setup.

На уровне стора флаги тоже раздельны: сборка это `offlineBuild` / `isServerBuild`, профиль это `isOnlineProject`. Операциям, которым важны оба (пуллер сервера, баннер недоступности, блокировка запуска), комбинация пишется явно: `isServerBuild && isOnlineProject`.

Поверхность офлайна, то есть то, что существует только в офлайн-мире:

| Слой | Только офлайн |
|---|---|
| Модули бека | `offline/` (authlib-шим и его jar), `modrinth/` (клиент и установка модов), `commands/auth_offline.rs` (офлайн-ветки авторизации) |
| Команды бека | `create_offline_profile`, четыре offline-skin команды, шесть `modrinth_*`, `get_minecraft_versions` и `get_loader_versions` (списки версий нужны только форме офлайн-профиля) |
| Фичи фронта | вкладка "Моды" целиком (Modrinth-стек), `useOfflineProfileForm` с `OfflineProfileForm.vue` (шаг 2 Setup), `useOfflineLogin`, `useOfflineSkinSettings`, `useOfflineCpmModel`, `offlineSettingsNav` |

Не офлайн, хотя названия намекают:

* Гейт `needsOfflineSetup` завязан на флаг сборки, не профиля: пустая офлайн-сборка попадает в Setup даже там, где офлайн-профилей нет.
* authlib-injector нужнее серверным профилям: агент с URL сервера ставится при каждом серверном запуске, офлайн лишь подменяет адрес локальным шимом.
* `autojoin`, `refresh_manifests` и версионные индексы обслуживают серверный флоу запуска.
* `CpmModelEntry.offline` в манифесте моделей это флаг локальной модели, к профилю отношения не имеет.

## 4. Фронтенд (`src/`)

Vue 3, TypeScript, Pinia, Feature-Sliced Design. Слои сверху вниз:

| Слой | Содержимое |
|---|---|
| `01-app` | Каркас приложения: `router.ts` (ленивая загрузка страниц), `App.vue` (бут-гейт: прелоадер, ошибка старта, глобальная обвязка), `AppLayout.vue` (шапка, сайдбар, контентная панель с `router-view`), глобальные стили, ассеты (токены, темы, шрифты, миксины), Preloader |
| `02-pages` | Компоненты маршрутов: `Accounts`, `Mods`, `Setup`, `Settings` с вложенными `settings/` (`LauncherPage`, `ProjectPage`) |
| `03-widgets` | Экранные блоки: `dashboard/` (сцены главного экрана), `tabs/` (аккаунты, логин, профиль, шаги первого запуска, моды Modrinth, настройки), `theme/`, `common/` (переиспользуемые куски вроде `LoadErrorRow` и `PopupShell`) |
| `04-features` | Композаблы с бизнес-логикой: `game-launch`, `game-session`, `integrity-check`, `modrinth`, `skin-settings`, `cpm-settings`, `server-availability` и ещё около 25 сегментов, по одному на фичу |
| `05-entities` | Pinia-сторы и типы |
| `06-shared` | Базовые UI-компоненты (`Button`, `Input`, `Dropdown`, `PopupShell`, `Tooltip`), IPC-слой `api/`, утилиты, директивы, типы |

Слой ниже не знает о слое выше, между слоями импортируют только через `index.ts`-баррели. Исключений два: `06-shared/api` считается публичным входом в shared-слой, а внутри одного слоя прямые импорты разрешены.

### Сторы (05-entities)

| Стор | Зона ответственности |
|---|---|
| `coreStore` | Центральное состояние: конфиг лаунчера, список проектов, текущий проект и его конфиг, флаги `offlineBuild` / `isOnlineProject` |
| `accountsStore` | Сохранённые логины по проектам, состояние авторизации |
| `launchStore` | Пайплайн запуска: план шагов, журнал прогресса, активные игровые сессии (`gameUsernames`) |
| `serverStore` | Доступность сервера лаунчера (`isServerReachable`) |
| `settingsStore` | Анимации и тема. Тема дополнительно кэшируется в localStorage, чтобы не мигать до загрузки конфига |
| `settingsDirtyStore` | Трекинг "грязных" вкладок настроек |
| `projectSettingsStore` | Форма настроек проекта с dirty-бейзлайном |
| `notificationStore` | Тосты и подтверждения |

### Сквозные механизмы

* Шагами установки и запуска управляет бекенд: он шлёт события `launch-steps` и `integrity-steps`, фронт сводит их в состояние машиной `06-shared/utils/stepEvents.ts`. Идентификаторы шагов задублированы в двух реестрах, `STEP_IDS` на фронте и `StepHandle::start` в беке. Новый шаг добавляется в оба места одним изменением.
* Поллинг сервера построен на общем движке `createBackoffPoller` (guard поколения, экспоненциальный бэкофф). `useServerAvailability` пингует сервер раз в 30 секунд, `useServerStatus` берёт статус из бека.
* Формы настроек держат dirty-состояние через `useDirtySnapshot`: бейзлайн после загрузки и сохранения, живой `isDirty`.
* 3D-вьюеры скина и CPM-модели работают на Three.js с общим каркасом `Viewer3D` и тулбаром, управление через provide/inject. Полноэкранный режим телепортирует существующий экземпляр, второй WebGL-контекст не появляется.
* Ошибки фронта уходят в `reportError`, который пишет их в дебаг-консоль бека командой `send_frontend_log`. Необработанные ошибки ловят глобальные хендлеры в `main.ts`.

## 5. Бекенд (`src-tauri/src/`)

Точка входа `lib.rs` парсит `.env` (вкомпилирован через `include_str!`) и ставит panic-hook с записью в файл-лог. Дальше инициализирует логгер. Поднимает трей и Discord Rich Presence. Загружает `LauncherConfig`, применяет лимит скорости, создаёт каталоги, чистит остатки `.part` после сбоев. В конце регистрирует около 80 IPC-команд.

| Модуль | Ответственность |
|---|---|
| `commands/` | Tauri-команды по доменам: `auth`, `auth_offline`, `profile`, `init`, `launcher_config`, `download`, `start`, `settings_project`, `game_options`, `integrity`, `install_journal`, `user_content`, `cpm_models`, `modrinth`, `update`, `notification`, `dto` |
| `state/` | Глобальное состояние и конфиги: `GlobalState` за `tokio::sync::Mutex` (команды сериализуются на нём намеренно), `ProjectConfig` (TOML), `LauncherConfig` (JSON), guard одновременного запуска (`launch_state`) |
| `minecraft/` | Ядро игры: установка vanilla (фазы: клиент, библиотеки, индекс ассетов, ассеты), лоадеры, сборка аргументов JVM, спавн процесса, авто-вход на сервер |
| `minecraft/mod_loader/` | Fabric держит свою реализацию трейта. Forge и NeoForge делят общий `InstallerLoader`: манифест, индекс, установщик. Добавление нового лоадера: модуль в `mod_loader/`, вариант enum в `state/dto.rs`, match в `commands/dto.rs` |
| `minecraft/process.rs` | `spawn_game_process`: слияние classpath, `-javaagent` для authlib-injector, wait-поток (шлёт `game-exit`, возвращает трей и Discord к состоянию "в лаунчере") |
| `auth/` | Логин, регистрация и refresh на сервере лаунчера. Хранение: keyring (Windows Credential Manager или Secret Service) с фолбэком `credentials.json` (0600, только refresh-токены и uuid, пароли не хранятся) |
| `launcher_server/` | Клиент API сервера: синхронизация файлов по SHA-1, скачивание модов, загрузка скинов и моделей игроков (multipart) |
| `modrinth/` | Клиент Modrinth API с кэшем ответов и установка модов: манифест `modrinth.json` в папке лаунчера, разрешение зависимостей, откат при частичном сбое |
| `java/` | Установка Java: Adoptium по версии MC, альтернативные дистрибутивы через Foojay |
| `offline/` | Офлайн-профили: скачивание authlib-injector (SHA-256, кэш на проект), локальный Yggdrasil-шим для скинов на 127.0.0.1 |
| `cpm/` | CPM-модели: манифест моделей проекта, сборка байтов модели (стаб-ссылка для сервера, полный файл для локальной установки), слияние `config/cpm.json` (ключ `selectedModel`). Модель всегда устанавливается в игру и выбирается локально; видимость другим игрокам работает только со специальным серверным форком CPM, который передаёт клиентам ссылки на модели |
| `updater/` | Самообновление через `tauri-plugin-updater`: сборка апдейтера в рантайме (публичный ключ, эндпоинты), список версий для дропдауна |
| `init.rs` | Инициализация каталогов и конфига проекта с сервера. Если сервер недоступен, инициализация падает с ошибкой, молчаливого дефолтного конфига нет |
| `tray.rs` | Трей с состоянием игры: иконка, тултип и меню меняются на время сессии |
| `discord.rs` | Rich Presence: активность "в лаунчере" и "играет в Minecraft {версия}", таймер сессии |
| `utils/` | Переиспользуемые помощники, см. ниже |

### Ключевые утилиты (utils/)

* Все HTTP-скачивания идут через `download_file`: атомарная запись (`.part` + rename) и хеширование SHA-1.
* `integrity` проверяет и восстанавливает файлы. `ensure_files` стоит гейтом в установке, `check_integrity` обслуживает страницу проверки, оба пишут install-манифест хешей.
* `bandwidth` держит глобальный токен-бакет лимита скорости, самообновление его сознательно обходит.
* `semaphore` ограничивает параллельные скачивания и добавляет ретраи.
* `step_events` даёт `StepHandle` для событий шагов. Терминальное событие у шага ровно одно, за этим следит система типов (хендлер потребляется по значению).
* `env_info`: имя лаунчера, пути, нормализация URL сервера, защита от path traversal.
* `http` отдаёт общий reqwest-клиент с пулом соединений.
* `install_id` считает идентификатор установки по железу (hostname, серийник, id диска) и отдаёт его для заголовка `X-Launcher-Id`. Заголовок ставят во все запросы к серверу лаунчера: авторизация, конфиг, файлы, моды, скины, обновления. Сторонним источникам он не уходит. `desktop_entry` синхронизирует .desktop-запись и иконку, `winreg` ведёт ветку деинсталляции в реестре Windows.

## 6. IPC-поверхность

Фронт вызывает только обёртки из `06-shared/api`, имена совпадают с командами бека. Группы:

| Группа | Команды |
|---|---|
| Инициализация и конфиг | `get_app_init_data`, `initialize_launcher`, `initialize_project`, `set_initialized`, `save_launcher_config`, `save_launcher_settings`, `save_theme`, `save_animations_enabled`, `get_startup_logs` |
| Профили | `create_server_profile`, `create_offline_profile`, `delete_project`, `save_current_project`, `get_server_connect_url`, `get_minecraft_versions`, `get_loader_versions`, `refresh_manifests` |
| Авторизация | `auth_login`, `auth_register`, `auth_refresh`, `auth_logins`, `change_password`, `delete_account`, `get_session_info`, `clear_session` |
| Установка и скачивание | `download_minecraft`, `download_java`, `download_alternative_java`, `get_java_distributions`, `get_java_version`, `download_server_file`, `download_server_mods`, `open_mods_folder`, `check_files_integrity`, `load_install_journal`, `record_install_step`, `clear_install_journal` |
| Запуск | `start_minecraft`, `get_game_state`, `get_launch_state`, `kill_game_process`, `exit_launcher` |
| Настройки проекта и игры | `load_settings_project`, `save_settings_project`, `probe_java_version`, `clear_minecraft_config`, `get_game_options`, `save_game_options`, `save_global_game_options`, `import_global_game_options` |
| Скины и модели | `upload_skin`, `list_skins`, `delete_skin`, `set_active_skin`, `get_profile_skin`, `read_skin_file`, `save_offline_skin`, `get_offline_skin`, `get_offline_skin_model`, `delete_offline_skin`, `upload_model`, `list_models`, `delete_model`, `save_player_model`, `read_cpm_project_file`, `take_cpm_project_path` |
| Modrinth | `modrinth_search`, `modrinth_project`, `modrinth_installed`, `modrinth_check_updates`, `modrinth_install`, `modrinth_uninstall`, `modrinth_export_prepare`, `modrinth_export_save`, `modrinth_import_preview`, `modrinth_import_apply` |
| Обновление лаунчера | `check_update`, `apply_update_cmd`, `get_launcher_versions`, `get_server_status`, `ping_launcher_server` |
| Прочее | `get_notification_icon`, `send_frontend_log` (лог фронта в дебаг-консоль) |

События из бека во фронт:

| Событие | Payload | Кто потребляет |
|---|---|---|
| `launch-steps` | `StepEvent` (start/progress/finish/fail) | `useLaunchStepsStream`, системные уведомления |
| `integrity-steps` | `StepEvent` | `useIntegrityCheck` |
| `game-started` | ник | `useGameSession`: активные сессии, экран "Игра запущена" |
| `game-exit` | код и успех | `useGameSession`, системные уведомления |
| `game-console` | строки лога игры | дебаг-консоль |
| `cpm-project-open` | путь к `.cpmproject` | открытие модели из проводника (single-instance) |

## 7. Ключевые потоки

### Установка и запуск игры

1. `useGameLaunch` смотрит на `ProjectConfig.initialized`. При `false` строится план установки: Java, файлы, Minecraft, запуск. При `true` план короче: проверка Java, синхронизация файлов, запуск.
2. `start_minecraft` берёт глобальный guard из `state/launch_state`, параллельный второй запуск исключён.
3. Бек проходит шаги, каждый шаг эмитит `launch-steps`. Файлы проверяются по хешам (`ensure_files`), докачиваются только битые и отсутствующие.
4. Vanilla-установка идёт фазами (`run_vanilla_phases`): клиент, библиотеки, индекс ассетов, ассеты. Лоадеры добавляют свои шаги поверх.
5. Перед спавном собираются classpath и аргументы: JVM-аргументы лоадера, пользовательские, авто-вход на сервер для 1.20.3+ через `--quickPlayMultiplayer`. Для серверных URL ставится authlib-агент, для офлайн-профилей поднимается локальный шим.
6. `spawn_game_process` запускает независимый процесс, включает трей и Discord-активность, шлёт `game-started`. Wait-поток ждёт выхода игры и шлёт `game-exit`.
7. Прерванная установка возобновляется: журнал шагов `install_journal_{проект}.json` позволяет продолжить с последнего успешного шага.

### Самообновление

Автопроверка при старте (`check_update`, таймаут 3 секунды) находит обновление, `apply_update_cmd` скачивает подписанный артефакт через `tauri-plugin-updater` и ставит его тихим NSIS-инсталлятором с перезапуском. Подпись проверяется по публичному ключу из `tauri.conf.json`. Детали релизного процесса в `RELEASE.md`.

### Сессии и доступность сервера

Активные сессии (`gameUsernames` в `launchStore`) блокируют смену проекта и включают экран "Игра запущена". Доступность сервера опрашивается с бэкоффом. Когда сервер недоступен, показывается баннер, кнопка "Играть" блокируется.

## 8. Данные на диске

| Путь | Что лежит |
|---|---|
| `{config_dir}/{launcher_name}/config.json` | `LauncherConfig`: путь установки, настройки, `project_names`, сохранённые логины |
| `~/{LAUNCHER_NAME}/project/{имя}/` | Игровая директория проекта (`.minecraft`) |
| `~/{LAUNCHER_NAME}/project/config/{имя}.toml` | `ProjectConfig`: версия MC, лоадер, флаги `online` / `initialized`, `server_url` |
| `~/{LAUNCHER_NAME}/manifest/` | Кэш индексов версий (`vanilla_index.json`, `forge.json` и другие), install-манифесты хешей (`installed_{проект}.json`), журналы установки (`install_journal_{проект}.json`) |
| `~/{LAUNCHER_NAME}/config/{проект}.models.json` | Манифест CPM-моделей проекта (служебный учёт лаунчера, игра его не читает) |
| `~/{LAUNCHER_NAME}/java/` | Установленные JDK |
| `~/{LAUNCHER_NAME}/credentials.json` | Фолбэк-хранилище креденшелов, только если keyring недоступен |
| `{игровая_дир}/player_models/`, `{игровая_дир}/config/cpm.json` | Установленные модели и выбор активной |
| `{игровая_дир}/profile_skins/` | Кэш скина профиля, офлайн-скин со sidecar-файлом модели |
| `~/{LAUNCHER_NAME}/project/{имя}/modrinth.json` | Bookkeeping-манифест Modrinth-модов: `ModrinthManifest { mods: HashMap<project_id, ManifestEntry>, known_hashes }` — соответствие «файл мода → источник, проект, версия», пополняется при каждой загрузке с Modrinth и при привязке ручных файлов |

Конфиги пишутся атомарно (`.part` + rename). Битые переименовываются в `.bak` и пересоздаются.

Файл-набор модов `.limmods.json` — транспортный формат для переноса набора между игроками (запись через `modrinth_export_save`, чтение через `modrinth_import_preview`/`modrinth_import_apply`). UTF-8 JSON, `format_version` = 1, поля — snake_case, неизвестные поля игнорируются. Лимиты: 1 МБ и 500 записей (жёсткая ошибка), записи дедуплицируются по `project_id` (нет — по `slug` без регистра), побеждает последняя.

```json
{
  "format_version": 1,
  "mods": [
    {
      "source": "modrinth",
      "project_id": "AABBCCDD",
      "slug": "sodium",
      "version_id": "XYZZYWWW",
      "version_number": "5.1.2",
      "title": "Sodium",
      "filename": "sodium-fabric-5.1.2.jar"
    }
  ]
}
```

`source` обязателен (сейчас единственное значение `modrinth`, неизвестные источники пропускаются с сообщением); обязателен хотя бы один из `project_id`/`slug`; `version_id` — пин версии (нет — ставится последняя совместимая); `version_number`, `title`, `filename` — только отображение. `sha1`/`icon_url` в файл не пишутся: импорт резолвит всё через Modrinth API и сверяет SHA-1 при скачивании. Сохранение дополняет имя суффиксом `.limmods.json`, если его нет, и отклоняет имя `modrinth.json` (охрана bookkeeping-манифеста).

## 9. Платформы

* Windows, основная платформа: NSIS-инсталлятор с кастомным шаблоном, самообновление тихой установкой, Credential Manager, ветка реестра для деинсталляции.
* Linux: сборка из исходников, Secret Service для keyring, синхронизация .desktop-записи и иконки при смене пути установки.
* macOS запланирована, пока не собирается и не тестируется. Известные пробелы (маппинг `osx` в `mac` для Adoptium, feature `apple-native` у keyring) зафиксированы в коде и ждут первого реального раннера CI.

Кроссплатформенные развилки помечены `#[cfg(target_os)]`. Classpath-разделитель и суффиксы нативных библиотек берутся из хелперов, хардкода нет.
