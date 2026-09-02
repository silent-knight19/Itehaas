import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
  query: (...args: any[]) => mockQuery(...args),
  getClient: vi.fn(),
  pool: { on: vi.fn() },
  };
});

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
      .mockResolvedValueOnce({ rows: [{ role: 'read' }] })
      .mockResolvedValueOnce({ rows: [] });
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
      .mockResolvedValueOnce({ rows: [{ role: 'read' }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await isAdmin('repo-id', 'user-2')).toBe(false);
  });

  it('canWrite via team write true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ permission: 'write' }] });
    expect(await canWrite('repo-id', 'user-2')).toBe(true);
  });

  it('canWrite via team read false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ permission: 'read' }] });
    expect(await canWrite('repo-id', 'user-2')).toBe(false);
  });

  it('isAdmin via team admin true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ permission: 'admin' }] });
    expect(await isAdmin('repo-id', 'user-2')).toBe(true);
  });

  it('canRead via team read true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ permission: 'read' }] });
    expect(await canRead('repo-id', 'user-2', 'private')).toBe(true);
  });
});
