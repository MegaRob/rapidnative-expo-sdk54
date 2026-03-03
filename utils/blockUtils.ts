import { collection, doc, deleteDoc, getDoc, setDoc, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../src/firebaseConfig';

/**
 * Get the block document ID from two user IDs
 */
export function getBlockId(blockerId: string, blockedId: string): string {
  return blockerId > blockedId ? `${blockerId}_${blockedId}` : `${blockedId}_${blockerId}`;
}

/**
 * Block a user
 */
export async function blockUser(blockedUserId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated to block someone');
  }

  if (currentUser.uid === blockedUserId) {
    throw new Error('Cannot block yourself');
  }

  const blockId = getBlockId(currentUser.uid, blockedUserId);
  const blockDocRef = doc(db, 'blocks', blockId);

  // Check if block already exists
  const existingBlock = await getDoc(blockDocRef);
  if (existingBlock.exists()) {
    // Block already exists, verify current user is the blocker
    const data = existingBlock.data();
    if (data.blockerId === currentUser.uid) {
      // Already blocked by this user, return success (idempotent)
      return;
    } else {
      throw new Error('Block already exists with different blocker');
    }
  }

  try {
    await setDoc(blockDocRef, {
      blockerId: currentUser.uid,
      blockedId: blockedUserId,
      timestamp: Timestamp.now(),
    });
    console.log('Successfully created block:', blockId);
  } catch (error: any) {
    console.error('Error creating block document:', error);
    console.error('Block ID:', blockId);
    console.error('Blocker ID:', currentUser.uid);
    console.error('Blocked ID:', blockedUserId);
    throw error;
  }
}

/**
 * Unblock a user
 */
export async function unblockUser(blockedUserId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated to unblock someone');
  }

  const blockId = getBlockId(currentUser.uid, blockedUserId);
  const blockDocRef = doc(db, 'blocks', blockId);

  // Check if the block exists and current user is the blocker
  const blockDoc = await getDoc(blockDocRef);
  if (!blockDoc.exists()) {
    throw new Error('Block does not exist');
  }

  const blockData = blockDoc.data();
  if (blockData.blockerId !== currentUser.uid) {
    throw new Error('You can only unblock users you have blocked');
  }

  await deleteDoc(blockDocRef);
}

/**
 * Check if a user is blocked (either by current user or has blocked current user)
 */
export async function isUserBlocked(otherUserId: string): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return false;
  }

  const blockId = getBlockId(currentUser.uid, otherUserId);
  const blockDocRef = doc(db, 'blocks', blockId);

  try {
    const blockDoc = await getDoc(blockDocRef);
    return blockDoc.exists();
  } catch (error) {
    console.error('Error checking if user is blocked:', error);
    return false;
  }
}

/**
 * Get all blocked user IDs for the current user (users they have blocked)
 */
export async function getBlockedUserIds(): Promise<string[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return [];
  }

  try {
    const blocksCollection = collection(db, 'blocks');
    const blockedQuery = query(blocksCollection, where('blockerId', '==', currentUser.uid));
    const snapshot = await getDocs(blockedQuery);
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return data.blockedId;
    }).filter((id): id is string => typeof id === 'string');
  } catch (error) {
    console.error('Error fetching blocked user IDs:', error);
    return [];
  }
}


