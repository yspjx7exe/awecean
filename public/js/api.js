export class ApiError extends Error {
  constructor(status, message, code = 'ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body, options = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    ...options,
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, '网络连接中断，请检查网络后重试', 'NETWORK');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, '服务器返回了无法识别的内容', 'BAD_RESPONSE');
  }
  if (!response.ok || !payload?.ok) {
    const error = payload?.error || {};
    if (response.status === 401 && !path.includes('/auth/')) {
      window.dispatchEvent(new CustomEvent('jw:unauthorized'));
    }
    throw new ApiError(
      response.status,
      error.message || '请求失败，请稍后再试',
      error.code || 'ERROR',
      error.details || null
    );
  }
  return payload.data;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  patch: (path, body, options) => request('PATCH', path, body ?? {}, options),
  delete: (path, body, options) => request('DELETE', path, body ?? {}, options),
  upload: (dataUrl) => request('POST', '/api/upload', { dataUrl }),
};

export function errorMessage(error) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error || '出现了一个意外');
}
