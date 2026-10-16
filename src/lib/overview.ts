/**
 * The signed-in person's overview, from GET /api/desktop/overview: who they are,
 * their approved tools (in their language), coaching sessions per tool, and what
 * waits on them if they review requests. One fetch, shared by the sidebar and
 * every page; refetched when the language changes and after a call ends.
 */
import { createContext, useContext } from "react";

export type Role = "admin" | "chief" | "employee";
export type ApprovedTool = {
  id: string;
  tool_name: string;
  tool_category: string;
  tool_url: string | null;
  reason: string;
  use_case: string;
  estimated_impact: "high" | "medium" | "low";
};
export type Progress = { tool: string; session_count: number; last_session_at: string | null };
export type Waiting = { id: string; tool_name: string; person: string };
export type Overview = {
  user: { name: string; email: string; role: Role; workspace: string | null; organization: string | null };
  tools: ApprovedTool[];
  progress: Progress[];
  waiting: Waiting[];
};

export type OverviewState = { data: Overview | null; error: string; loading: boolean; reload: () => void };
export const OverviewContext = createContext<OverviewState>({ data: null, error: "", loading: true, reload: () => {} });

export const useOverview = () => useContext(OverviewContext);

/** coaching_progress keys are trimmed and lowercased tool names. */
export function sessionsDone(progress: Progress[], tool: string): number {
  const key = tool.trim().toLowerCase();
  return progress.find((p) => p.tool === key)?.session_count ?? 0;
}

/**
 * The coaching session to suggest next: the approved tool with the fewest
 * sessions so far, high impact first. Null when nothing is approved.
 */
export function nextSession(o: Overview | null): ApprovedTool | null {
  if (!o?.tools.length) return null;
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...o.tools].sort((a, b) =>
    sessionsDone(o.progress, a.tool_name) - sessionsDone(o.progress, b.tool_name)
    || rank[a.estimated_impact] - rank[b.estimated_impact])[0];
}

export function firstName(name: string): string {
  const base = name.includes("@") ? name.split("@")[0].replace(/[._-]/g, " ") : name;
  const first = base.trim().split(/\s+/)[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function initialsOf(name: string): string {
  const base = name.includes("@") ? name.split("@")[0].replace(/[._-]/g, " ") : name;
  const p = base.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "S";
}
