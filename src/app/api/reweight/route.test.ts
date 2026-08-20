// #64 — the Next.js/auth boundary around handleReweightRequest (see
// handler.ts's header for why the actual reweight logic is tested there
// instead). This file only proves route.ts's own job: parse the body,
// require a session, and otherwise get out of the way. Mirrors recap's
// route.test.ts exactly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockHandleReweightRequest = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('./handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./handler')>();
  return { ...actual, handleReweightRequest: mockHandleReweightRequest };
});

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return new Request('http://localhost/api/reweight', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockHandleReweightRequest.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/reweight', () => {
  it('400s on a missing attemptId, before ever checking auth', async () => {
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ updated: false });
    expect(mockHandleReweightRequest).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('400s on an attemptId of the wrong type', async () => {
    const response = await POST(postRequest({ attemptId: 12345 }));
    expect(response.status).toBe(400);
  });

  it('400s on an unparseable body rather than throwing', async () => {
    const badRequest = new Request('http://localhost/api/reweight', {
      method: 'POST',
      body: 'not json',
    });
    const response = await POST(badRequest);
    expect(response.status).toBe(400);
  });

  it('401s when there is no authenticated user, before calling the handler', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(postRequest({ attemptId: 'abc' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ updated: false });
    expect(mockHandleReweightRequest).not.toHaveBeenCalled();
  });

  it('delegates to handleReweightRequest and returns its result for an authenticated caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockHandleReweightRequest.mockResolvedValue({ updated: true });

    const response = await POST(postRequest({ attemptId: 'attempt-1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });
    expect(mockHandleReweightRequest).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'attempt-1' }),
    );
  });

  it('still returns 200 with updated:false when the handler had nothing to persist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockHandleReweightRequest.mockResolvedValue({ updated: false });

    const response = await POST(postRequest({ attemptId: 'attempt-2' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: false });
  });
});
