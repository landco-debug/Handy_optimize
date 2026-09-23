# Постобработка через обычный аккаунт ChatGPT

## Статус

Реализация находится в ветке `feature-chatgpt-account-postprocessing`.

Provider ID: `chatgpt_account`.

На первом этапе функция показывается только в сборке Apple Silicon macOS, чтобы не расширять область изменений до проверки реальным аккаунтом. Технически транспорт больше не зависит от архитектуры: отдельный Codex-бинарник не используется.

## Что именно реализовано

Handy поддерживает второй способ облачной постобработки наряду с API-провайдерами:

- обычные API-провайдеры продолжают работать через `llm_client.rs`;
- Apple Intelligence остаётся отдельным локальным путём;
- `ChatGPT Account` использует подписку ChatGPT через Codex device-code authorization и отдельный backend `codex_client.rs`.

Это не вход через cookies браузера и не извлечение сессии сайта ChatGPT.

## Почему реализация изменена после первого прототипа

Первый прототип этой ветки запускал официальный `codex-app-server` и общался с ним по JSON-RPC. Он был рабочим на уровне сборки, но после повторной проверки исходников Cribe выяснилось, что Cribe делает иначе.

Cribe напрямую:

1. получает device code у `auth.openai.com`;
2. ждёт подтверждения пользователем;
3. меняет authorization code на OAuth access/refresh tokens;
4. хранит токены в macOS Keychain;
5. обращается к `chatgpt.com/backend-api/codex` напрямую.

Актуальный open-source Codex подтверждает тот же device-code протокол, OAuth client ID и заголовок `ChatGPT-Account-ID`. Поэтому Handy переведён на этот прямой механизм. Скачивание и запуск `codex-app-server` полностью удалены из тракта ChatGPT Account.

## Авторизация

Используются:

- client id: `app_EMoamEEZ73f0CkXaXp7hrann`;
- старт: `POST https://auth.openai.com/api/accounts/deviceauth/usercode`;
- подтверждение: `POST https://auth.openai.com/api/accounts/deviceauth/token`;
- страница пользователя: `https://auth.openai.com/codex/device`;
- обмен и refresh: `POST https://auth.openai.com/oauth/token`;
- redirect URI: `https://auth.openai.com/deviceauth/callback`.

При 403/404 во время polling Handy продолжает ждать. Максимальное время ожидания — 15 минут, как в Codex/Cribe.

Если старт device flow возвращает 404, UI показывает отдельное сообщение: в ChatGPT нужно включить **Settings → Security → Device code authorization for Codex**.

## Хранение секретов

Access token, refresh token и ID token не попадают в tauri-plugin-store и не логируются.

На macOS Handy сначала пытается хранить их в Data Protection Keychain. Для ad-hoc тестовых сборок, у которых нет нужного keychain entitlement, предусмотрен fallback в обычный Login Keychain — это повторяет защитную схему Cribe.

Refresh выполняется заранее, когда access token истекает менее чем через 5 минут. Одновременные refresh-запросы сериализуются, чтобы один и тот же rotating refresh token не был использован дважды.

## Вызов модели

Список моделей:

`GET https://chatgpt.com/backend-api/codex/models?client_version=0.155.0`

Постобработка:

`POST https://chatgpt.com/backend-api/codex/responses`

К запросу добавляются bearer token, `ChatGPT-Account-ID`, `originator: codex_cli_rs`, session id и Codex User-Agent.

Текст транскрипции отправляется отдельным user message, а выбранный пользователем prompt — как instructions. Инструкции дополнительно запрещают трактовать саму транскрипцию как команды и требуют вернуть только обработанный текст.

Ответ читается как SSE и собирается из `response.output_text.delta` до `response.completed`.

Если облачная постобработка падает, основной результат транскрибации не теряется: Handy возвращается к исходному локально распознанному тексту.

## Затронутые файлы

- `src-tauri/src/codex_client.rs` — авторизация, Keychain, refresh, список моделей и Codex Responses transport;
- `src-tauri/src/actions.rs` — отдельный маршрут для provider `chatgpt_account`;
- `src-tauri/src/settings.rs` — provider;
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` — Tauri commands;
- `src-tauri/src/shortcut/mod.rs` — получение списка моделей;
- `src/components/settings/PostProcessingSettingsApi/ChatGptAccountSettings.tsx` — вход/выход и device code UI;
- `src/components/settings/PostProcessingSettingsApi/usePostProcessProviderState.ts` и `PostProcessingSettings.tsx` — выбор provider;
- `src/i18n/locales/en/translation.json`, `ru/translation.json` — строки интерфейса.

## Проверка перед слиянием

Минимальный реальный тест:

1. Открыть ChatGPT → Settings → Security и включить device-code authorization.
2. В Handy выбрать `ChatGPT Account`.
3. Нажать вход, открыть показанную страницу и ввести одноразовый код.
4. Убедиться, что после подтверждения появились доступные модели.
5. Выбрать модель.
6. Выполнить диктовку горячей клавишей с постобработкой.
7. Перезапустить Handy и проверить, что вход сохранился.
8. Проверить выход из аккаунта.
9. Проверить fallback: при сетевой ошибке исходная транскрипция должна остаться доступной.

До реального end-to-end теста аккаунтом ветку нельзя считать готовой к слиянию в `main`.
