class SafeHtml {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return value instanceof SafeHtml ? value : new SafeHtml(value);
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderValue(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value == null || value === false) return '';
  return esc(value);
}

/**
 * Tagged template that escapes every interpolation unless it is SafeHtml.
 * Usage: html`<p>${user.name}</p>`.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}

export function setHtml(target, value) {
  target.innerHTML = value instanceof SafeHtml ? value.value : String(value);
}

export function prettyNumber(n) {
  const value = Number(n) || 0;
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`;
  return String(value);
}

export function fmtDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(date);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 0) return '刚刚';
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return fmtDate(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function dayGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早安';
  if (hour < 12) return '上午好';
  if (hour < 14) return '午安';
  if (hour < 18) return '下午好';
  if (hour < 23) return '晚上好';
  return '夜深了';
}

export function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function avatarUrl(user) {
  if (!user) return '/api/avatar?seed=Awecean';
  if (user.avatar) return user.avatar;
  return `/api/avatar?seed=${encodeURIComponent(user.username || 'Awecean')}`;
}

export function firstChar(name) {
  return Array.from(String(name || 'A'))[0] || 'A';
}

export const ROLE_NAMES = {
  owner: '帝企鹅管理员',
  pelican: '鹈鹕管理员',
  sparrow: '麻雀管理员',
  user: '成员',
};

export function roleName(role) {
  return ROLE_NAMES[role] || '成员';
}

export function objectTone(name) {
  const tones = [
    ['#2d454b', '#17211f'],
    ['#6c5140', '#2f241d'],
    ['#3b4a45', '#17201e'],
    ['#5b3d3b', '#241716'],
    ['#56534a', '#24231f'],
    ['#3c4857', '#171e27'],
  ];
  let sum = 0;
  for (const ch of String(name || '敬')) sum += ch.codePointAt(0);
  return tones[sum % tones.length];
}

export function compressImage(file, { maxSize = 1600, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    if (file.size > 18 * 1024 * 1024) {
      reject(new Error('图片超过 18MB，请先压缩'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const longest = Math.max(img.width, img.height);
        const scale = longest > maxSize ? maxSize / longest : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

export function debounce(fn, wait = 260) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function parseQuery(search = window.location.search) {
  return Object.fromEntries(new URLSearchParams(search).entries());
}

export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

export function timeLeft(value) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return '已失效';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) return `剩余 ${Math.floor(hours / 24)} 天`;
  if (hours >= 1) return `剩余 ${hours} 小时 ${minutes} 分`;
  return `剩余 ${Math.max(1, minutes)} 分钟`;
}

export function daysBetweenLabel(days) {
  if (!days) return '今天';
  return `${days} 天`;
}

export function localDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDaysKey(key, amount) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + amount));
  return date.toISOString().slice(0, 10);
}

export function objectPath(object) {
  return `/o/${object.id}`;
}

export function userPath(user) {
  return `/u/${encodeURIComponent(user.username)}`;
}

export function isMobile() {
  return window.matchMedia('(max-width: 760px)').matches;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
