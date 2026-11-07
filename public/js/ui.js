import {
  avatarUrl,
  esc,
  firstChar,
  fmtDate,
  fmtDateTime,
  html,
  localDayKey,
  objectPath,
  objectTone,
  prettyNumber,
  raw,
  roleName,
  timeAgo,
  userPath,
} from './utils.js';
import { icon } from './icons.js';

export const NAV_ITEMS = [
  { key: 'home', href: '/cover', label: '首页', icon: 'home' },
  { key: 'explore', href: '/explore', label: '发现', icon: 'compass' },
  { key: 'leaderboard', href: '/leaderboard', label: '排行榜', icon: 'trophy' },
  { key: 'people', href: '/people', label: '寻人', icon: 'users' },
];

export function brandMark(size = 'normal') {
  return html`<span class="brand-mark brand-mark--${size}" aria-hidden="true">
    <img src="/assets/logo.png" alt="" loading="eager" decoding="async" />
  </span>`;
}

export function brand() {
  return html`<a class="brand" href="/cover" aria-label="Awecean · 返回封面">
    ${brandMark()}
    <span class="brand-text"><span class="brand-cn">Awecean</span></span>
  </a>`;
}

export function avatar(user, size = 40, extraClass = '') {
  const name = typeof user === 'string' ? user : user?.username || '用户';
  const src = typeof user === 'string' ? `/api/avatar?seed=${encodeURIComponent(user)}` : avatarUrl(user);
  return html`<span class="avatar ${extraClass}" style="--avatar-size:${size}px">
    <img src="${src}" alt="${name}的头像" width="${size}" height="${size}" loading="lazy" decoding="async" />
  </span>`;
}

export function levelPill(level) {
  return html`<span class="level-pill level-pill--${level}">
    <span class="level-pill__dot"></span>L${level}
  </span>`;
}

export function roleBadge(user) {
  if (!user) return '';
  if (user.role === 'owner') {
    return html`<span class="role-badge role-badge--owner">${icon('crown', { size: 12 })}帝企鹅</span>`;
  }
  if (user.role === 'pelican') {
    return html`<span class="role-badge role-badge--pelican">${icon('shield', { size: 12 })}鹈鹕</span>`;
  }
  if (user.role === 'sparrow') {
    return html`<span class="role-badge role-badge--sparrow">${icon('feather', { size: 12 })}麻雀</span>`;
  }
  return '';
}

export function identityLine(user, { compact = false } = {}) {
  if (!user) return '';
  return html`<span class="identity-line">
    ${levelPill(user.level || 1, { showName: !compact })} ${roleBadge(user)}
  </span>`;
}

