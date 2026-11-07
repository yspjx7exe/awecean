import { api, errorMessage } from '../api.js';
import { session } from '../state.js';
import { debounce, html } from '../utils.js';
import { icon } from '../icons.js';
import {
  emptyState,
  layout,
  pageHead,
  toast,
  userCard,
} from '../ui.js';

const SORTS = [
  { key: 'respects', label: '虔诚' },
  { key: 'level', label: '等级' },
  { key: 'followers', label: '被关注' },
  { key: 'newest', label: '新来' },
  { key: 'forget', label: '忘记' },
];

function cardsMarkup(users, viewerId) {
  if (!users.length) {
    return emptyState({
      title: '没有找到这个人',
      description: '试试完整的用户名，或者换一种排序。',
      iconName: 'users',
    });
  }
  return html`<div class="people-grid">${users.map((user) => userCard(user, { viewerId }))}</div>`;
}

export async function peopleView({ query }) {
  const q = query.q || '';
  const sort = SORTS.some((item) => item.key === query.sort) ? query.sort : 'respects';
  const data = await api.get(`/api/users?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`);
  const me = session.me;
  const viewerId = me?.user?.id;

  const content = html`<div class="people">
    ${pageHead({
      title: '寻人',
      description: '按用户名找到人。',
      center: true,
    })}

    <div class="toolbar">
      <form class="search-box" data-people-search>
        ${icon('search', { size: 17 })}
        <input class="input" type="search" name="q" value="${q}" placeholder="输入用户名 / 用户 ID…" autocomplete="off" aria-label="搜索用户" />
      </form>
      <div class="toolbar__right">
        <span class="toolbar__count" data-people-count>${data.total} 位成员</span>
        <div class="chips">
          ${SORTS.map(
            (item) => html`<a class="chip ${sort === item.key ? 'is-active' : ''}" href="/people?sort=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ''}">${item.label}</a>`
          )}
        </div>
      </div>
    </div>

    ${q ? html`<p class="results-note">${icon('search', { size: 12 })} 正在寻找 <strong>「${q}」</strong></p>` : ''}
    <div data-people-results>${cardsMarkup(data.users, viewerId)}</div>

    <div class="notice" style="margin-top:28px">
      ${icon('info', { size: 15 })}
      <span>用户 ID 全站唯一，搜索不区分大小写。连续未敬畏天数越长，越容易出现在「忘敬畏榜」。</span>
    </div>

  </div>`;

  return {
    title: '寻人 · Awecean',
    active: 'people',
    html: layout(content, { me, active: 'people' }),
    mount(root) {
      const form = root.querySelector('[data-people-search]');
      const input = form.querySelector('input');
      const resultRoot = root.querySelector('[data-people-results]');
      const countEl = root.querySelector('[data-people-count]');
      let currentSort = sort;
      const run = debounce(async () => {
        const value = input.value.trim();
        window.history.replaceState(
          {},
          '',
          `/people?sort=${currentSort}${value ? `&q=${encodeURIComponent(value)}` : ''}`
        );
        try {
          const result = await api.get(
            `/api/users?q=${encodeURIComponent(value)}&sort=${encodeURIComponent(currentSort)}`
          );
          resultRoot.innerHTML = cardsMarkup(result.users, viewerId).value;
          countEl.textContent = `${result.total} 位成员`;
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      }, 320);
      input.addEventListener('input', run);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        run.cancel();
        run();
      });
    },
  };
}
