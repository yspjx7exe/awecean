import { api, errorMessage } from '../api.js';
import { session, applyMe } from '../state.js';
import { html } from '../utils.js';
import { brand } from '../ui.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';

const MODE_COPY = {
  login: {
    title: '登录',
    desc: '回到 Awecean。',
  },
  register: {
    title: '注册',
    desc: '使用一枚邀请码加入。',
  },
  reset: {
    title: '找回密码',
    desc: '需要原注册邀请码，以及一枚新邀请码。',
  },
};

export function authView({ query }) {
  const mode = ['login', 'register', 'reset'].includes(query.mode) ? query.mode : 'login';
  const copy = MODE_COPY[mode];

  const tabs = ['login', 'register'].map(
    (item) => html`<a class="auth__tab ${mode === item ? 'is-active' : ''}" href="/auth?mode=${item}">${item === 'login' ? '登录' : '注册'}</a>`
  );

  const form =
    mode === 'login'
      ? html`<form class="auth__form" data-auth-form="login" novalidate>
          <div class="field">
            <label for="login-username">用户名</label>
            <input id="login-username" name="username" autocomplete="username" placeholder="用户名" required />
          </div>
          <div class="field">
            <label for="login-password">密码</label>
            <div class="password-field">
              <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="密码" required />
              <button class="password-toggle" type="button" data-password-toggle aria-label="显示密码">${icon('eye', { size: 17 })}</button>
            </div>
          </div>
          <div class="auth__error" data-auth-error></div>
          <button class="btn btn--primary btn--wide auth__submit" type="submit">登录 ${icon('arrow-right', { size: 16 })}</button>
        </form>`
      : mode === 'register'
        ? html`<form class="auth__form" data-auth-form="register" novalidate>
            <div class="field">
              <label for="reg-invite">邀请码</label>
              <input id="reg-invite" name="inviteCode" autocomplete="off" placeholder="邀请码" required />
              <p class="auth__invite-status" data-invite-status></p>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="reg-username">用户名</label>
                <input id="reg-username" name="username" autocomplete="username" placeholder="2–20 个字符" required />
                <p class="auth__invite-status" data-username-status></p>
              </div>
              <div class="field">
                <label for="reg-email">邮箱</label>
                <input id="reg-email" name="email" type="email" autocomplete="email" placeholder="可选" />
              </div>
            </div>
            <div class="field">
              <label for="reg-signature">签名</label>
              <input id="reg-signature" name="signature" placeholder="可选" maxlength="80" />
            </div>
            <div class="field-row">
              <div class="field">
                <label for="reg-password">密码</label>
                <div class="password-field">
                  <input id="reg-password" name="password" type="password" autocomplete="new-password" placeholder="至少 6 位" required />
                  <button class="password-toggle" type="button" data-password-toggle aria-label="显示密码">${icon('eye', { size: 17 })}</button>
                </div>
              </div>
              <div class="field">
                <label for="reg-password2">确认密码</label>
                <input id="reg-password2" name="password2" type="password" autocomplete="new-password" placeholder="再输入一次" required />
              </div>
            </div>
            <div class="auth__error" data-auth-error></div>
            <button class="btn btn--primary btn--wide auth__submit" type="submit">注册 ${icon('log-in', { size: 16 })}</button>
          </form>`
        : html`<form class="auth__form" data-auth-form="reset" novalidate>
            <div class="field">
              <label for="reset-username">用户名</label>
              <input id="reset-username" name="username" autocomplete="username" placeholder="需要找回的账号" required />
            </div>
            <div class="field">
              <label for="reset-original">原注册邀请码</label>
              <input id="reset-original" name="originalInvite" placeholder="原邀请码" required />
            </div>
            <div class="field">
              <label for="reset-new-invite">新邀请码</label>
              <input id="reset-new-invite" name="newInviteCode" placeholder="请邀请人重新发放" required />
            </div>
            <div class="field">
              <label for="reset-password">新密码</label>
              <input id="reset-password" name="password" type="password" autocomplete="new-password" placeholder="至少 6 位" required />
            </div>
            <div class="field">
              <label for="reset-password2">确认新密码</label>
              <input id="reset-password2" name="password2" type="password" autocomplete="new-password" placeholder="再输入一次" required />
            </div>
            <div class="auth__error" data-auth-error></div>
            <button class="btn btn--primary btn--wide auth__submit" type="submit">重置密码 ${icon('key', { size: 16 })}</button>
            <a class="auth__back" href="/auth?mode=login" style="margin:16px 0 0">${icon('arrow-left', { size: 14 })} 返回登录</a>
          </form>`;

  const view = html`<div class="auth">
    <section class="auth__visual">
      <div class="auth__visual-top">${brand()}</div>
      <img class="auth__mascot" src="/assets/mascot-bird.jpg" alt="" aria-hidden="true" />
    </section>

    <section class="auth__panel">
      <div class="auth__box">
        <a class="auth__back" href="/cover">${icon('arrow-left', { size: 14 })} 回到封面</a>
        <h1 class="auth__title">${copy.title}</h1>
        <p class="auth__desc">${copy.desc}</p>
        ${mode !== 'reset'
          ? html`<nav class="auth__tabs" aria-label="登录或注册">${tabs}<a class="auth__tab" href="/auth?mode=reset">找回</a></nav>`
          : html`<div style="height:22px"></div>`}
        ${form}
      </div>
    </section>
  </div>`;

  return {
    title: `${copy.title} · Awecean`,
    bare: true,
    html: view,
    mount(root) {
      const formEl = root.querySelector('[data-auth-form]');
      const errorEl = root.querySelector('[data-auth-error]');
      const submit = formEl.querySelector('button[type=submit]');
      const showError = (message) => {
        errorEl.textContent = message;
        errorEl.classList.add('is-visible');
      };

      root.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
          const input = button.parentElement.querySelector('input');
          const visible = input.type === 'text';
          input.type = visible ? 'password' : 'text';
          button.innerHTML = visible ? icon('eye', { size: 17 }).value : icon('eye-off', { size: 17 }).value;
        });
      });

      if (mode === 'register') {
        const inviteInput = formEl.querySelector('[name=inviteCode]');
        const statusEl = formEl.querySelector('[data-invite-status]');
        const usernameInput = formEl.querySelector('[name=username]');
        const usernameStatus = formEl.querySelector('[data-username-status]');
        let timer = null;
        let usernameTimer = null;
        const check = async () => {
          const code = inviteInput.value.trim();
          if (!code) {
            statusEl.textContent = '';
            statusEl.className = 'auth__invite-status';
            return;
          }
          try {
            const result = await api.get(`/api/invites/check?code=${encodeURIComponent(code)}`);
            statusEl.textContent = result.valid ? `邀请人：${result.inviter}` : '邀请码无效或已过期';
            statusEl.className = `auth__invite-status ${result.valid ? 'is-valid' : 'is-invalid'}`;
          } catch {
            statusEl.textContent = '';
          }
        };
        inviteInput.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(check, 500);
        });
        usernameInput.addEventListener('input', () => {
          clearTimeout(usernameTimer);
          const value = usernameInput.value.trim();
          if (!value) {
            usernameStatus.textContent = '';
            usernameStatus.className = 'auth__invite-status';
            return;
          }
          usernameTimer = setTimeout(async () => {
            try {
              const result = await api.get(`/api/users/check?username=${encodeURIComponent(value)}`);
              usernameStatus.textContent = result.reason;
              usernameStatus.className = `auth__invite-status ${result.available ? 'is-valid' : 'is-invalid'}`;
            } catch {
              usernameStatus.textContent = '';
            }
          }, 420);
        });
      }

      formEl.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorEl.classList.remove('is-visible');
        const data = Object.fromEntries(new FormData(formEl).entries());
        if (!data.username || !data.password) {
          showError('请填写用户名和密码');
          return;
        }
        if (mode !== 'login' && data.password !== data.password2) {
          showError('两次输入的密码不一致');
          return;
        }
        if (mode === 'register' && !data.inviteCode?.trim()) {
          showError('请填写邀请码');
          return;
        }
        submit.classList.add('is-loading');
        submit.disabled = true;
        try {
          if (mode === 'login') {
            const payload = await api.post('/api/auth/login', { username: data.username, password: data.password });
            applyMe(payload);
            toast('已登录', 'success');
            window.history.replaceState({}, '', '/explore');
            window.dispatchEvent(new PopStateEvent('popstate'));
          } else if (mode === 'register') {
            const payload = await api.post('/api/auth/register', {
              username: data.username,
              password: data.password,
              inviteCode: data.inviteCode,
              email: data.email,
              signature: data.signature,
            });
            applyMe(payload);
            toast('已加入 Awecean', 'success');
            window.history.replaceState({}, '', '/explore');
            window.dispatchEvent(new PopStateEvent('popstate'));
          } else {
            await api.post('/api/auth/reset', {
              username: data.username,
              originalInvite: data.originalInvite,
              newInviteCode: data.newInviteCode,
              password: data.password,
            });
            toast('密码已重置', 'success');
            window.history.replaceState({}, '', '/auth?mode=login');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        } catch (error) {
          showError(errorMessage(error));
        } finally {
          submit.classList.remove('is-loading');
          submit.disabled = false;
        }
      });

      if (session.me) {
        window.history.replaceState({}, '', '/explore');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    },
  };
}
