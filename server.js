'use strict';

/**
 * Awecean
 * A dependency-free Node.js server for the 敬畏 community.
 * Data is persisted to data/db.json. Images live in public/uploads.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const TZ = 'Asia/Shanghai';
const SESSION_DAYS = 30;
const INVITE_HOURS = 48;
const MAX_BODY = 22 * 1024 * 1024;

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

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

function id(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function isEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 120;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `AW-${out.slice(0, 4)}-${out.slice(4)}`;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function ok(res, data, status = 200) {
  sendJson(res, status, { ok: true, data });
}

function fail(res, status, message, code = 'ERROR', details = null) {
  sendJson(res, status, { ok: false, error: { code, message, details } });
}

class ApiError extends Error {
  constructor(status, message, code = 'ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let db = null;
let saveTimer = null;

function createEmptyDb() {
  return {
    meta: { version: 1, createdAt: nowIso(), seededAt: null },
    users: [],
    objects: [],
    respects: [],
    sessions: [],
    invites: [],
    reports: [],
  };
}

async function loadDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    for (const key of ['users', 'objects', 'respects', 'sessions', 'invites', 'reports']) {
      if (!Array.isArray(db[key])) db[key] = [];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not read database, starting fresh:', error);
    }
    db = createEmptyDb();
    seedDb();
    await saveDbNow();
  }
  if (!db.meta.seededAt) {
    seedDb();
    await saveDbNow();
  }
  cleanupInvites();
  cleanupObjects();
  recalcAll();
}

function saveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDbNow().catch((error) => console.error('Save failed:', error));
  }, 120);
}

async function saveDbNow() {
  const tmp = `${DB_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fsp.rename(tmp, DB_FILE);
}

function findUserByUsername(username) {
  const needle = String(username || '').toLowerCase();
  return db.users.find((u) => u.usernameLower === needle);
}

function findUserById(userId) {
  return db.users.find((u) => u.id === userId);
}

function userName(userId) {
  return findUserById(userId)?.username || '已注销';
}

function publicUserBase(user) {
  const stats = userStats(user);
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
    invitedBy: user.invitedBy ? userName(user.invitedBy) : null,
    publicRecords: user.publicRecords !== false,
    banned: Boolean(user.bannedUntil && new Date(user.bannedUntil) > new Date()),
    bannedUntil: user.bannedUntil || null,
  };
}

function serializeUser(user, viewer = null) {
  const base = publicUserBase(user);
  return {
    ...base,
    isSelf: viewer?.id === user.id,
    isFollowing: Boolean(viewer && viewer.following?.includes(user.id)),
    followsYou: Boolean(viewer && user.following?.includes(viewer.id)),
    objectsCount: db.objects.filter((o) => o.ownerId === user.id && !o.removedAt).length,
  };
}

function objectLikeCount(objectId) {
  return db.respects.filter((r) => r.objectId === objectId).length;
}

function weekStartTime() {
  const today = dayKey();
  const [year, month, date] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return atLocal(keyAdd(today, -mondayOffset), 0).getTime();
}

function objectWeekCount(objectId) {
  const since = weekStartTime();
  return db.respects.filter(
    (r) => r.objectId === objectId && new Date(r.createdAt).getTime() >= since
  ).length;
}

function serializeObject(object, viewer = null) {
  const owner = findUserById(object.ownerId);
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
      ? {
          id: owner.id,
          username: owner.username,
          avatar: owner.avatar || null,
          level: userStats(owner).level,
        }
      : null,
    ownerId: object.ownerId,
    createdAt: object.createdAt,
    removedAt: object.removedAt || null,
    respects: objectLikeCount(object.id),
    weekRespects: objectWeekCount(object.id),
    isOwner,
    canEdit: Boolean(viewer && (isOwner || object.visibility === 'public')),
    canChangeVisibility: Boolean(isOwner),
    respectedToday: Boolean(
      viewer &&
        db.respects.some(
          (r) => r.userId === viewer.id && r.objectId === object.id && r.date === today
        )
    ),
    reportCount: db.reports.filter((r) => r.objectId === object.id && r.status === 'open').length,
  };
}

function respectDates(userId) {
  return [...new Set(db.respects.filter((r) => r.userId === userId).map((r) => r.date))].sort();
}

function computeStreaks(user) {
  const dates = respectDates(user.id);
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
      if (prev && dayDiff(prev, d) === 1) run += 1;
      else run = 1;
      longest = Math.max(longest, run);
      prev = d;
    }
    const last = dates[dates.length - 1];
    gap = Math.max(0, dayDiff(last, today) - 1);
  } else {
    const start = dayKey(new Date(user.createdAt));
    gap = Math.max(0, dayDiff(start, today) - 1);
  }

  // Longest completed run of days without respecting. The count begins after
  // the first recorded respect, so a brand-new member is not punished for the
  // days before they found their way here.
  const createdKey = dayKey(new Date(user.createdAt));
  const firstActive = dates[0] || null;
  let cursor = keyAdd(firstActive || createdKey, 1);
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

function userStats(user) {
  const total = db.respects.filter((r) => r.userId === user.id).length;
  const streaks = computeStreaks(user);
  const level = Math.max(user.level || 1, levelFrom({ ...streaks, total }));
  return {
    total,
    current: streaks.current,
    longest: streaks.longest,
    gap: streaks.gap,
    longestGap: streaks.longestGap,
    last: streaks.last,
    level,
    dates: streaks.dates,
  };
}

function recalcAll() {
  for (const user of db.users) {
    const total = db.respects.filter((r) => r.userId === user.id).length;
    const streaks = computeStreaks(user);
    user.level = Math.max(user.level || 1, levelFrom({ ...streaks, total }));
    user.totalRespects = total;
  }
}

function cleanupInvites() {
  const now = Date.now();
  db.invites = db.invites.filter((invite) => new Date(invite.expiresAt).getTime() > now);
}

function cleanupObjects() {
  const now = Date.now();
  let changed = false;
  for (const object of db.objects) {
    if (object.removedAt) continue;
    const age = now - new Date(object.createdAt).getTime();
    if (age > 5 * 86400000) {
      const count = db.respects.filter((r) => r.objectId === object.id).length;
      if (count < 5) {
        object.removedAt = nowIso();
        object.removedBy = 'system';
        object.removeReason = '创建 5 天内累计被敬畏少于 5 次，已自动下架';
        changed = true;
      }
    }
  }
  if (changed) {
    const removedIds = new Set(db.objects.filter((o) => o.removedBy === 'system').map((o) => o.id));
    db.reports = db.reports.filter((r) => !removedIds.has(r.objectId));
    saveDb();
  }
}

function purgeExpiredSessions() {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  if (db.sessions.length !== before) saveDb();
}

function createSession(user) {
  const session = {
    id: crypto.randomBytes(28).toString('hex'),
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
  };
  db.sessions.push(session);
  saveDb();
  return session;
}

// ---------------------------------------------------------------------------
// Seed content
// ---------------------------------------------------------------------------

function makeUser({ username, password, role = 'user', email = '', signature = '', daysAgo = 30, rootPoints = 0 }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: id('u_'),
    username,
    usernameLower: username.toLowerCase(),
    passwordSalt: salt,
    passwordHash: hash,
    email,
    signature,
    avatar: null,
    role,
    level: 1,
    totalRespects: 0,
    rootPoints,
    createdAt: atLocal(dayOffset(daysAgo), 9).toISOString(),
    invitedBy: null,
    registrationCode: null,
    following: [],
    followers: [],
    publicRecords: true,
    bannedUntil: null,
    banReason: '',
  };
}

function seedDb() {
  const owner = makeUser({
    username: '根号12',
    password: 'yspjx',
    role: 'owner',
    email: 'root12@awecean.site',
    signature: '',
    daysAgo: 0,
    rootPoints: 60,
  });

  db.users = [owner];
  db.objects = [];
  db.respects = [];
  db.invites = [
    {
      id: id('i_'),
      code: 'AW-2026',
      createdBy: owner.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + INVITE_HOURS * 3600000).toISOString(),
      usedBy: null,
      usedAt: null,
    },
  ];
  db.reports = [];
  db.sessions = [];
  db.meta.seededAt = nowIso();
  recalcAll();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function currentUser(req) {
  purgeExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.awecean_session;
  if (!token) return null;
  const session = db.sessions.find((s) => s.id === token);
  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;
  return findUserById(session.userId) || null;
}

function sessionCookie(session) {
  const maxAge = SESSION_DAYS * 86400;
  return `awecean_session=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie() {
  return 'awecean_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function assertActive(user) {
  if (!user) return;
  if (user.bannedUntil && new Date(user.bannedUntil) > new Date()) {
    throw new ApiError(
      403,
      `该账号已被封禁至 ${new Date(user.bannedUntil).toLocaleString('zh-CN', { timeZone: TZ })}`,
      'BANNED',
      { bannedUntil: user.bannedUntil, reason: user.banReason || '' }
    );
  }
}

function authUser(req) {
  const user = currentUser(req);
  if (!user) throw new ApiError(401, '请先登录', 'UNAUTHORIZED');
  assertActive(user);
  return user;
}

function permissions(user) {
  const stats = userStats(user);
  const isOwner = user.role === 'owner';
  const isPelican = user.role === 'pelican';
  const isSparrow = user.role === 'sparrow';
  const canInvite = isOwner || isPelican || isSparrow || stats.level >= 4;
  const inviteCost = isOwner || isPelican ? 0 : isSparrow ? 2 : 4;
  return {
    isOwner,
    isPelican,
    isSparrow,
    isAdmin: isOwner || isPelican || isSparrow,
    canInvite,
    inviteCost,
    canUnpublish: isOwner || isPelican,
    canReport: true,
    canManageRoles: isOwner,
    canBan: isOwner,
    dailyLimit: stats.level,
  };
}

function viewerPayload(user) {
  const stats = userStats(user);
  const today = dayKey();
  const todayRespects = db.respects.filter((r) => r.userId === user.id && r.date === today);
  const todayObjects = [...new Set(todayRespects.map((r) => r.objectId))];
  const perm = permissions(user);
  const openReports = db.reports.filter((r) => r.status === 'open');
  const inboxCount = perm.isOwner || perm.isPelican
    ? openReports.length
    : perm.isSparrow
      ? openReports.filter((r) => r.reporterId === user.id).length
      : 0;
  return {
    user: serializeUser(user, user),
    stats: {
      ...stats,
      level: stats.level,
      todayCount: todayObjects.length,
      todayLimit: stats.level,
      remaining: Math.max(0, stats.level - todayObjects.length),
      respectedToday: todayObjects.length > 0,
      todayObjectIds: todayObjects,
    },
    permissions: perm,
    cover: {
      hasRespectedToday: todayObjects.length > 0,
      date: today,
    },
    inboxCount,
    activeInvites: db.invites.filter(
      (i) => i.createdBy === user.id && !i.usedBy && new Date(i.expiresAt) > new Date()
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const RESERVED_NAMES = [
  '总管理员',
  '管理员',
  '官方',
  '系统',
  '帝企鹅',
  '鹈鹕',
  '麻雀',
  '敬畏官方',
  'admin',
  'root',
  'system',
  'official',
  'administrator',
];

const SENSITIVE_WORDS = [
  '色情',
  '裸聊',
  '约炮',
  '赌博',
  '毒品',
  '诈骗',
  '代开发票',
  '傻逼',
  '操你',
];

function validateUsername(username) {
  const value = String(username || '').trim();
  const chars = Array.from(value);
  if (chars.length < 2 || chars.length > 20) {
    throw new ApiError(400, '用户名长度需为 2–20 个字符', 'BAD_USERNAME');
  }
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(value)) {
    throw new ApiError(400, '用户名只能包含中文、英文字母、数字或下划线', 'BAD_USERNAME');
  }
  if (/^\d+$/.test(value)) {
    throw new ApiError(400, '用户名不能是纯数字', 'BAD_USERNAME');
  }
  const lower = value.toLowerCase();
  if (RESERVED_NAMES.some((item) => lower.includes(item.toLowerCase()))) {
    throw new ApiError(400, '该用户名包含保留词，请换一个', 'BAD_USERNAME');
  }
  if (SENSITIVE_WORDS.some((item) => lower.includes(item.toLowerCase()))) {
    throw new ApiError(400, '该用户名包含不适合的词语，请换一个', 'BAD_USERNAME');
  }
  return value;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6) throw new ApiError(400, '密码至少需要 6 位', 'BAD_PASSWORD');
  if (value.length > 128) throw new ApiError(400, '密码过长', 'BAD_PASSWORD');
  return value;
}

function validateInvite(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) throw new ApiError(400, '请填写邀请码', 'BAD_INVITE');
  const invite = db.invites.find((i) => i.code.toUpperCase() === value && !i.usedBy);
  if (!invite) throw new ApiError(400, '邀请码无效或已被使用', 'BAD_INVITE');
  if (new Date(invite.expiresAt) <= new Date()) {
    throw new ApiError(400, '邀请码已过期', 'BAD_INVITE');
  }
  return invite;
}

function consumeInvite(invite, user) {
  invite.usedBy = user.id;
  invite.usedAt = nowIso();
}

// ---------------------------------------------------------------------------
// Image uploads
// ---------------------------------------------------------------------------

async function saveImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new ApiError(400, '图片格式不正确', 'BAD_IMAGE');
  }
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new ApiError(400, '仅支持 JPG、PNG 或 WebP 图片', 'BAD_IMAGE');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new ApiError(413, '图片过大，请压缩后再上传', 'IMAGE_TOO_LARGE');
  }
  if (buffer.length < 32) throw new ApiError(400, '图片内容为空', 'BAD_IMAGE');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

function isUploadedUrl(url) {
  return typeof url === 'string' && /^\/(uploads|assets)\/[A-Za-z0-9._/-]+$/.test(url);
}

function sanitizeImageUrl(url) {
  if (!url) return null;
  if (!isUploadedUrl(url)) throw new ApiError(400, '图片地址不合法', 'BAD_IMAGE');
  return url;
}

// ---------------------------------------------------------------------------
// Avatar generation (deliberately independent from the cover artwork)
// ---------------------------------------------------------------------------

function avatarSvg(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  const palettes = [
    ['#E9E2D4', '#24322F', '#9D3F30'],
    ['#DCE5E2', '#1F3439', '#B36B4A'],
    ['#EAE0EA', '#332C3D', '#7E4B62'],
    ['#E4E7D8', '#2C3424', '#8B6A3E'],
    ['#DFE4EC', '#263142', '#496C8A'],
  ];
  const palette = palettes[hash[0] % palettes.length];
  const initial = Array.from(String(seed || '敬'))[0] || '敬';
  const rotation = (hash[1] % 40) - 20;
  const cx = 26 + (hash[2] % 12);
  const cy = 34 + (hash[3] % 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="${escapeXml(initial)}">
  <rect width="160" height="160" fill="${palette[0]}"/>
  <circle cx="${cx}" cy="${cy}" r="54" fill="none" stroke="${palette[1]}" stroke-opacity=".14"/>
  <circle cx="${160 - cx}" cy="${160 - cy}" r="72" fill="none" stroke="${palette[1]}" stroke-opacity=".1"/>
  <path d="M -20 ${110 + (hash[4] % 20)} Q 80 ${70 + (hash[5] % 30)} 180 ${124 + (hash[6] % 10)}" fill="none" stroke="${palette[1]}" stroke-opacity=".13" stroke-width="1.5"/>
  <g transform="rotate(${rotation} 80 84)">
    <rect x="43" y="30" width="74" height="74" fill="none" stroke="${palette[2]}" stroke-opacity=".55"/>
    <text x="80" y="82" text-anchor="middle" font-family="Songti SC, STSong, Noto Serif CJK SC, serif" font-size="42" fill="${palette[1]}">${escapeXml(initial)}</text>
  </g>
  <circle cx="126" cy="34" r="5" fill="${palette[2]}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// API: auth
// ---------------------------------------------------------------------------

async function handleLogin(req, res, body) {
  const username = cleanText(body.username, 40);
  const password = String(body.password || '');
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    throw new ApiError(400, '用户名或密码不正确', 'BAD_CREDENTIALS');
  }
  assertActive(user);
  const session = createSession(user);
  return sendJson(
    res,
    200,
    { ok: true, data: viewerPayload(user) },
    { 'Set-Cookie': sessionCookie(session) }
  );
}

async function handleRegister(req, res, body) {
  cleanupInvites();
  const username = validateUsername(body.username);
  if (findUserByUsername(username)) {
    throw new ApiError(409, '这个用户名已经被使用了', 'USERNAME_TAKEN');
  }
  const password = validatePassword(body.password);
  const invite = validateInvite(body.inviteCode);
  const email = cleanText(body.email, 120);
  if (!isEmail(email)) throw new ApiError(400, '邮箱格式不正确', 'BAD_EMAIL');
  const signature = cleanText(body.signature, 80);
  const { salt, hash } = hashPassword(password);
  const inviter = findUserById(invite.createdBy);
  const user = {
    id: id('u_'),
    username,
    usernameLower: username.toLowerCase(),
    passwordSalt: salt,
    passwordHash: hash,
    email,
    signature,
    avatar: null,
    role: 'user',
    level: 1,
    totalRespects: 0,
    rootPoints: 0,
    createdAt: nowIso(),
    invitedBy: inviter?.id || null,
    registrationCode: invite.code.toUpperCase(),
    following: [],
    followers: [],
    publicRecords: true,
    bannedUntil: null,
    banReason: '',
  };
  db.users.push(user);
  consumeInvite(invite, user);
  const session = createSession(user);
  saveDb();
  return sendJson(
    res,
    201,
    { ok: true, data: viewerPayload(user) },
    { 'Set-Cookie': sessionCookie(session) }
  );
}

async function handleReset(req, res, body) {
  cleanupInvites();
  const username = cleanText(body.username, 40);
  const user = findUserByUsername(username);
  if (!user) throw new ApiError(400, '账号不存在', 'NOT_FOUND');
  if (!user.registrationCode) {
    throw new ApiError(400, '该账号没有可验证的注册邀请记录，请联系管理员', 'NO_RESET');
  }
  const original = String(body.originalInvite || '').trim().toUpperCase();
  if (original !== user.registrationCode.toUpperCase()) {
    throw new ApiError(400, '原注册邀请码不正确', 'BAD_INVITE');
  }
  const freshInvite = validateInvite(body.newInviteCode);
  const password = validatePassword(body.password);
  const { salt, hash } = hashPassword(password);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  consumeInvite(freshInvite, user);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  saveDb();
  return ok(res, { message: '密码已重置，请重新登录' });
}

// ---------------------------------------------------------------------------
// API: objects
// ---------------------------------------------------------------------------

function objectPayload(object, viewer) {
  const payload = serializeObject(object, viewer);
  const owner = findUserById(object.ownerId);
  payload.ownerUser = owner ? serializeUser(owner, viewer) : null;
  return payload;
}

async function handleObjectCreate(req, res, body, user) {
  const name = cleanText(body.name, 40);
  if (!name) throw new ApiError(400, '请填写敬畏对象的名称', 'BAD_NAME');
  const quote = cleanText(body.quote, 160);
  if (!quote) throw new ApiError(400, '名言名句是必填的', 'BAD_QUOTE');
  const quoteSource = cleanText(body.quoteSource, 80);
  const intro = cleanText(body.intro, 1200);
  const mainImage = body.mainImage ? sanitizeImageUrl(body.mainImage) : null;
  const gallery = Array.isArray(body.gallery)
    ? body.gallery.slice(0, 5).map(sanitizeImageUrl).filter(Boolean)
    : [];
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  const object = {
    id: id('o_'),
    name,
    mainImage,
    gallery,
    intro,
    quote,
    quoteSource,
    visibility,
    ownerId: user.id,
    createdAt: nowIso(),
    removedAt: null,
    removedBy: null,
    removeReason: '',
  };
  db.objects.unshift(object);
  saveDb();
  return ok(res, objectPayload(object, user), 201);
}

async function handleObjectUpdate(req, res, object, user, body) {
  const isOwner = object.ownerId === user.id;
  if (!isOwner && object.visibility !== 'public') {
    throw new ApiError(403, '该敬畏对象是私有的，只有创建者可以修改', 'FORBIDDEN');
  }
  if (body.visibility && body.visibility !== object.visibility) {
    if (!isOwner) throw new ApiError(403, '只有创建者可以更改编辑权限', 'FORBIDDEN');
    if (!['public', 'private'].includes(body.visibility)) {
      throw new ApiError(400, '权限值不合法', 'BAD_VISIBILITY');
    }
    object.visibility = body.visibility;
  }
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
  if (body.mainImage !== undefined) {
    object.mainImage = body.mainImage ? sanitizeImageUrl(body.mainImage) : null;
  }
  if (body.gallery !== undefined) {
    object.gallery = Array.isArray(body.gallery)
      ? body.gallery.slice(0, 5).map(sanitizeImageUrl).filter(Boolean)
      : [];
  }
  object.updatedAt = nowIso();
  saveDb();
  return ok(res, objectPayload(object, user));
}

async function handleRespect(req, res, object, user) {
  if (object.removedAt) throw new ApiError(410, '这个敬畏对象已经下架', 'REMOVED');
  const stats = userStats(user);
  const today = dayKey();
  const already = db.respects.find(
    (r) => r.userId === user.id && r.objectId === object.id && r.date === today
  );
  if (already) throw new ApiError(409, '今天已经敬畏过 TA 了，明天再来吧', 'ALREADY_RESPECTED');
  const todayObjects = [
    ...new Set(
      db.respects.filter((r) => r.userId === user.id && r.date === today).map((r) => r.objectId)
    ),
  ];
  if (todayObjects.length >= stats.level) {
    throw new ApiError(
      429,
      `今天已敬畏 ${todayObjects.length} 位，达到 L${stats.level} 的每日限额`,
      'DAILY_LIMIT',
      { level: stats.level, limit: stats.level }
    );
  }
  const event = {
    id: id('r_'),
    userId: user.id,
    objectId: object.id,
    date: today,
    createdAt: nowIso(),
  };
  db.respects.push(event);
  user.rootPoints = (user.rootPoints || 0) + 1;
  user.totalRespects = (user.totalRespects || 0) + 1;
  const after = userStats(user);
  user.level = Math.max(user.level || 1, after.level);
  saveDb();
  return ok(res, {
    object: objectPayload(object, user),
    me: viewerPayload(user),
    gained: 1,
    message: `已向「${object.name}」表达敬畏`,
  });
}

// ---------------------------------------------------------------------------
// API: users & social
// ---------------------------------------------------------------------------

function sortUsers(users, sort) {
  const list = [...users];
  switch (sort) {
    case 'newest':
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case 'level':
      list.sort((a, b) => userStats(b).level - userStats(a).level || userStats(b).total - userStats(a).total);
      break;
    case 'followers':
      list.sort((a, b) => (b.followers?.length || 0) - (a.followers?.length || 0));
      break;
    case 'respects':
      list.sort((a, b) => userStats(b).total - userStats(a).total);
      break;
    case 'forget':
      list.sort((a, b) => userStats(b).longestGap - userStats(a).longestGap || userStats(b).gap - userStats(a).gap);
      break;
    default:
      list.sort((a, b) => userStats(b).total - userStats(a).total);
  }
  return list;
}

function sortObjects(objects, sort) {
  const list = [...objects];
  switch (sort) {
    case 'newest':
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case 'week':
      list.sort((a, b) => objectWeekCount(b.id) - objectWeekCount(a.id));
      break;
    case 'name':
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      break;
    default:
      list.sort((a, b) => objectLikeCount(b.id) - objectLikeCount(a.id));
  }
  return list;
}

function leaderboardPayload() {
  const activeUsers = db.users.filter(
    (u) => !(u.bannedUntil && new Date(u.bannedUntil) > new Date())
  );
  const byLevel = {};
  for (let level = 5; level >= 1; level -= 1) {
    const group = activeUsers
      .filter((u) => userStats(u).level === level)
      .sort((a, b) => {
        const sa = userStats(a);
        const sb = userStats(b);
        return sb.total - sa.total || sb.current - sa.current;
      })
      .slice(0, 10)
      .map((u) => serializeUser(u, null));
    byLevel[level] = group;
  }
  const topObjects = sortObjects(db.objects.filter((o) => !o.removedAt), 'hot')
    .slice(0, 10)
    .map((o) => serializeObject(o, null));
  const forgotten = activeUsers
    .filter((u) => {
      const s = userStats(u);
      return s.total > 0 && s.longestGap > 0;
    })
    .sort((a, b) => {
      const sa = userStats(a);
      const sb = userStats(b);
      return sb.longestGap - sa.longestGap || sb.gap - sa.gap;
    })
    .slice(0, 12)
    .map((u) => ({ ...serializeUser(u, null), forget: userStats(u) }));
  return { byLevel, topObjects, forgotten };
}

// ---------------------------------------------------------------------------
// API: admin
// ---------------------------------------------------------------------------

function serializeInvite(invite, viewer) {
  const creator = findUserById(invite.createdBy);
  const used = invite.usedBy ? findUserById(invite.usedBy) : null;
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
    canSee: viewer.id === invite.createdBy || viewer.role === 'owner',
  };
}

async function handleAdminUserUpdate(req, res, target, admin, body) {
  if (target.role === 'owner' && target.id !== admin.id) {
    throw new ApiError(403, '不能修改站长账号', 'FORBIDDEN');
  }
  if (target.id === admin.id) {
    throw new ApiError(400, '不能对自己执行此操作', 'SELF');
  }
  if (body.role !== undefined) {
    if (!['pelican', 'sparrow', 'user'].includes(body.role)) {
      throw new ApiError(400, '角色值不合法', 'BAD_ROLE');
    }
    target.role = body.role;
  }
  if (body.ban === false) {
    target.bannedUntil = null;
    target.banReason = '';
  } else if (body.days !== undefined) {
    const days = Number(body.days);
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      throw new ApiError(400, '封禁天数需在 1–3650 之间', 'BAD_BAN');
    }
    target.bannedUntil = new Date(Date.now() + days * 86400000).toISOString();
    target.banReason = cleanText(body.reason, 120);
    db.sessions = db.sessions.filter((s) => s.userId !== target.id);
  } else if (body.until !== undefined) {
    const until = new Date(body.until);
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      throw new ApiError(400, '封禁截止时间不合法', 'BAD_BAN');
    }
    target.bannedUntil = until.toISOString();
    target.banReason = cleanText(body.reason, 120);
    db.sessions = db.sessions.filter((s) => s.userId !== target.id);
  }
  saveDb();
  return ok(res, { user: serializeUser(target, admin), message: '成员状态已更新' });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, '请求内容过大', 'TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, '请求格式不正确', 'BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // Retire expired invitations and objects that never found an audience.
  cleanupInvites();
  cleanupObjects();

  // Public endpoints -----------------------------------------------------
  if (pathname === '/api/avatar' && method === 'GET') {
    const seed = url.searchParams.get('seed') || '敬';
    const svg = avatarSvg(seed);
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(svg);
  }

  if (pathname === '/api/health' && method === 'GET') {
    return ok(res, { status: 'ok', time: nowIso() });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    return handleLogin(req, res, await readBody(req));
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    return handleRegister(req, res, await readBody(req));
  }
  if (pathname === '/api/auth/reset' && method === 'POST') {
    return handleReset(req, res, await readBody(req));
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    db.sessions = db.sessions.filter((s) => s.id !== cookies.awecean_session);
    saveDb();
    return sendJson(res, 200, { ok: true, data: { message: '已退出' } }, { 'Set-Cookie': clearCookie() });
  }
  if (pathname === '/api/invites/check' && method === 'GET') {
    cleanupInvites();
    const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
    const invite = db.invites.find((i) => i.code.toUpperCase() === code && !i.usedBy);
    if (!invite || new Date(invite.expiresAt) <= new Date()) {
      return ok(res, { valid: false });
    }
    return ok(res, {
      valid: true,
      inviter: userName(invite.createdBy),
      expiresAt: invite.expiresAt,
    });
  }

  if (pathname === '/api/users/check' && method === 'GET') {
    const value = cleanText(url.searchParams.get('username'), 40);
    try {
      validateUsername(value);
      if (findUserByUsername(value)) {
        return ok(res, { available: false, reason: '这个用户名已经被使用了' });
      }
      return ok(res, { available: true, reason: '可以使用' });
    } catch (error) {
      return ok(res, { available: false, reason: error.message });
    }
  }

  const user = authUser(req);

  // Session ---------------------------------------------------------------
  if (pathname === '/api/me' && method === 'GET') {
    return ok(res, viewerPayload(user));
  }

  if (pathname === '/api/me' && method === 'PATCH') {
    const body = await readBody(req);
    if (body.signature !== undefined) user.signature = cleanText(body.signature, 80);
    if (body.email !== undefined) {
      const email = cleanText(body.email, 120);
      if (!isEmail(email)) throw new ApiError(400, '邮箱格式不正确', 'BAD_EMAIL');
      user.email = email;
    }
    if (body.avatar !== undefined) {
      user.avatar = body.avatar ? sanitizeImageUrl(body.avatar) : null;
    }
    if (body.publicRecords !== undefined) user.publicRecords = Boolean(body.publicRecords);
    saveDb();
    return ok(res, { me: viewerPayload(user), message: '资料已保存' });
  }

  if (pathname === '/api/me/password' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordSalt, user.passwordHash)) {
      throw new ApiError(400, '当前密码不正确', 'BAD_PASSWORD');
    }
    const next = validatePassword(body.newPassword);
    const { salt, hash } = hashPassword(next);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    saveDb();
    return ok(res, { message: '密码已更新' });
  }

  if (pathname === '/api/me/username' && method === 'POST') {
    const body = await readBody(req);
    const next = validateUsername(body.username);
    if (next.toLowerCase() === user.usernameLower) {
      throw new ApiError(400, '新用户名与当前相同', 'BAD_USERNAME');
    }
    if (findUserByUsername(next)) {
      throw new ApiError(409, '这个用户名已经被使用了', 'USERNAME_TAKEN');
    }
    if ((user.rootPoints || 0) < 5) {
      throw new ApiError(400, '修改用户名需要 5 个根号数', 'NOT_ENOUGH_ROOTS');
    }
    user.rootPoints -= 5;
    user.username = next;
    user.usernameLower = next.toLowerCase();
    saveDb();
    return ok(res, { me: viewerPayload(user), message: '用户名已修改，消耗 5 个根号数' });
  }

  if (pathname === '/api/me/records' && method === 'GET') {
    const records = db.respects
      .filter((r) => r.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 60)
      .map((r) => {
        const object = db.objects.find((o) => o.id === r.objectId);
        return {
          id: r.id,
          date: r.date,
          createdAt: r.createdAt,
          object: object
            ? { id: object.id, name: object.name, mainImage: object.mainImage, quote: object.quote }
            : null,
        };
      });
    return ok(res, { records });
  }

  // Photos ----------------------------------------------------------------
  if (pathname === '/api/upload' && method === 'POST') {
    const body = await readBody(req);
    const imageUrl = await saveImageDataUrl(body.dataUrl);
    return ok(res, { url: imageUrl }, 201);
  }

  // Home ------------------------------------------------------------------
  if (pathname === '/api/home' && method === 'GET') {
    const visible = db.objects.filter((o) => !o.removedAt);
    const featured = sortObjects(visible, 'hot').slice(0, 4);
    const fresh = sortObjects(visible, 'newest').slice(0, 4);
    const topObjects = sortObjects(visible, 'hot').slice(0, 5).map((o) => serializeObject(o, user));
    const boards = leaderboardPayload();
    const topUsers = [];
    for (let level = 5; level >= 1; level -= 1) {
      if (boards.byLevel[level]?.length) {
        topUsers.push(...boards.byLevel[level].slice(0, 3));
        if (topUsers.length >= 5) break;
      }
    }
    return ok(res, {
      featured: featured.map((o) => serializeObject(o, user)),
      fresh: fresh.map((o) => serializeObject(o, user)),
      topObjects,
      topUsers: topUsers.slice(0, 5),
      stats: {
        users: db.users.length,
        objects: visible.length,
        todayRespects: new Set(
          db.respects.filter((r) => r.date === dayKey()).map((r) => `${r.userId}:${r.objectId}`)
        ).size,
      },
      calendar: userStats(user).dates.slice(-31),
      me: viewerPayload(user),
    });
  }

  // Objects ---------------------------------------------------------------
  if (pathname === '/api/objects' && method === 'GET') {
    cleanupObjects();
    const q = cleanText(url.searchParams.get('q'), 60).toLowerCase();
    const sort = url.searchParams.get('sort') || 'hot';
    let list = db.objects.filter((o) => !o.removedAt);
    if (q) {
      list = list.filter((o) => {
        const haystack = [o.name, o.intro, o.quote, o.quoteSource].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    list = sortObjects(list, sort);
    return ok(res, {
      objects: list.slice(0, 60).map((o) => serializeObject(o, user)),
      total: list.length,
      query: q,
      sort,
    });
  }

  if (pathname === '/api/objects' && method === 'POST') {
    return handleObjectCreate(req, res, await readBody(req), user);
  }

  const objectMatch = /^\/api\/objects\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (objectMatch) {
    const object = db.objects.find((o) => o.id === objectMatch[1]);
    if (!object) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    if (object.removedAt) {
      const canSee = user.role === 'owner' || user.role === 'pelican' || object.ownerId === user.id;
      if (!canSee) throw new ApiError(410, '这个敬畏对象已经下架', 'REMOVED');
    }
    if (method === 'GET') {
      return ok(res, objectPayload(object, user));
    }
    if (method === 'PATCH') {
      return handleObjectUpdate(req, res, object, user, await readBody(req));
    }
    if (method === 'DELETE') {
      if (object.ownerId !== user.id && user.role !== 'owner') {
        throw new ApiError(403, '只有创建者或站长可以删除', 'FORBIDDEN');
      }
      object.removedAt = nowIso();
      object.removedBy = user.id;
      object.removeReason = '创建者删除';
      db.reports = db.reports.filter((r) => r.objectId !== object.id);
      saveDb();
      return ok(res, { message: '已删除' });
    }
  }

  const respectMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/respect$/.exec(pathname);
  if (respectMatch && method === 'POST') {
    const object = db.objects.find((o) => o.id === respectMatch[1]);
    if (!object) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    return handleRespect(req, res, object, user);
  }

  const reportMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/report$/.exec(pathname);
  if (reportMatch && method === 'POST') {
    const object = db.objects.find((o) => o.id === reportMatch[1]);
    if (!object || object.removedAt) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    const body = await readBody(req);
    const reason = cleanText(body.reason, 300);
    if (reason.length < 5) throw new ApiError(400, '请填写至少 5 个字的举报说明', 'BAD_REPORT');
    const duplicate = db.reports.find(
      (r) => r.objectId === object.id && r.reporterId === user.id && r.status === 'open'
    );
    if (duplicate) throw new ApiError(409, '你已经举报过这个对象，管理员正在处理', 'DUPLICATE_REPORT');
    const report = {
      id: id('p_'),
      objectId: object.id,
      reporterId: user.id,
      reason,
      createdAt: nowIso(),
      status: 'open',
    };
    db.reports.push(report);
    saveDb();
    return ok(res, { message: '举报已送达鹈鹕管理员与帝企鹅管理员' }, 201);
  }

  const removeMatch = /^\/api\/objects\/([A-Za-z0-9_]+)\/remove$/.exec(pathname);
  if (removeMatch && method === 'POST') {
    if (!['owner', 'pelican'].includes(user.role)) {
      throw new ApiError(403, '只有帝企鹅或鹈鹕管理员可以下架内容', 'FORBIDDEN');
    }
    const object = db.objects.find((o) => o.id === removeMatch[1]);
    if (!object) throw new ApiError(404, '敬畏对象不存在', 'NOT_FOUND');
    const body = await readBody(req);
    object.removedAt = nowIso();
    object.removedBy = user.id;
    object.removeReason = cleanText(body.reason, 200) || '管理员下架';
    db.reports = db.reports.filter((r) => r.objectId !== object.id);
    saveDb();
    return ok(res, { message: '内容已下架，相关举报已一并处理' });
  }

  // Users -----------------------------------------------------------------
  if (pathname === '/api/users' && method === 'GET') {
    const q = cleanText(url.searchParams.get('q'), 40).toLowerCase();
    const sort = url.searchParams.get('sort') || 'respects';
    let list = db.users.filter(
      (u) => !(u.bannedUntil && new Date(u.bannedUntil) > new Date())
    );
    if (q) list = list.filter((u) => u.usernameLower.includes(q));
    list = sortUsers(list, sort);
    return ok(res, {
      users: list.slice(0, 60).map((u) => serializeUser(u, user)),
      total: list.length,
      query: q,
      sort,
    });
  }

  if (pathname === '/api/users/me/following' && method === 'GET') {
    const list = user.following
      .map((uid) => findUserById(uid))
      .filter(Boolean)
      .map((u) => serializeUser(u, user));
    return ok(res, { users: list });
  }

  const connectionMatch = /^\/api\/users\/([A-Za-z0-9_]+)\/connections$/.exec(pathname);
  if (connectionMatch && method === 'GET') {
    const target = findUserById(connectionMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    const type = url.searchParams.get('type') === 'followers' ? 'followers' : 'following';
    const list = (target[type] || [])
      .map((uid) => findUserById(uid))
      .filter(Boolean)
      .map((u) => serializeUser(u, user));
    return ok(res, { users: list, type });
  }

  const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
  if (userMatch && method === 'GET') {
    const key = decodeURIComponent(userMatch[1]);
    const target = findUserById(key) || findUserByUsername(key);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    const stats = userStats(target);
    const created = db.objects
      .filter((o) => o.ownerId === target.id && !o.removedAt)
      .map((o) => serializeObject(o, user));
    const canSeeRecords = target.publicRecords !== false || target.id === user.id;
    const records = canSeeRecords
      ? db.respects
          .filter((r) => r.userId === target.id)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 30)
          .map((r) => {
            const object = db.objects.find((o) => o.id === r.objectId);
            return {
              id: r.id,
              date: r.date,
              createdAt: r.createdAt,
              object: object
                ? { id: object.id, name: object.name, mainImage: object.mainImage, quote: object.quote }
                : null,
            };
          })
      : [];
    const following = target.following
      .map((uid) => findUserById(uid))
      .filter(Boolean)
      .map((u) => serializeUser(u, user));
    const followers = target.followers
      .map((uid) => findUserById(uid))
      .filter(Boolean)
      .map((u) => serializeUser(u, user));
    return ok(res, {
      user: {
        ...serializeUser(target, user),
        stats: {
          ...stats,
          todayLimit: stats.level,
        },
        recordsVisible: canSeeRecords,
        calendar: stats.dates.slice(-42),
        createdObjects: created,
        recentRecords: records,
        followingList: following,
        followersList: followers,
      },
    });
  }

  const followMatch = /^\/api\/users\/([A-Za-z0-9_]+)\/follow$/.exec(pathname);
  if (followMatch && method === 'POST') {
    const target = findUserById(followMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    if (target.id === user.id) throw new ApiError(400, '不能关注自己', 'SELF_FOLLOW');
    if (target.bannedUntil && new Date(target.bannedUntil) > new Date()) {
      throw new ApiError(403, '该账号已被封禁', 'BANNED');
    }
    const following = user.following || [];
    const index = following.indexOf(target.id);
    let followed;
    if (index === -1) {
      following.push(target.id);
      target.followers = target.followers || [];
      if (!target.followers.includes(user.id)) target.followers.push(user.id);
      followed = true;
    } else {
      following.splice(index, 1);
      target.followers = (target.followers || []).filter((uid) => uid !== user.id);
      followed = false;
    }
    user.following = following;
    saveDb();
    return ok(res, {
      followed,
      message: followed ? `已关注 ${target.username}` : `已取消关注 ${target.username}`,
      user: serializeUser(target, user),
    });
  }

  // Leaderboards ----------------------------------------------------------
  if (pathname === '/api/leaderboards' && method === 'GET') {
    return ok(res, leaderboardPayload());
  }

  // Invites ---------------------------------------------------------------
  if (pathname === '/api/invites' && method === 'GET') {
    const perm = permissions(user);
    let invites = db.invites.filter(
      (i) => i.createdBy === user.id || (perm.isOwner && url.searchParams.get('all') === '1')
    );
    invites = invites
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((i) => serializeInvite(i, user));
    return ok(res, {
      invites,
      permissions: perm,
      rootPoints: user.rootPoints || 0,
    });
  }

  if (pathname === '/api/invites' && method === 'POST') {
    cleanupInvites();
    const perm = permissions(user);
    if (!perm.canInvite) {
      throw new ApiError(403, 'L4 及以上用户或管理员才能发放邀请码', 'FORBIDDEN');
    }
    const cost = perm.inviteCost;
    if ((user.rootPoints || 0) < cost) {
      throw new ApiError(400, `发放邀请码需要 ${cost} 个根号数`, 'NOT_ENOUGH_ROOTS');
    }
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
    db.invites.push(invite);
    saveDb();
    return ok(
      res,
      {
        invite: serializeInvite(invite, user),
        rootPoints: user.rootPoints,
        message: `邀请码已生成，${INVITE_HOURS} 小时后自动失效`,
      },
      201
    );
  }

  // Admin -----------------------------------------------------------------
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const perm = permissions(user);
    if (!perm.isAdmin) throw new ApiError(403, '无权访问管理后台', 'FORBIDDEN');
    const users = db.users
      .map((u) => {
        const payload = serializeUser(u, user);
        return {
          ...payload,
          email: u.email || '',
          rootPoints: u.rootPoints || 0,
          banReason: u.banReason || '',
          stats: userStats(u),
        };
      })
      .sort((a, b) => {
        const rank = { owner: 0, pelican: 1, sparrow: 2, user: 3 };
        return rank[a.role] - rank[b.role] || b.level - a.level;
      });
    const reports = db.reports
      .filter((r) => perm.isOwner || perm.isPelican || r.reporterId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((r) => {
        const object = db.objects.find((o) => o.id === r.objectId);
        return {
          ...r,
          object: object
            ? {
                id: object.id,
                name: object.name,
                mainImage: object.mainImage,
                removedAt: object.removedAt,
              }
            : null,
          reporter: userName(r.reporterId),
        };
      });
    const invites = perm.isOwner
      ? db.invites
          .slice()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((i) => serializeInvite(i, user))
      : [];
    return ok(res, {
      permissions: perm,
      users,
      reports,
      invites,
      stats: {
        users: db.users.length,
        objects: db.objects.filter((o) => !o.removedAt).length,
        respects: db.respects.length,
        reports: reports.filter((r) => r.status === 'open').length,
        invites: db.invites.filter((i) => !i.usedBy).length,
      },
    });
  }

  const adminUserMatch = /^\/api\/admin\/users\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (adminUserMatch && method === 'PATCH') {
    if (user.role !== 'owner') throw new ApiError(403, '只有帝企鹅管理员可以管理成员', 'FORBIDDEN');
    const target = findUserById(adminUserMatch[1]);
    if (!target) throw new ApiError(404, '用户不存在', 'NOT_FOUND');
    return handleAdminUserUpdate(req, res, target, user, await readBody(req));
  }

  const adminReportMatch = /^\/api\/admin\/reports\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (adminReportMatch && method === 'POST') {
    if (!['owner', 'pelican'].includes(user.role)) {
      throw new ApiError(403, '只有帝企鹅或鹈鹕管理员可以处理举报', 'FORBIDDEN');
    }
    const report = db.reports.find((r) => r.id === adminReportMatch[1]);
    if (!report) throw new ApiError(404, '举报不存在', 'NOT_FOUND');
    const body = await readBody(req);
    if (body.action === 'remove') {
      const object = db.objects.find((o) => o.id === report.objectId);
      if (object) {
        object.removedAt = nowIso();
        object.removedBy = user.id;
        object.removeReason = cleanText(body.reason, 200) || '举报核实后下架';
      }
      db.reports = db.reports.filter((r) => r.objectId !== report.objectId);
      saveDb();
      return ok(res, { message: '已下架内容，举报记录已清除' });
    }
    if (body.action === 'dismiss') {
      db.reports = db.reports.filter((r) => r.id !== report.id);
      saveDb();
      return ok(res, { message: '举报已处理并移除' });
    }
    throw new ApiError(400, '未知的处理方式', 'BAD_ACTION');
  }

  throw new ApiError(404, '接口不存在', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return fail(res, 400, '路径不正确', 'BAD_PATH');
  }
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, 403, '禁止访问', 'FORBIDDEN');

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    const ext = path.extname(pathname);
    if (!ext && req.method === 'GET') {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
  }

  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    const isCode = ['.css', '.js', '.mjs'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHtml || isCode ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'same-origin',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof ApiError) {
        return fail(res, error.status, error.message, error.code, error.details);
      }
      console.error('API error:', error);
      return fail(res, 500, '服务器开小差了，请稍后再试', 'SERVER_ERROR');
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return fail(res, 405, '不支持的请求方法', 'METHOD_NOT_ALLOWED');
  }
  return serveStatic(req, res, url);
});

loadDb()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Awecean running at http://${HOST}:${PORT}`);
      console.log(`Data file: ${DB_FILE}`);
    });
  })
  .catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  try {
    if (saveTimer) clearTimeout(saveTimer);
    await saveDbNow();
  } finally {
    process.exit(0);
  }
});
