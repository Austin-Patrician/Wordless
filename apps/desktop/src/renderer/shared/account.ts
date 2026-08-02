import { useCallback, useEffect, useState } from "react";
import type { AccountSnapshot } from "@wordless/protocol";
import { useRuntimeClient } from "./runtime";

type AccountOperation = "idle" | "signing-in" | "signing-out";

export function useDesktopAccount() {
  const client = useRuntimeClient();
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [operation, setOperation] = useState<AccountOperation>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void client.getAccountSnapshot().then((next) => {
      if (active) setAccount(next);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => client.subscribeHost((event) => {
    if (event.type === "account.changed") {
      setAccount(event.account);
      setOperation("idle");
    }
  }), [client]);

  const login = useCallback(async () => {
    setOperation("signing-in");
    setError(null);
    try {
      setAccount(await client.loginGoogle());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOperation("idle");
    }
  }, [client]);

  const logout = useCallback(async () => {
    setOperation("signing-out");
    setError(null);
    try {
      await client.logoutGoogle();
      setAccount({ status: "signed-out", subject: null, email: null, name: null, pictureUrl: null, emailVerified: false, signedInAt: null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOperation("idle");
    }
  }, [client]);

  return { account, error, login, logout, operation };
}
