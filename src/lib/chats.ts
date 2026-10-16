/**
 * Chat history, kept on this computer.
 *
 * Socrates itself keeps one long-running conversation per person on the server
 * (users.socrates_session_id), so it remembers context across chats either way.
 * What the server doesn't keep is a list of separate conversations with their
 * messages, which the Chats page and the sidebar's Recents need. That lives
 * here, per signed-in person. Storage can be unavailable or cleared, so every
 * access is guarded and the app works without it (history just starts empty).
 */
import { useEffect, useState } from "react";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages: ChatMessage[] };

const MAX_CONVERSATIONS = 200;
const listeners = new Set<() => void>();

const keyFor = (owner: string) => `socrates.chats.v1.${owner.toLowerCase()}`;

function read(owner: string): Conversation[] {
  try {
    const raw = localStorage.getItem(keyFor(owner));
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(owner: string, list: Conversation[]) {
  try {
    localStorage.setItem(keyFor(owner), JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch { /* storage full or blocked: history just isn't kept */ }
  listeners.forEach((l) => l());
}

/** Newest activity first. */
export function listChats(owner: string): Conversation[] {
  return read(owner).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getChat(owner: string, id: string): Conversation | null {
  return read(owner).find((c) => c.id === id) ?? null;
}

/** The title is the first message, cut to 32 characters. */
export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 32 ? t.slice(0, 32).trimEnd() + "…" : t;
}

/** Start a conversation with its first user message; returns it. */
export function createChat(owner: string, firstMessage: string): Conversation {
  const now = new Date().toISOString();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const chat: Conversation = { id, title: titleFrom(firstMessage), created_at: now, updated_at: now, messages: [{ role: "user", content: firstMessage }] };
  write(owner, [chat, ...read(owner)]);
  return chat;
}

export function appendMessage(owner: string, id: string, message: ChatMessage) {
  const list = read(owner);
  const chat = list.find((c) => c.id === id);
  if (!chat) return;
  chat.messages.push(message);
  chat.updated_at = new Date().toISOString();
  write(owner, list);
}

/** Re-renders when any conversation changes. */
export function useChats(owner: string): Conversation[] {
  const [list, setList] = useState(() => listChats(owner));
  useEffect(() => {
    const update = () => setList(listChats(owner));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [owner]);
  return list;
}

export type ChatGroup = "today" | "yesterday" | "thisWeek" | "lastWeek" | "earlier";

/** Which heading a conversation sits under on the Chats page, by when it started. */
export function groupOf(createdAt: string, now = new Date()): ChatGroup {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(createdAt))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "thisWeek";
  if (days < 14) return "lastWeek";
  return "earlier";
}

// ── Asking Socrates ──────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL as string;
const pending = new Set<string>();
const failures = new Map<string, string>();

/**
 * Ask Socrates for a reply to a conversation's latest message and store it.
 * Started from the click that sent the message (not from a render effect), and
 * at most once per conversation at a time. A failure is kept for the page to
 * show, never stored as one of Socrates's messages.
 */
export async function requestReply(owner: string, id: string): Promise<void> {
  const chat = getChat(owner, id);
  if (!chat || pending.has(id)) return;
  pending.add(id);
  failures.delete(id);
  listeners.forEach((l) => l());
  try {
    const { apiFetch } = await import("./api");
    const res = await apiFetch(`${API_URL}/api/chat/employee-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chat.messages }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(errorText(body) || `HTTP ${res.status}`);
    pending.delete(id);
    appendMessage(owner, id, { role: "assistant", content: body });
  } catch (e) {
    pending.delete(id);
    failures.set(id, e instanceof Error ? e.message : String(e));
    listeners.forEach((l) => l());
  }
}

/** A server error's own words: plain text, or the `error` field of a JSON body. */
function errorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed?.error === "string") return parsed.error;
  } catch { /* not JSON */ }
  return body;
}

/** Whether a reply is on its way, and why the last one failed, for one conversation. */
export function useReplyState(id: string | null): { busy: boolean; failure: string } {
  const read = () => ({ busy: !!id && pending.has(id), failure: (id && failures.get(id)) || "" });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    return () => { listeners.delete(update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return state;
}
