// Ported 1:1 from server/auth.js — see that file for the full rationale
// (Supabase Postgres via PostgREST + fetch, scrypt password hashing, DB-backed
// sessions re-read live on every request). If you change this, change
// server/auth.js too (or vice versa) — the two are not auto-synced, though
// both point at the same dashboard_users/dashboard_sessions tables, so an
// account created via one backend works on both.

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours, fixed — no refresh-on-activity.

export interface DashboardUser {
  id: string;
  username: string;
  password_hash: string;
  email: string | null;
  is_superuser: boolean;
  allowed_tabs: string[];
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  isSuperuser: boolean;
  allowedTabs: string[];
  createdAt: string;
}

async function rest(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase REST ${opts.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---- Password hashing: scrypt (via Deno's node:crypto compat) --------------
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = new Uint8Array(crypto.scryptSync(plain, salt, 64));
  const expected = new Uint8Array(Buffer.from(hash, 'hex'));
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---- Users ------------------------------------------------------------------
export async function findUserByUsername(username: string): Promise<DashboardUser | null> {
  const rows = await rest(`/dashboard_users?username=eq.${encodeURIComponent(username)}&select=*`);
  return rows[0] || null;
}

export async function findUserById(id: string): Promise<DashboardUser | null> {
  const rows = await rest(`/dashboard_users?id=eq.${id}&select=*`);
  return rows[0] || null;
}

export function listUsers(): Promise<DashboardUser[]> {
  return rest('/dashboard_users?select=id,username,email,is_superuser,allowed_tabs,created_at&order=username.asc');
}

export async function countSuperusers(): Promise<number> {
  const rows = await rest('/dashboard_users?is_superuser=eq.true&select=id');
  return rows.length;
}

export async function createUser(opts: { username: string; password: string; email?: string | null; isSuperuser?: boolean; allowedTabs?: string[] }): Promise<DashboardUser> {
  const rows = await rest('/dashboard_users', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      username: opts.username,
      password_hash: hashPassword(opts.password),
      email: opts.email || null,
      is_superuser: !!opts.isSuperuser,
      allowed_tabs: opts.allowedTabs || [],
    }),
  });
  return rows[0];
}

// patch: { password?, email?, isSuperuser?, allowedTabs? } — only defined keys are updated.
export async function updateUser(id: string, patch: { password?: string; email?: string | null; isSuperuser?: boolean; allowedTabs?: string[] } = {}): Promise<DashboardUser> {
  const body: Record<string, unknown> = {};
  if (patch.password) body.password_hash = hashPassword(patch.password);
  if (patch.email !== undefined) body.email = patch.email || null;
  if (patch.isSuperuser !== undefined) body.is_superuser = patch.isSuperuser;
  if (patch.allowedTabs !== undefined) body.allowed_tabs = patch.allowedTabs;
  const rows = await rest(`/dashboard_users?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  return rows[0];
}

export function deleteUser(id: string): Promise<null> {
  return rest(`/dashboard_users?id=eq.${id}`, { method: 'DELETE' });
}

// ---- Sessions -----------------------------------------------------------
export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await rest('/dashboard_sessions', {
    method: 'POST',
    body: JSON.stringify({ token_hash: sha256Hex(token), user_id: userId, expires_at: expiresAt }),
  });
  return token;
}

// Always re-reads the user row live (never trusts anything cached in the
// token) so a permission edit or account deletion takes effect on the user's
// very next request, not just at their next login.
export async function findUserByToken(token: string | null): Promise<DashboardUser | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const sessions = await rest(`/dashboard_sessions?token_hash=eq.${tokenHash}&select=user_id,expires_at`);
  const session = sessions[0];
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await rest(`/dashboard_sessions?token_hash=eq.${tokenHash}`, { method: 'DELETE' });
    return null;
  }
  return findUserById(session.user_id);
}

export async function deleteSessionByToken(token: string | null): Promise<void> {
  if (!token) return;
  await rest(`/dashboard_sessions?token_hash=eq.${sha256Hex(token)}`, { method: 'DELETE' });
}

// ---- Audit log ----------------------------------------------------------
export interface AuditLogRow {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  detail: string | null;
  created_at: string;
}

// username is stored as a plain snapshot (not just a join through user_id) so
// the record survives the account later being deleted.
export async function logEvent(userId: string | null, username: string, action: string, detail?: string | null): Promise<void> {
  try {
    await rest('/dashboard_audit_log', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId || null, username, action, detail: detail || null }),
    });
  } catch (err) {
    // Logging must never be able to break the login/export it's recording.
    console.error('[audit log]', (err as Error).message);
  }
}

// search is a case-insensitive wildcard match across username, action, and
// detail (so e.g. typing an export source/filename finds it too, not just a
// username) — from/to filter on created_at, inclusive of the whole "to" day.
// The team reads/picks these dates in Jakarta (GMT+7), so the day boundaries
// are anchored to +07:00, not UTC midnight — otherwise "today" would miss the
// first 7 hours of the Jakarta day and bleed into the next one at the end.
// `user` is a separate, exact filter (the "filter by user" dropdown) — kept
// apart from `search` so picking a user from the dropdown and typing a
// detail/action keyword can be combined (both apply, PostgREST ANDs them).
export function listAuditLog(opts: { limit?: number | string; search?: string; from?: string; to?: string; user?: string } = {}): Promise<AuditLogRow[]> {
  const { limit = 200, search = '', from = '', to = '', user = '' } = opts;
  const params = [`select=*`, `order=created_at.desc`, `limit=${Number(limit) || 200}`];
  if (search) {
    const term = `*${search}*`;
    params.push(`or=(username.ilike.${encodeURIComponent(term)},action.ilike.${encodeURIComponent(term)},detail.ilike.${encodeURIComponent(term)})`);
  }
  if (user) params.push(`username=eq.${encodeURIComponent(user)}`);
  if (from) params.push(`created_at=gte.${encodeURIComponent(from + 'T00:00:00+07:00')}`);
  if (to) params.push(`created_at=lte.${encodeURIComponent(to + 'T23:59:59.999+07:00')}`);
  return rest(`/dashboard_audit_log?${params.join('&')}`);
}

// ---- Shaping + permission check ---------------------------------------------
export function publicUser(u: DashboardUser): PublicUser {
  return { id: u.id, username: u.username, email: u.email || null, isSuperuser: u.is_superuser, allowedTabs: u.allowed_tabs || [], createdAt: u.created_at };
}

export function userCan(user: DashboardUser | null | undefined, tab: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return (user.allowed_tabs || []).includes(tab);
}
