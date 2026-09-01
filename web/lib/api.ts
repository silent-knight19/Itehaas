const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type FetchOpts = RequestInit & { auth?: boolean };

async function api(path: string, opts: FetchOpts = {}) {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { res, json, ok: res.ok, status: res.status };
}

export const Api = {
  health: () => api('/health'),
  me: () => api('/api/auth/me'),
  register: (payload: { username: string; email: string; password: string }) =>
    api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { username: string; password: string }) =>
    api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  listRepos: () => api('/api/repos'),
  getRepo: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}`),
  createRepo: (payload: { name: string; description?: string; visibility?: string }) =>
    api('/api/repos', { method: 'POST', body: JSON.stringify(payload) }),
  listBranches: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/branches`),
  log: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/log`),
  tree: (owner: string, repo: string, hash: string) => api(`/api/repos/${owner}/${repo}/tree/${hash}`),
};

export { API_URL };
