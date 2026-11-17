// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../../i18n/ui-text";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  rewardHeadline,
  outcomeToStatusTone,
  type Trajectory,
} from "../../lib/trajectory";
import { StatusPill } from "../../components/Badge";
import { Button } from "@/components/ui/button";
import { TraceView } from "../../components/timeline/TraceView";
import { ApiError, useApi } from "../../lib/api";

/**
 * Session-detail trajectory views.
 *
 * Pieces:
 *   - `TrajectoryOutcomeChip` — small "Outcome: X" pill rendered in the
 *     session header. Hidden while loading / on error / when the agent
 *     is still running.
 *   - `TrajectoryRewardChip` — paired pill showing the verifier's reward
 *     score. Tooltip reveals the verifier id + computed-at timestamp.
 *   - `SessionTrace` — the session's Trace tab: unified TraceView plus
 *     envelope status, Download JSON and a collapsed Raw JSON.
 *   - `useTrajectoryLoader` — on-demand envelope fetch used by SessionDetail.
 *
 * Lifted out of SessionDetail to keep the orchestrator focused on event
 * stream + chat scaffolding.
 */

export function TrajectoryOutcomeChip({
  trajectory,
}: {
  trajectory: TrajectoryState;
}) {
  if (!trajectory || trajectory === "loading" || trajectory === "error" || trajectory === "unavailable") return null;
  if (trajectory.outcome === "running") return null;
  const tone = outcomeToStatusTone(trajectory.outcome);
  return (
    <StatusPill
      status={tone}
      label={uiText(`Outcome: ${trajectory.outcome}`)}
    />
  );
}

/** Reward chip rendered in the session header strip. Pure read-out of
 *  the verifier output; tooltip shows verifier_id for debugging. */
export function TrajectoryRewardChip({
  trajectory,
}: {
  trajectory: TrajectoryState;
}) {
  if (!trajectory || trajectory === "loading" || trajectory === "error" || trajectory === "unavailable") return null;
  const r = trajectory.reward;
  if (!r) return null;
  const headline = rewardHeadline(r);
  const isPass = r.final_reward >= 0.99;
  const isFail = r.final_reward <= 0;
  // Reuse StatusPill tone tokens so the visual language stays consistent
  // with the outcome chip next to it (success = same green, failure = red).
  const tone = isPass ? "completed" : isFail ? "errored" : "neutral";
  const titleParts = [
    uiText(`Reward: ${r.final_reward.toFixed(4)}`),
    r.verifier_id ? `verifier: ${r.verifier_id}` : null,
    r.computed_at ? `computed: ${new Date(r.computed_at).toLocaleString()}` : null,
  ].filter(Boolean) as string[];
  return (
    <span title={titleParts.join(" · ")}>
      <StatusPill status={tone} label={uiText(`Reward: ${headline}`)} />
    </span>
  );
}

/** True when opening the Trace tab should (re)fetch the envelope:
 *  nothing loaded yet, the last attempt failed, or the run was still going
 *  when we fetched it. */
export function trajectoryNeedsFetch(trajectory: TrajectoryState): boolean {
  if (trajectory === undefined || trajectory === "error") return true;
  if (trajectory === "loading" || trajectory === "unavailable") return false;
  return trajectory.outcome === "running";
}

export type TrajectoryState = Trajectory | "loading" | "error" | "unavailable" | undefined;

/**
 * On-demand loader for `GET /v1/maishu/sessions/:id/trajectory` (OpenMA
 * product route, so plain `api()` rather than `managedApi`). A 404 means this
 * deployment has no trajectory envelope for the managed session; it becomes
 * a silent unavailable state because Trace can still render the event history.
 * State resets whenever `sessionId` changes, and responses for a stale
 * session id or a superseded request are dropped.
 */
export function useTrajectoryLoader(sessionId: string | undefined) {
  const { api } = useApi();
  const [trajectory, setTrajectory] = useState<TrajectoryState>(undefined);
  const ticket = useRef(0);

  useEffect(() => {
    ticket.current += 1;
    setTrajectory(undefined);
  }, [sessionId]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const mine = ++ticket.current;
    setTrajectory("loading");
    try {
      const t = await api<Trajectory>(`/v1/maishu/sessions/${encodeURIComponent(sessionId)}/trajectory`);
      if (ticket.current === mine) setTrajectory(t);
    } catch (error) {
      if (ticket.current !== mine) return;
      setTrajectory(error instanceof ApiError && error.status === 404 ? "unavailable" : "error");
    }
  }, [api, sessionId]);

  return { trajectory, load };
}

/** Download the envelope as `trajectory-<session>.json` via an in-memory
 *  blob URL, so there's no second round-trip to the server. */
export function downloadTrajectoryJson(sessionId: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trajectory-${sessionId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Full raw envelope JSON, rendered only once the disclosure is opened. */
function RawJsonDisclosure({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mx-4 my-3 text-xs"
      aria-label={uiText("Raw JSON")}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-fg-subtle">{uiText("Raw JSON · oma.trajectory.v1")}</summary>
      {open && (
        <pre className="mt-2 font-mono text-xs bg-bg-surface rounded px-3 py-2 overflow-auto max-h-[40vh] text-fg whitespace-pre-wrap break-words">
          {json}
        </pre>
      )}
    </details>
  );
}

/**
 * The session's single Trace surface: the unified TraceView over the
 * session's events, plus the on-demand trajectory envelope (outcome,
 * reward, Download JSON, collapsed Raw JSON).
 *
 * Event source: live session events when there are any (they update while
 * the run continues); otherwise the envelope's events once it is loaded.
 */
export function SessionTrace({
  sessionId,
  events,
  trajectory,
  onRetry,
}: {
  sessionId: string;
  events: readonly unknown[];
  trajectory: TrajectoryState;
  onRetry?: () => void;
}) {
  const ready = trajectory !== undefined
    && trajectory !== "loading"
    && trajectory !== "error"
    && trajectory !== "unavailable";
  const json = useMemo(() => (ready ? JSON.stringify(trajectory, null, 2) : ""), [ready, trajectory]);
  const source = events.length > 0 ? events : ready ? trajectory.events : [];

  const notice =
    trajectory === "loading" ? (
      <div className="px-4 sm:px-6 py-1.5 text-xs text-fg-subtle" role="status">{uiText("Loading trajectory envelope…")}</div>
    ) : trajectory === "error" ? (
      <div className="px-4 sm:px-6 py-1.5 text-xs text-danger flex flex-wrap items-center gap-2" role="alert">
        <span>
           {uiText("Trajectory unavailable. The session may not have any events yet, or the sandbox worker is unreachable.")} </span>
        {onRetry && <Button variant="outline" size="xs" onClick={onRetry}>{uiText("Retry")}</Button>}
      </div>
    ) : null;

  const facts = ready
    ? [
        { label: uiText("Trajectory"), value: trajectory.trajectory_id },
        { label: uiText("Outcome"), value: trajectory.outcome },
        ...(trajectory.reward ? [{ label: uiText("Reward"), value: rewardHeadline(trajectory.reward) }] : []),
      ]
    : undefined;

  return (
    <TraceView
      events={source}
      facts={facts}
      notice={notice}
      actions={
        <Button
          variant="outline"
          size="xs"
          onClick={() => ready && downloadTrajectoryJson(sessionId, json)}
          disabled={!ready}
          title={ready ? uiText("Download the oma.trajectory.v1 envelope") : uiText("Available once the trajectory envelope loads")}
        >
           {uiText("Download JSON")} </Button>
      }
      footer={ready ? <RawJsonDisclosure json={json} /> : null}
    />
  );
}
