import { api, errorMessage, ApiError } from './api.js';
import { applyMe, clearMe, session } from './state.js';
import { html } from './utils.js';
import { icon } from './icons.js';
import { authView } from './views/auth.js';
import { coverView } from './views/cover.js';
import { exploreView } from './views/explore.js';
import { peopleView } from './views/people.js';
import { leaderboardView } from './views/leaderboard.js';
import { objectDetailView } from './views/object.js';
import { createView } from './views/create.js';
import { profileView } from './views/profile.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { layout, toast } from './ui.js';

const app = document.getElementById('app');
let cleanup = null;
let rendering = false;
let pendingRefresh = false;
let booted = false;

const ROUTES = [
  { pattern: /^\/cover\/?$/, view: coverView, public: true, bare: true },
  { pattern: /^\/auth\/?$/, view: authView, public: true, bare: true },
  { pattern: /^\/home\/?$/, redirect: '/cover' },
  { pattern: /^\/explore\/?$/, view: exploreView, active: 'explore' },
  { pattern: /^\/people\/?$/, view: peopleView, active: 'people' },
  { pattern: /^\/leaderboard\/?$/, view: leaderboardView, active: 'leaderboard' },
  { pattern: /^\/create\/?$/, view: createView, active: 'create' },
  { pattern: /^\/o\/([^/]+)\/edit\/?$/, view: createView, active: 'create', keys: ['id'] },
  { pattern: /^\/o\/([^/]+)\/?$/, view: objectDetailView, active: 'object', keys: ['id'] },
  { pattern: /^\/u\/([^/]+)\/?$/, view: profileView, active: 'profile', keys: ['username'] },
  { pattern: /^\/settings\/?$/, view: settingsView, active: 'settings' },
  { pattern: /^\/admin\/?$/, view: adminView, active: 'admin' },
];

function resolve(pathname) {
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params = {};
    (route.keys || []).forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { ...route, params };
  }
  return null;
}

function showProgress() {
  let bar = document.getElementById('route-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'route-progress';
    document.body.appendChild(bar);
  }
  bar.classList.remove('is-done');
  bar.classList.add('is-running');
}

function hideProgress() {
  const bar = document.getElementById('route-progress');
  if (!bar) return;
  bar.classList.remove('is-running');
  bar.classList.add('is-done');
  setTimeout(() => bar.remove(), 300);
}

function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  renderRoute({ scroll: true });
}

function errorView(error) {
  const message = errorMessage(error);
  return html`<div class="route-error">
    <span class="route-error__mark">敬</span>
    <h1>这里暂时没有回音。</h1>
    <p>${message}</p>
    <div class="route-error__actions">
      <button class="btn btn--primary" type="button" data-retry>再试一次</button>
      <a class="btn btn--ghost" href="/cover">回到封面</a>
    </div>
  </div>`;
}

async function renderRoute({ scroll = true } = {}) {
  if (rendering) {
    pendingRefresh = true;
    return;
  }
  rendering = true;
  if (window.location.pathname === '/') {
    window.history.replaceState({}, '', session.me ? '/explore' : '/cover');
  }

  const route = resolve(window.location.pathname);
  const query = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  if (!route) {
    app.innerHTML = `<div class="shell"><main class="page" style="padding-top:80px">${errorView(new Error('这个页面不存在，或者已经被移走。'))}</main></div>`;
    document.title = '页面不存在 · Awecean';
    rendering = false;
    return;
  }

  if (route.redirect) {
    window.history.replaceState({}, '', route.redirect);
    rendering = false;
    return renderRoute({ scroll });
  }

  const loggedIn = Boolean(session.me);
  if (!route.public && !loggedIn) {
    window.history.replaceState({}, '', '/cover');
    rendering = false;
    return renderRoute({ scroll });
  }
  if (route.public && loggedIn && window.location.pathname === '/auth') {
    window.history.replaceState({}, '', '/explore');
    rendering = false;
    return renderRoute({ scroll });
  }

  showProgress();
  try {
    const view = await route.view({ query, params: route.params });
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    app.innerHTML = view.html.value;
    document.title = view.title || 'Awecean';
    cleanup = view.mount?.(app) || null;
    if (scroll) window.scrollTo(0, 0);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearMe();
      window.history.replaceState({}, '', '/cover');
      rendering = false;
      return renderRoute({ scroll: true });
    }
    app.innerHTML = `<div class="shell"><main class="page" style="padding-top:60px">${errorView(error).value}</main></div>`;
    document.title = '出错了 · Awecean';
    app.querySelector('[data-retry]')?.addEventListener('click', () => renderRoute({ scroll: false }));
  } finally {
    hideProgress();
    rendering = false;
    if (pendingRefresh) {
      pendingRefresh = false;
      renderRoute({ scroll: false });
    }
  }
}

function refreshRoute() {
  renderRoute({ scroll: false });
}

function bindGlobalEvents() {
  document.addEventListener('click', async (event) => {
    const logout = event.target.closest('[data-logout]');
    if (logout) {
      event.preventDefault();
      try {
        await api.post('/api/auth/logout');
      } catch {
        /* The local session is what matters. */
      }
      clearMe();
      navigate('/cover');
      return;
    }

    const follow = event.target.closest('[data-follow]');
    if (follow) {
      event.preventDefault();
      event.stopPropagation();
      if (follow.disabled) return;
      follow.disabled = true;
      const id = follow.dataset.follow;
      try {
        const result = await api.post(`/api/users/${id}/follow`);
        document.querySelectorAll(`[data-follow="${id}"]`).forEach((button) => {
          button.classList.toggle('is-following', result.followed);
          button.innerHTML = `${icon(result.followed ? 'user-check' : 'user-plus', { size: 14 }).value}<span>${result.followed ? '已关注' : '关注'}</span>`;
        });
        toast(result.message, 'success');
      } catch (error) {
        toast(errorMessage(error), 'error');
      } finally {
        follow.disabled = false;
      }
      return;
    }

    const anchor = event.target.closest('a');
    if (!anchor) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.hash) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });

  window.addEventListener('popstate', () => renderRoute({ scroll: false }));
  window.addEventListener('jw:refresh', refreshRoute);
  window.addEventListener('jw:unauthorized', () => {
    if (!booted) return;
    clearMe();
    toast('登录已失效，请重新进入', 'info');
    navigate('/cover', { replace: true });
  });
}

async function boot() {
  const bootScreen = document.querySelector('.boot-screen');
  try {
    const me = await api.get('/api/me');
    applyMe(me);
  } catch (error) {
    if (error.status !== 401) {
      app.innerHTML = errorView(error).value;
      app.querySelector('[data-retry]')?.addEventListener('click', () => window.location.reload());
      booted = true;
      return;
    }
    clearMe();
  }
  booted = true;
  bindGlobalEvents();
  if (bootScreen) bootScreen.remove();
  await renderRoute({ scroll: false });
}

boot();
