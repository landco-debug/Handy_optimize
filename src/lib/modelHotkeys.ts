import type { ShortcutBinding } from "@/bindings";

/**
 * Per-model hotkeys are dynamic bindings (`switch_model:<model_id>`): they only
 * exist in settings once a key has been assigned, and pressing one starts a
 * dictation with that model.
 */
export const MODEL_HOTKEY_PREFIX = "switch_model:";

export const isModelHotkeyId = (id: string): boolean =>
  id.startsWith(MODEL_HOTKEY_PREFIX);

/** Stand-in shown for a model that has no hotkey assigned yet. */
export const emptyModelHotkey = (id: string, name: string): ShortcutBinding => ({
  id,
  name,
  description: "",
  default_binding: "",
  current_binding: "",
});
