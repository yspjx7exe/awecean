import { api } from '../api.js';
import { session } from '../state.js';
import { fmtDate, html, prettyNumber } from '../utils.js';
import { icon } from '../icons.js';
import {
  avatar,
  emptyState,
  identityLine,
  layout,
  levelPill,
  objectCard,
  respectCalendar,
  roleBadge,
  roleName,
  statBlock,
  userCard,
} from '../ui.js';

function recordList(records) {
  if (!records.length) {
    return emptyState({ title: '还没有敬畏记录', description: '今天的第一次低头，会从这里开始。', iconName: 'heart' });
  }
  return html`<div class="record-list">
    ${records.map((record) => {
      const date = record.date ? record.date.slice(5).replace('-', '.') : '—';
      return html`<div class="record-item">
        <span class="record-item__date"><strong>${date}</strong>${record.date?.slice(0, 4) || ''}</span>
        <a class="record-item__body" href="${record.object ? `/o/${record.object.id}` : '#'}">
          <span class="record-item__thumb">
            ${record.object?.mainImage ? html`<img src="${record.object.mainImage}" alt="" loading="lazy" />` : ''}
          </span>
          <span class="record-item__text">
            <strong>${record.object?.name || '已下架的对象'}</strong>
            <small>${record.object?.owner?.username ? `由 ${record.object.owner.username} 创建` : '敬畏记录'}</small>
          </span>
          <span class="record-item__action">${record.createdAt ? new Date(record.createdAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }) : ''} ${icon('chevron-right', { size: 13 })}</span>
        </a>
      </div>`;
    })}
  </div>`;
}

function connectionGrid(users, viewerId, emptyTitle, emptyDesc) {
  if (!users.length) {
    return emptyState({ title: emptyTitle, description: emptyDesc, iconName: 'users' });
  }
  return html`<div class="people-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
    ${users.map((user) => userCard(user, { viewerId }))}
  </div>`;
}

