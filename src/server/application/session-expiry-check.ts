// Session expiry check (Milestone 4).
// Sessions carry an expires_at from creation; M4 checks it before any callback
// transition or enhancement claim. Full expiry sweeping is Milestone 6.

export function isSessionExpired(session: { expiresAt: string }, now: Date = new Date()): boolean {
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}
