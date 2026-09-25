import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface TextReplacementsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const normalizePhrase = (value: string) =>
  value.replace(/\s+/g, " ").trim();

export const TextReplacements: React.FC<TextReplacementsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    const replacements = getSetting("text_replacements") || {};
    const normalizedFrom = normalizePhrase(from);
    const normalizedTo = normalizePhrase(to);
    const entries = useMemo(
      () =>
        Object.entries(replacements).sort(([a], [b]) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        ),
      [replacements],
    );

    const handleAdd = () => {
      if (!normalizedFrom || !normalizedTo) return;
      if (normalizedFrom.length > 100 || normalizedTo.length > 100) return;

      const duplicate = Object.keys(replacements).find(
        (key) => key.toLocaleLowerCase() === normalizedFrom.toLocaleLowerCase(),
      );
      if (duplicate) {
        toast.error(
          t("settings.advanced.textReplacements.duplicate", {
            phrase: duplicate,
          }),
        );
        return;
      }

      updateSetting("text_replacements", {
        ...replacements,
        [normalizedFrom]: normalizedTo,
      });
      setFrom("");
      setTo("");
    };

    const handleRemove = (source: string) => {
      const next = { ...replacements };
      delete next[source];
      updateSetting("text_replacements", next);
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    };

    const busy = isUpdating("text_replacements");

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.textReplacements.title")}
          description={t("settings.advanced.textReplacements.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Input
              type="text"
              className="min-w-0 flex-1"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("settings.advanced.textReplacements.from")}
              variant="compact"
              disabled={busy}
            />
            <span className="text-mid-gray shrink-0">→</span>
            <Input
              type="text"
              className="min-w-0 flex-1"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("settings.advanced.textReplacements.to")}
              variant="compact"
              disabled={busy}
            />
            <Button
              onClick={handleAdd}
              disabled={
                !normalizedFrom ||
                !normalizedTo ||
                normalizedFrom.length > 100 ||
                normalizedTo.length > 100 ||
                busy
              }
              variant="primary"
              size="md"
            >
              {t("settings.advanced.textReplacements.add")}
            </Button>
          </div>
        </SettingContainer>

        {entries.length > 0 && (
          <div
            className={`px-4 py-2 ${grouped ? "" : "rounded-lg border border-mid-gray/20"} space-y-1`}
          >
            {entries.map(([source, target]) => (
              <div
                key={source}
                className="flex items-center gap-2 rounded-md bg-mid-gray/5 px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate" title={source}>
                  {source}
                </span>
                <span className="text-mid-gray shrink-0">→</span>
                <span className="min-w-0 flex-1 truncate" title={target}>
                  {target}
                </span>
                <Button
                  onClick={() => handleRemove(source)}
                  disabled={busy}
                  variant="secondary"
                  size="sm"
                  aria-label={t("settings.advanced.textReplacements.remove", {
                    phrase: source,
                  })}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  },
);
