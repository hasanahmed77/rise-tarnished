// #13 — the Next.js/auth boundary around handleRecapRequest (see handler.ts's
// header for why the actual recap logic is tested there instead). This file
// only proves route.ts's own job: parse the body, require a session, and
// otherwise get out of the way.
//
// Both dependencies (@/lib/supabase/server, ./handler) are mocked — this
// suite never touches next/headers' request-scope requirement or makes a
// real Supabase/network call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockHandleRecapRequest = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('./handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./handler')>();
  return { ...actual, handleRecapRequest: mockHandleRecapRequest };
});

const { POST } = await import('./route');

function postRequest(body: unknown) {
  return new Request('http://localhost/api/recap', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockHandleRecapRequest.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/recap', () => {
  it('400s on a missing attemptId, before ever checking auth', async () => {
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ recap: null });
    expect(mockHandleRecapRequest).not.toHaveBeenCalled();
    // Auth wasn't even consulted — bad input is rejected before touching
    // Supabase at all.
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('400s on an attemptId of the wrong type', async () => {
    const response = await POST(postRequest({ attemptId: 12345 }));
    expect(response.status).toBe(400);
  });

  it('400s on an unparseable body rather than throwing', async () => {
    const badRequest = new Request('http://localhost/api/recap', {
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
    expect(await response.json()).toEqual({ recap: null });
    expect(mockHandleRecapRequest).not.toHaveBeenCalled();
  });

  it('delegates to handleRecapRequest and returns its result for an authenticated caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockHandleRecapRequest.mockResolvedValue({ recap: 'Margit read your panic-rolls.' });

    const response = await POST(postRequest({ attemptId: 'attempt-1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recap: 'Margit read your panic-rolls.' });
    expect(mockHandleRecapRequest).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'attempt-1' }),
    );
  });

  it('still returns 200 with recap:null when the handler found nothing to say', async () => {
    // The handler's own "no recap" cases (victory, no data, ungrounded,
    // provider failure) are not route-level errors — verifying the route
    // doesn't turn that into a non-200 status.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockHandleRecapRequest.mockResolvedValue({ recap: null });

    const response = await POST(postRequest({ attemptId: 'attempt-2' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recap: null });
  });
});