export function layout(content, { me, active = 'home' } = {}) {
  const user = me?.user;
  const admin = me?.permissions?.isAdmin;
  const sidebarItems = [
    ...NAV_ITEMS.slice(0, 2),
    { key: 'create', href: '/create', label: '创建', icon: 'plus' },
    ...NAV_ITEMS.slice(2),
    ...(user ? [{ key: 'profile', href: userPath(user), label: '我的', icon: 'user' }] : []),
    { key: 'settings', href: '/settings', label: '设置', icon: 'settings' },
    ...(admin ? [{ key: 'admin', href: '/admin', label: '管理台', icon: 'shield' }] : []),
  ];

  const sidebarNav = sidebarItems.map(
    (item) => html`<a class="sidebar__link ${active === item.key ? 'is-active' : ''}" href="${item.href}">
      <span class="sidebar__icon">${icon(item.icon, { size: 18 })}</span>
      <span>${item.label}</span>
    </a>`
  );

  const dockItems = [
    NAV_ITEMS[0],
    NAV_ITEMS[1],
    { key: 'create', href: '/create', label: '创建', icon: 'plus', center: true },
    NAV_ITEMS[2],
    {
      key: 'profile',
      href: user ? userPath(user) : '/cover',
      label: '我的',
      icon: 'user',
    },
  ];
  const mobileNav = dockItems.map(
    (item) => html`<a class="dock__item ${item.center ? 'dock__item--create' : ''} ${active === item.key || (item.key === 'profile' && active === 'profile') ? 'is-active' : ''}" href="${item.href}">
      <span class="dock__icon">${icon(item.icon, { size: item.center ? 24 : 21 })}</span>
      <span class="dock__label">${item.label}</span>
    </a>`
  );

  return html`<div class="app-shell">
    <aside class="sidebar" aria-label="主要导航">
      <div class="sidebar__brand">${brand()}</div>
      <nav class="sidebar__nav">${sidebarNav}</nav>
      ${user
        ? html`<div class="sidebar__foot">
            <a class="sidebar__account" href="${userPath(user)}">
              ${avatar(user, 38)}
              <span class="sidebar__account-text">
                <strong>${user.username}</strong>
                <small>${roleName(user.role)}</small>
              </span>
            </a>
            <button class="sidebar__logout" type="button" data-logout aria-label="退出登录">
              ${icon('logout', { size: 16 })}
            </button>
          </div>`
        : ''}
    </aside>

    <div class="workbench">
      <header class="topbar">
        <div class="topbar__inner">
          <div class="topbar__left">${brand()}</div>
          <form class="topbar__search-form" action="/people" method="get" role="search">
            ${icon('search', { size: 17 })}
            <input name="q" type="search" placeholder="搜索用户" aria-label="搜索用户" autocomplete="off" />
          </form>
          <a class="icon-btn topbar__search-mobile" href="/people" aria-label="搜索">${icon('search', { size: 19 })}</a>
          <div class="topbar__actions">
            <a class="topbar__create" href="/create">${icon('plus', { size: 15 })}<span>创建</span></a>
            ${admin
              ? html`<a class="icon-btn icon-btn--badge topbar__bell" href="/admin?tab=reports" aria-label="管理台通知">
                  ${icon('bell', { size: 19 })}
                  ${me?.inboxCount ? html`<span class="icon-btn__dot">${me.inboxCount > 9 ? '9+' : me.inboxCount}</span>` : ''}
                </a>`
              : ''}
            <a class="icon-btn topbar__settings" href="/settings" aria-label="设置">${icon('settings', { size: 18 })}</a>
            ${user ? html`<a class="topbar__avatar" href="${userPath(user)}" aria-label="我的主页">${avatar(user, 34)}</a>` : ''}
          </div>
        </div>
      </header>

      <main class="page" id="page">${content}</main>
    </div>

    <nav class="mobile-dock" aria-label="移动端导航">${mobileNav}</nav>
  </div>`;
}

function activeLabel(active) {
  const map = {
    home: '首页',
    explore: '探索',
    leaderboard: '排行榜',
    people: '寻人',
    settings: '设置',
    profile: '个人主页',
    admin: '管理台',
    object: '敬畏对象',
    create: '创建',
  };
  return map[active] || 'Awecean';
}

export function pageHead({ eyebrow = '', title, description = '', actions = '', className = '', center = false }) {
  return html`<header class="page-head ${center ? 'page-head--center' : ''} ${className}">
    <div class="page-head__text">
      ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${title}</h1>
      ${description ? html`<p class="page-head__desc">${description}</p>` : ''}
    </div>
    ${actions ? html`<div class="page-head__actions">${actions}</div>` : ''}
  </header>`;
}

export function sectionHead({ title, sub = '', link = '', linkLabel = '查看全部', className = '' }) {
  return html`<div class="section-head ${className}">
    <div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
    ${link ? html`<a class="text-link" href="${link}">${linkLabel}${icon('arrow-right', { size: 15 })}</a>` : ''}
  </div>`;
}

