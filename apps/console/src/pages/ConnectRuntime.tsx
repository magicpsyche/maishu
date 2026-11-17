// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../i18n/ui-text";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../lib/api";
import { useApiQuery } from "../lib/useApiQuery";
import { Button } from "@/components/ui/button";
import { Logo } from "../components/Logo";
import { LocalDebugOnlyWarning } from "../components/LocalDebugOnlyWarning";

/** Browser-side handler for `oma bridge setup`. The CLI binds a random
 *  127.0.0.1 port and opens this URL with `?cb=http://127.0.0.1:<port>/cb&state=<nonce>`.
 *  The user authenticates (cookie session), POSTs /v1/maishu/runtimes/connect-runtime
 *  to mint a one-time exchange code, then this page redirects back to the
 *  CLI's loopback listener with `?code=...&state=...`. The CLI exchanges
 *  the code at /agents/runtime/exchange for a permanent runtime token.
 *
 *  Mirror of CliLogin.tsx — same shape, different mint endpoint, just one
 *  code per setup (no per-tenant fan-out — the token belongs to the active
 *  tenant at code-mint time). */

interface MeResponse {
  user: { id: string; email: string; name: string | null } | null;
  tenant: { id: string; name: string };
  tenants: Array<{ id: string; name: string; role: string }>;
}

function isLoopback(callbackUrl: string): boolean {
  try {
    const u = new URL(callbackUrl);
    if (u.protocol !== "http:") return false;
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

export function ConnectRuntime() {
  const { api } = useApi();
  const capabilities = useApiQuery<{ runtime_bridge: boolean }>("/v1/maishu/capabilities");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const callback = params.get("cb") ?? "";
  const state = params.get("state") ?? "";
  const callbackOk = isLoopback(callback);

  const [authNeeded, setAuthNeeded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  // Validate URL params synchronously so an invalid callback never wastes
  // a /v1/maishu/me roundtrip. The `enabled` gate on the query below carries the
  // same guard for the actual fetch.
  const paramsValid = callbackOk && !!state && state.length >= 8;
  useEffect(() => {
    if (!callbackOk) {
      setError(
        uiText("Invalid callback URL — only loopback addresses (127.0.0.1, localhost) are permitted."),
      );
      return;
    }
    if (!state || state.length < 8) {
      setError(uiText("Missing or invalid state parameter — re-run `oma bridge setup`."));
    }
  }, [callbackOk, state]);

  // /v1/maishu/me lookup via TQ. Deduped across the page's lifetime; a tab switch
  // away and back doesn't re-hit the endpoint within staleTime.
  const meQuery = useApiQuery<MeResponse>(paramsValid ? "/v1/maishu/me" : null);
  const me = meQuery.data ?? null;
  const loading = paramsValid ? meQuery.isLoading : false;

  // /v1/maishu/me failure: 401 → show "Sign in" CTA; everything else → inline.
  useEffect(() => {
    const err = meQuery.error;
    if (!err) return;
    if (/401|Unauthorized/i.test(String((err as Error).message))) {
      setAuthNeeded(true);
    } else {
      setError(String((err as Error).message ?? err));
    }
  }, [meQuery.error]);

  const goLogin = () => {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  };

  const approve = async () => {
    if (!me || !capabilities.data?.runtime_bridge) return;
    setWorking(true);
    setError("");
    try {
      const { code } = await api<{ code: string; expires_at: number }>(
        "/v1/maishu/runtimes/connect-runtime",
        {
          method: "POST",
          body: JSON.stringify({ state }),
        },
      );
      const url = new URL(callback);
      url.searchParams.set("code", code);
      url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWorking(false);
    }
  };

  const cancel = () => {
    if (callbackOk) {
      const url = new URL(callback);
      url.searchParams.set("error", "user_cancelled");
      url.searchParams.set("state", state);
      window.location.href = url.toString();
    } else {
      window.location.href = "/";
    }
  };

  if (!capabilities.data?.runtime_bridge) return <div className="min-h-screen flex items-center justify-center p-6 bg-bg"><div className="max-w-lg space-y-4"><Logo size="lg" /><h1 className="text-2xl font-semibold">机器接入暂不可用</h1><p className="text-sm text-fg-muted">{capabilities.isLoading ? "正在检查部署能力…" : "当前部署通过远程沙箱执行任务，不提供 Bridge 配对。请在控制台配置沙箱后端。"}</p><Button onClick={() => { window.location.href = "/settings/sandbox"; }}>返回控制台</Button></div></div>;

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-bg-surface border border-border rounded-xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" />
          <div>
            <h1 className="font-display text-lg font-semibold">{uiText("Connect machine")}</h1>
            <div className="text-xs text-fg-subtle">{uiText("openma local runtime")}</div>
          </div>
        </div>

        {loading && <div className="text-sm text-fg-subtle">{uiText("Checking session…")}</div>}

        {!loading && error && (
          <div className="bg-danger-subtle border border-danger/30 text-danger text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {!loading && authNeeded && (
          <>
            <p className="text-sm text-fg-muted mb-4">{uiText("Sign in to authorize this machine.")}</p>
            <Button onClick={goLogin} className="w-full">
               {uiText("Sign in")} </Button>
          </>
        )}

        {!loading && !authNeeded && me && callbackOk && (
          <>
            <p className="text-sm text-fg-muted mb-2">
               {uiText("Allow this machine to attach to OMA as")}{" "}
              <span className="font-mono text-fg">
                {me.user?.email ?? me.user?.id ?? uiText("this user")}
              </span>{" "}
               {uiText("in workspace")} <span className="font-mono text-fg">{me.tenant.name}</span>?
            </p>
            <p className="text-xs text-fg-subtle mb-5">
               {uiText("The daemon will spawn ACP-compatible agents (Claude Code, Codex, etc.) on this machine when you bind an agent to it. Revoke any time on the Local Runtimes page.")} </p>
            <LocalDebugOnlyWarning className="mb-5" />

            <div className="flex gap-2">
              <Button onClick={approve} disabled={working} className="flex-1">
                {working ? uiText("Authorizing…") : uiText("Allow")}
              </Button>
              <Button variant="ghost"
                onClick={cancel}
                disabled={working}
                className="inline-flex items-center justify-center px-4 py-2.5 min-h-11 sm:min-h-0 rounded-lg border border-border text-sm text-fg-muted hover:bg-bg disabled:opacity-40"
              >
                 {uiText("Cancel")} </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
