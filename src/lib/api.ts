/**
 * apiFetch — every call to our backend, with a token that is actually valid.
 *
 * The bug this exists to kill: components received a `Session` prop captured at
 * login and used `session.access_token` forever. Supabase access tokens expire
 * after an hour, and autoRefreshToken's timer doesn't reliably tick in a Tauri
 * window that spends its life hidden behind a tray panel. So after an hour the
 * desktop app 401'd on everything — and for voice that surfaced as the call
 * silently dropping to the classic engine, which read as "the transcript is
 * broken" rather than "you are logged out".
 *
 * Rule: never pass a token around. Ask for one at the moment of the request.
 */
import { supabase } from "./supabase";
import { getLocale } from "../i18n/core";

/**
 * The UI language, on every request to our API. The server uses it when the
 * user's stored locale isn't available, so AI replies follow the app's language.
 * Needs `X-Socrates-Locale` in desktopCors' Access-Control-Allow-Headers
 * (app/lib/auth.ts): without it WKWebView fails EVERY preflight.
 */
export function localeHeader(): Record<string, string> {
  return { "X-Socrates-Locale": getLocale() };
}

/** A token good for at least the next minute, refreshing if needed. */
export async function freshToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) throw new Error("not signed in");

  // expires_at is unix seconds. Refresh a minute early so a slow request
  // can't straddle the boundary.
  const expiresSoon = !s.expires_at || s.expires_at * 1000 - Date.now() < 60_000;
  if (!expiresSoon) return s.access_token;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session) throw new Error("session expired");
  return refreshed.session.access_token;
}

/**
 * fetch against our API with a fresh bearer token. On a 401 it forces one
 * refresh and retries once — covers the case where the server rejects a token
 * we believed was still good (clock skew, rotated session).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), ...localeHeader(), Authorization: `Bearer ${token}` },
    });

  let res = await send(await freshToken());
  if (res.status !== 401) return res;

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return res; // still 401 — caller reports "signed out"
  res = await send(data.session.access_token);
  return res;
}
