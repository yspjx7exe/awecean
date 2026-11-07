import { api, errorMessage } from '../api.js';
import { session } from '../state.js';
import { copyText, fmtDate, fmtDateTime, html, prettyNumber, roleName, timeAgo } from '../utils.js';
import { icon } from '../icons.js';
import {
  avatar,
  confirmDialog,
  emptyState,
  layout,
  levelPill,
  openModal,
  pageHead,
  roleBadge,
  toast,
} from '../ui.js';

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'members', label: '成员' },
  { key: 'reports', label: '举报信箱' },
  { key: 'invites', label: '邀请码' },
];

function overview(data) {
  const recentReports = data.reports.slice(0, 3);
  return html`<div>
    <div class="admin-stats">
      <div class="admin-stat"><strong>${prettyNumber(data.stats.users)}</strong><span>注册成员</span></div>
      <div class="admin-stat"><strong>${prettyNumber(data.stats.objects)}</strong><span>在线对象</span></div>
      <div class="admin-stat"><strong>${prettyNumber(data.stats.respects)}</strong><span>累计敬畏</span></div>
      <div class="admin-stat"><strong>${prettyNumber(data.stats.reports)}</strong><span>待处理举报</span></div>
    </div>

    <div class="admin-overview-grid">
      <div>
        <div class="section-head"><div><h2>最近举报</h2><p>鹈鹕与帝企鹅管理员会收到这些信息</p></div><a class="text-link" href="/admin?tab=reports">进入信箱 ${icon('arrow-right', { size: 13 })}</a></div>
        ${recentReports.length
          ? recentReports.map((report) => html`<div class="report-card">
              <div class="report-card__head">
                <div class="report-card__object">
                  <span class="report-card__thumb">${report.object?.mainImage ? html`<img src="${report.object.mainImage}" alt="" />` : ''}</span>
                  <div><strong>${report.object?.name || '已删除对象'}</strong><small>${report.reporter} 举报 · ${timeAgo(report.createdAt)}</small></div>
                </div>
                <span class="tag tag--seal">待处理</span>
              </div>
              <div class="report-card__reason">${report.reason}</div>
            </div>`)
          : html`<div class="empty-mini">信箱是空的。这里暂时没有需要处理的内容。</div>`}
      </div>
      <div class="rail-card">
        <div class="rail-card__head"><h3>权限</h3></div>
        <div class="info-line"><span class="info-line__label">帝企鹅</span><span class="info-line__value">全站所有权限</span></div>
        <div class="info-line"><span class="info-line__label">鹈鹕</span><span class="info-line__value">发码 · 下架</span></div>
        <div class="info-line"><span class="info-line__label">麻雀</span><span class="info-line__value">发码 · 举报</span></div>
        <div class="info-line"><span class="info-line__label">L4+</span><span class="info-line__value">发码（4 根号数）</span></div>
        <p class="field-help" style="margin-top:13px">封禁可由站长按天数或截止时间执行。封禁期间账号无法登录，现有会话会立即失效。</p>
      </div>
    </div>
  </div>`;
}

