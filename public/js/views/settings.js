import { api, errorMessage } from '../api.js';
import { session, applyMe } from '../state.js';
import {
  copyText,
  fmtDate,
  html,
  prettyNumber,
  roleName,
  timeLeft,
} from '../utils.js';
import { icon } from '../icons.js';
import {
  avatar,
  layout,
  levelPill,
  openModal,
  pageHead,
  toast,
} from '../ui.js';

function inviteItem(invite) {
  const statusLabel = invite.status === 'active' ? '有效' : invite.status === 'used' ? '已使用' : '已失效';
  return html`<div class="invite-item">
    <span class="invite-item__code">${invite.code}</span>
    <span class="invite-item__meta">
      <small>${invite.status === 'active' ? timeLeft(invite.expiresAt) : invite.status === 'used' ? `被 ${invite.usedBy} 使用` : '48 小时有效期已过'}</small>
    </span>
    <span class="invite-item__status is-${invite.status}">${statusLabel}</span>
    ${invite.status === 'active'
      ? html`<button class="copy-btn" type="button" data-copy="${invite.code}" aria-label="复制邀请码">${icon('copy', { size: 14 })}</button>`
      : ''}
  </div>`;
}

export async function settingsView() {
  const me = session.me;
  const user = me.user;
  const perm = me.permissions;
  let invites = [];
  if (perm.canInvite) {
    const data = await api.get('/api/invites');
    invites = data.invites;
  }

  const inviteSection = perm.canInvite
    ? html`<section class="settings-card" id="invitations">
        <div class="settings-card__head">
          <div>
            <h2>邀请码</h2>
            <p>邀请新的人进入敬畏。每枚邀请码一次性使用，48 小时后自动删除。</p>
          </div>
          <span class="tag tag--seal">${perm.inviteCost === 0 ? '免费' : `${perm.inviteCost} 根号数 / 枚`}</span>
        </div>
        <div class="settings-card__body">
          <div class="invite-create">
            <div class="invite-create__copy">
              <strong>为一个人打开门</strong>
              <small>你当前有 ${prettyNumber(user.rootPoints)} 个根号数。邀请码创建后请尽快使用。</small>
            </div>
            <button class="btn btn--primary" type="button" data-create-invite>
              ${icon('key', { size: 15 })} 生成邀请码
            </button>
          </div>
          <div class="invite-list" data-invite-list>
            ${invites.length ? invites.map(inviteItem) : html`<p class="field-help">还没有发放过邀请码。</p>`}
          </div>
          <p class="field-help">${perm.isOwner || perm.isPelican ? '管理员发放邀请码不消耗根号数。' : perm.isSparrow ? '麻雀管理员每次发放消耗 2 个根号数。' : 'L4 及以上成员每次发放消耗 4 个根号数。'} 已使用或过期的邀请码不可再次使用。</p>
        </div>
      </section>`
    : html`<section class="settings-card" id="invitations">
        <div class="settings-card__head">
          <div><h2>邀请码</h2><p>邀请制是这里的门。</p></div>
        </div>
        <div class="settings-card__body">
          <div class="notice">${icon('lock', { size: 15 })} L4 及以上成员与管理员才可发放邀请码。继续敬畏，等级会带你到那里。</div>
        </div>
      </section>`;

  const content = html`<div class="settings-page">
    ${pageHead({
      title: '设置',
      description: '头像、签名、密码与隐私。',
    })}

    <div class="settings-layout">
      <nav class="settings-menu" aria-label="设置栏目">
        <a class="is-active" href="#profile">个人资料</a>
        <a href="#privacy">隐私与记录</a>
        <a href="#security">密码与安全</a>
        <a href="#invitations">邀请码</a>
        <a href="#account">账号信息</a>
      </nav>

      <div class="settings-content">
        <section class="settings-card" id="profile">
          <div class="settings-card__head">
            <div><h2>个人资料</h2><p>这些信息会出现在你的主页上。</p></div>
            <span class="level-pill level-pill--${user.level}"><span class="level-pill__dot"></span>L${user.level}</span>
          </div>
          <form class="settings-card__body" data-profile-form>
            <div class="avatar-editor">
              <span data-avatar-wrap>${avatar(user, 82)}</span>
              <div class="avatar-editor__copy">
                <strong>头像</strong>
                <small>上传后会自动压缩到长边不超过 1080px，并保留较高清晰度。</small>
              </div>
              <button class="btn btn--ghost btn--tiny" type="button" data-avatar-button>${icon('camera', { size: 13 })} 更换头像</button>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-avatar-input />
            </div>
            <div class="field-row">
              <div class="field">
                <label>用户名 <span>全站唯一 · 修改消耗 5 根号数</span></label>
                <div style="display:flex;gap:8px">
                  <input value="${user.username}" readonly style="background:rgba(24,33,31,.035)" />
                  <button class="btn btn--ghost btn--tiny" type="button" data-change-username style="flex:0 0 auto">修改</button>
                </div>
              </div>
              <div class="field">
                <label for="settings-email">邮箱 <span>展示在主页</span></label>
                <input id="settings-email" name="email" type="email" value="${user.email || ''}" placeholder="you@example.com" />
              </div>
            </div>
            <div class="field">
              <label for="settings-signature">签名 <span>80 字以内</span></label>
              <textarea id="settings-signature" name="signature" maxlength="80" style="min-height:80px" placeholder="一句话，留给自己">${user.signature || ''}</textarea>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">${icon('check', { size: 15 })} 保存资料</button>
            </div>
          </form>
        </section>

        <section class="settings-card" id="privacy">
          <div class="settings-card__head">
            <div><h2>隐私与记录</h2><p>决定谁可以看到你的敬畏记录与日历。</p></div>
          </div>
          <div class="settings-card__body">
            <label class="toggle">
              <input type="checkbox" data-public-records ${user.publicRecords ? 'checked' : ''} />
              <span class="toggle__track"></span>
              <span class="toggle__text">
                <strong>公开我的敬畏记录</strong>
                <small>关闭后，只有你自己能在个人主页看到记录与日历；累计数据仍会出现在榜单上。</small>
              </span>
            </label>
            <div class="notice">${icon('info', { size: 15 })} 关闭公开后，其他成员仍能看到你的累计敬畏次数、连续天数与等级。</div>
          </div>
        </section>

        <section class="settings-card" id="security">
          <div class="settings-card__head">
            <div><h2>密码与安全</h2><p>修改密码后，其他设备上的登录不会被强制退出。</p></div>
          </div>
          <form class="settings-card__body" data-password-form>
            <div class="field">
              <label for="current-password">当前密码</label>
              <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" placeholder="输入当前密码" required />
            </div>
            <div class="field-row">
              <div class="field">
                <label for="new-password">新密码 <span>至少 6 位</span></label>
                <input id="new-password" name="newPassword" type="password" autocomplete="new-password" placeholder="设置新密码" required />
              </div>
              <div class="field">
                <label for="new-password2">确认新密码</label>
                <input id="new-password2" name="newPassword2" type="password" autocomplete="new-password" placeholder="重复新密码" required />
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn--ghost" type="submit">${icon('key', { size: 14 })} 更新密码</button>
            </div>
          </form>
        </section>

        ${inviteSection}

        <section class="settings-card" id="account">
          <div class="settings-card__head">
            <div><h2>账号信息</h2><p>你的身份与邀请来处。</p></div>
            ${perm.isAdmin ? html`<a class="btn btn--ghost btn--tiny" href="/admin">${icon('shield', { size: 13 })} 管理台</a>` : ''}
          </div>
          <div class="settings-card__body">
            <div class="info-line"><span class="info-line__label">${icon('user', { size: 14 })} 角色</span><span class="info-line__value">${roleName(user.role)} ${user.role === 'user' ? `· L${user.level}` : ''}</span></div>
            <div class="info-line"><span class="info-line__label">${icon('heart', { size: 14 })} 累计敬畏</span><span class="info-line__value">${user.totalRespects} 次</span></div>
            <div class="info-line"><span class="info-line__label">${icon('flame', { size: 14 })} 连续敬畏</span><span class="info-line__value">${user.currentStreak} 天 · 最长 ${user.longestStreak} 天</span></div>
            <div class="info-line"><span class="info-line__label">${icon('key', { size: 14 })} 根号数</span><span class="info-line__value">${user.rootPoints}</span></div>
            <div class="info-line"><span class="info-line__label">${icon('user-check', { size: 14 })} 邀请人</span><span class="info-line__value">${user.invitedBy || '—'}</span></div>
            <div class="info-line"><span class="info-line__label">${icon('calendar', { size: 14 })} 加入时间</span><span class="info-line__value">${fmtDate(user.createdAt)}</span></div>
            <p class="field-help">用户名修改会实时校验唯一性；修改成功后，旧用户名立即释放。</p>
          </div>
        </section>

        <section class="settings-card danger-zone">
          <div class="settings-card__head">
            <div><h2>离开之前</h2><p>退出登录会结束当前设备上的会话。</p></div>
            <button class="btn btn--ghost btn--tiny" type="button" data-logout>${icon('logout', { size: 13 })} 退出登录</button>
          </div>
        </section>
      </div>
    </div>
  </div>`;

  return {
    title: '设置 · Awecean',
    active: 'settings',
    html: layout(content, { me, active: 'settings' }),
    mount(root) {
      const profileForm = root.querySelector('[data-profile-form]');
      const passwordForm = root.querySelector('[data-password-form]');
      const avatarInput = root.querySelector('[data-avatar-input]');

      root.querySelector('[data-avatar-button]').addEventListener('click', () => avatarInput.click());
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files?.[0];
        if (!file) return;
        avatarInput.value = '';
        try {
          const { compressImage } = await import('../utils.js');
          const dataUrl = await compressImage(file, { maxSize: 1080, quality: 0.9 });
          const { url } = await api.upload(dataUrl);
          const result = await api.patch('/api/me', { avatar: url });
          applyMe(result.me);
          root.querySelector('[data-avatar-wrap]').innerHTML = avatar(result.me.user, 82).value;
          toast('头像已更新', 'success');
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      });

      profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(profileForm).entries());
        const button = profileForm.querySelector('button[type=submit]');
        button.classList.add('is-loading');
        button.disabled = true;
        try {
          const result = await api.patch('/api/me', {
            email: data.email,
            signature: data.signature,
          });
          applyMe(result.me);
          toast('资料已保存', 'success');
        } catch (error) {
          toast(errorMessage(error), 'error');
        } finally {
          button.classList.remove('is-loading');
          button.disabled = false;
        }
      });

      root.querySelector('[data-public-records]').addEventListener('change', async (event) => {
        const checked = event.target.checked;
        try {
          const result = await api.patch('/api/me', { publicRecords: checked });
          applyMe(result.me);
          toast(checked ? '你的记录已公开' : '你的记录已设为私密', 'success');
        } catch (error) {
          event.target.checked = !checked;
          toast(errorMessage(error), 'error');
        }
      });

      passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(passwordForm).entries());
        if (data.newPassword !== data.newPassword2) {
          toast('两次输入的新密码不一致', 'error');
          return;
        }
        if (data.newPassword.length < 6) {
          toast('新密码至少需要 6 位', 'error');
          return;
        }
        const button = passwordForm.querySelector('button[type=submit]');
        button.classList.add('is-loading');
        button.disabled = true;
        try {
          await api.post('/api/me/password', {
            currentPassword: data.currentPassword,
            newPassword: data.newPassword,
          });
          toast('密码已更新', 'success');
          passwordForm.reset();
        } catch (error) {
          toast(errorMessage(error), 'error');
        } finally {
          button.classList.remove('is-loading');
          button.disabled = false;
        }
      });

      root.querySelector('[data-change-username]').addEventListener('click', () => {
        openModal({
          title: '修改用户名',
          body: html`<form class="form-stack" data-username-form>
            <p class="field-help">用户名全站唯一，不区分大小写。修改一次消耗 5 个根号数。你当前有 ${user.rootPoints} 个。</p>
            <div class="field">
              <label for="new-username">新用户名 <span>2–20 个字符</span></label>
              <input id="new-username" name="username" placeholder="中文、字母、数字、下划线" maxlength="20" required />
              <p class="auth__invite-status" data-username-status></p>
            </div>
            <div class="auth__error" data-username-error></div>
          </form>`,
          footer: html`<button class="btn btn--ghost" type="button" data-modal-close>取消</button>
            <button class="btn btn--primary" type="button" data-username-submit>确认修改</button>`,
          onMount(panel, close) {
            const nameInput = panel.querySelector('#new-username');
            const nameStatus = panel.querySelector('[data-username-status]');
            let nameTimer = null;
            nameInput.addEventListener('input', () => {
              clearTimeout(nameTimer);
              const value = nameInput.value.trim();
              nameTimer = setTimeout(async () => {
                if (!value) {
                  nameStatus.textContent = '';
                  return;
                }
                try {
                  const result = await api.get(`/api/users/check?username=${encodeURIComponent(value)}`);
                  nameStatus.textContent = result.reason;
                  nameStatus.className = `auth__invite-status ${result.available ? 'is-valid' : 'is-invalid'}`;
                } catch {
                  nameStatus.textContent = '';
                }
              }, 420);
            });
            panel.querySelector('[data-username-submit]').addEventListener('click', async (event) => {
              const button = event.currentTarget;
              const form = panel.querySelector('[data-username-form]');
              const errorEl = panel.querySelector('[data-username-error]');
              const username = form.querySelector('input').value.trim();
              if (!username) {
                errorEl.textContent = '请输入新用户名';
                errorEl.classList.add('is-visible');
                return;
              }
              button.classList.add('is-loading');
              button.disabled = true;
              try {
                const result = await api.post('/api/me/username', { username });
                applyMe(result.me);
                close();
                toast('用户名已修改，消耗 5 个根号数', 'success');
                window.history.pushState({}, '', '/settings');
                window.dispatchEvent(new PopStateEvent('popstate'));
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

      root.querySelector('[data-create-invite]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.classList.add('is-loading');
        button.disabled = true;
        try {
          const result = await api.post('/api/invites');
          const fresh = await api.get('/api/me');
          applyMe(fresh);
          openModal({
            title: '邀请码已生成',
            body: html`<div style="text-align:center;padding:6px 0 4px">
              <p class="field-help" style="margin-bottom:14px">${perm.inviteCost ? `已消耗 ${perm.inviteCost} 个根号数。` : '管理员邀请不消耗根号数。'} 48 小时后自动失效。</p>
              <div style="font-family:var(--mono);font-size:24px;letter-spacing:.12em;padding:18px;border:1px dashed var(--line-strong);background:rgba(255,255,255,.3)">${result.invite.code}</div>
              <button class="btn btn--ghost btn--tiny" type="button" data-copy-modal style="margin-top:14px">${icon('copy', { size: 13 })} 复制邀请码</button>
            </div>`,
            footer: html`<button class="btn btn--primary" type="button" data-modal-close>知道了</button>`,
            onMount(panel, close) {
              panel.querySelector('[data-copy-modal]')?.addEventListener('click', async () => {
                const ok = await copyText(result.invite.code);
                toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
              });
            },
            onClose: () => window.dispatchEvent(new CustomEvent('jw:refresh')),
          });
        } catch (error) {
          toast(errorMessage(error), 'error');
        } finally {
          button.classList.remove('is-loading');
          button.disabled = false;
        }
      });

      root.querySelector('[data-invite-list]')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy]');
        if (!button) return;
        const ok = await copyText(button.dataset.copy);
        toast(ok ? '邀请码已复制' : '复制失败', ok ? 'success' : 'error');
      });

      root.querySelectorAll('.settings-menu a').forEach((link) => {
        link.addEventListener('click', (event) => {
          const id = link.getAttribute('href')?.slice(1);
          const target = id ? root.querySelector(`#${id}`) : null;
          if (!target) return;
          event.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          root.querySelectorAll('.settings-menu a').forEach((item) => item.classList.toggle('is-active', item === link));
          window.history.replaceState({}, '', `${window.location.pathname}#${id}`);
        });
      });
    },
  };
}
