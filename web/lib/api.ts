const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type FetchOpts = RequestInit & { auth?: boolean };

export async function api(path: string, opts: FetchOpts = {}) {
  const url = `${API_URL}${path}`;
  try {
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
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { res, json, ok: res.ok, status: res.status };
  } catch (err: any) {
    return {
      res: null,
      json: { error: err?.message || 'Network connection failed' },
      ok: false,
      status: 0,
    };
  }
}

export const Api = {
  // System
  health: () => api('/health'),

  // Auth
  me: () => api('/api/auth/me'),
  register: (payload: { username: string; email: string; password: string }) =>
    api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { username: string; password: string }) =>
    api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),

  // Repositories
  listRepos: (options?: { mine?: boolean; all?: boolean; search?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.mine !== undefined) params.set('mine', String(options.mine));
    if (options?.all !== undefined) params.set('all', String(options.all));
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const q = params.toString();
    return api(`/api/repos${q ? `?${q}` : ''}`);
  },
  getRepo: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}`),
  createRepo: (payload: { name: string; description?: string; visibility?: string }) =>
    api('/api/repos', { method: 'POST', body: JSON.stringify(payload) }),
  updateRepo: (owner: string, repo: string, payload: { description?: string; visibility?: string; default_branch?: string }) =>
    api(`/api/repos/${owner}/${repo}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}`, { method: 'DELETE' }),

  // Branches & VCS History
  listBranches: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/branches`),
  log: (owner: string, repo: string, maxCount = 100) =>
    api(`/api/repos/${owner}/${repo}/log?max_count=${maxCount}&full=1`),
  tree: (owner: string, repo: string, hash: string) =>
    api(`/api/repos/${owner}/${repo}/tree/${hash}`),

  // Stars
  getStars: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/stars`),
  starRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/star`, { method: 'POST' }),
  unstarRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/star`, { method: 'DELETE' }),

  // Issues
  listIssues: (owner: string, repo: string, status?: 'open' | 'closed') =>
    api(`/api/repos/${owner}/${repo}/issues${status ? `?status=${status}` : ''}`),
  createIssue: (owner: string, repo: string, payload: { title: string; body?: string }) =>
    api(`/api/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify(payload) }),
  getIssue: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}`),
  updateIssue: (owner: string, repo: string, id: string, payload: { title?: string; body?: string; status?: 'open' | 'closed' }) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getIssueComments: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}/comments`),
  addIssueComment: (owner: string, repo: string, id: string, body: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  // Pull Requests
  listPulls: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/pulls`),
  createPull: (owner: string, repo: string, payload: { title: string; body?: string; source_branch: string; target_branch?: string }) =>
    api(`/api/repos/${owner}/${repo}/pulls`, { method: 'POST', body: JSON.stringify(payload) }),
  getPull: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}`),
  getPullDiff: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/diff`),
  mergePull: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/merge`, { method: 'POST' }),
  getPullComments: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/comments`),
  addPullComment: (owner: string, repo: string, id: string, body: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  // CI / CD
  listPipelines: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pipelines`),
  getPipeline: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pipelines/${id}`),
  runPipeline: (owner: string, repo: string, payload: { ref?: string; commit?: string }) =>
    api(`/api/repos/${owner}/${repo}/ci/run`, { method: 'POST', body: JSON.stringify(payload) }),
  getJobLogs: (owner: string, repo: string, jobId: string) =>
    api(`/api/repos/${owner}/${repo}/ci/jobs/${jobId}/logs`),

  // Remotes
  listRemotes: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/remotes`),
  addRemote: (owner: string, repo: string, payload: { name: string; url: string }) =>
    api(`/api/repos/${owner}/${repo}/remotes`, { method: 'POST', body: JSON.stringify(payload) }),

  // Members
  listMembers: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/members`),

  // Profile
  getUser: (username: string) => api(`/api/users/${username}`),
  updateProfile: (username: string, payload: { bio?: string; avatar_url?: string | null }) =>
    api(`/api/users/${username}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getUserRepos: (
    username: string,
    opts?: { visibility?: string; sort?: string; search?: string; limit?: number; offset?: number }
  ) => {
    const params = new URLSearchParams();
    if (opts?.visibility) params.set('visibility', opts.visibility);
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.search) params.set('search', opts.search);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const q = params.toString();
    return api(`/api/users/${username}/repos${q ? `?${q}` : ''}`);
  },
  getUserStars: (username: string, opts?: { search?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.search) params.set('search', opts.search);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const q = params.toString();
    return api(`/api/users/${username}/stars${q ? `?${q}` : ''}`);
  },
  getUserActivity: (username: string, limit = 30) =>
    api(`/api/users/${username}/activity?limit=${limit}`),
  getContributions: (username: string, year?: number, days?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', String(year));
    if (days) params.set('days', String(days));
    const q = params.toString();
    return api(`/api/users/${username}/contributions${q ? `?${q}` : ''}`);
  },
};

export { API_URL };
