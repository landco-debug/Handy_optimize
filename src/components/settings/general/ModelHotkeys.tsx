import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ShortcutInput } from "../ShortcutInput";
import { useModelStore } from "../../../stores/modelStore";
import { getTranslatedModelName } from "../../../lib/utils/modelTranslation";
import { MODEL_HOTKEY_PREFIX } from "../../../lib/modelHotkeys";

/**
 * One hotkey per downloaded model. Pressing it makes that model active and
 * starts a dictation with it (toggle / push-to-talk as set for the main
 * transcribe shortcut), without opening any menu.
 */
export const ModelHotkeys: React.FC = () => {
  const { t } = useTranslation();
  const { models } = useModelStore();
  const downloaded = models.filter((model) => model.is_downloaded);

  if (downloaded.length === 0) return null;

  return (
    <SettingsGroup
      title={t("settings.general.modelHotkeys.title", "Model Hotkeys")}
      description={t(
        "settings.general.modelHotkeys.description",
        "Assign a key to a model: pressing it selects that model and starts dictation with it right away.",
      )}
    >
      {downloaded.map((model) => (
        <ShortcutInput
          key={model.id}
          shortcutId={`${MODEL_HOTKEY_PREFIX}${model.id}`}
          label={getTranslatedModelName(model, t)}
          grouped={true}
        />
      ))}
    </SettingsGroup>
  );
};