export async function profileView({ params, query }) {
  const data = await api.get(`/api/users/${encodeURIComponent(params.username)}`);
  const target = data.user;
  const me = session.me;
  const viewer = me.user;
  const isSelf = target.id === viewer.id;
  const isVisible = target.recordsVisible;
  const tabKeys = ['records', 'objects', 'following', 'followers'];
  const activeTab = tabKeys.includes(query.tab) ? query.tab : 'records';
  const [year, month, day] = target.createdAt
    ? new Date(target.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).split('-')
    : ['', '', ''];

  const content = html`<div class="profile-page">
    ${target.banned
      ? html`<div class="removed-banner">${icon('ban', { size: 16 })}<span>该账号当前处于封禁状态，部分互动已被限制。</span></div>`
      : ''}
    <section class="profile-hero">
      <div class="profile-hero__top">
        <span class="profile-avatar">${avatar(target, 96)}</span>
        <div class="profile-hero__main">
          <div class="profile-hero__name-row">
            <h1>${target.username}</h1>
            ${target.role !== 'user' ? roleBadge(target) : ''}
            ${levelPill(target.level, { showName: true })}
          </div>
          <p class="profile-hero__signature">${target.signature || '这个人还没有写下签名。'}</p>
          <div class="profile-hero__meta">
            <span>${icon('calendar', { size: 12 })} ${year} 年 ${Number(month)} 月加入</span>
            ${target.invitedBy ? html`<span>${icon('user-check', { size: 12 })} 邀请人 ${target.invitedBy}</span>` : ''}
            ${target.email ? html`<span>${icon('mail', { size: 12 })} ${target.email}</span>` : ''}
          </div>
        </div>
        <div class="profile-hero__actions">
          ${isSelf
            ? html`<a class="btn btn--ghost" href="/settings">${icon('settings', { size: 14 })} 编辑资料</a>`
            : html`<button class="follow-btn ${target.isFollowing ? 'is-following' : ''}" type="button" data-follow="${target.id}">
                ${icon(target.isFollowing ? 'user-check' : 'user-plus', { size: 15 })}<span>${target.isFollowing ? '已关注' : '关注'}</span>
              </button>`}
        </div>
      </div>
      <div class="profile-stats">
        ${statBlock(prettyNumber(target.totalRespects), '累计敬畏')}
        ${statBlock(target.currentStreak, '连续天数')}
        ${statBlock(target.longestStreak, '最长连续')}
        ${statBlock(prettyNumber(target.followerCount), '粉丝')}
        ${statBlock(prettyNumber(target.followingCount), '关注')}
      </div>
    </section>

    <div class="profile-body">
      <div>
        <nav class="profile-tabs" aria-label="个人主页内容">
          <button class="profile-tab ${activeTab === 'records' ? 'is-active' : ''}" type="button" data-profile-tab="records">敬畏记录 <em>${target.recordsVisible ? target.recentRecords.length : '·'}</em></button>
          <button class="profile-tab ${activeTab === 'objects' ? 'is-active' : ''}" type="button" data-profile-tab="objects">创建的对象 <em>${data.user.createdObjects.length}</em></button>
          <button class="profile-tab ${activeTab === 'following' ? 'is-active' : ''}" type="button" data-profile-tab="following">关注 <em>${target.followingCount}</em></button>
          <button class="profile-tab ${activeTab === 'followers' ? 'is-active' : ''}" type="button" data-profile-tab="followers">粉丝 <em>${target.followerCount}</em></button>
        </nav>

        <div data-profile-panel="records" ${activeTab !== 'records' ? 'hidden' : ''}>
          ${isVisible
            ? recordList(target.recentRecords)
            : html`<div class="private-records">
                ${icon('lock', { size: 22 })}
                <div>${isSelf ? '你把敬畏记录设为了私密。' : '这个人的敬畏记录是私密的。'}</div>
                ${isSelf ? html`<a class="text-link" href="/settings#privacy" style="margin-top:8px">去设置中公开记录 ${icon('arrow-right', { size: 13 })}</a>` : ''}
              </div>`}
        </div>

        <div data-profile-panel="objects" ${activeTab !== 'objects' ? 'hidden' : ''}>
          ${target.createdObjects.length
            ? html`<div class="object-grid object-grid--two">${target.createdObjects.map((object) => objectCard(object))}</div>`
            : emptyState({ title: '还没有创建过敬畏对象', description: isSelf ? '去为你在意的人或象征留一个位置。' : '这个人还没有把谁放到这里。', iconName: 'plus' })}
        </div>

        <div data-profile-panel="following" ${activeTab !== 'following' ? 'hidden' : ''}>
          ${connectionGrid(target.followingList, viewer.id, '还没有关注任何人', isSelf ? '去寻人页找到你想记住的名字。' : '这个人的关注列表还是空的。')}
        </div>

        <div data-profile-panel="followers" ${activeTab !== 'followers' ? 'hidden' : ''}>
          ${connectionGrid(target.followersList, viewer.id, '还没有粉丝', '被看见需要一点时间。')}
        </div>
      </div>

      <aside class="profile-side">
        <div class="side-panel">
          <h3>身份</h3>
          ${identityLine(target)}
          <div style="margin-top:12px">
            ${roleName(target.role) !== '成员' ? html`<div class="info-line"><span class="info-line__label">${icon('shield', { size: 14 })} 角色</span><span class="info-line__value">${roleName(target.role)}</span></div>` : ''}
            <div class="info-line"><span class="info-line__label">${icon('flame', { size: 14 })} 连续敬畏</span><span class="info-line__value">${target.currentStreak} 天</span></div>
            <div class="info-line"><span class="info-line__label">${icon('clock', { size: 14 })} 连续未敬畏</span><span class="info-line__value">${target.forgetDays} 天</span></div>
            <div class="info-line"><span class="info-line__label">${icon('heart', { size: 14 })} 累计敬畏</span><span class="info-line__value">${target.totalRespects} 次</span></div>
            <div class="info-line"><span class="info-line__label">${icon('mail', { size: 14 })} 邮箱</span><span class="info-line__value">${target.email || '未设置'}</span></div>
            <div class="info-line"><span class="info-line__label">${icon('user-check', { size: 14 })} 邀请人</span><span class="info-line__value">${target.invitedBy || '—'}</span></div>
            <div class="info-line"><span class="info-line__label">${icon('calendar', { size: 14 })} 加入</span><span class="info-line__value">${fmtDate(target.createdAt, { year: 'numeric', month: '2-digit', day: '2-digit' })}</span></div>
          </div>
        </div>

        ${isVisible
          ? html`<div class="side-panel">
              <h3>敬畏日历</h3>
              ${respectCalendar(target.calendar, { weeks: 8 })}
              <div class="calendar-legend" style="margin-top:10px">
                <span><i class="is-on"></i> 已敬畏</span>
                <span>近 56 天</span>
              </div>
            </div>`
          : html`<div class="side-panel">
              <h3>敬畏日历</h3>
              <p class="field-help">该用户选择不公开自己的记录。</p>
            </div>`}

        <div class="side-panel">
          <h3>一句话</h3>
          <p class="serif" style="font-size:15px;line-height:1.9;color:var(--ink-3)">
            ${isSelf ? '你正在被看见。继续记得，继续低头。' : `你正在看 ${target.username} 的页。留下关注，或者只是安静地路过。`}
          </p>
        </div>
      </aside>
    </div>

  </div>`;

  return {
    title: `${target.username} · Awecean`,
    active: 'profile',
    html: layout(content, { me, active: 'profile' }),
    mount(root) {
      const tabs = root.querySelectorAll('[data-profile-tab]');
      const panels = root.querySelectorAll('[data-profile-panel]');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
          panels.forEach((panel) => {
            panel.hidden = panel.dataset.profilePanel !== tab.dataset.profileTab;
          });
          window.history.replaceState({}, '', `${window.location.pathname}?tab=${tab.dataset.profileTab}`);
        });
      });

      root.querySelector('[data-share-profile]')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          import('../ui.js').then(({ toast }) => toast('主页链接已复制', 'success'));
        } catch {
          import('../ui.js').then(({ toast }) => toast('复制失败，请手动复制地址栏', 'error'));
        }
      });
    },
  };
}
