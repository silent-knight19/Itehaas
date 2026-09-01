import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  getClient: vi.fn(),
  pool: { on: vi.fn() },
}));

import { canRead, canWrite, isAdmin } from './permissions';

describe('permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canRead public true without user', async () => {
    expect(await canRead('repo-id', null, 'public')).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('canRead private false without user', async () => {
    expect(await canRead('repo-id', null, 'private')).toBe(false);
  });

  it('canRead private true if owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] }); // isOwner check
    expect(await canRead('repo-id', 'user-1', 'private')).toBe(true);
  });

  it('canWrite owner true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] });
    expect(await canWrite('repo-id', 'user-1')).toBe(true);
  });

  it('canWrite member write true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'write' }] });
    expect(await canWrite('repo-id', 'user-2')).toBe(true);
  });

  it('canWrite member read false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'read' }] });
    expect(await canWrite('repo-id', 'user-2')).toBe(false);
  });

  it('isAdmin member admin true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] });
    expect(await isAdmin('repo-id', 'user-2')).toBe(true);
  });

  it('isAdmin read false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'read' }] });
    expect(await isAdmin('repo-id', 'user-2')).toBe(false);
  });
});
