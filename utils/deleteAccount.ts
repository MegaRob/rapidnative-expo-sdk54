/**
 * Client-side Firestore cleanup before Firebase Auth account deletion.
 * Requires matching security rules (see firestore.rules).
 */
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  query,
  type QueryDocumentSnapshot,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../src/firebaseConfig';
import { userPublicDisplayRef } from './userProfile';

const APP_ID =
  process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:1048323489461:web:e3c514fcf0d7748ef848fc';

const getChatId = (uid1: string, uid2: string) =>
  uid1 > uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;

/** Delete all docs returned by a query in batches (by document ref). */
async function deleteQuerySnapshotDocs(
  docs: QueryDocumentSnapshot[]
): Promise<void> {
  if (docs.length === 0) return;
  const BATCH_SIZE = 450;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/**
 * Delete all messages sent by this user across all chats (collection group).
 */
async function deleteUserChatMessages(uid: string): Promise<void> {
  try {
    const q = query(collectionGroup(db, 'messages'), where('userId', '==', uid));
    const snap = await getDocs(q);
    await deleteQuerySnapshotDocs(snap.docs);
  } catch (e: unknown) {
    // If index missing, fall back to per-chat deletion via match graph
    const code = (e as { code?: string })?.code;
    if (code !== 'failed-precondition') {
      throw e;
    }
    await deleteUserChatMessagesViaMatches(uid);
  }
}

/**
 * Fallback when collection group index is not deployed yet.
 */
async function deleteUserChatMessagesViaMatches(uid: string): Promise<void> {
  const myMatchesSnap = await getDocs(
    query(collection(db, 'matches'), where('userId', '==', uid))
  );
  const myTrailIds = myMatchesSnap.docs.map((d) => d.data().trailId as string);
  if (myTrailIds.length === 0) return;

  const buddySet = new Set<string>();
  for (let i = 0; i < myTrailIds.length; i += 30) {
    const batch = myTrailIds.slice(i, i + 30);
    const snap = await getDocs(
      query(collection(db, 'matches'), where('trailId', 'in', batch))
    );
    snap.docs.forEach((d) => {
      const u = d.data().userId as string;
      if (u && u !== uid) buddySet.add(u);
    });
  }

  for (const buddyId of buddySet) {
    const chatId = getChatId(uid, buddyId);
    const mq = query(
      collection(db, 'chats', chatId, 'messages'),
      where('userId', '==', uid)
    );
    const snap = await getDocs(mq);
    await deleteQuerySnapshotDocs(snap.docs);
  }
}

async function deleteUserSubcollections(uid: string): Promise<void> {
  const savedSnap = await getDocs(collection(db, 'users', uid, 'savedRaces'));
  await deleteQuerySnapshotDocs(savedSnap.docs);
  const dislikedSnap = await getDocs(collection(db, 'users', uid, 'dislikedRaces'));
  await deleteQuerySnapshotDocs(dislikedSnap.docs);
  const privateSnap = await getDocs(collection(db, 'users', uid, 'private'));
  await deleteQuerySnapshotDocs(privateSnap.docs);
  try {
    await deleteDoc(userPublicDisplayRef(uid));
  } catch {
    /* missing mirror */
  }
}

async function deleteQueryByField(
  collName: string,
  field: string,
  value: string
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, collName), where(field, '==', value))
  );
  await deleteQuerySnapshotDocs(snap.docs);
}

async function deleteBlocksForUser(uid: string): Promise<void> {
  const asBlocker = await getDocs(
    query(collection(db, 'blocks'), where('blockerId', '==', uid))
  );
  const asBlocked = await getDocs(
    query(collection(db, 'blocks'), where('blockedId', '==', uid))
  );
  await deleteQuerySnapshotDocs(asBlocker.docs);
  await deleteQuerySnapshotDocs(asBlocked.docs);
}

async function deleteCommunityPostsAndInterested(uid: string): Promise<void> {
  const postsRef = collection(
    db,
    'artifacts',
    APP_ID,
    'public',
    'data',
    'community_posts'
  );
  const postsSnap = await getDocs(
    query(postsRef, where('authorId', '==', uid))
  );
  for (const postDoc of postsSnap.docs) {
    const interestedSnap = await getDocs(
      collection(postDoc.ref, 'interested')
    );
    await deleteQuerySnapshotDocs(interestedSnap.docs);
    await deleteDoc(postDoc.ref);
  }
}

async function deleteArtifactRegistrations(uid: string): Promise<void> {
  const regRef = collection(
    db,
    'artifacts',
    APP_ID,
    'public',
    'data',
    'registrations'
  );
  const snap = await getDocs(query(regRef, where('userId', '==', uid)));
  await deleteQuerySnapshotDocs(snap.docs);
}

async function deleteArtifactUserDoc(uid: string): Promise<void> {
  const ref = doc(db, 'artifacts', APP_ID, 'users', uid);
  try {
    await deleteDoc(ref);
  } catch {
    // ignore missing
  }
}

/**
 * Deletes Firestore data owned by the user while they are still authenticated.
 * Call before `deleteUser(auth.currentUser)`.
 */
export async function deleteUserFirestoreData(uid: string): Promise<void> {
  if (!uid) throw new Error('Missing user id');

  await deleteUserChatMessages(uid);
  await deleteUserSubcollections(uid);

  await deleteQueryByField('matches', 'userId', uid);
  await deleteQueryByField('registrations', 'userId', uid);
  await deleteQueryByField('completed_races', 'userId', uid);
  await deleteQueryByField('reviews', 'userId', uid);

  await deleteBlocksForUser(uid);
  await deleteCommunityPostsAndInterested(uid);
  await deleteArtifactRegistrations(uid);
  await deleteArtifactUserDoc(uid);

  const userRef = doc(db, 'users', uid);
  await deleteDoc(userRef);
}

export function isRequiresRecentLoginError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return (
    err?.code === 'auth/requires-recent-login' ||
    (typeof err?.message === 'string' &&
      err.message.includes('requires-recent-login'))
  );
}

