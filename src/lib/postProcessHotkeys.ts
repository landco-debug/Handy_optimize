import type { ShortcutBinding } from "@/bindings";

export const POST_PROCESS_PROMPT_HOTKEY_PREFIX = "post_process_prompt:";

export const isPostProcessPromptHotkeyId = (id: string): boolean =>
  id.startsWith(POST_PROCESS_PROMPT_HOTKEY_PREFIX);

export const emptyPostProcessPromptHotkey = (
  id: string,
  name: string,
): ShortcutBinding => ({
  id,
  name,
  description: "",
  default_binding: "",
  current_binding: "",
});