function members(data, me) {
  const canManage = data.permissions.canManageRoles;
  const canBan = data.permissions.canBan;
  return html`<div class="admin-table-wrap">
    <table class="admin-table">
      <thead><tr><th>成员</th><th>角色 / 等级</th><th>敬畏</th><th>根号数</th><th>状态</th><th>加入</th><th>操作</th></tr></thead>
      <tbody>
        ${data.users.map((user) => {
          const banned = Boolean(user.bannedUntil && new Date(user.bannedUntil) > new Date());
          const isSelf = user.id === me.user.id;
          return html`<tr>
            <td><div class="admin-table__person">${avatar(user, 30)}<div><strong>${user.username}${isSelf ? html`<span class="text-muted" style="font-size:9px"> · 你</span>` : ''}</strong><small>${user.email || '未填邮箱'}</small></div></div></td>
            <td>
              ${canManage && user.role !== 'owner'
                ? html`<select class="input" data-role-select="${user.id}" data-previous="${user.role}" style="min-height:30px;padding:4px 8px;font-size:10px;width:auto">
                    <option value="user" ${user.role === 'user' ? 'selected' : ''}>成员</option>
                    <option value="sparrow" ${user.role === 'sparrow' ? 'selected' : ''}>麻雀管理员</option>
                    <option value="pelican" ${user.role === 'pelican' ? 'selected' : ''}>鹈鹕管理员</option>
                  </select>`
                : html`<span class="tag">${roleName(user.role)}</span>`}
              <span style="margin-left:5px">${levelPill(user.level)}</span>
            </td>
            <td>${user.totalRespects}</td>
            <td>${user.rootPoints}</td>
            <td>${banned ? html`<span class="status-dot is-banned">封禁至 ${fmtDate(user.bannedUntil, { month: '2-digit', day: '2-digit' })}</span>` : html`<span class="status-dot">正常</span>`}</td>
            <td>${fmtDate(user.createdAt, { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>
            <td><div class="admin-table__actions">
              ${canBan && !isSelf && user.role !== 'owner'
                ? banned
                  ? html`<button class="btn btn--ghost btn--tiny" data-unban="${user.id}">解除封禁</button>`
                  : html`<button class="btn btn--ghost btn--tiny" data-ban="${user.id}">封禁</button>`
                : ''}
              <a class="btn btn--ghost btn--tiny" href="/u/${encodeURIComponent(user.username)}">主页</a>
            </div></td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function reports(data) {
  if (!data.reports.length) {
    return emptyState({ title: '举报信箱是空的', description: '没有待处理的内容。继续保持这里的秩序。', iconName: 'mail' });
  }
  return html`<div>
    ${data.reports.map(
      (report) => html`<div class="report-card">
        <div class="report-card__head">
          <div class="report-card__object">
            <span class="report-card__thumb">${report.object?.mainImage ? html`<img src="${report.object.mainImage}" alt="" />` : ''}</span>
            <div>
              <strong>${report.object?.name || '已删除对象'}</strong>
              <small>${report.reporter} 举报 · ${fmtDateTime(report.createdAt)}</small>
            </div>
          </div>
          <span class="tag tag--seal">待处理</span>
        </div>
        <div class="report-card__reason">${report.reason}</div>
        <div class="report-card__foot">
          <span class="report-card__meta">举报编号 ${report.id.slice(-6)} · 对象 ${report.object ? '仍在线' : '已不存在'}</span>
          <div class="report-card__actions">
            <a class="btn btn--ghost btn--tiny" href="${report.object ? `/o/${report.object.id}` : '/explore'}">查看对象</a>
            ${data.permissions.canUnpublish || data.permissions.isOwner
              ? html`<button class="btn btn--ghost btn--tiny" data-dismiss-report="${report.id}">忽略并删除</button>
                  <button class="btn btn--seal btn--tiny" data-remove-report="${report.id}">核实并下架</button>`
              : ''}
          </div>
        </div>
      </div>`
    )}
  </div>`;
}

function invites(data) {
  if (!data.invites.length) {
    return emptyState({ title: '还没有邀请码', description: '邀请码创建 48 小时后自动删除。', iconName: 'key' });
  }
  return html`<div class="admin-table-wrap">
    <table class="admin-table">
      <thead><tr><th>邀请码</th><th>发放者</th><th>创建时间</th><th>状态</th><th>使用者</th><th></th></tr></thead>
      <tbody>
        ${data.invites.map(
          (invite) => html`<tr>
            <td><span class="invite-item__code">${invite.code}</span></td>
            <td>${invite.createdBy}</td>
            <td>${fmtDateTime(invite.createdAt)}</td>
            <td><span class="invite-item__status is-${invite.status}">${invite.status === 'active' ? '有效' : invite.status === 'used' ? '已使用' : '已失效'}</span></td>
            <td>${invite.usedBy || '—'}</td>
            <td>${invite.status === 'active' ? html`<button class="copy-btn" type="button" data-admin-copy="${invite.code}">${icon('copy', { size: 13 })}</button>` : ''}</td>
          </tr>`
        )}
      </tbody>
    </table>
  </div>`;
}

export async function adminView({ query }) {
  const data = await api.get('/api/admin/overview');
  const me = session.me;
  const tab = TABS.some((item) => item.key === query.tab) ? query.tab : 'overview';
  const reportsCount = data.reports.length;

  const content = html`<div class="admin-page">
    ${pageHead({
      title: '管理台',
      description: '成员、内容与举报。',
      actions: html`<span class="tag tag--seal">${roleName(me.user.role)}</span>
        <img class="admin__mascot" src="/assets/mascot-penguin.jpg" alt="" aria-hidden="true" />`,
    })}

    <nav class="admin-tabs" aria-label="管理台栏目">
      ${TABS.filter((item) => item.key !== 'invites' || data.permissions.isOwner).map(
        (item) => html`<a class="admin-tab ${tab === item.key ? 'is-active' : ''}" href="/admin?tab=${item.key}">
          ${item.label}${item.key === 'reports' && reportsCount ? html`<em>${reportsCount}</em>` : ''}
        </a>`
      )}
    </nav>

    ${tab === 'overview'
      ? overview(data)
      : tab === 'members'
        ? members(data, me)
        : tab === 'reports'
          ? reports(data)
          : invites(data)}

  </div>`;

  return {
    title: '管理台 · Awecean',
    active: 'admin',
    html: layout(content, { me, active: 'admin' }),
    mount(root) {
      root.querySelectorAll('[data-role-select]').forEach((select) => {
        select.addEventListener('change', async () => {
          const previous = select.dataset.previous || select.value;
          try {
            await api.patch(`/api/admin/users/${select.dataset.roleSelect}`, { role: select.value });
            toast('角色已更新', 'success');
            window.dispatchEvent(new CustomEvent('jw:refresh'));
          } catch (error) {
            select.value = previous;
            toast(errorMessage(error), 'error');
          }
        });
      });

      const banModal = (userId) => {
        const target = data.users.find((user) => user.id === userId);
        if (!target) return;
        openModal({
          title: `封禁 ${target.username}`,
          body: html`<form class="form-stack" data-ban-form>
            <p class="field-help">填写封禁天数，或指定一个截止时间（二选一）。封禁期间该账号无法登录，现有会话立即失效。</p>
            <div class="field-row">
              <div class="field"><label for="ban-days">封禁天数</label><input id="ban-days" name="days" type="number" min="1" max="3650" placeholder="例如 7" /></div>
              <div class="field"><label for="ban-until">截止时间</label><input id="ban-until" name="until" type="datetime-local" /></div>
            </div>
            <div class="field"><label for="ban-reason">原因 <span>可选</span></label><input id="ban-reason" name="reason" placeholder="简要说明封禁原因" maxlength="120" /></div>
            <div class="auth__error" data-ban-error></div>
          </form>`,
          footer: html`<button class="btn btn--ghost" type="button" data-modal-close>取消</button>
            <button class="btn btn--danger" type="button" data-ban-submit>执行封禁</button>`,
          onMount(panel, close) {
            panel.querySelector('[data-ban-submit]').addEventListener('click', async (event) => {
              const button = event.currentTarget;
              const form = panel.querySelector('[data-ban-form]');
              const errorEl = panel.querySelector('[data-ban-error]');
              const days = form.querySelector('[name=days]').value;
              const until = form.querySelector('[name=until]').value;
              if (!days && !until) {
                errorEl.textContent = '请填写封禁天数或截止时间';
                errorEl.classList.add('is-visible');
                return;
              }
              button.classList.add('is-loading');
              button.disabled = true;
              try {
                const payload = { reason: form.querySelector('[name=reason]').value };
                if (until) payload.until = new Date(until).toISOString();
                else payload.days = Number(days);
                await api.patch(`/api/admin/users/${userId}`, payload);
                close();
                toast(`已封禁 ${target.username}`, 'success');
                window.dispatchEvent(new CustomEvent('jw:refresh'));
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
      };

      root.querySelectorAll('[data-ban]').forEach((button) => {
        button.addEventListener('click', () => banModal(button.dataset.ban));
      });

      root.querySelectorAll('[data-unban]').forEach((button) => {
        button.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: '解除封禁？',
            message: '解除后，该成员可以重新登录并使用站内功能。',
            confirmText: '解除封禁',
          });
          if (!confirmed) return;
          try {
            await api.patch(`/api/admin/users/${button.dataset.unban}`, { ban: false });
            toast('已解除封禁', 'success');
            window.dispatchEvent(new CustomEvent('jw:refresh'));
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        });
      });

      root.querySelectorAll('[data-remove-report]').forEach((button) => {
        button.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: '核实并下架？',
            message: '对象将立即下架，相关举报记录会被一并删除。',
            confirmText: '下架并处理',
            danger: true,
          });
          if (!confirmed) return;
          try {
            await api.post(`/api/admin/reports/${button.dataset.removeReport}`, {
              action: 'remove',
              reason: '举报核实后下架',
            });
            toast('内容已下架，举报记录已清除', 'success');
            window.dispatchEvent(new CustomEvent('jw:refresh'));
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        });
      });

      root.querySelectorAll('[data-dismiss-report]').forEach((button) => {
        button.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: '忽略并删除这条举报？',
            message: '如果内容确实需要处理，请选择「核实并下架」。',
            confirmText: '忽略并删除',
          });
          if (!confirmed) return;
          try {
            await api.post(`/api/admin/reports/${button.dataset.dismissReport}`, { action: 'dismiss' });
            toast('举报已删除', 'success');
            window.dispatchEvent(new CustomEvent('jw:refresh'));
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        });
      });

      root.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-copy]');
        if (!button) return;
        const ok = await copyText(button.dataset.adminCopy);
        toast(ok ? '邀请码已复制' : '复制失败', ok ? 'success' : 'error');
      });
    },
  };
}
