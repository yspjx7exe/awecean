/**
 * Awecean · Cloudflare Worker edition
 *
 * Static frontend is served from ./public through the ASSETS binding.
 * All /api/* routes run here. State is stored as one versioned JSON document
 * in D1 (small-community friendly, optimistic concurrency), images in R2.
 */

const TZ = 'Asia/Shanghai';
const INVITE_HOURS = 48;
const SESSION_DAYS = 30;
const MAX_BODY = 12 * 1024 * 1024;

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ADMIN_HASH = 'pbkdf2$50000$0b38c3c48c758f3416fe1ca26ae13614$034b56a668eab6716bb08200869740addb5c217335ffab62148b08a3cc69c75f';

const RESERVED_NAMES = ['总管理员', '管理员', '官方', '系统', '帝企鹅', '鹈鹕', '麻雀', '敬畏官方', 'admin', 'root', 'system', 'official', 'administrator'];
const SENSITIVE_WORDS = ['色情', '裸聊', '约炮', '赌博', '毒品', '诈骗', '代开发票', '傻逼', '操你'];

class ApiError extends Error {
  constructor(status, message, code = 'ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
class StateConflict extends Error {}

function nowIso() {
  return new Date().toISOString();
}
function dayKey(date = new Date()) {
  return DATE_FMT.format(date);
}
function dayOffset(n) {
  return dayKey(new Date(Date.now() - n * 86400000));
}
function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function dayDiff(a, b) {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86400000);
}
function keyAdd(key, n) {
  return new Date(keyToUtc(key) + n * 86400000).toISOString().slice(0, 10);
}
function atLocal(key, hour = 10) {
  return new Date(`${key}T${String(hour).padStart(2, '0')}:00:00+08:00`);
}
function randomHex(bytes = 12) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function id(prefix = '') {
  return prefix + randomHex(9);
}
function cleanText(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function isEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 120;
}
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseCookies(request) {
  const out = {};
  const header = request.headers.get('Cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
function cookieFor(session) {
  return `awecean_session=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
function clearCookie() {
  return 'awecean_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

const PBKDF2_ITERATIONS = 50000;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function derivePassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await derivePassword(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}
async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const expected = parts[3];
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const actual = await derivePassword(password, parts[2], iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Domain helpers                                                             */
/* -------------------------------------------------------------------------- */

function findUserByUsername(state, username) {
  const needle = String(username || '').toLowerCase();
  return state.users.find((u) => u.usernameLower === needle);
}
function findUserById(state, userId) {
  return state.users.find((u) => u.id === userId);
}
function userName(state, userId) {
  return findUserById(state, userId)?.username || '已注销';
}
function objectLikeCount(state, objectId) {
  return state.respects.filter((r) => r.objectId === objectId).length;
}
function weekStartTime() {
  const today = dayKey();
  const [year, month, date] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return atLocal(keyAdd(today, -((weekday + 6) % 7)), 0).getTime();
}
function objectWeekCount(state, objectId) {
  const since = weekStartTime();
  return state.respects.filter((r) => r.objectId === objectId && new Date(r.createdAt).getTime() >= since).length;
}
function respectDates(state, userId) {
  return [...new Set(state.respects.filter((r) => r.userId === userId).map((r) => r.date))].sort();
}
function computeStreaks(state, user) {
  const dates = respectDates(state, user.id);
  const set = new Set(dates);
  const today = dayKey();
  const yesterday = keyAdd(today, -1);
  let current = 0;
  let longest = 0;
  let gap = 0;
  let longestGap = 0;
  if (dates.length) {
    let cursor = set.has(today) ? today : yesterday;
    if (set.has(cursor)) {
      while (set.has(cursor)) {
        current += 1;
        cursor = keyAdd(cursor, -1);
      }
    }
    let run = 0;
    let prev = null;
    for (const d of dates) {
      run = prev && dayDiff(prev, d) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    }
    gap = Math.max(0, dayDiff(dates[dates.length - 1], today) - 1);
  } else {
    gap = Math.max(0, dayDiff(dayKey(new Date(user.createdAt)), today) - 1);
  }
  const createdKey = dayKey(new Date(user.createdAt));
  let cursor = keyAdd(dates[0] || createdKey, 1);
  let missing = 0;
  const lastCompleted = keyAdd(today, -1);
  while (dayDiff(cursor, lastCompleted) >= 0) {
    if (set.has(cursor)) missing = 0;
    else {
      missing += 1;
      longestGap = Math.max(longestGap, missing);
    }
    cursor = keyAdd(cursor, 1);
  }
  return { dates, current, longest, gap, longestGap, last: dates[dates.length - 1] || null };
}
function levelFrom(stats) {
  if (stats.longest >= 30 || stats.total >= 100) return 5;
  if (stats.longest >= 15 || stats.total >= 50) return 4;
  if (stats.longest >= 7 || stats.total >= 20) return 3;
  if (stats.longest >= 3 || stats.total >= 7) return 2;
  return 1;
}
function userStats(state, user) {
  const total = state.respects.filter((r) => r.userId === user.id).length;
  const streaks = computeStreaks(state, user);
  return {
    total,
    ...streaks,
    level: Math.max(user.level || 1, levelFrom({ ...streaks, total })),
  };
}
function permissions(state, user) {
  const stats = userStats(state, user);
  const isOwner = user.role === 'owner';
  const isPelican = user.role === 'pelican';
  const isSparrow = user.role === 'sparrow';
  return {
    isOwner,
    isPelican,
    isSparrow,
    isAdmin: isOwner || isPelican || isSparrow,
    canInvite: isOwner || isPelican || isSparrow || stats.level >= 4,
    inviteCost: isOwner || isPelican ? 0 : isSparrow ? 2 : 4,
    canUnpublish: isOwner || isPelican,
    canManageRoles: isOwner,
    canBan: isOwner,
    dailyLimit: stats.level,
  };
}
function serializeUser(state, user, viewer = null) {
  const stats = userStats(state, user);
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    signature: user.signature || '',
    email: user.email || '',
    role: user.role,
    level: stats.level,
    rootPoints: user.rootPoints || 0,
    totalRespects: stats.total,
    currentStreak: stats.current,
    longestStreak: stats.longest,
    forgetDays: stats.gap,
    longestForgetDays: stats.longestGap,
    followerCount: user.followers?.length || 0,
    followingCount: user.following?.length || 0,
    createdAt: user.createdAt,
    invitedBy: user.invitedBy ? userName(state, user.invitedBy) : null,
    publicRecords: user.publicRecords !== false,
    isBanned: Boolean(user.bannedUntil && new Date(user.bannedUntil) > new Date()),
    banned: Boolean(user.bannedUntil && new Date(user.bannedUntil) > new Date()),
    bannedUntil: user.bannedUntil || null,
    isSelf: viewer?.id === user.id,
    isFollowing: Boolean(viewer && viewer.following?.includes(user.id)),
    followsYou: Boolean(viewer && user.following?.includes(viewer.id)),
    objectsCount: state.objects.filter((o) => o.ownerId === user.id && !o.removedAt).length,
  };
}
function serializeObject(state, object, viewer = null) {
  const owner = findUserById(state, object.ownerId);
  const today = dayKey();
  const isOwner = Boolean(viewer && viewer.id === object.ownerId);
  return {
    id: object.id,
    name: object.name,
    mainImage: object.mainImage || null,
    gallery: Array.isArray(object.gallery) ? object.gallery : [],
    intro: object.intro || '',
    quote: object.quote || '',
    quoteSource: object.quoteSource || '',
    visibility: object.visibility || 'public',
    owner: owner
      ? { id: owner.id, username: owner.username, avatar: owner.avatar || null, level: userStats(state, owner).level }
      : null,
    ownerId: object.ownerId,
    createdAt: object.createdAt,
    removedAt: object.removedAt || null,
    respects: objectLikeCount(state, object.id),
    weekRespects: objectWeekCount(state, object.id),
    isOwner,
    canEdit: Boolean(viewer && (isOwner || object.visibility === 'public')),
    canChangeVisibility: Boolean(isOwner),
    respectedToday: Boolean(
      viewer && state.respects.some((r) => r.userId === viewer.id && r.objectId === object.id && r.date === today)
    ),
    reportCount: state.reports.filter((r) => r.objectId === object.id && r.status === 'open').length,
  };
}
function viewerPayload(state, user) {
  const stats = userStats(state, user);
  const today = dayKey();
  const todayObjects = [
    ...new Set(state.respects.filter((r) => r.userId === user.id && r.date === today).map((r) => r.objectId)),
  ];
  const perm = permissions(state, user);
  const openReports = state.reports.filter((r) => r.status === 'open');
  const inboxCount = perm.isOwner || perm.isPelican
    ? openReports.length
    : perm.isSparrow
      ? openReports.filter((r) => r.reporterId === user.id).length
      : 0;
  return {
    user: serializeUser(state, user, user),
    stats: {
      ...stats,
      todayCount: todayObjects.length,
      todayLimit: stats.level,
      remaining: Math.max(0, stats.level - todayObjects.length),
      respectedToday: todayObjects.length > 0,
      todayObjectIds: todayObjects,
    },
    permissions: perm,
    cover: { hasRespectedToday: todayObjects.length > 0, date: today },
    inboxCount,
    activeInvites: state.invites.filter(
      (i) => i.createdBy === user.id && !i.usedBy && new Date(i.expiresAt) > new Date()
    ).length,
  };
}

function validateUsername(username) {
  const value = String(username || '').trim();
  const chars = Array.from(value);
  if (chars.length < 2 || chars.length > 20) throw new ApiError(400, '用户名长度需为 2–20 个字符', 'BAD_USERNAME');
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(value)) throw new ApiError(400, '用户名只能包含中文、英文字母、数字或下划线', 'BAD_USERNAME');
  if (/^\d+$/.test(value)) throw new ApiError(400, '用户名不能是纯数字', 'BAD_USERNAME');
  const lower = value.toLowerCase();
  if (RESERVED_NAMES.some((item) => lower.includes(item.toLowerCase()))) throw new ApiError(400, '该用户名包含保留词，请换一个', 'BAD_USERNAME');
  if (SENSITIVE_WORDS.some((item) => lower.includes(item.toLowerCase()))) throw new ApiError(400, '该用户名包含不适合的词语，请换一个', 'BAD_USERNAME');
  return value;
}
function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6) throw new ApiError(400, '密码至少需要 6 位', 'BAD_PASSWORD');
  if (value.length > 128) throw new ApiError(400, '密码过长', 'BAD_PASSWORD');
  return value;
}
function validateInvite(state, code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) throw new ApiError(400, '请填写邀请码', 'BAD_INVITE');
  const invite = state.invites.find((i) => i.code.toUpperCase() === value && !i.usedBy);
  if (!invite) throw new ApiError(400, '邀请码无效或已被使用', 'BAD_INVITE');
  if (new Date(invite.expiresAt) <= new Date()) throw new ApiError(400, '邀请码已过期', 'BAD_INVITE');
  return invite;
}
function assertActive(user) {
  if (user?.bannedUntil && new Date(user.bannedUntil) > new Date()) {
    throw new ApiError(403, `该账号已被封禁至 ${new Date(user.bannedUntil).toLocaleString('zh-CN', { timeZone: TZ })}`, 'BANNED', {
      bannedUntil: user.bannedUntil,
      reason: user.banReason || '',
    });
  }
}
function currentUser(request, state) {
  const token = parseCookies(request).awecean_session;
  if (!token) return null;
  const session = state.sessions.find((s) => s.id === token);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;
  return findUserById(state, session.userId) || null;
}
function createSession(state, user) {
  const session = {
    id: randomHex(28),
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
  };
  state.sessions.push(session);
  return session;
}

function cleanupState(state) {
  let dirty = false;
  const now = Date.now();
  const beforeInvites = state.invites.length;
  state.invites = state.invites.filter((i) => new Date(i.expiresAt).getTime() > now);
  if (state.invites.length !== beforeInvites) dirty = true;
  for (const object of state.objects) {
    if (object.removedAt) continue;
    if (now - new Date(object.createdAt).getTime() > 5 * 86400000) {
      const count = objectLikeCount(state, object.id);
      if (count < 5) {
        object.removedAt = nowIso();
        object.removedBy = 'system';
        object.removeReason = '创建 5 天内累计被敬畏少于 5 次，已自动下架';
        state.reports = state.reports.filter((r) => r.objectId !== object.id);
        dirty = true;
      }
    }
  }
  const beforeSessions = state.sessions.length;
  state.sessions = state.sessions.filter((s) => new Date(s.expiresAt) > new Date());
  if (state.sessions.length !== beforeSessions) dirty = true;
  return dirty;
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

function makeSeedUser(username, role, email, signature, daysAgo, rootPoints, passwordHash, invitedBy = null) {
  return {
    id: id('u_'),
    username,
    usernameLower: username.toLowerCase(),
    passwordHash,
    email,
    signature,
    avatar: null,
    role,
    level: 1,
    totalRespects: 0,
    rootPoints,
    createdAt: atLocal(dayOffset(daysAgo), 9).toISOString(),
    invitedBy,
    registrationCode: null,
    following: [],
    followers: [],
    publicRecords: true,
    bannedUntil: null,
    banReason: '',
  };
}

function seedState() {
  const owner = makeSeedUser('根号12', 'owner', 'root12@awecean.site', '', 0, 60, ADMIN_HASH);
  const invites = [{
    id: id('i_'),
    code: 'AW-2026',
    createdBy: owner.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + INVITE_HOURS * 3600000).toISOString(),
    usedBy: null,
    usedAt: null,
  }];
  const state = {
    meta: { version: 1, createdAt: nowIso(), seededAt: nowIso() },
    users: [owner],
    objects: [],
    respects: [],
    sessions: [],
    invites,
    reports: [],
  };
  const stats = userStats(state, owner);
  owner.level = stats.level;
  owner.totalRespects = stats.total;
  return state;
}


/* -------------------------------------------------------------------------- */
/* D1 state                                                                   */
/* -------------------------------------------------------------------------- */

async function loadState(env) {
  let row = await env.DB.prepare('SELECT data, version FROM site_state WHERE id = ?').bind('main').first();
  if (!row) {
    const seed = seedState();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO site_state (id, data, version, updated_at) VALUES (?, ?, ?, ?)'
    ).bind('main', JSON.stringify(seed), 1, nowIso()).run();
    row = await env.DB.prepare('SELECT data, version FROM site_state WHERE id = ?').bind('main').first();
  }
  if (!row) throw new Error('Could not initialize site state.');
  return { state: JSON.parse(row.data), version: Number(row.version) };
}

async function saveState(env, state, version) {
  const result = await env.DB.prepare(
    'UPDATE site_state SET data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
  ).bind(JSON.stringify(state), nowIso(), 'main', version).run();
  if (!result.meta?.changes) throw new StateConflict('State changed while writing.');
}

/* -------------------------------------------------------------------------- */
/* Responses / identity                                                       */
/* -------------------------------------------------------------------------- */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}
function ok(data, status = 200, extraHeaders = {}) {
  return json({ ok: true, data }, status, extraHeaders);
}
function fail(status, message, code = 'ERROR', details = null) {
  return json({ ok: false, error: { code, message, details } }, status);
}

async function readBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY) throw new ApiError(413, '请求内容过大', 'TOO_LARGE');
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, '请求格式不正确', 'BAD_JSON');
  }
}

function avatarSvg(seed) {
  const hash = new Uint8Array(awaitHash(`${seed}`));
  const palettes = [
    ['#FFE8EE', '#4B4352', '#EF6F8D'],
    ['#EAF8FF', '#3E5662', '#6FBBD6'],
    ['#F3EFFF', '#4D4363', '#9B8AE8'],
    ['#FFF6E0', '#5A4A2E', '#D2A24C'],
    ['#ECFBF5', '#365247', '#68AD90'],
  ];
  const p = palettes[hash[0] % palettes.length];
  const initial = Array.from(String(seed || '敬'))[0] || '敬';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="${escapeXml(initial)}">
    <rect width="160" height="160" fill="${p[0]}"/>
    <circle cx="36" cy="34" r="52" fill="none" stroke="${p[1]}" stroke-opacity=".09"/>
    <circle cx="128" cy="132" r="68" fill="none" stroke="${p[1]}" stroke-opacity=".08"/>
    <path d="M-20 112 Q80 68 180 122" fill="none" stroke="${p[1]}" stroke-opacity=".12" stroke-width="1.5"/>
    <g transform="rotate(${(hash[1] % 30) - 15} 80 84)">
      <rect x="43" y="30" width="74" height="74" fill="none" stroke="${p[2]}" stroke-opacity=".5"/>
      <text x="80" y="82" text-anchor="middle" font-family="Songti SC, STSong, Noto Serif CJK SC, serif" font-size="42" fill="${p[1]}">${escapeXml(initial)}</text>
    </g>
    <circle cx="126" cy="34" r="5" fill="${p[2]}"/>
  </svg>`;
}
function awaitHash(text) {
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < 32; i += 1) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out[i] = Math.abs(h + i * 31) % 255;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Uploads / media                                                            */
/* -------------------------------------------------------------------------- */

function sanitizeImageUrl(url) {
  if (!url) return null;
  if (!/^\/(uploads|assets|api\/media)\/[A-Za-z0-9._/-]+$/.test(url)) throw new ApiError(400, '图片地址不合法', 'BAD_IMAGE');
  return url;
}

async function saveImageDataUrl(env, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new ApiError(400, '图片格式不正确', 'BAD_IMAGE');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new ApiError(400, '仅支持 JPG、PNG 或 WebP 图片', 'BAD_IMAGE');
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length > 5 * 1024 * 1024) throw new ApiError(413, '图片过大，请压缩后再上传', 'IMAGE_TOO_LARGE');
  if (bytes.length < 32) throw new ApiError(400, '图片内容为空', 'BAD_IMAGE');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const key = `uploads/${Date.now().toString(36)}-${randomHex(5)}.${ext}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: `image/${match[1]}` } });
  return `/api/media/${key}`;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

function matchObject(pathname) {
  const m = /^\/api\/objects\/([A-Za-z0-9_]+)$/.exec(pathname);
  return m ? m[1] : null;
}

async function processApi(request, env, url, state) {
  const pathname = url.pathname;
  const method = request.method;

  /* public ---------------------------------------------------------------- */
  if (pathname === '/api/invites/check' && method === 'GET') {
    const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
    const invite = state.invites.find((i) => i.code.toUpperCase() === code && !i.usedBy);
    if (!invite || new Date(invite.expiresAt) <= new Date()) return { data: { valid: false } };
    return { data: { valid: true, inviter: userName(state, invite.createdBy), expiresAt: invite.expiresAt } };
  }
  if (pathname === '/api/users/check' && method === 'GET') {
    const value = cleanText(url.searchParams.get('username'), 40);
    try {
      validateUsername(value);
      if (findUserByUsername(state, value)) return { data: { available: false, reason: '这个用户名已经被使用了' } };
      return { data: { available: true, reason: '可以使用' } };
    } catch (error) {
      return { data: { available: false, reason: error.message } };
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(request);
    const user = findUserByUsername(state, cleanText(body.username, 40));
    if (!user || !(await verifyPassword(String(body.password || ''), user.passwordHash))) {
      throw new ApiError(400, '用户名或密码不正确', 'BAD_CREDENTIALS');
    }
    assertActive(user);
    const session = createSession(state, user);
    return { data: viewerPayload(state, user), cookie: cookieFor(session), dirty: true };
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readBody(request);
    const username = validateUsername(body.username);
    if (findUserByUsername(state, username)) throw new ApiError(409, '这个用户名已经被使用了', 'USERNAME_TAKEN');
    const password = validatePassword(body.password);
    const invite = validateInvite(state, body.inviteCode);
    const email = cleanText(body.email, 120);
    if (!isEmail(email)) throw new ApiError(400, '邮箱格式不正确', 'BAD_EMAIL');
    const user = {
      id: id('u_'),
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: await hashPassword(password),
      email,
      signature: cleanText(body.signature, 80),
      avatar: null,
      role: 'user',
      level: 1,
      totalRespects: 0,
      rootPoints: 0,
      createdAt: nowIso(),
      invitedBy: invite.createdBy,
      registrationCode: invite.code.toUpperCase(),
      following: [],
      followers: [],
      publicRecords: true,
      bannedUntil: null,
      banReason: '',
    };
    state.users.push(user);
    invite.usedBy = user.id;
    invite.usedAt = nowIso();
    const session = createSession(state, user);
    return { data: viewerPayload(state, user), cookie: cookieFor(session), dirty: true, status: 201 };
  }

  if (pathname === '/api/auth/reset' && method === 'POST') {
    const body = await readBody(request);
    const user = findUserByUsername(state, cleanText(body.username, 40));
    if (!user) throw new ApiError(400, '账号不存在', 'NOT_FOUND');
    if (!user.registrationCode) throw new ApiError(400, '该账号没有可验证的注册邀请记录，请联系管理员', 'NO_RESET');
    if (String(body.originalInvite || '').trim().toUpperCase() !== user.registrationCode.toUpperCase()) {
      throw new ApiError(400, '原注册邀请码不正确', 'BAD_INVITE');
    }
    const fresh = validateInvite(state, body.newInviteCode);
    user.passwordHash = await hashPassword(validatePassword(body.password));
    fresh.usedBy = user.id;
    fresh.usedAt = nowIso();
    state.sessions = state.sessions.filter((s) => s.userId !== user.id);
    return { data: { message: '密码已重置，请重新登录' }, dirty: true };
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(request).awecean_session;
    state.sessions = state.sessions.filter((s) => s.id !== token);
    return { data: { message: '已退出' }, cookie: clearCookie(), dirty: true };
  }

  const user = currentUser(request, state);
  if (!user) throw new ApiError(401, '请先登录', 'UNAUTHORIZED');
  assertActive(user);

  /* session --------------------------------------------------------------- */
  if (pathname === '/api/me' && method === 'GET') return { data: viewerPayload(state, user) };
  if (pathname === '/api/me' && method === 'PATCH') {
    const body = await readBody(request);
    if (body.signature !== undefined) user.signature = cleanText(body.signature, 80);
    if (body.email !== undefined) {
      const email = cleanText(body.email, 120);
      if (!isEmail(email)) throw new ApiError(400, '邮箱格式不正确', 'BAD_EMAIL');
      user.email = email;
    }
    if (body.avatar !== undefined) user.avatar = body.avatar ? sanitizeImageUrl(body.avatar) : null;
    if (body.publicRecords !== undefined) user.publicRecords = Boolean(body.publicRecords);
    return { data: { me: viewerPayload(state, user), message: '资料已保存' }, dirty: true };
  }
  if (pathname === '/api/me/password' && method === 'POST') {
    const body = await readBody(request);
    if (!(await verifyPassword(String(body.currentPassword || ''), user.passwordHash))) {
      throw new ApiError(400, '当前密码不正确', 'BAD_PASSWORD');
    }
    user.passwordHash = await hashPassword(validatePassword(body.newPassword));
    return { data: { message: '密码已更新' }, dirty: true };
  }
  if (pathname === '/api/me/username' && method === 'POST') {
    const body = await readBody(request);
    const next = validateUsername(body.username);
    if (next.toLowerCase() === user.usernameLower) throw new ApiError(400, '新用户名与当前相同', 'BAD_USERNAME');
    if (findUserByUsername(state, next)) throw new ApiError(409, '这个用户名已经被使用了', 'USERNAME_TAKEN');
    if ((user.rootPoints || 0) < 5) throw new ApiError(400, '修改用户名需要 5 个根号数', 'NOT_ENOUGH_ROOTS');
    user.rootPoints -= 5;
    user.username = next;
    user.usernameLower = next.toLowerCase();
    return { data: { me: viewerPayload(state, user), message: '用户名已修改，消耗 5 个根号数' }, dirty: true };
  }
  if (pathname === '/api/me/records' && method === 'GET') {
    const records = state.respects
      .filter((r) => r.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 60)
      .map((r) => {
        const object = state.objects.find((o) => o.id === r.objectId);
        return {
          id: r.id,
          date: r.date,
          createdAt: r.createdAt,
          object: object ? { id: object.id, name: object.name, mainImage: object.mainImage, quote: object.quote } : null,
        };
      });
    return { data: { records } };
  }

  /* uploads --------------------------------------------------------------- */
  if (pathname === '/api/upload' && method === 'POST') {
    const body = await readBody(request);
    return { data: { url: await saveImageDataUrl(env, body.dataUrl) }, status: 201 };
  }

  /* home ------------------------------------------------------------------ */
  if (pathname === '/api/home' && method === 'GET') {
    const visible = state.objects.filter((o) => !o.removedAt);
    const byHeat = [...visible].sort((a, b) => objectLikeCount(state, b.id) - objectLikeCount(state, a.id));
    const featured = byHeat.slice(0, 4);
    const fresh = [...visible].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
    const topObjects = byHeat.slice(0, 5).map((o) => serializeObject(state, o, user));
    const boards = leaderboardPayload(state);
    const topUsers = [];
    for (let level = 5; level >= 1; level -= 1) {
      if (boards.byLevel[level]?.length) {
        topUsers.push(...boards.byLevel[level].slice(0, 3));
        if (topUsers.length >= 5) break;
      }
    }
    return {
      data: {
        featured: featured.map((o) => serializeObject(state, o, user)),
        fresh: fresh.map((o) => serializeObject(state, o, user)),
        topObjects,
        topUsers: topUsers.slice(0, 5),
        stats: {
          users: state.users.length,
          objects: visible.length,
          todayRespects: new Set(state.respects.filter((r) => r.date === dayKey()).map((r) => `${r.userId}:${r.objectId}`)).size,
        },
        calendar: userStats(state, user).dates.slice(-31),
        me: viewerPayload(state, user),
      },
    };
  }

  /* objects --------------------------------------------------------------- */
  if (pathname === '/api/objects' && method === 'GET') {
    const q = cleanText(url.searchParams.get('q'), 60).toLowerCase();
    const sort = url.searchParams.get('sort') || 'hot';
    let list = state.objects.filter((o) => !o.removedAt);
    if (q) {
      list = list.filter((o) => [o.name, o.intro, o.quote, o.quoteSource].join(' ').toLowerCase().includes(q));
    }
    if (sort === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'week') list.sort((a, b) => objectWeekCount(state, b.id) - objectWeekCount(state, a.id));
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    else list.sort((a, b) => objectLikeCount(state, b.id) - objectLikeCount(state, a.id));
    return {
      data: {
        objects: list.slice(0, 60).map((o) => serializeObject(state, o, user)),
        total: list.length,
        query: q,
        sort,
      },
    };
  }
  if (pathname === '/api/objects' && method === 'POST') {
    const body = await readBody(request);
    const name = cleanText(body.name, 40);
    if (!name) throw new ApiError(400, '请填写敬畏对象的名称', 'BAD_NAME');
    const quote = cleanText(body.quote, 160);
    if (!quote) throw new ApiError(400, '名言名句是必填的', 'BAD_QUOTE');
    const object = {
      id: id('o_'),
      name,
      mainImage: body.mainImage ? sanitizeImageUrl(body.mainImage) : null,
      gallery: Array.isArray(body.gallery) ? body.gallery.slice(0, 5).map(sanitizeImageUrl).filter(Boolean) : [],
      intro: cleanText(body.intro, 1200),
      quote,
      quoteSource: cleanText(body.quoteSource, 80),
      visibility: body.visibility === 'private' ? 'private' : 'public',
      ownerId: user.id,
      createdAt: nowIso(),
      removedAt: null,
      removedBy: null,
      removeReason: '',
    };
    state.objects.unshift(object);
    return { data: serializeObject(state, object, user), status: 201, dirty: true };
  }

  const objectId = matchObject(pathname);
  if (objectId) {
    const object = state.objects.find((o) => o.id === objectId);
    if (!object) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    if (object.removedAt && !(user.role === 'owner' || user.role === 'pelican' || object.ownerId === user.id)) {
      throw new ApiError(410, '这个敬畏对象已经下架', 'REMOVED');
    }
    if (method === 'GET') return { data: serializeObject(state, object, user) };
    if (method === 'PATCH') {
      const body = await readBody(request);
      const isOwner = object.ownerId === user.id;
      if (!isOwner && object.visibility !== 'public') throw new ApiError(403, '该敬畏对象是私有的，只有创建者可以修改', 'FORBIDDEN');
      if (body.name !== undefined) {
        const name = cleanText(body.name, 40);
        if (!name) throw new ApiError(400, '名称不能为空', 'BAD_NAME');
        object.name = name;
      }
      if (body.quote !== undefined) {
        const quote = cleanText(body.quote, 160);
        if (!quote) throw new ApiError(400, '名言名句不能为空', 'BAD_QUOTE');
        object.quote = quote;
      }
      if (body.quoteSource !== undefined) object.quoteSource = cleanText(body.quoteSource, 80);
      if (body.intro !== undefined) object.intro = cleanText(body.intro, 1200);
      if (body.mainImage !== undefined) object.mainImage = body.mainImage ? sanitizeImageUrl(body.mainImage) : null;
      if (body.gallery !== undefined) object.gallery = Array.isArray(body.gallery) ? body.gallery.slice(0, 5).map(sanitizeImageUrl).filter(Boolean) : [];
      if (body.visibility !== undefined && body.visibility !== object.visibility) {
        if (!isOwner) throw new ApiError(403, '只有创建者可以更改编辑权限', 'FORBIDDEN');
        if (!['public', 'private'].includes(body.visibility)) throw new ApiError(400, '权限值不合法', 'BAD_VISIBILITY');
        object.visibility = body.visibility;
      }
      object.updatedAt = nowIso();
      return { data: serializeObject(state, object, user), dirty: true };
    }
    if (method === 'DELETE') {
      if (object.ownerId !== user.id && user.role !== 'owner') throw new ApiError(403, '只有创建者或站长可以删除', 'FORBIDDEN');
      object.removedAt = nowIso();
      object.removedBy = user.id;
      object.removeReason = '创建者删除';
      state.reports = state.reports.filter((r) => r.objectId !== object.id);
      return { data: { message: '已删除' }, dirty: true };
    }
  }

  const respectMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/respect$/.exec(pathname);
  if (respectMatch && method === 'POST') {
    const object = state.objects.find((o) => o.id === respectMatch[1]);
    if (!object || object.removedAt) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    const stats = userStats(state, user);
    const today = dayKey();
    if (state.respects.some((r) => r.userId === user.id && r.objectId === object.id && r.date === today)) {
      throw new ApiError(409, '今天已经敬畏过 TA 了，明天再来吧', 'ALREADY_RESPECTED');
    }
    const todayObjects = new Set(state.respects.filter((r) => r.userId === user.id && r.date === today).map((r) => r.objectId));
    if (todayObjects.size >= stats.level) {
      throw new ApiError(429, `今天已敬畏 ${todayObjects.size} 位，达到 L${stats.level} 的每日限额`, 'DAILY_LIMIT', { level: stats.level, limit: stats.level });
    }
    state.respects.push({ id: id('r_'), userId: user.id, objectId: object.id, date: today, createdAt: nowIso() });
    user.rootPoints = (user.rootPoints || 0) + 1;
    user.totalRespects = (user.totalRespects || 0) + 1;
    const after = userStats(state, user);
    user.level = Math.max(user.level || 1, after.level);
    return {
      data: {
        object: serializeObject(state, object, user),
        me: viewerPayload(state, user),
        gained: 1,
        message: `已向「${object.name}」表达敬畏`,
      },
      dirty: true,
    };
  }

  const reportMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/report$/.exec(pathname);
  if (reportMatch && method === 'POST') {
    const object = state.objects.find((o) => o.id === reportMatch[1]);
    if (!object || object.removedAt) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    const body = await readBody(request);
    const reason = cleanText(body.reason, 300);
    if (reason.length < 5) throw new ApiError(400, '请填写至少 5 个字的举报说明', 'BAD_REPORT');
    if (state.reports.some((r) => r.objectId === object.id && r.reporterId === user.id && r.status === 'open')) {
      throw new ApiError(409, '你已经举报过这个对象，管理员正在处理', 'DUPLICATE_REPORT');
    }
    state.reports.push({ id: id('p_'), objectId: object.id, reporterId: user.id, reason, createdAt: nowIso(), status: 'open' });
    return { data: { message: '举报已送达鹈鹕管理员与帝企鹅管理员' }, status: 201, dirty: true };
  }

  const removeMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/remove$/.exec(pathname);
  if (removeMatch && method === 'POST') {
    if (!['owner', 'pelican'].includes(user.role)) throw new ApiError(403, '只有帝企鹅或鹈鹕管理员可以下架内容', 'FORBIDDEN');
    const object = state.objects.find((o) => o.id === removeMatch[1]);
    if (!object) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    const body = await readBody(request);
    object.removedAt = nowIso();
    object.removedBy = user.id;
    object.removeReason = cleanText(body.reason, 200) || '管理员下架';
    state.reports = state.reports.filter((r) => r.objectId !== object.id);
    return { data: { message: '内容已下架，相关举报已一并处理' }, dirty: true };
  }

  /* users ----------------------------------------------------------------- */
  if (pathname === '/api/users' && method === 'GET') {
    const q = cleanText(url.searchParams.get('q'), 40).toLowerCase();
    const sort = url.searchParams.get('sort') || 'respects';
    let list = state.users.filter((u) => !(u.bannedUntil && new Date(u.bannedUntil) > new Date()));
    if (q) list = list.filter((u) => u.usernameLower.includes(q));
    if (sort === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'level') list.sort((a, b) => userStats(state, b).level - userStats(state, a).level);
    else if (sort === 'followers') list.sort((a, b) => (b.followers?.length || 0) - (a.followers?.length || 0));
    else if (sort === 'forget') list.sort((a, b) => userStats(state, b).longestGap - userStats(state, a).longestGap);
    else list.sort((a, b) => userStats(state, b).total - userStats(state, a).total);
    return { data: { users: list.slice(0, 60).map((u) => serializeUser(state, u, user)), total: list.length, query: q, sort } };
  }
  if (pathname === '/api/users/me/following' && method === 'GET') {
    return {
      data: {
        users: user.following.map((uid) => findUserById(state, uid)).filter(Boolean).map((u) => serializeUser(state, u, user)),
      },
    };
  }
  const connectionMatch = /^\/api\/users\/([A-Za-z0-9_]+)\/connections$/.exec(pathname);
  if (connectionMatch && method === 'GET') {
    const target = findUserById(state, connectionMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    const type = url.searchParams.get('type') === 'followers' ? 'followers' : 'following';
    return {
      data: {
        type,
        users: target[type].map((uid) => findUserById(state, uid)).filter(Boolean).map((u) => serializeUser(state, u, user)),
      },
    };
  }
  const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
  if (userMatch && method === 'GET') {
    const key = decodeURIComponent(userMatch[1]);
    const target = findUserById(state, key) || findUserByUsername(state, key);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    const stats = userStats(state, target);
    const created = state.objects.filter((o) => o.ownerId === target.id && !o.removedAt).map((o) => serializeObject(state, o, user));
    const canSeeRecords = target.publicRecords !== false || target.id === user.id;
    const records = canSeeRecords
      ? state.respects.filter((r) => r.userId === target.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30).map((r) => {
          const object = state.objects.find((o) => o.id === r.objectId);
          return { id: r.id, date: r.date, createdAt: r.createdAt, object: object ? { id: object.id, name: object.name, mainImage: object.mainImage, quote: object.quote } : null };
        })
      : [];
    return {
      data: {
        user: {
          ...serializeUser(state, target, user),
          stats: { ...stats, todayLimit: stats.level },
          recordsVisible: canSeeRecords,
          calendar: stats.dates.slice(-42),
          createdObjects: created,
          recentRecords: records,
          followingList: target.following.map((uid) => findUserById(state, uid)).filter(Boolean).map((u) => serializeUser(state, u, user)),
          followersList: target.followers.map((uid) => findUserById(state, uid)).filter(Boolean).map((u) => serializeUser(state, u, user)),
        },
      },
    };
  }
  const followMatch = /^\/api\/users\/([A-Za-z0-9_]+)\/follow$/.exec(pathname);
  if (followMatch && method === 'POST') {
    const target = findUserById(state, followMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    if (target.id === user.id) throw new ApiError(400, '不能关注自己', 'SELF_FOLLOW');
    const index = user.following.indexOf(target.id);
    let followed;
    if (index === -1) {
      user.following.push(target.id);
      if (!target.followers.includes(user.id)) target.followers.push(user.id);
      followed = true;
    } else {
      user.following.splice(index, 1);
      target.followers = target.followers.filter((uid) => uid !== user.id);
      followed = false;
    }
    return { data: { followed, message: followed ? `已关注 ${target.username}` : `已取消关注 ${target.username}`, user: serializeUser(state, target, user) }, dirty: true };
  }

  /* leaderboard ----------------------------------------------------------- */
  if (pathname === '/api/leaderboards' && method === 'GET') return { data: leaderboardPayload(state) };

  /* invites --------------------------------------------------------------- */
  if (pathname === '/api/invites' && method === 'GET') {
    const perm = permissions(state, user);
    const invites = state.invites
      .filter((i) => i.createdBy === user.id || (perm.isOwner && url.searchParams.get('all') === '1'))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((i) => serializeInvite(state, i, user));
    return { data: { invites, permissions: perm, rootPoints: user.rootPoints || 0 } };
  }
  if (pathname === '/api/invites' && method === 'POST') {
    const perm = permissions(state, user);
    if (!perm.canInvite) throw new ApiError(403, 'L4 及以上用户或管理员才能发放邀请码', 'FORBIDDEN');
    const cost = perm.inviteCost;
    if ((user.rootPoints || 0) < cost) throw new ApiError(400, `发放邀请码需要 ${cost} 个根号数`, 'NOT_ENOUGH_ROOTS');
    user.rootPoints -= cost;
    const invite = {
      id: id('i_'),
      code: randomCode(),
      createdBy: user.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + INVITE_HOURS * 3600000).toISOString(),
      usedBy: null,
      usedAt: null,
    };
    state.invites.push(invite);
    return { data: { invite: serializeInvite(state, invite, user), rootPoints: user.rootPoints, message: `邀请码已生成，${INVITE_HOURS} 小时后自动失效` }, status: 201, dirty: true };
  }

  /* admin ----------------------------------------------------------------- */
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const perm = permissions(state, user);
    if (!perm.isAdmin) throw new ApiError(403, '无权访问管理后台', 'FORBIDDEN');
    const users = state.users.map((u) => ({ ...serializeUser(state, u, user), email: u.email || '', rootPoints: u.rootPoints || 0, banReason: u.banReason || '', stats: userStats(state, u) }));
    const reports = state.reports
      .filter((r) => perm.isOwner || perm.isPelican || r.reporterId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((r) => {
        const object = state.objects.find((o) => o.id === r.objectId);
        return { ...r, object: object ? { id: object.id, name: object.name, mainImage: object.mainImage, removedAt: object.removedAt } : null, reporter: userName(state, r.reporterId) };
      });
    const invites = perm.isOwner ? state.invites.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((i) => serializeInvite(state, i, user)) : [];
    return {
      data: {
        permissions: perm,
        users,
        reports,
        invites,
        stats: {
          users: state.users.length,
          objects: state.objects.filter((o) => !o.removedAt).length,
          respects: state.respects.length,
          reports: reports.filter((r) => r.status === 'open').length,
          invites: state.invites.filter((i) => !i.usedBy).length,
        },
      },
    };
  }
  const adminUserMatch = /^\/api\/admin\/users\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (adminUserMatch && method === 'PATCH') {
    if (user.role !== 'owner') throw new ApiError(403, '只有帝企鹅管理员可以管理成员', 'FORBIDDEN');
    const target = findUserById(state, adminUserMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    if (target.id === user.id) throw new ApiError(400, '不能对自己执行此操作', 'SELF');
    const body = await readBody(request);
    if (body.role !== undefined) {
      if (!['pelican', 'sparrow', 'user'].includes(body.role)) throw new ApiError(400, '角色值不合法', 'BAD_ROLE');
      target.role = body.role;
    }
    if (body.ban === false) {
      target.bannedUntil = null;
      target.banReason = '';
    } else if (body.days !== undefined) {
      const days = Number(body.days);
      if (!Number.isFinite(days) || days < 1 || days > 3650) throw new ApiError(400, '封禁天数需在 1–3650 之间', 'BAD_BAN');
      target.bannedUntil = new Date(Date.now() + days * 86400000).toISOString();
      target.banReason = cleanText(body.reason, 120);
      state.sessions = state.sessions.filter((s) => s.userId !== target.id);
    } else if (body.until !== undefined) {
      const until = new Date(body.until);
      if (Number.isNaN(until.getTime()) || until <= new Date()) throw new ApiError(400, '封禁截止时间不合法', 'BAD_BAN');
      target.bannedUntil = until.toISOString();
      target.banReason = cleanText(body.reason, 120);
      state.sessions = state.sessions.filter((s) => s.userId !== target.id);
    }
    return { data: { user: serializeUser(state, target, user), message: '成员状态已更新' }, dirty: true };
  }
  const adminReportMatch = /^\/api\/admin\/reports\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (adminReportMatch && method === 'POST') {
    if (!['owner', 'pelican'].includes(user.role)) throw new ApiError(403, '只有帝企鹅或鹈鹕管理员可以处理举报', 'FORBIDDEN');
    const report = state.reports.find((r) => r.id === adminReportMatch[1]);
    if (!report) throw new ApiError(404, '举报不存在', 'NOT_FOUND');
    const body = await readBody(request);
    if (body.action === 'remove') {
      const object = state.objects.find((o) => o.id === report.objectId);
      if (object) {
        object.removedAt = nowIso();
        object.removedBy = user.id;
        object.removeReason = cleanText(body.reason, 200) || '举报核实后下架';
      }
      state.reports = state.reports.filter((r) => r.objectId !== report.objectId);
      return { data: { message: '已下架内容，举报记录已清除' }, dirty: true };
    }
    if (body.action === 'dismiss') {
      state.reports = state.reports.filter((r) => r.id !== report.id);
      return { data: { message: '举报已处理并移除' }, dirty: true };
    }
    throw new ApiError(400, '未知的处理方式', 'BAD_ACTION');
  }

  throw new ApiError(404, '接口不存在', 'NOT_FOUND');
}

function serializeInvite(state, invite, viewer) {
  const creator = findUserById(state, invite.createdBy);
  const used = invite.usedBy ? findUserById(state, invite.usedBy) : null;
  const active = !invite.usedBy && new Date(invite.expiresAt) > new Date();
  return {
    id: invite.id,
    code: invite.code,
    createdBy: creator ? creator.username : '未知',
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    usedBy: used ? used.username : null,
    usedAt: invite.usedAt,
    status: invite.usedBy ? 'used' : active ? 'active' : 'expired',
  };
}
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `AW-${out.slice(0, 4)}-${out.slice(4)}`;
}
function leaderboardPayload(state) {
  const active = state.users.filter((u) => !(u.bannedUntil && new Date(u.bannedUntil) > new Date()));
  const byLevel = {};
  for (let level = 5; level >= 1; level -= 1) {
    byLevel[level] = active
      .filter((u) => userStats(state, u).level === level)
      .sort((a, b) => {
        const sa = userStats(state, a);
        const sb = userStats(state, b);
        return sb.total - sa.total || sb.current - sa.current;
      })
      .slice(0, 10)
      .map((u) => serializeUser(state, u, null));
  }
  const topObjects = state.objects
    .filter((o) => !o.removedAt)
    .sort((a, b) => objectLikeCount(state, b.id) - objectLikeCount(state, a.id))
    .slice(0, 10)
    .map((o) => serializeObject(state, o, null));
  const forgotten = active
    .filter((u) => {
      const s = userStats(state, u);
      return s.total > 0 && s.longestGap > 0;
    })
    .sort((a, b) => {
      const sa = userStats(state, a);
      const sb = userStats(state, b);
      return sb.longestGap - sa.longestGap || sb.gap - sa.gap;
    })
    .slice(0, 12)
    .map((u) => ({ ...serializeUser(state, u, null), forget: userStats(state, u) }));
  return { byLevel, topObjects, forgotten };
}

/* -------------------------------------------------------------------------- */
/* Worker entry                                                               */
/* -------------------------------------------------------------------------- */

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return ok({ status: 'ok', time: nowIso() });
  }
  if (url.pathname === '/api/avatar' && request.method === 'GET') {
    return new Response(avatarSvg(url.searchParams.get('seed') || '敬'), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (url.pathname.startsWith('/api/media/') && request.method === 'GET') {
    const key = decodeURIComponent(url.pathname.slice('/api/media/'.length));
    if (!key.startsWith('uploads/')) return new Response('Not found', { status: 404 });
    const object = await env.BUCKET.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { state, version } = await loadState(env);
    let dirty = cleanupState(state);
    try {
      const result = await processApi(request, env, url, state);
      if (result.dirty) dirty = true;
      if (dirty) await saveState(env, state, version);
      return ok(result.data, result.status || 200, result.cookie ? { 'Set-Cookie': result.cookie } : {});
    } catch (error) {
      if (error instanceof StateConflict) continue;
      throw error;
    }
  }
  return fail(503, '这里有一点拥挤，请再试一次', 'STATE_BUSY');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details);
      console.error('API error', error);
      return fail(500, '服务器开小差了，请稍后再试', 'SERVER_ERROR');
    }
  },
};
