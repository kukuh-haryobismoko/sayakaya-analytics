'use strict';

// Dashboard login accounts, sessions, and per-tab permissions — stored in
// Supabase Postgres (a database that ships with the already-linked Supabase
// project but was otherwise unused), reached over its auto-generated REST API
// (PostgREST) with the service_role key via plain fetch(). No new dependency:
// Node 18+ has a global fetch, and this is the one store shared by both the
// Netlify backend (this file) and the Supabase Edge Function port
// (supabase/functions/api/auth.ts) — an account created on one works on both.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, fixed — no refresh-on-activity.

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase REST ${opts.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---- Password hashing: scrypt (Node stdlib, no bcrypt dependency) ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---- Users ------------------------------------------------------------------
async function findUserByUsername(username) {
  const rows = await rest(`/dashboard_users?username=eq.${encodeURIComponent(username)}&select=*`);
  return rows[0] || null;
}

async function findUserById(id) {
  const rows = await rest(`/dashboard_users?id=eq.${id}&select=*`);
  return rows[0] || null;
}

function listUsers() {
  return rest('/dashboard_users?select=id,username,is_superuser,allowed_tabs,created_at&order=username.asc');
}

async function countSuperusers() {
  const rows = await rest('/dashboard_users?is_superuser=eq.true&select=id');
  return rows.length;
}

async function createUser({ username, password, isSuperuser = false, allowedTabs = [] }) {
  const rows = await rest('/dashboard_users', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      username,
      password_hash: hashPassword(password),
      is_superuser: isSuperuser,
      allowed_tabs: allowedTabs,
    }),
  });
  return rows[0];
}

// patch: { password?, isSuperuser?, allowedTabs? } — only defined keys are updated.
async function updateUser(id, patch = {}) {
  const body = {};
  if (patch.password) body.password_hash = hashPassword(patch.password);
  if (patch.isSuperuser !== undefined) body.is_superuser = patch.isSuperuser;
  if (patch.allowedTabs !== undefined) body.allowed_tabs = patch.allowedTabs;
  const rows = await rest(`/dashboard_users?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  return rows[0];
}

function deleteUser(id) {
  return rest(`/dashboard_users?id=eq.${id}`, { method: 'DELETE' });
}

// ---- Sessions -----------------------------------------------------------
async function createSession(userId) {
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
async function findUserByToken(token) {
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

async function deleteSessionByToken(token) {
  if (!token) return;
  await rest(`/dashboard_sessions?token_hash=eq.${sha256Hex(token)}`, { method: 'DELETE' });
}

// ---- Audit log ----------------------------------------------------------
// username is stored as a plain snapshot (not just a join through user_id)
// so the record survives the account later being deleted.
async function logEvent(userId, username, action, detail) {
  try {
    await rest('/dashboard_audit_log', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId || null, username, action, detail: detail || null }),
    });
  } catch (err) {
    // Logging must never be able to break the login/export it's recording.
    console.error('[audit log]', err.message);
  }
}

function listAuditLog(limit = 200) {
  return rest(`/dashboard_audit_log?select=*&order=created_at.desc&limit=${Number(limit) || 200}`);
}

// ---- Shaping + permission check ---------------------------------------------
function publicUser(u) {
  return { id: u.id, username: u.username, isSuperuser: u.is_superuser, allowedTabs: u.allowed_tabs || [], createdAt: u.created_at };
}

function userCan(user, tab) {
  if (!user) return false;
  if (user.is_superuser) return true;
  return (user.allowed_tabs || []).includes(tab);
}

module.exports = {
  hashPassword, verifyPassword,
  findUserByUsername, findUserById, listUsers, countSuperusers, createUser, updateUser, deleteUser,
  createSession, findUserByToken, deleteSessionByToken,
  logEvent, listAuditLog,
  publicUser, userCan,
};