export function objectCard(object, { variant = 'default', showOwner = true } = {}) {
  const hasImage = Boolean(object.mainImage);
  const [from, to] = objectTone(object.name);
  return html`<a class="object-card object-card--${variant} ${hasImage ? '' : 'is-text'}" href="${objectPath(object)}" data-object-card>
    <div class="object-card__media" style="--tone-a:${from};--tone-b:${to}">
      ${hasImage
        ? html`<img src="${object.mainImage}" alt="${object.name}" loading="lazy" decoding="async" />`
        : html`<div class="object-card__texture"><span>${firstChar(object.name)}</span><i></i></div>`}
      <span class="object-card__badge">${object.weekRespects ? html`本周 ${object.weekRespects}` : html`新近`}</span>
      ${object.visibility === 'private' ? html`<span class="object-card__private">${icon('lock', { size: 11 })} 私有</span>` : ''}
    </div>
    <div class="object-card__body">
      <div class="object-card__heading">
        <h3>${object.name}</h3>
        <span class="object-card__hearts">${icon('heart', { size: 12 })} ${prettyNumber(object.respects)}</span>
      </div>
      <div class="object-card__meta">
        ${showOwner && object.owner
          ? html`<span class="object-card__owner">${avatar(object.owner, 18)} ${object.owner.username}</span>`
          : html`<span>${icon('feather', { size: 12 })} 值得被记住</span>`}
        <span class="object-card__week">${object.weekRespects ? `本周 +${object.weekRespects}` : '刚刚出现'}</span>
      </div>
    </div>
  </a>`;
}

export function objectRow(object, rank) {
  return html`<li class="object-row">
    <span class="object-row__rank">${String(rank).padStart(2, '0')}</span>
    <a class="object-row__link" href="${objectPath(object)}">
      <span class="object-row__thumb" style="--tone-a:${objectTone(object.name)[0]};--tone-b:${objectTone(object.name)[1]}">
        ${object.mainImage ? html`<img src="${object.mainImage}" alt="" loading="lazy" />` : firstChar(object.name)}
      </span>
      <span class="object-row__text"><strong>${object.name}</strong><small>${object.weekRespects ? `本周 +${object.weekRespects}` : '公开对象'}</small></span>
      <span class="object-row__count"><strong>${prettyNumber(object.respects)}</strong><small>次</small></span>
      ${icon('chevron-right', { size: 16 })}
    </a>
  </li>`;
}

export function userCard(user, { viewerId = null } = {}) {
  const followed = user.isFollowing;
  return html`<article class="user-card">
    <a class="user-card__link" href="${userPath(user)}" aria-label="查看 ${user.username} 的主页">
      ${avatar(user, 58, 'user-card__avatar')}
      <div class="user-card__head">
        <h3>${user.username}</h3>
        ${identityLine(user, { compact: true })}
      </div>
      <p class="user-card__bio">${user.signature || '这个人还没有写下签名。'}</p>
      <div class="user-card__stats">
        <span><strong>${prettyNumber(user.totalRespects)}</strong>累计</span>
        <span><strong>${user.currentStreak}</strong>连续</span>
        <span><strong>${prettyNumber(user.followerCount)}</strong>粉丝</span>
      </div>
    </a>
    ${viewerId && viewerId !== user.id
      ? html`<button class="follow-btn ${followed ? 'is-following' : ''}" type="button" data-follow="${user.id}">
          ${icon(followed ? 'user-check' : 'user-plus', { size: 14 })}<span>${followed ? '已关注' : '关注'}</span>
        </button>`
      : ''}
  </article>`;
}

export function rankRow(user, rank, { metric = 'total' } = {}) {
  const value =
    metric === 'forget'
      ? `${user.longestForgetDays}`
      : metric === 'level'
        ? `L${user.level}`
        : `${prettyNumber(user.totalRespects)}`;
  return html`<li class="rank-row">
    <span class="rank-row__no ${rank <= 3 ? `is-top rank-${rank}` : ''}">${String(rank).padStart(2, '0')}</span>
    <a class="rank-row__person" href="${userPath(user)}">
      ${avatar(user, 38)}
      <span class="rank-row__name"><strong>${user.username}</strong><small>${levelPill(user.level)} ${user.currentStreak ? `连续 ${user.currentStreak} 天` : '未连续'}</small></span>
    </a>
    <span class="rank-row__metric"><strong>${value}</strong><small>${metric === 'forget' ? '最长忘日' : metric === 'level' ? '等级' : '次敬畏'}</small></span>
  </li>`;
}

export function statBlock(value, label, { accent = false, iconName = '' } = {}) {
  return html`<div class="stat-block ${accent ? 'is-accent' : ''}">
    ${iconName ? html`<span class="stat-block__icon">${icon(iconName, { size: 15 })}</span>` : ''}
    <strong>${value}</strong><span>${label}</span>
  </div>`;
}

