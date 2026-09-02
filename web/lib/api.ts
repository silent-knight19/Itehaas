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

  // Forks & Network
  forkRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/fork`, { method: 'POST' }),
  getForks: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/forks`),
  getNetwork: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/network`),

  // Branches & VCS History
  listBranches: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/branches`),
  log: (owner: string, repo: string, maxCount = 100) =>
    api(`/api/repos/${owner}/${repo}/log?max_count=${maxCount}&full=1`),
  tree: (owner: string, repo: string, hash: string) =>
    api(`/api/repos/${owner}/${repo}/tree/${hash}`),
  // File browsing (recursive ?path)
  getFile: (owner: string, repo: string, filePath: string, ref?: string) => {
    const enc = filePath.split('/').map(encodeURIComponent).join('/');
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return api(`/api/repos/${owner}/${repo}/file/${enc}${q}`);
  },
  getFileHistory: (owner: string, repo: string, filePath: string, ref?: string) => {
    const enc = filePath.split('/').map(encodeURIComponent).join('/');
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return api(`/api/repos/${owner}/${repo}/history/${enc}${q}`);
  },
  getBlame: (owner: string, repo: string, filePath: string, ref?: string) => {
    const enc = filePath.split('/').map(encodeURIComponent).join('/');
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return api(`/api/repos/${owner}/${repo}/blame/${enc}${q}`);
  },

  // Search
  search: (q: string, type?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return api(`/api/search?${params.toString()}`);
  },

  // Stars
  getStars: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/stars`),
  starRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/star`, { method: 'POST' }),
  unstarRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/star`, { method: 'DELETE' }),

  // Watch
  getWatch: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/watch`),
  watchRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/watch`, { method: 'POST' }),
  unwatchRepo: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/watch`, { method: 'DELETE' }),
  getWatchers: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/watchers`),

  // Notifications
  getNotifications: () => api('/api/notifications'),
  markNotificationRead: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),

  // Issues (with labels/assignees/milestone)
  listIssues: (owner: string, repo: string, status?: 'open' | 'closed', extra?: { label?: string; assignee?: string; milestone?: string }) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (extra?.label) params.set('label', extra.label);
    if (extra?.assignee) params.set('assignee', extra.assignee);
    if (extra?.milestone) params.set('milestone', extra.milestone);
    const q = params.toString();
    return api(`/api/repos/${owner}/${repo}/issues${q ? `?${q}` : ''}`);
  },
  createIssue: (owner: string, repo: string, payload: { title: string; body?: string; labels?: string[]; assignees?: string[]; milestone?: string }) =>
    api(`/api/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify(payload) }),
  getIssue: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}`),
  updateIssue: (owner: string, repo: string, id: string, payload: { title?: string; body?: string; status?: 'open' | 'closed'; labels?: string[]; assignees?: string[]; milestone?: string | null }) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getIssueComments: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}/comments`),
  addIssueComment: (owner: string, repo: string, id: string, body: string) =>
    api(`/api/repos/${owner}/${repo}/issues/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  // Labels & Milestones
  listLabels: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/labels`),
  createLabel: (owner: string, repo: string, payload: { name: string; color?: string; description?: string }) =>
    api(`/api/repos/${owner}/${repo}/labels`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteLabel: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/labels/${id}`, { method: 'DELETE' }),
  listMilestones: (owner: string, repo: string) => api(`/api/repos/${owner}/${repo}/milestones`),
  createMilestone: (owner: string, repo: string, payload: { title: string; description?: string; due_date?: string }) =>
    api(`/api/repos/${owner}/${repo}/milestones`, { method: 'POST', body: JSON.stringify(payload) }),

  // Pull Requests (draft, reviewers, approvals, line-comments, CODEOWNERS, close keywords)
  listPulls: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/pulls`),
  createPull: (owner: string, repo: string, payload: { title: string; body?: string; source_branch: string; target_branch?: string; source_repo?: string; draft?: boolean }) =>
    api(`/api/repos/${owner}/${repo}/pulls`, { method: 'POST', body: JSON.stringify(payload) }),
  getPull: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}`),
  updatePull: (owner: string, repo: string, id: string, payload: { title?: string; body?: string; is_draft?: boolean }) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  markPullReady: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/ready`, { method: 'POST' }),
  getPullDiff: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/diff`),
  mergePull: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/merge`, { method: 'POST' }),
  getPullComments: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/comments`),
  addPullComment: (owner: string, repo: string, id: string, body: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  // Reviewers & Reviews
  getReviewers: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/reviewers`),
  requestReviewers: (owner: string, repo: string, id: string, username: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/reviewers`, { method: 'POST', body: JSON.stringify({ username }) }),
  removeReviewer: (owner: string, repo: string, id: string, username: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/reviewers/${username}`, { method: 'DELETE' }),
  getReviews: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/reviews`),
  addReview: (owner: string, repo: string, id: string, payload: { decision: 'approved' | 'changes_requested' | 'commented'; body?: string }) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/reviews`, { method: 'POST', body: JSON.stringify(payload) }),
  // Line-level review comments
  getReviewComments: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/review_comments`),
  addReviewComment: (owner: string, repo: string, id: string, payload: { body: string; path: string; line?: number; side?: 'LEFT' | 'RIGHT' | 'UNIFIED'; commit_hash?: string }) =>
    api(`/api/repos/${owner}/${repo}/pulls/${id}/review_comments`, { method: 'POST', body: JSON.stringify(payload) }),

  // CI / CD — Real (YAML workflow, Docker runner, artifacts, status checks)
  listPipelines: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pipelines`),
  getPipeline: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pipelines/${id}`),
  runPipeline: (owner: string, repo: string, payload: { ref?: string; commit?: string; workflow?: any }) =>
    api(`/api/repos/${owner}/${repo}/ci/run`, { method: 'POST', body: JSON.stringify(payload) }),
  getJobLogs: (owner: string, repo: string, jobId: string) =>
    api(`/api/repos/${owner}/${repo}/ci/jobs/${jobId}/logs`),
  getWorkflows: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/ci/workflows`),
  getArtifacts: (owner: string, repo: string, pipelineId: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pipelines/${pipelineId}/artifacts`),
  getStatusChecks: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/ci/status_checks`),
  createStatusCheck: (owner: string, repo: string, payload: { name: string; required?: boolean }) =>
    api(`/api/repos/${owner}/${repo}/ci/status_checks`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteStatusCheck: (owner: string, repo: string, id: string) =>
    api(`/api/repos/${owner}/${repo}/ci/status_checks/${id}`, { method: 'DELETE' }),
  getPRChecks: (owner: string, repo: string, prId: string) =>
    api(`/api/repos/${owner}/${repo}/ci/pr/${prId}/checks`),
  getSecrets: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/ci/secrets`),
  createSecret: (owner: string, repo: string, payload: { key: string; value: string }) =>
    api(`/api/repos/${owner}/${repo}/ci/secrets`, { method: 'POST', body: JSON.stringify(payload) }),

  // Remotes
  listRemotes: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/remotes`),
  addRemote: (owner: string, repo: string, payload: { name: string; url: string }) =>
    api(`/api/repos/${owner}/${repo}/remotes`, { method: 'POST', body: JSON.stringify(payload) }),

  // Members
  listMembers: (owner: string, repo: string) =>
    api(`/api/repos/${owner}/${repo}/members`),

  // Orgs & Teams
  listOrgs: () => api('/api/orgs'),
  createOrg: (payload: { name: string; display_name?: string; description?: string }) =>
    api('/api/orgs', { method: 'POST', body: JSON.stringify(payload) }),
  getOrg: (name: string) => api(`/api/orgs/${name}`),
  listOrgMembers: (org: string) => api(`/api/orgs/${org}/members`),
  addOrgMember: (org: string, payload: { username: string; role?: string }) =>
    api(`/api/orgs/${org}/members`, { method: 'POST', body: JSON.stringify(payload) }),
  listTeams: (org: string) => api(`/api/orgs/${org}/teams`),
  createTeam: (org: string, payload: { name: string; description?: string }) =>
    api(`/api/orgs/${org}/teams`, { method: 'POST', body: JSON.stringify(payload) }),
  listTeamMembers: (org: string, team: string) => api(`/api/orgs/${org}/teams/${team}/members`),
  addTeamMember: (org: string, team: string, username: string) =>
    api(`/api/orgs/${org}/teams/${team}/members`, { method: 'POST', body: JSON.stringify({ username }) }),
  listTeamRepos: (org: string, team: string) => api(`/api/orgs/${org}/teams/${team}/repos`),
  addTeamRepo: (org: string, team: string, payload: { owner: string; repo: string; permission?: string }) =>
    api(`/api/orgs/${org}/teams/${team}/repos`, { method: 'POST', body: JSON.stringify(payload) }),

  // Invites
  listInvites: () => api('/api/invites'),
  acceptInvite: (token: string) => api(`/api/invites/${token}/accept`, { method: 'POST' }),
  rejectInvite: (token: string) => api(`/api/invites/${token}/reject`, { method: 'POST' }),
  createOrgInvite: (org: string, payload: { username?: string; email?: string; role?: string }) =>
    api(`/api/orgs/${org}/invites`, { method: 'POST', body: JSON.stringify(payload) }),
  createRepoInvite: (owner: string, repo: string, payload: { username?: string; email?: string; role?: string }) =>
    api(`/api/repos/${owner}/${repo}/invites`, { method: 'POST', body: JSON.stringify(payload) }),

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
