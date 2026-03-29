import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../src/firebaseConfig';
import type { MergedUserProfile, UserPrivateAccount, UserPublicProfile } from '../types/user';

export const USER_PRIVATE_COLLECTION = 'private';
export const USER_PRIVATE_ACCOUNT_DOC = 'account';

/** Subdoc readable by any signed-in user; only non-PII fields (see pickPeerDisplayFields). */
export const USER_PUBLIC_DISPLAY_COLLECTION = 'publicDisplay';
export const USER_PUBLIC_DISPLAY_DOC_ID = 'profile';

const PEER_DISPLAY_ROOT_KEYS: (keyof UserPublicProfile | 'lastActive')[] = [
  'username',
  'name',
  'displayName',
  'firstName',
  'lastName',
  'avatarUrl',
  'photoURL',
  'bio',
  'lastActive',
];

export function userRootRef(uid: string) {
  return doc(db, 'users', uid);
}

export function userPublicDisplayRef(uid: string) {
  return doc(db, 'users', uid, USER_PUBLIC_DISPLAY_COLLECTION, USER_PUBLIC_DISPLAY_DOC_ID);
}

/** Strip to fields replicated under users/{uid}/publicDisplay/profile for peer reads. */
export function pickPeerDisplayFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PEER_DISPLAY_ROOT_KEYS) {
    if (data[k as string] !== undefined) {
      out[k as string] = data[k as string];
    }
  }
  return out;
}

/** Writes peer-visible fields so chat/inbox can read without accessing root (PII-blocked). */
export async function syncUserPublicDisplay(
  uid: string,
  rootData: Record<string, unknown>
): Promise<void> {
  const picked = pickPeerDisplayFields(rootData);
  if (Object.keys(picked).length === 0) return;
  await setDoc(userPublicDisplayRef(uid), picked, { merge: true });
}

/** Load another user's display row: publicDisplay first, then root if rules allow (legacy). */
export async function fetchPeerDisplayForInbox(
  uid: string
): Promise<Record<string, unknown> | null> {
  const pubSnap = await getDoc(userPublicDisplayRef(uid));
  if (pubSnap.exists()) {
    return pubSnap.data() as Record<string, unknown>;
  }
  try {
    const legacy = await getDoc(userRootRef(uid));
    if (legacy.exists()) {
      return legacy.data() as Record<string, unknown>;
    }
  } catch {
    /* permission-denied: buddy has sensitive keys on root and no mirror yet */
  }
  return null;
}

/** Name + avatar for message bubbles (chat cache). */
export async function fetchPeerProfileForChat(
  uid: string
): Promise<{ name: string; avatarUrl: string | null } | null> {
  const row = await fetchPeerDisplayForInbox(uid);
  if (!row) return null;
  const name = String(row.username || row.name || row.displayName || 'User');
  const avatarUrl =
    (typeof row.avatarUrl === 'string' && row.avatarUrl) ||
    (typeof row.photoURL === 'string' && row.photoURL) ||
    null;
  return { name, avatarUrl };
}

export function userPrivateAccountRef(uid: string) {
  return doc(db, 'users', uid, USER_PRIVATE_COLLECTION, USER_PRIVATE_ACCOUNT_DOC);
}

/**
 * Merge root user doc + private/account. Private fields override when both exist.
 */
export function mergeUserProfileData(
  publicData: Record<string, unknown>,
  privateData: Record<string, unknown> | undefined | null
): MergedUserProfile {
  return {
    ...(publicData as UserPublicProfile),
    ...((privateData || {}) as Partial<UserPrivateAccount>),
  } as MergedUserProfile;
}

export async function fetchMergedUserProfile(uid: string): Promise<MergedUserProfile> {
  const [pubSnap, privSnap] = await Promise.all([
    getDoc(userRootRef(uid)),
    getDoc(userPrivateAccountRef(uid)),
  ]);
  const publicData = pubSnap.exists() ? pubSnap.data() : {};
  const privateData = privSnap.exists() ? privSnap.data() : undefined;
  return mergeUserProfileData(publicData as Record<string, unknown>, privateData as Record<string, unknown>);
}

/** Write sensitive fields only to `private/account`. */
export async function updatePrivateAccount(
  uid: string,
  data: Partial<UserPrivateAccount>,
  options?: { merge?: boolean }
): Promise<void> {
  const ref = userPrivateAccountRef(uid);
  await setDoc(ref, data as Record<string, unknown>, { merge: options?.merge !== false });
}
