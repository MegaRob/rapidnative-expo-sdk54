import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../src/firebaseConfig';

/**
 * Hook to fetch all blocked users for the current user
 * Returns both users the current user has blocked AND users who have blocked the current user
 */
export function useBlockedUsers() {
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [blockedByUserIds, setBlockedByUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlockedUsers = async () => {
      if (!auth.currentUser) {
        setLoading(false);
        return;
      }

      try {
        const currentUserId = auth.currentUser.uid;
        const blocksCollection = collection(db, 'blocks');

        // Fetch blocks where current user is the blocker
        const blockedQuery = query(blocksCollection, where('blockerId', '==', currentUserId));
        const blockedSnapshot = await getDocs(blockedQuery);
        const blockedIds = new Set<string>();
        blockedSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.blockedId) {
            blockedIds.add(data.blockedId);
          }
        });

        // Fetch blocks where current user is the blocked
        const blockedByQuery = query(blocksCollection, where('blockedId', '==', currentUserId));
        const blockedBySnapshot = await getDocs(blockedByQuery);
        const blockedByIds = new Set<string>();
        blockedBySnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.blockerId) {
            blockedByIds.add(data.blockerId);
          }
        });

        setBlockedUserIds(blockedIds);
        setBlockedByUserIds(blockedByIds);
      } catch (error: any) {
        console.error('Error fetching blocked users:', error);
        // If it's a permissions error, set empty sets and continue
        // The app will work without block filtering until rules are fixed
        if (error?.code === 'permission-denied') {
          console.warn('Permission denied fetching blocked users - continuing without block filtering');
          setBlockedUserIds(new Set());
          setBlockedByUserIds(new Set());
        }
      } finally {
        setLoading(false);
      }
    };

    fetchBlockedUsers();
  }, []);

  // Combined set of all users that should be filtered (either blocked or blocking)
  const allBlockedIds = new Set([...blockedUserIds, ...blockedByUserIds]);

  return {
    blockedUserIds,
    blockedByUserIds,
    allBlockedIds,
    loading,
  };
}