export function emptyState({ title = '这里什么都没有呀', action = '' }) {
  return html`<div class="empty-state">
    <img class="empty-state__image" src="/assets/empty-state.png" alt="${title}" loading="lazy" decoding="async" />
    ${action || ''}
  </div>`;
}

export function loadingState(label = '正在抵达') {
  return html`<div class="loading-state"><span class="loader-ring"></span><span>${label}</span></div>`;
}

export function skeletonGrid(count = 6) {
  return html`<div class="skeleton-grid">${Array.from(
    { length: count },
    () => html`<div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`
  )}</div>`;
}

export function toast(message, type = 'info') {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  node.innerHTML = `<span class="toast__icon">${icon(iconName, { size: 16 }).value}</span><span>${esc(message)}</span>`;
  stack.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 300);
  }, type === 'error' ? 4200 : 3200);
}

export function followButton(user, { small = false } = {}) {
  if (!user) return '';
  return html`<button class="follow-btn ${small ? 'follow-btn--small' : ''} ${user.isFollowing ? 'is-following' : ''}" type="button" data-follow="${user.id}">
    ${icon(user.isFollowing ? 'user-check' : 'user-plus', { size: 14 })}<span>${user.isFollowing ? '已关注' : '关注'}</span>
  </button>`;
}

export function quotePanel(text, author = '', { source = '', compact = false } = {}) {
  return html`<figure class="quote-panel ${compact ? 'quote-panel--compact' : ''}">
    <span class="quote-panel__mark">“</span>
    <blockquote>${text}</blockquote>
    <figcaption><span></span>${author}${source ? html` · ${source}` : ''}</figcaption>
  </figure>`;
}

export function progressRing(value, total, { size = 86, label = '' } = {}) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  return html`<div class="progress-ring" style="--ring-size:${size}px">
    <svg viewBox="0 0 92 92" aria-hidden="true">
      <circle cx="46" cy="46" r="${radius}" class="progress-ring__track"/>
      <circle cx="46" cy="46" r="${radius}" class="progress-ring__fill" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
    </svg>
    <span class="progress-ring__center"><strong>${value}</strong><small>${label || `/ ${total}`}</small></span>
  </div>`;
}

export function respectCalendar(dates = [], { weeks = 10, compact = false } = {}) {
  const set = new Set(dates);
  const today = localDayKey();
  const [year, month, dateNumber] = today.split('-').map(Number);
  const todayDate = new Date(Date.UTC(year, month - 1, dateNumber));
  const cells = [];
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const d = new Date(todayDate.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    cells.push({ key, active: set.has(key), future: false });
  }
  return html`<div class="respect-calendar ${compact ? 'is-compact' : ''}" aria-label="敬畏日历">
    ${cells.map(
      (cell) => html`<span class="respect-calendar__cell ${cell.active ? 'is-active' : ''} ${cell.future ? 'is-future' : ''}" title="${cell.key}${cell.active ? ' · 已敬畏' : ''}"></span>`
    )}
  </div>`;
}

export function infoLine(label, value, iconName = '') {
  return html`<div class="info-line">
    <span class="info-line__label">${iconName ? icon(iconName, { size: 15 }) : ''}${label}</span>
    <span class="info-line__value">${value || '—'}</span>
  </div>`;
}

export function tag(text, tone = '') {
  return html`<span class="tag ${tone ? `tag--${tone}` : ''}">${text}</span>`;
}

export function modalShell({ title = '', body, footer = '', wide = false, className = '' }) {
  return html`<div class="modal-backdrop" data-modal-backdrop>
    <section class="modal ${wide ? 'modal--wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${title || '对话框'}">
      <header class="modal__head">
        <h2>${title}</h2>
        <button class="icon-btn modal__close" type="button" data-modal-close aria-label="关闭">${icon('x', { size: 18 })}</button>
      </header>
      <div class="modal__body">${body}</div>
      ${footer ? html`<footer class="modal__foot">${footer}</footer>` : ''}
    </section>
  </div>`;
}

let activeModal = null;

