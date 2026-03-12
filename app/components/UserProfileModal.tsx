import React, { forwardRef, useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { db, auth } from '../../src/firebaseConfig';
import { blockUser, isUserBlocked } from '../../utils/blockUtils';
import ReportModal, { ReportModalHandle } from './ReportModal';
import StandardBottomSheet, { StandardBottomSheetHandle } from './StandardBottomSheet';

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface UserProfileModalHandle {
  present: () => void;
  close: () => void;
}

interface UserProfileModalProps {
  userId: string;
  onClose?: () => void;
  trailId?: string;
  distance?: string;
}

interface UserData {
  name?: string;
  bio?: string;
  pace?: string;
  photoURL?: string;
  avatarUrl?: string;
  isPrivate?: boolean;
  hometown?: string;
  location?: string;
  primaryDistance?: string;
  preferredTerrain?: string;
  paceRange?: string;
  lookingFor?: string[];
  openDMs?: boolean;
}

// Helper to create a unique chat ID (alphabetically sorted)
const getChatId = (uid1: string, uid2: string): string => {
  return uid1 > uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

const UserProfileModal = forwardRef<UserProfileModalHandle, UserProfileModalProps>(
  ({ userId, onClose, trailId, distance }, ref) => {
    const router = useRouter();
    const sheetRef = useRef<StandardBottomSheetHandle>(null);
    const reportModalRef = useRef<ReportModalHandle>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isBlocked, setIsBlocked] = useState(false);
    const [blocking, setBlocking] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [completedCount, setCompletedCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);

    // Expose present / close to parent via ref
    React.useImperativeHandle(ref, () => ({
      present: () => {
        setIsOpen(true);
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    useEffect(() => {
      const fetchUserData = async () => {
        if (!userId) {
          setLoading(false);
          return;
        }

        setLoading(true);
        try {
          const userDocRef = doc(db, 'users', userId);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data() as UserData;
            setUserData(data);
            setIsPrivate(data.isPrivate === true);
          } else {
            setUserData(null);
          }

          const currentUid = auth.currentUser?.uid;
          if (currentUid && currentUid === userId) {
            const completedQuery = query(
              collection(db, 'completed_races'),
              where('userId', '==', userId)
            );
            const completedSnapshot = await getDocs(completedQuery);
            setCompletedCount(completedSnapshot.size);
          } else {
            setCompletedCount(0);
          }

          const blocked = await isUserBlocked(userId);
          setIsBlocked(blocked);
        } catch (error) {
          console.error('Error fetching user data:', error);
          setUserData(null);
        } finally {
          setLoading(false);
        }
      };

      if (isOpen && userId) {
        fetchUserData();
      } else {
        setUserData(null);
        setLoading(true);
        setIsBlocked(false);
      }
    }, [isOpen, userId]);

    const displayName = userData?.name || 'Runner';
    const bio = userData?.bio || 'No bio available';
    const pace = userData?.pace || 'Not specified';
    const photoUrl = userData?.avatarUrl || userData?.photoURL || null;
    const hometown = userData?.hometown || userData?.location || 'Not set';
    const primaryDistance = userData?.primaryDistance || 'Not set';
    const preferredTerrain = userData?.preferredTerrain || 'Not set';
    const paceRange = userData?.paceRange || 'Not set';
    const lookingFor = Array.isArray(userData?.lookingFor) ? userData?.lookingFor : [];
    const openDMs = userData?.openDMs !== false;
    const badgeThresholds = [1, 5, 10, 15];
    const earnedBadges = badgeThresholds.filter((threshold) => completedCount >= threshold);

    const handleBlockUser = () => {
      const name = userData?.name || 'this user';
      Alert.alert(
        `Block ${name}?`,
        `You will no longer see each other's messages, profiles, or race activity. This can be undone in Settings.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              if (!userId || !auth.currentUser) return;
              setBlocking(true);
              try {
                await blockUser(userId);
                setIsBlocked(true);
                Alert.alert('User Blocked', `${name} has been blocked.`, [
                  {
                    text: 'OK',
                    onPress: () => {
                      sheetRef.current?.close();
                      router.back();
                    },
                  },
                ]);
              } catch (error: any) {
                console.error('Error blocking user:', error);
                Alert.alert('Error', error.message || 'Failed to block user. Please try again.');
              } finally {
                setBlocking(false);
              }
            },
          },
        ]
      );
    };

    const handleStartChat = async () => {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid || !userId) return;
      if (currentUid === userId) return;

      if (!openDMs) {
        Alert.alert('DMs Closed', 'This runner is not accepting direct messages.');
        return;
      }

      try {
        const chatId = getChatId(currentUid, userId);
        const chatDocRef = doc(db, 'chats', chatId);
        const chatDoc = await getDoc(chatDocRef);

        if (!chatDoc.exists()) {
          const chatData: any = {
            userIds: [currentUid, userId],
            createdAt: Timestamp.now(),
            status: 'pending',
            requestedBy: currentUid,
          };
          if (trailId) chatData.trailId = trailId;
          if (distance) chatData.distance = distance;
          await setDoc(chatDocRef, chatData, { merge: true });

          try {
            const recipientDocRef = doc(db, 'users', userId);
            await setDoc(recipientDocRef, { hasUnreadMessages: true }, { merge: true });
          } catch (error: any) {
            if (error?.code === 'permission-denied') {
              console.warn('Permission denied setting notification flag');
            } else {
              console.warn('Failed to set notification flag:', error);
            }
          }
        } else {
          const existingData = chatDoc.data();
          if (trailId && !existingData.trailId) {
            await setDoc(chatDocRef, { trailId }, { merge: true });
          }
          if (distance && !existingData.distance) {
            await setDoc(chatDocRef, { distance }, { merge: true });
          }
        }

        router.push({
          pathname: '/chat',
          params: { chatId: chatId, buddyId: userId },
        });
        sheetRef.current?.close();
      } catch (error: any) {
        console.error('Error starting chat:', error);
        Alert.alert(
          'Unable to Start Chat',
          'There was a problem starting the conversation. Please try again later.',
          [{ text: 'OK' }]
        );
      }
    };

    const handleDismiss = useCallback(() => {
      setIsOpen(false);
      onClose?.();
    }, [onClose]);

    return (
      <>
        <StandardBottomSheet
          ref={sheetRef}
          snapPoints={['70%', '95%']}
          onClose={handleDismiss}
        >
          {loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <ActivityIndicator size="large" color="#10B981" />
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              {/* Profile Image */}
              {photoUrl ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={{ width: 128, height: 128, borderRadius: 64, marginBottom: 24, backgroundColor: '#1E293B' }}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={{
                    width: 128,
                    height: 128,
                    borderRadius: 64,
                    marginBottom: 24,
                    backgroundColor: '#1E293B',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 36, fontWeight: '700' }}>
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}

              {/* User Name */}
              <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '700', marginBottom: 16, textAlign: 'center' }}>
                {displayName}
              </Text>

              {/* Bio */}
              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Bio</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16, lineHeight: 24 }}>{bio}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Hometown</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{hometown}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Pace</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{pace}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Primary Distance</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{primaryDistance}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Preferred Terrain</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{preferredTerrain}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Pace Range</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{paceRange}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Looking For</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(!lookingFor || lookingFor.length === 0) ? (
                    <Text style={{ color: '#9CA3AF' }}>None set</Text>
                  ) : (
                    lookingFor.map((tag) => (
                      <View key={tag} style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 }}>
                        <Text style={{ color: '#34D399', fontSize: 14 }}>
                          {tag.charAt(0).toUpperCase() + tag.slice(1)}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>DM Status</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{openDMs ? 'Open to DMs' : 'DMs Closed'}</Text>
              </View>

              <View style={{ width: '100%', marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 18, marginBottom: 8 }}>Races Completed</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16, marginBottom: 8 }}>{completedCount}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {earnedBadges.length === 0 ? (
                    <Text style={{ color: '#9CA3AF' }}>No badges yet</Text>
                  ) : (
                    earnedBadges.map((threshold) => (
                      <View key={threshold} style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 }}>
                        <Text style={{ color: '#34D399', fontSize: 14 }}>{threshold} Races</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>

              {/* Start Chat Button */}
              {auth.currentUser?.uid !== userId && !isBlocked && !isPrivate && openDMs && (
                <Pressable
                  onPress={handleStartChat}
                  style={{
                    width: '100%',
                    backgroundColor: '#10B981',
                    paddingVertical: 16,
                    borderRadius: 8,
                    alignItems: 'center',
                    marginTop: 16,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Start Chat</Text>
                </Pressable>
              )}

              {/* Private user message */}
              {auth.currentUser?.uid !== userId && isPrivate && (
                <View style={{ width: '100%', paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginTop: 16, backgroundColor: 'rgba(51, 65, 85, 0.5)' }}>
                  <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 }}>
                    This user has a private profile and cannot be contacted directly.
                  </Text>
                </View>
              )}

              {/* DMs closed message */}
              {auth.currentUser?.uid !== userId && !isPrivate && !openDMs && (
                <View style={{ width: '100%', paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginTop: 16, backgroundColor: 'rgba(51, 65, 85, 0.5)' }}>
                  <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 }}>
                    This runner has closed their DMs.
                  </Text>
                </View>
              )}

              {/* Report User Button */}
              {auth.currentUser?.uid !== userId && (
                <Pressable
                  onPress={() => reportModalRef.current?.present()}
                  style={{
                    width: '100%',
                    paddingVertical: 16,
                    borderRadius: 8,
                    alignItems: 'center',
                    marginTop: 16,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: '#F97316',
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#F97316' }}>Report User</Text>
                </Pressable>
              )}

              {/* Block User Button */}
              {auth.currentUser?.uid !== userId && (
                <Pressable
                  onPress={handleBlockUser}
                  disabled={blocking || isBlocked}
                  style={{
                    width: '100%',
                    paddingVertical: 16,
                    borderRadius: 8,
                    alignItems: 'center',
                    marginTop: 16,
                    backgroundColor: isBlocked ? '#374151' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: '700', color: isBlocked ? '#9CA3AF' : '#EF4444' }}>
                    {isBlocked ? 'Blocked' : 'Block User'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </StandardBottomSheet>

        {/* Report Modal */}
        <ReportModal
          ref={reportModalRef}
          reportedUserId={userId}
          reportedUserName={displayName}
          onReportSubmitted={() => {
            sheetRef.current?.close();
          }}
        />
      </>
    );
  }
);

UserProfileModal.displayName = 'UserProfileModal';
export default UserProfileModal;
