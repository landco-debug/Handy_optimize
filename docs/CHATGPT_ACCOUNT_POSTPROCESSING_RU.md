# Постобработка через обычный аккаунт ChatGPT

## Назначение

В Handy добавлен отдельный поставщик `ChatGPT Account`. Он не использует OpenAI API-ключ и не связан с API-биллингом Handy. Авторизация идёт через официальный Codex app-server и обычный ChatGPT-аккаунт — тем же классом механизма, на который указывает переключатель «Авторизация по коду устройства для Codex» в настройках ChatGPT.

## Авторизация

1. Пользователь выбирает `ChatGPT Account` в разделе постобработки.
2. Перед входом Handy явно напоминает включить в ChatGPT → Настройки → Безопасность авторизацию кода устройства для Codex; для многих аккаунтов она по умолчанию выключена.
3. При первом входе Handy лениво скачивает официальный `codex-app-server` версии 0.155.0 для Apple Silicon.
4. SHA-256 архива проверяется до распаковки.
5. Handy вызывает `account/login/start` с `type = chatgptDeviceCode`.
6. Пользователь получает URL и одноразовый код, открывает страницу ChatGPT и подтверждает вход.
7. Handy ждёт `account/login/completed`, затем проверяет аккаунт через `account/read`.
8. Ожидание можно отменить из интерфейса; отмена не блокируется mutex'ом активной app-server-сессии.

Пароли ChatGPT, cookies браузера и приватные web-endpoint'ы не используются.

## Хранение данных

Runtime и служебные данные находятся в отдельной структуре Handy:

```text
<Handy app data>/
└── chatgpt-account/
    ├── runtime/
    │   └── 0.155.0/
    │       └── codex-app-server
    ├── codex-home/
    │   └── config.toml
    └── workspace/
```

Для Codex задан отдельный `CODEX_HOME`. В `config.toml` включено:

```toml
cli_auth_credentials_store = "keyring"
```

Поэтому учётные данные ChatGPT не смешиваются с обычной установкой Codex CLI пользователя и хранятся через системный keyring.

## Постобработка

Для каждого запроса создаётся ephemeral thread:

- `approvalPolicy = never`;
- `sandbox = read-only`;
- промпт пользователя передаётся как developer instructions;
- транскрипция передаётся отдельно как пользовательские данные;
- модель получает явную инструкцию не использовать shell, web, файлы и инструменты;
- `outputSchema` требует объект с единственным полем `transcription`;
- если модель в настройках не выбрана, используется модель Codex по умолчанию;
- список доступных моделей загружается через `model/list`.

При ошибке облачной постобработки сохраняется штатный принцип Handy: исходная транскрипция не теряется.

## Ограничение текущей реализации

Поставщик включён только для Apple Silicon macOS, потому что первая версия интеграции закрепляет конкретный официальный runtime `codex-app-server-aarch64-apple-darwin`. Это намеренное ограничение, чтобы не добавлять непроверенные бинарники для других платформ.

## Основные файлы

- `src-tauri/src/codex_client.rs` — runtime, JSON-RPC, device-code login, аккаунт, модели и post-processing.
- `src-tauri/src/actions.rs` — маршрутизация постобработки.
- `src-tauri/src/settings.rs` — регистрация провайдера.
- `src-tauri/src/shortcut/mod.rs` — получение списка моделей.
- `src/components/settings/PostProcessingSettingsApi/ChatGptAccountSettings.tsx` — UI авторизации.
