import { api, errorMessage } from '../api.js';
import { session, applyMe } from '../state.js';
import { fmtDate, html, objectTone, prettyNumber, timeAgo } from '../utils.js';
import { icon } from '../icons.js';
import {
  avatar,
  confirmDialog,
  emptyState,
  layout,
  openLightbox,
  openModal,
  pageHead,
  statBlock,
  toast,
} from '../ui.js';

export async function objectDetailView({ params }) {
  const me = session.me;
  let object;
  try {
    object = await api.get(`/api/objects/${encodeURIComponent(params.id)}`);
  } catch (error) {
    if (error.status === 404 || error.status === 410) {
      return {
        title: '对象不存在 · Awecean',
        active: 'explore',
        html: layout(
          html`<div style="padding-top:40px">
            ${emptyState({
              title: '这个人或象征已经不在海面上了',
              description: error.message,
              action: html`<a class="btn btn--primary" href="/explore">回到探索</a>`,
              iconName: 'compass',
            })}
          </div>`,
          { me, active: 'explore' }
        ),
      };
    }
    throw error;
  }

  const stats = me.stats;
  const full = stats.remaining <= 0;
  const canRespect = !object.removedAt && !object.respectedToday && !full;
  const images = [object.mainImage, ...(object.gallery || [])].filter(Boolean);
  const [toneA, toneB] = objectTone(object.name);
  const isAdmin = me.permissions.isAdmin;

  const respectLabel = object.respectedToday
    ? '今日已敬畏'
    : full
      ? '今日限额已满'
      : '敬畏';

  const content = html`<div class="object-detail-page">
    <a class="object-detail__back" href="/explore">${icon('arrow-left', { size: 14 })} 回到探索</a>
    ${object.removedAt
      ? html`<div class="removed-banner">${icon('alert', { size: 16 })}<span>此内容已于 ${timeAgo(object.removedAt)}下架。${object.isOwner || isAdmin ? '仅创建者与管理员仍可看到此页。' : ''}</span></div>`
      : ''}

    <div class="object-detail">
      <div class="object-detail__visual">
        <div class="object-detail__image ${object.mainImage ? '' : 'is-text'}" style="--tone-a:${toneA};--tone-b:${toneB}">
          ${object.mainImage
            ? html`<img src="${object.mainImage}" alt="${object.name}" data-main-image />`
            : html`<span class="object-detail__glyph">${Array.from(object.name)[0] || '敬'}</span>`}
          <span class="object-detail__image-tag">${object.mainImage ? '主图' : '文字'}</span>
        </div>
        ${images.length > 1
          ? html`<div class="object-gallery" aria-label="次要图片">
              ${images.map(
                (image, index) => html`<button type="button" data-gallery-index="${index}" class="${index === 0 ? 'is-active' : ''}" aria-label="查看第 ${index + 1} 张图片">
                  <img src="${image}" alt="" loading="lazy" />
                </button>`
              )}
            </div>`
          : ''}
        ${object.gallery?.length
          ? html`<p class="field-help" style="margin-top:7px">${icon('image', { size: 11 })} 点击图片放大浏览 · 可左右滑动</p>`
          : ''}
      </div>

      <div class="object-detail__info">
        <div class="object-detail__topline">
          <span class="tag ${object.visibility === 'public' ? 'tag--seal' : ''}">
            ${icon(object.visibility === 'public' ? 'lock-open' : 'lock', { size: 11 })}
            ${object.visibility === 'public' ? '公开 · 任何人可编辑' : '私有 · 仅创建者可编辑'}
          </span>
          ${object.weekRespects ? html`<span class="tag">本周 ${object.weekRespects} 次</span>` : ''}
          ${object.removedAt ? html`<span class="tag tag--seal">已下架</span>` : ''}
        </div>
        <h1 class="object-detail__title">${object.name}</h1>

        <div class="object-detail__quote">
          <blockquote>“${object.quote}”</blockquote>
          <cite>${object.quoteSource ? `— ${object.quoteSource}` : '— 无出处'}</cite>
        </div>

        ${object.intro ? html`<p class="object-detail__intro">${object.intro}</p>` : ''}

        <div class="object-detail__stats">
          ${statBlock(prettyNumber(object.respects), '累计敬畏', { accent: true, iconName: 'heart' })}
          ${statBlock(prettyNumber(object.weekRespects), '本周', { iconName: 'flame' })}
          ${statBlock(fmtDate(object.createdAt, { year: 'numeric', month: '2-digit', day: '2-digit' }), '创建于', { iconName: 'calendar' })}
        </div>

        ${object.removedAt
          ? html`<div class="notice" style="margin-top:22px">${icon('info', { size: 15 })} 该内容已下架，不能再表达敬畏。</div>`
          : html`<div class="respect-panel">
              <button class="respect-btn ${object.respectedToday ? 'is-respected' : ''}" type="button" data-respect ${canRespect ? '' : 'disabled'}>
                ${icon('heart', { size: 18 })}
                <span data-respect-label>${respectLabel}</span>
                <span class="respect-btn__count" data-respect-count>${prettyNumber(object.respects)}</span>
              </button>
              <p class="respect-note" data-respect-note>
                ${object.respectedToday
                  ? `你已经在今天敬畏过 TA。明天再来。`
                  : full
                    ? `今天已敬畏 ${stats.todayCount} 位，达到 L${stats.level} 的每日限额。`
                    : html`今日剩余 <strong>${stats.remaining}</strong> 位 · 每次敬畏获得 1 个根号数`}
              </p>
            </div>`}

        ${object.ownerUser
          ? html`<div class="object-owner">
              ${avatar(object.ownerUser, 38)}
              <div class="object-owner__copy">
                <small>敬畏的记录者</small>
                <strong>${object.ownerUser.username}</strong>
              </div>
              <a class="follow-btn ${object.ownerUser.isFollowing ? 'is-following' : ''}" href="/u/${encodeURIComponent(object.ownerUser.username)}">
                ${icon('arrow-up-right', { size: 13 })} 主页
              </a>
            </div>`
          : ''}

        <div class="object-actions">
          <button class="btn btn--ghost btn--tiny" type="button" data-share>${icon('link', { size: 13 })} 复制链接</button>
          ${object.canEdit
            ? html`<a class="btn btn--ghost btn--tiny" href="/o/${object.id}/edit">${icon('edit', { size: 13 })} 编辑</a>`
            : ''}
          ${!object.isOwner && !object.removedAt
            ? html`<button class="btn btn--ghost btn--tiny" type="button" data-report>${icon('alert', { size: 13 })} 举报</button>`
            : ''}
          <span class="object-actions__spacer"></span>
          ${me.permissions.canUnpublish && !object.removedAt && !object.isOwner
            ? html`<button class="btn btn--ghost btn--tiny" type="button" data-remove>${icon('ban', { size: 13 })} 下架</button>`
            : ''}
          ${object.isOwner && !object.removedAt
            ? html`<button class="btn btn--ghost btn--tiny" type="button" data-delete>${icon('trash', { size: 13 })} 删除</button>`
            : ''}
        </div>
        <p class="field-help" style="margin-top:14px">
          ${object.visibility === 'public'
            ? '这个对象是公开的：任何成员都可以修改主图、次要图、简介与名言；只有创建者可以改为私有。'
            : '这个对象是私有的：只有创建者可以修改。创建者可以随时将其改回公开。'}
        </p>
      </div>
    </div>

  </div>`;

  return {
    title: `${object.name} · Awecean`,
    active: 'explore',
    html: layout(content, { me, active: 'explore' }),
    mount(root) {
      const respectBtn = root.querySelector('[data-respect]');
      const label = root.querySelector('[data-respect-label]');
      const count = root.querySelector('[data-respect-count]');
      const note = root.querySelector('[data-respect-note]');

      respectBtn?.addEventListener('click', async () => {
        if (respectBtn.disabled || respectBtn.classList.contains('is-loading')) return;
        respectBtn.classList.add('is-loading');
        try {
          const data = await api.post(`/api/objects/${object.id}/respect`);
          applyMe(data.me);
          object.respects = data.object.respects;
          object.respectedToday = true;
          count.textContent = prettyNumber(data.object.respects);
          const statCount = root.querySelector('.object-detail__stats .stat-block strong');
          if (statCount) statCount.textContent = prettyNumber(data.object.respects);
          label.textContent = '今日已敬畏';
          respectBtn.classList.remove('is-loading');
          respectBtn.classList.add('is-respected');
          respectBtn.disabled = true;
          note.innerHTML = '你已经在今天敬畏过 TA。明天再来。';
          toast(`+1 根号数 · 已向「${object.name}」表达敬畏`, 'success');
          respectBtn.animate(
            [
              { transform: 'scale(1)' },
              { transform: 'scale(0.97)' },
              { transform: 'scale(1)' },
            ],
            { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }
          );
        } catch (error) {
          respectBtn.classList.remove('is-loading');
          toast(errorMessage(error), 'error');
          if (error.code === 'DAILY_LIMIT') {
            respectBtn.disabled = true;
            label.textContent = '今日限额已满';
          }
        }
      });

      if (images.length) {
        root.querySelectorAll('[data-gallery-index]').forEach((button) => {
          button.addEventListener('click', () => {
            openLightbox(images, Number(button.dataset.galleryIndex));
          });
        });
        root.querySelector('[data-main-image]')?.addEventListener('click', () => openLightbox(images, 0));
      }

      root.querySelector('[data-share]')?.addEventListener('click', async () => {
        const url = window.location.href;
        try {
          await navigator.clipboard.writeText(url);
          toast('链接已复制', 'success');
        } catch {
          toast('复制失败，请手动复制地址栏', 'error');
        }
      });

      root.querySelector('[data-report]')?.addEventListener('click', () => {
        openModal({
          title: '向管理员举报',
          body: html`<form class="form-stack" data-report-form>
            <p class="field-help">举报会单独送达鹈鹕管理员与帝企鹅管理员。若内容被处理，举报记录会一并删除。</p>
            <div class="field">
              <label for="report-reason">举报说明 <span>至少 5 个字</span></label>
              <textarea id="report-reason" name="reason" placeholder="请说明你认为不适、敏感或需要核实的地方…" required></textarea>
            </div>
            <div class="auth__error" data-report-error></div>
          </form>`,
          footer: html`<button class="btn btn--ghost" type="button" data-modal-close>取消</button>
            <button class="btn btn--seal" type="button" data-report-submit>提交举报</button>`,
          onMount(panel, close) {
            panel.querySelector('[data-report-submit]').addEventListener('click', async (event) => {
              const button = event.currentTarget;
              const form = panel.querySelector('[data-report-form]');
              const reason = form.querySelector('textarea').value.trim();
              const errorEl = panel.querySelector('[data-report-error]');
              if (reason.length < 5) {
                errorEl.textContent = '请填写至少 5 个字的举报说明';
                errorEl.classList.add('is-visible');
                return;
              }
              button.classList.add('is-loading');
              button.disabled = true;
              try {
                await api.post(`/api/objects/${object.id}/report`, { reason });
                close();
                toast('举报已送达，感谢你帮助维护这里', 'success');
              } catch (error) {
                errorEl.textContent = errorMessage(error);
                errorEl.classList.add('is-visible');
              } finally {
                button.classList.remove('is-loading');
                button.disabled = false;
              }
            });
          },
        });
      });

      root.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: '下架这个对象？',
          message: '下架后，普通用户将无法再看到或敬畏它，相关举报也会一并清除。',
          confirmText: '确认下架',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.post(`/api/objects/${object.id}/remove`, { reason: '管理员下架' });
          toast('内容已下架', 'success');
          window.dispatchEvent(new CustomEvent('jw:refresh'));
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      });

      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: '删除这个敬畏对象？',
          message: '删除后不可恢复，相关的敬畏记录仍会保留在你的历史里。',
          confirmText: '确认删除',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.delete(`/api/objects/${object.id}`);
          toast('已删除', 'success');
          window.history.pushState({}, '', '/explore');
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      });
    },
  };
}
