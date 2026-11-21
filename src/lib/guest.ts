// Finds the user's anonymous (guest) account, or signs in a new one only if there really is none.
// Pure logic around the auth client, so it can be tested without a phone (tests/secure-storage.test.ts).

type AuthResult<T> = Promise<{ data: T; error: { code?: string; message?: string } | null }>;
export type GuestAuth = {
  getSession(): AuthResult<{ session: { user: { id: string } } | null }>;
  signInAnonymously(): AuthResult<{ user: { id: string } | null }>;
};

/** Why there is no account to use right now; the app stays local and tries again later. */
export class GuestUnavailable extends Error {
  reason: 'storage' | 'disabled' | 'offline';
  constructor(reason: 'storage' | 'disabled' | 'offline') {
    super(reason);
    this.reason = reason;
    this.name = 'GuestUnavailable';
  }
}

export async function ensureGuest(auth: GuestAuth): Promise<string> {
  // Only "really no session" may lead to a new anonymous account. If the stored session can't be read
  // right now (keychain not reachable, see secureStorage.ts) or the check fails, stay local this time,
  // or the user would lose the link to everything synced so far.
  let session;
  try {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch {
    throw new GuestUnavailable('storage');
  }
  if (session) return session.user.id;
  const { data: signedIn, error } = await auth.signInAnonymously();
  if (error || !signedIn.user) {
    const msg = error?.message ?? '';
    if (error?.code === 'anonymous_provider_disabled' || (/anonymous/i.test(msg) && /disabled/i.test(msg))) {
      throw new GuestUnavailable('disabled');
    }
    throw new GuestUnavailable('offline');
  }
  return signedIn.user.id;
}
