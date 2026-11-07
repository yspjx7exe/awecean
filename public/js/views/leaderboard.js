import { api } from '../api.js';
import { session } from '../state.js';
import { html } from '../utils.js';
import {
  avatar,
  emptyState,
  layout,
  levelPill,
  objectRow,
  pageHead,
  rankRow,
} from '../ui.js';

const TABS = [
  { key: 'diligence', label: '最勤奋' },
  { key: 'objects', label: '形象榜' },
  { key: 'forget', label: '忘敬畏' },
];

function diligence(data) {
  const levels = [5, 4, 3, 2, 1].filter((level) => data.byLevel[level]?.length);
  if (!levels.length) {
    return emptyState({ title: '榜单还在等第一个人' });
  }
  return html`<div>
    ${levels.map((level) => {
      const group = data.byLevel[level];
      return html`<section class="level-section">
        <div class="level-section__head">
          <h2>L${level}组</h2>
          <span>${group.length} 人</span>
        </div>
        <div class="rank-list">
          ${group.map((user, i) => rankRow(user, i + 1))}
        </div>
      </section>`;
    })}
  </div>`;
}

function objects(data) {
  if (!data.topObjects?.length) {
    return emptyState({ title: '还没有对象被敬畏' });
  }
  return html`<div class="rank-list object-rank-list">
    <ul>${data.topObjects.map((object, i) => objectRow(object, i + 1))}</ul>
  </div>`;
}

function forget(data) {
  if (!data.forgotten?.length) {
    return emptyState({ title: '没有人忘记敬畏' });
  }
  return html`<div>
    <p class="board-note">按最长连续未敬畏天数排序。</p>
    <div class="rank-list">
      ${data.forgotten.map(
        (user, i) => html`<div class="forget-row">
          <span class="forget-row__rank">${String(i + 1).padStart(2, '0')}</span>
          <a class="forget-row__person" href="/u/${encodeURIComponent(user.username)}">
            ${avatar(user, 38)}
            <span class="rank-row__name">
              <strong>${user.username}</strong>
              <small>${levelPill(user.level)} ${user.currentStreak ? `连续 ${user.currentStreak} 天` : `${user.forgetDays} 天未敬畏`}</small>
            </span>
          </a>
          <span class="forget-row__badge">
            <strong>${user.longestForgetDays}</strong>
            <small>最长忘日</small>
          </span>
        </div>`
      )}
    </div>
  </div>`;
}

export async function leaderboardView({ query }) {
  const tab = TABS.some((item) => item.key === query.tab) ? query.tab : 'diligence';
  const data = await api.get('/api/leaderboards');
  const me = session.me;

  const content = html`<div class="leaderboard">
    ${pageHead({
      title: '排行榜',
      description: '同级排名',
      center: true,
    })}

    <nav class="leader-tabs" aria-label="榜单类型">
      ${TABS.map(
        (item) => html`<a class="leader-tab ${tab === item.key ? 'is-active' : ''}" href="/leaderboard?tab=${item.key}">${item.label}</a>`
      )}
    </nav>

    ${tab === 'diligence'
      ? diligence(data)
      : tab === 'objects'
        ? objects(data)
        : forget(data)}

  </div>`;

  return {
    title: '排行榜 · Awecean',
    active: 'leaderboard',
    html: layout(content, { me, active: 'leaderboard' }),
  };
}
