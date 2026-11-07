import { api, errorMessage } from '../api.js';
import { session } from '../state.js';
import { debounce, html } from '../utils.js';
import { icon } from '../icons.js';
import {
  emptyState,
  layout,
  loadingState,
  objectCard,
  pageHead,
  toast,
} from '../ui.js';

const SORTS = [
  { key: 'hot', label: '最热' },
  { key: 'newest', label: '最新' },
  { key: 'week', label: '本周' },
  { key: 'name', label: '名称' },
];

function gridMarkup(objects) {
  if (!objects.length) {
    return emptyState({
      title: '这里还没有回音',
      description: '换一个关键词，或者成为第一个留下敬畏的人。',
      action: html`<a class="btn btn--primary" href="/create">创建 ${icon('plus', { size: 15 })}</a>`,
      iconName: 'compass',
    });
  }
  return html`<div class="object-grid">${objects.map((object) => objectCard(object))}</div>`;
}

export async function exploreView({ query }) {
  const q = query.q || '';
  const sort = SORTS.some((item) => item.key === query.sort) ? query.sort : 'hot';
  const data = await api.get(`/api/objects?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`);
  const me = session.me;

  const sortChips = SORTS.map(
    (item) => html`<a class="chip ${sort === item.key ? 'is-active' : ''}" href="/explore?sort=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ''}">${item.label}</a>`
  );

  const content = html`<div class="explore">
    ${pageHead({
      title: '发现',
      description: '想敬畏的人、事、物。',
      center: true,
    })}

    <div class="toolbar toolbar--discover">
      <form class="search-box" data-search-form>
        ${icon('search', { size: 17 })}
        <input class="input" type="search" name="q" value="${q}" placeholder="搜索你想敬畏的…" autocomplete="off" aria-label="搜索敬畏对象" />
      </form>
      <div class="toolbar__right">
        <span class="toolbar__count" data-result-count>${data.total} 个</span>
        <div class="chips">${sortChips}</div>
      </div>
    </div>

    ${q ? html`<p class="results-note">${icon('search', { size: 12 })} 关于 <strong>「${q}」</strong> 的搜索结果</p>` : ''}
    <div data-explore-results>${gridMarkup(data.objects)}</div>

  </div>`;

  return {
    title: '发现 · Awecean',
    active: 'explore',
    html: layout(content, { me, active: 'explore' }),
    mount(root) {
      const form = root.querySelector('[data-search-form]');
      const input = form.querySelector('input');
      const resultRoot = root.querySelector('[data-explore-results]');
      const countEl = root.querySelector('[data-result-count]');
      let currentSort = sort;

      const runSearch = debounce(async () => {
        const value = input.value.trim();
        const url = `/explore?sort=${currentSort}${value ? `&q=${encodeURIComponent(value)}` : ''}`;
        window.history.replaceState({}, '', url);
        try {
          const result = await api.get(`/api/objects?q=${encodeURIComponent(value)}&sort=${encodeURIComponent(currentSort)}`);
          resultRoot.innerHTML = gridMarkup(result.objects).value;
          countEl.textContent = `${result.total} 个对象`;
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      }, 320);

      input.addEventListener('input', runSearch);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        runSearch.cancel();
        runSearch();
      });
    },
  };
}
