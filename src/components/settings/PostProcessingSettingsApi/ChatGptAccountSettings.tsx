import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
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

const CHATGPT_LABEL = "ChatGPT";

export const ChatGptAccountSettings: React.FC<Props> = ({
  onAuthenticated,
}) => {
  const { t } = useTranslation();
  const mounted = useRef(true);
  const cancelRequested = useRef(false);
  const modelsRefreshed = useRef(false);
  const [status, setStatus] = useState<CodexAccountStatus | null>(null);
  const [login, setLogin] = useState<CodexDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshModelsOnce = (next: CodexAccountStatus) => {
    if (next.signedIn && !modelsRefreshed.current) {
      modelsRefreshed.current = true;
      onAuthenticated();
    }
  };

  useEffect(() => {
    mounted.current = true;

    void invoke<CodexAccountStatus>("get_codex_account_status")
      .then((next) => {
        if (!mounted.current) return;
        setStatus(next);
        refreshModelsOnce(next);
      })
      .catch((cause) => {
        if (mounted.current) setError(String(cause));
      });

    return () => {
      mounted.current = false;
    };
  }, [onAuthenticated]);

  const signIn = async () => {
    cancelRequested.current = false;
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
      refreshModelsOnce(next);
    } catch (cause) {
      if (mounted.current && !cancelRequested.current) {
        setError(String(cause));
      }
    } finally {
      if (mounted.current) {
        setLogin(null);
        setBusy(false);
      }
    }
  };

  const cancelSignIn = async () => {
    cancelRequested.current = true;
    setError(null);

    try {
      await invoke("cancel_codex_device_login");
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);

    try {
      const next = await invoke<CodexAccountStatus>("logout_codex_account");
      if (mounted.current) {
        modelsRefreshed.current = false;
        setStatus(next);
        setLogin(null);
      }
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const openVerificationPage = async () => {
    if (!login) return;

    try {
      await openUrl(login.verificationUrl);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    }
  };

  const accountText = status?.signedIn
    ? [status.email, status.planType].filter(Boolean).join(" · ") ||
      CHATGPT_LABEL
    : CHATGPT_LABEL;

  return (
    <>
      <SettingContainer
        title={CHATGPT_LABEL}
        description={t("settings.postProcessing.api.provider.description")}
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
              title={t("common.clear")}
              aria-label={t("common.clear")}
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
                : `${t("common.open")} ${CHATGPT_LABEL}`}
            </Button>
          )}
        </div>
      </SettingContainer>

      {!status?.signedIn && (
        <Alert variant="warning" contained>
          {t("settings.postProcessing.api.chatGptAccount.deviceCodeNotice")}
        </Alert>
      )}

      {login && (
        <div className="space-y-3 rounded-md border border-mid-gray/20 p-4">
          <div className="flex items-center gap-3">
            <code className="select-all text-lg font-semibold tracking-wider">
              {login.userCode}
            </code>
            <Button
              onClick={() => void navigator.clipboard.writeText(login.userCode)}
              variant="secondary"
              size="sm"
            >
              {t("common.copy")}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={openVerificationPage}
              variant="secondary"
              size="sm"
            >
              {t("common.open")}
            </Button>
            <span className="text-xs text-mid-gray">
              {t("onboarding.permissions.waiting")}
            </span>
            <Button
              onClick={cancelSignIn}
              variant="secondary"
              size="sm"
              className="ml-auto"
            >
              {t("settings.postProcessing.prompts.cancel")}
            </Button>
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
