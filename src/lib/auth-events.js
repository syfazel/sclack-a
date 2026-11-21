// Auth-event handling with no imports — the App wires it to the real
// Supabase client and the stores; the probe imports it directly and
// drives it with fakes.
//
// THE BUG IT FIXES (live, G2 test 2026-11-22 ~01:10): the session
// bounced back to the login page 4 times shortly after login, each
// time needing a re-login. The old App handler wiped ALL local state
// on ANY null session from onAuthStateChange — including transient
// ones. A null session does not always mean "signed out":
//   * gotrue emits INITIAL_SESSION / TOKEN_REFRESHED with a null
//     session while storage is mid-write or a concurrent refresh was
//     discarded;
//   * a STALE tab (one left open from an earlier test, holding a
//     rotated-away refresh token) fails its refresh and calls
//     _removeSession — which deletes the SHARED localStorage session
//     and broadcasts SIGNED_OUT to every tab. The access token cannot
//     expire minutes after a fresh login, so a same-tab refresh
//     failure cannot explain 4 bounces in a few minutes — a foreign
//     tab is the only mechanism in auth-js that destroys a fresh
//     session that fast. (The app cannot stop another tab's client;
//     it can only survive it.)
//
// THE FIX, in handleAuthEvent:
//   1. A session always wins.
//   2. A null session on anything BUT SIGNED_OUT is transient: re-read
//      storage, restore if a session is there, otherwise KEEP the
//      current user. The app never returns to the login page on its
//      own for a transient null.
//   3. SIGNED_OUT is verified against storage first (a foreign tab
//      can broadcast it while this tab's session is intact).
//   4. If storage is empty, the stashed refresh token is tried: the
//      server session is still alive when the wipe came from another
//      tab (only the local copy was deleted), so a fresh session is
//      minted and the tab recovers with no re-login. A genuine
//      sign-out revoked the token server-side, so recovery fails and
//      the wipe stands. The stash lives only in memory (this tab) and
//      is cleared on any real sign-out, so a deliberate sign-out is
//      never "recovered".

let stashedRefreshToken = null

export function stashSession(session) {
  stashedRefreshToken = session?.refresh_token || null
}

export function clearStashedSession() {
  stashedRefreshToken = null
}

// Handle one auth event. `deps` is injected (real client in the App,
// fakes in the probe). Returns 'signed-in' | 'kept' | 'signed-out'.
export async function handleAuthEvent(event, session, deps) {
  const { getSession, refreshSession, onSignedIn, onSignedOut } = deps
  if (session?.user) {
    stashSession(session)
    await onSignedIn(session.user)
    return 'signed-in'
  }
  if (event !== 'SIGNED_OUT') {
    try {
      const { data } = await getSession()
      if (data?.session?.user) {
        stashSession(data.session)
        await onSignedIn(data.session.user)
        return 'signed-in'
      }
    } catch {
      // Storage unreadable: keep the current user, do not wipe.
    }
    return 'kept'
  }
  try {
    const { data } = await getSession()
    if (data?.session?.user) {
      stashSession(data.session)
      await onSignedIn(data.session.user)
      return 'signed-in'
    }
  } catch {
    // Fall through to the stashed-token recovery below.
  }
  if (stashedRefreshToken) {
    try {
      const { data, error } = await refreshSession({
        refresh_token: stashedRefreshToken
      })
      if (!error && data?.session?.user) {
        stashSession(data.session)
        await onSignedIn(data.session.user)
        return 'signed-in'
      }
    } catch {
      // Recovery failed: the session is genuinely gone.
    }
  }
  clearStashedSession()
  await onSignedOut()
  return 'signed-out'
}
