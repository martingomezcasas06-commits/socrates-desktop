import { describe, it, expect } from "vitest";
import { groupOf, titleFrom } from "./chats";
import { firstName, nextSession, sessionsDone, type Overview, type ApprovedTool } from "./overview";

// The Night redesign's small rules: how chats are titled and grouped, which
// coaching session is "next", and whose name the greeting uses.

describe("chats", () => {
  it("titles a chat with its first message, cut at 32 characters", () => {
    expect(titleFrom("  How do I   use Claude?  ")).toBe("How do I use Claude?");
    expect(titleFrom("How do I get Claude to draft my Monday report?")).toBe("How do I get Claude to draft my…");
  });

  it("groups by the day a chat started", () => {
    const now = new Date(2026, 9, 16, 10, 0);
    const at = (d: number, h = 9) => new Date(2026, 9, d, h).toISOString();
    expect(groupOf(at(16, 1), now)).toBe("today");
    expect(groupOf(at(15, 23), now)).toBe("yesterday");
    expect(groupOf(at(11), now)).toBe("thisWeek");
    expect(groupOf(at(5), now)).toBe("lastWeek");
    expect(groupOf(at(1), now)).toBe("earlier");
  });
});

describe("overview", () => {
  const tool = (name: string, impact: ApprovedTool["estimated_impact"]): ApprovedTool =>
    ({ id: name, tool_name: name, tool_category: "", tool_url: null, reason: "", use_case: "", estimated_impact: impact });
  const o = (tools: ApprovedTool[], progress: Overview["progress"]): Overview =>
    ({ user: { name: "", email: "", role: "employee", workspace: null, organization: null }, tools, progress, waiting: [] });

  it("counts sessions by the stored lowercase tool name", () => {
    expect(sessionsDone([{ tool: "claude ai", session_count: 2, last_session_at: null }], " Claude AI ")).toBe(2);
    expect(sessionsDone([], "Gong")).toBe(0);
  });

  it("suggests the tool with the fewest sessions, then the higher impact", () => {
    const tools = [tool("Claude AI", "high"), tool("Gong", "medium"), tool("Clay", "high")];
    expect(nextSession(o(tools, [{ tool: "claude ai", session_count: 2, last_session_at: null }]))?.tool_name).toBe("Clay");
    expect(nextSession(o([], []))).toBeNull();
  });

  it("greets by first name, also when only an email is known", () => {
    expect(firstName("Alejo Casas")).toBe("Alejo");
    expect(firstName("martin.gomez@example.com")).toBe("Martin");
  });
});
