/**
 * Minimal trail fields for swipe ordering (avoids circular import with app/(tabs)/index).
 */
export type SwipeSortTrail = {
  id: string;
  distance?: number;
  socialTotal?: number;
  matchCount?: number;
  registrationCount?: number;
};

/**
 * Swipe deck ordering: nearest races first; within a small distance band, higher
 * social activity (matches + registrations) ranks higher.
 *
 * Firestore still loads trails by `documentId()` — this only affects client-side order.
 */
const DISTANCE_TIE_EPS_MI = 0.75;

/** Resolved count of Interested (matches) + Registered for a trail. */
export function getTrailSocialTotal(
  trail: SwipeSortTrail,
  socialTotalsByTrailId: Record<string, number>
): number {
  if (typeof trail.socialTotal === 'number') return trail.socialTotal;
  const fromMap = socialTotalsByTrailId[trail.id];
  if (typeof fromMap === 'number') return fromMap;
  return (trail.matchCount ?? 0) + (trail.registrationCount ?? 0);
}

export function compareTrailsForSwipeDeck(
  a: SwipeSortTrail,
  b: SwipeSortTrail,
  socialTotalsByTrailId: Record<string, number>
): number {
  const sa = getTrailSocialTotal(a, socialTotalsByTrailId);
  const sb = getTrailSocialTotal(b, socialTotalsByTrailId);

  const da = a.distance;
  const db = b.distance;

  if (da !== undefined && db !== undefined) {
    if (Math.abs(da - db) > DISTANCE_TIE_EPS_MI) {
      return da - db;
    }
    return sb - sa;
  }
  if (da !== undefined) return -1;
  if (db !== undefined) return 1;
  return sb - sa;
}

/** Preserves the input element type (e.g. full `Trail`) so callers keep correct typing. */
export function sortTrailsForSwipeDeck<T extends SwipeSortTrail>(
  trails: T[],
  socialTotalsByTrailId: Record<string, number>
): T[] {
  return [...trails].sort((a, b) => compareTrailsForSwipeDeck(a, b, socialTotalsByTrailId));
}
