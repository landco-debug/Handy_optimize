# Direct Local LLM Post-Processing — Handy Fork

## Источник истины

База этой функции:
`feature-chatgpt-account-postprocessing` →
`1fa2da98b9f514477102519a904f21469ae00c41`.

В этой базе уже есть ChatGPT Account через direct Codex OAuth/backend и
per-prompt hotkeys. Их нельзя терять.

## Цель

Локальная постобработка без Ollama, LM Studio, localhost HTTP, API-ключа и
обязательного серверного процесса.

Тракт:

`выбранная сейчас STT-модель Handy → транскрипция → выбранный или
hotkey-привязанный prompt → Local (GGUF) → готовый текст`.

Prompt-hotkey меняет только prompt и никогда не меняет STT-модель.

## Реализация

- provider: `local_gguf`;
- GGUF выбирается стандартным macOS file picker и копируется в
  `app_data/llm_models`;
- Handy запускает подписанный bundled sidecar `handy-local-llm`;
- sidecar использует llama.cpp через `llama-cpp-2` с Metal;
- запрос передаётся через stdin JSON, результат возвращается через stdout JSON;
- sidecar не открывает порт и не является localhost-сервером;
- один запуск sidecar обслуживает одну операцию и после неё освобождает память;
- отмена операции убивает child через `kill_on_drop(true)`.

Изоляция отдельным Mach-O намеренная: основной процесс Handy уже содержит
transcribe.cpp/ggml для ASR, поэтому второй независимо собранный llama.cpp/ggml
не загружается в тот же процесс.

## Инварианты

1. Сохранять ChatGPT Account.
2. Сохранять per-prompt hotkeys.
3. Prompt-hotkey не переключает выбранную STT-модель.
4. Ошибка local LLM оставляет исходную локальную транскрипцию.
5. Не добавлять localhost/server как обязательный слой.
