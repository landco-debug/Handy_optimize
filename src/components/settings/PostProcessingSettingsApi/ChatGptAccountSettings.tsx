import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { SettingContainer } from "@/components/ui";

type CodexAccountStatus = {
  runtimeInstalled: boolean;
  signedIn: boolean;
  email: string | null;
  planType: string | null;
};

type CodexDeviceLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

type Props = {
  onAuthenticated: () => void;
};

export const ChatGptAccountSettings: React.FC<Props> = ({
  onAuthenticated,
}) => {
  const { t } = useTranslation();
  const mounted = useRef(true);
  const [status, setStatus] = useState<CodexAccountStatus | null>(null);
  const [login, setLogin] = useState<CodexDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageForError = (cause: unknown) => {
    const raw = String(cause);
    if (raw.includes("DEVICE_CODE_DISABLED")) {
      return t(
        "settings.postProcessing.api.chatGptAccount.deviceCodeDisabled",
      );
    }
    if (raw.includes("CHATGPT_DEVICE_CODE_TIMEOUT")) {
      return t("settings.postProcessing.api.chatGptAccount.timeout");
    }
    if (
      raw.includes("CHATGPT_REAUTH_REQUIRED") ||
      raw.includes("CHATGPT_NOT_AUTHORIZED")
    ) {
      return t("settings.postProcessing.api.chatGptAccount.reauthRequired");
    }
    return raw;
  };

  useEffect(() => {
    mounted.current = true;

    void invoke<CodexAccountStatus>("get_codex_account_status")
      .then((next) => {
        if (!mounted.current) return;
        setStatus(next);
        if (next.signedIn) {
          onAuthenticated();
        }
      })
      .catch((cause) => {
        if (mounted.current) setError(messageForError(cause));
      });

    return () => {
      mounted.current = false;
    };
    // The provider owns this component, so status is intentionally read once
    // per mount. onAuthenticated is only a post-login model refresh hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    setLogin(null);

    try {
      const device = await invoke<CodexDeviceLogin>(
        "start_codex_device_login",
      );
      if (!mounted.current) return;

      setLogin(device);

      const next = await invoke<CodexAccountStatus>("wait_codex_device_login", {
        loginId: device.loginId,
      });
      if (!mounted.current) return;

      setStatus(next);
      setLogin(null);
      if (next.signedIn) {
        onAuthenticated();
      }
    } catch (cause) {
      if (mounted.current) setError(messageForError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);

    try {
      const next = await invoke<CodexAccountStatus>("logout_codex_account");
      if (mounted.current) {
        setStatus(next);
        setLogin(null);
      }
    } catch (cause) {
      if (mounted.current) setError(messageForError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const accountText = status?.signedIn
    ? [status.email, status.planType].filter(Boolean).join(" · ") ||
      t("settings.postProcessing.api.chatGptAccount.connected")
    : t("settings.postProcessing.api.chatGptAccount.notConnected");

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.chatGptAccount.title")}
        description={t(
          "settings.postProcessing.api.chatGptAccount.description",
        )}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <div className="flex min-w-[360px] items-center justify-end gap-3">
          <span className="truncate text-sm text-mid-gray">{accountText}</span>

          {status?.signedIn ? (
            <Button
              onClick={signOut}
              variant="secondary"
              size="sm"
              disabled={busy}
              title={t("settings.postProcessing.api.chatGptAccount.signOut")}
              aria-label={t(
                "settings.postProcessing.api.chatGptAccount.signOut",
              )}
              className="flex h-9 w-9 items-center justify-center px-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={signIn}
              variant="primary"
              size="md"
              disabled={busy}
            >
              {busy && !login
                ? t("common.loading")
                : t("settings.postProcessing.api.chatGptAccount.signIn")}
            </Button>
          )}
        </div>
      </SettingContainer>

      {!status?.signedIn && !login && (
        <p className="px-1 text-xs text-mid-gray">
          {t("settings.postProcessing.api.chatGptAccount.deviceCodeNotice")}
        </p>
      )}

      {login && (
        <div className="space-y-3 rounded-md border border-mid-gray/20 p-4">
          <p className="text-sm text-mid-gray">
            {t("settings.postProcessing.api.chatGptAccount.enterCode")}
          </p>

          <div className="flex items-center gap-3">
            <code className="select-all text-lg font-semibold tracking-wider">
              {login.userCode}
            </code>
            <Button
              onClick={() => void navigator.clipboard.writeText(login.userCode)}
              variant="secondary"
              size="sm"
            >
              {t("settings.postProcessing.api.chatGptAccount.copyCode")}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md border border-mid-gray/30 px-3 text-sm font-medium hover:bg-mid-gray/10"
            >
              {t(
                "settings.postProcessing.api.chatGptAccount.openAuthorization",
              )}
            </a>
            <span className="text-xs text-mid-gray">
              {t("settings.postProcessing.api.chatGptAccount.waiting")}
            </span>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="error" contained>
          {error}
        </Alert>
      )}
    </>
  );
};