export function openModal({ title = '', body, footer = '', wide = false, onMount, onClose, dismissible = true }) {
  if (activeModal) activeModal.close(true);
  const root = document.getElementById('modal-root');
  root.innerHTML = modalShell({ title, body, footer, wide }).value;
  const backdrop = root.firstElementChild;
  const panel = backdrop.querySelector('.modal');
  let closed = false;
  const close = (immediate = false) => {
    if (closed) return;
    closed = true;
    activeModal = null;
    document.body.classList.remove('modal-open');
    if (immediate) {
      root.innerHTML = '';
      if (onClose) onClose();
      return;
    }
    backdrop.classList.add('is-closing');
    setTimeout(() => {
      root.innerHTML = '';
      if (onClose) onClose();
    }, 180);
  };
  activeModal = { close };
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  document.body.classList.add('modal-open');
  if (dismissible) {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    panel.querySelectorAll('[data-modal-close]').forEach((button) => {
      button.addEventListener('click', () => close());
    });
  } else {
    panel.querySelectorAll('[data-modal-close]').forEach((button) => button.remove());
  }
  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);
  onMount?.(panel, close);
  setTimeout(() => {
    const focusable = panel.querySelector('input:not([type=hidden]), textarea, select, button');
    focusable?.focus({ preventScroll: true });
  }, 120);
  return { close, panel };
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      body: html`<p class="confirm-text">${message}</p>`,
      footer: html`<button class="btn btn--ghost" type="button" data-cancel>${cancelText}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm>${confirmText}</button>`,
      onMount(panel, close) {
        panel.querySelector('[data-cancel]')?.addEventListener('click', () => {
          finish(false);
          close();
        });
        panel.querySelector('[data-confirm]')?.addEventListener('click', () => {
          finish(true);
          close();
        });
      },
      onClose: () => finish(false),
    });
  });
}

export function openLightbox(images, start = 0) {
  const list = images.filter(Boolean);
  if (!list.length) return;
  let index = Math.max(0, Math.min(start, list.length - 1));
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="查看图片">
    <button class="lightbox__close" type="button" aria-label="关闭">${icon('x', { size: 22 }).value}</button>
    ${list.length > 1 ? `<button class="lightbox__prev" type="button" aria-label="上一张">${icon('chevron-left', { size: 26 }).value}</button>` : ''}
    <figure class="lightbox__figure"><img alt="敬畏图片" /><figcaption></figcaption></figure>
    ${list.length > 1 ? `<button class="lightbox__next" type="button" aria-label="下一张">${icon('chevron-right', { size: 26 }).value}</button>` : ''}
  </div>`;
  const overlay = root.firstElementChild;
  const img = overlay.querySelector('img');
  const caption = overlay.querySelector('figcaption');
  const render = () => {
    img.src = list[index];
    caption.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : '';
  };
  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', keyHandler);
  };
  const next = () => {
    index = (index + 1) % list.length;
    render();
  };
  const prev = () => {
    index = (index - 1 + list.length) % list.length;
    render();
  };
  const keyHandler = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight') next();
    if (event.key === 'ArrowLeft') prev();
  };
  overlay.querySelector('.lightbox__close').addEventListener('click', close);
  overlay.querySelector('.lightbox__next')?.addEventListener('click', next);
  overlay.querySelector('.lightbox__prev')?.addEventListener('click', prev);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', keyHandler);
  document.body.classList.add('modal-open');
  render();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

export function shimmerLine(width = '100%') {
  return html`<span class="shimmer-line" style="width:${width}"></span>`;
}

export function formatJoined(value) {
  return fmtDate(value, { year: 'numeric', month: 'long' });
}

export function miniMeta(user) {
  return html`<span class="mini-meta">${roleName(user.role)} · ${timeAgo(user.createdAt)}加入</span>`;
}

export function chip(label, { active = false, href = '', count = '', iconName = '' } = {}) {
  const content = html`${iconName ? icon(iconName, { size: 14 }) : ''}<span>${label}</span>${count ? html`<em>${count}</em>` : ''}`;
  if (href) return html`<a class="chip ${active ? 'is-active' : ''}" href="${href}">${content}</a>`;
  return html`<button class="chip ${active ? 'is-active' : ''}" type="button">${content}</button>`;
}

export { raw, roleName };
