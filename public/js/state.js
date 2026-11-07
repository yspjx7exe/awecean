export const session = {
  me: null,
  loaded: false,
};

export function applyMe(payload) {
  if (!payload) return;
  session.me = payload;
  session.loaded = true;
  window.dispatchEvent(new CustomEvent('jw:me', { detail: payload }));
}

export function clearMe() {
  session.me = null;
  session.loaded = true;
  window.dispatchEvent(new CustomEvent('jw:me', { detail: null }));
}

export function currentUser() {
  return session.me?.user || null;
}

export function stats() {
  return session.me?.stats || null;
}

export function permissions() {
  return (
    session.me?.permissions || {
      isOwner: false,
      isPelican: false,
      isSparrow: false,
      isAdmin: false,
      canInvite: false,
      inviteCost: 4,
      canUnpublish: false,
      canManageRoles: false,
      canBan: false,
      dailyLimit: 1,
    }
  );
}
