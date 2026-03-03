import React, { useState, useEffect } from 'react';
import { Modal, View, Text, Image, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { db, auth } from '../../src/firebaseConfig';
import { blockUser, isUserBlocked } from '../../utils/blockUtils';
import ReportModal from './ReportModal';

interface UserProfileModalProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  trailId?: string; // Optional: The trail/race ID associated with this chat
  distance?: string; // Optional: The distance associated with this chat
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

export default function UserProfileModal({
  visible,
  userId,
  onClose,
  trailId,
  distance,
}: UserProfileModalProps) {
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

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
          // Check if user has private profile enabled
          setIsPrivate(data.isPrivate === true);
        } else {
          console.log('User document not found');
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

        // Check if user is blocked
        const blocked = await isUserBlocked(userId);
        setIsBlocked(blocked);
      } catch (error) {
        console.error('Error fetching user data:', error);
        setUserData(null);
      } finally {
        setLoading(false);
      }
    };

    if (visible && userId) {
      fetchUserData();
    } else {
      // Reset state when modal is closed
      setUserData(null);
      setLoading(true);
      setIsBlocked(false);
    }
  }, [visible, userId]);

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

  // Handle blocking a user
  const handleBlockUser = () => {
    const displayName = userData?.name || 'this user';
    Alert.alert(
      `Block ${displayName}?`,
      `You will no longer see each other's messages, profiles, or race activity. This can be undone in Settings.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!userId || !auth.currentUser) return;
            
            setBlocking(true);
            try {
              await blockUser(userId);
              setIsBlocked(true);
              Alert.alert('User Blocked', `${displayName} has been blocked.`, [
                {
                  text: 'OK',
                  onPress: () => {
                    onClose();
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

  // Handle starting a chat
  const handleStartChat = async () => {
    const currentUid = auth.currentUser?.uid;
    
    if (!currentUid || !userId) {
      console.error('Cannot start chat: missing user IDs');
      return;
    }

    // Don't allow chatting with yourself
    if (currentUid === userId) {
      console.error('Cannot start chat with yourself');
      return;
    }

    if (!openDMs) {
      Alert.alert('DMs Closed', 'This runner is not accepting direct messages.');
      return;
    }

    try {
      // Create unique chatId by combining the two UIDs (alphabetically sorted)
      const chatId = getChatId(currentUid, userId);

      // Check if the chat room already exists by trying to get the document
      // In this structure, the chatId IS the document ID
      const chatDocRef = doc(db, 'chats', chatId);
      const chatDoc = await getDoc(chatDocRef);

      // If the chat room does not exist, create a new document
      if (!chatDoc.exists()) {
        const chatData: any = {
          userIds: [currentUid, userId],
          createdAt: Timestamp.now(),
          status: 'pending', // New chats start as pending
          requestedBy: currentUid,
        };
        
        // Add trailId and distance if provided
        if (trailId) {
          chatData.trailId = trailId;
        }
        if (distance) {
          chatData.distance = distance;
        }
        
        await setDoc(chatDocRef, chatData, { merge: true });
        console.log('Created new chat room:', chatId);
        
        // Set notification flag for the recipient
        try {
          const recipientDocRef = doc(db, 'users', userId);
          await setDoc(recipientDocRef, {
            hasUnreadMessages: true
          }, { merge: true });
          console.log('Set notification flag for recipient');
        } catch (error: any) {
          // Log but don't fail - notification is secondary
          if (error?.code === 'permission-denied') {
            console.warn('Permission denied setting notification flag (expected due to security rules)');
          } else {
            console.warn('Failed to set notification flag:', error);
          }
        }
      } else {
        // If chat exists but doesn't have trailId/distance, update it
        const existingData = chatDoc.data();
        if (trailId && !existingData.trailId) {
          await setDoc(chatDocRef, { trailId }, { merge: true });
        }
        if (distance && !existingData.distance) {
          await setDoc(chatDocRef, { distance }, { merge: true });
        }
        console.log('Chat room already exists:', chatId);
      }

      // Navigate to the chat screen directly using chatId
      router.push({
        pathname: '/chat', // The actual file path (app/chat.tsx)
        params: { chatId: chatId, buddyId: userId } // Pass both chatId and buddyId for compatibility
      });

      // Close the modal
      onClose();
    } catch (error: any) {
      // Log detailed error information
      console.error('Error starting chat:', error);
      console.error('Firebase Error Code:', error.code);
      console.error('Firebase Error Message:', error.message);
      
      // Show user-friendly error message
      Alert.alert(
        'Unable to Start Chat',
        'There was a problem starting the conversation. Please try again later. If the problem persists, check your permissions or contact support.',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-gray-900">
        {/* Header with Close Button */}
        <View className="flex-row justify-end items-center px-4 pt-8 pb-2">
          <Pressable
            onPress={onClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-gray-800"
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Content */}
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#8BC34A" />
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              alignItems: 'center',
              paddingHorizontal: 24,
              paddingTop: 32,
              paddingBottom: 32,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* Profile Image */}
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                className="w-32 h-32 rounded-full mb-6 bg-gray-800"
                resizeMode="cover"
              />
            ) : (
              <View className="w-32 h-32 rounded-full mb-6 bg-gray-800 items-center justify-center">
                <Text className="text-white text-4xl font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {/* User Name */}
            <Text className="text-white text-3xl font-bold mb-4 text-center">
              {displayName}
            </Text>

            {/* Bio */}
            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Bio</Text>
              <Text className="text-white text-base leading-6">{bio}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Hometown</Text>
              <Text className="text-white text-base">{hometown}</Text>
            </View>

            {/* Pace */}
            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Pace</Text>
              <Text className="text-white text-base">{pace}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Primary Distance</Text>
              <Text className="text-white text-base">{primaryDistance}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Preferred Terrain</Text>
              <Text className="text-white text-base">{preferredTerrain}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Pace Range</Text>
              <Text className="text-white text-base">{paceRange}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Looking For</Text>
              <View className="flex-row flex-wrap gap-2">
                {lookingFor.length === 0 ? (
                  <Text className="text-gray-400">None set</Text>
                ) : (
                  lookingFor.map((tag) => (
                    <View key={tag} className="bg-green-500/20 px-3 py-1 rounded-full">
                      <Text className="text-green-400 text-sm">
                        {tag.charAt(0).toUpperCase() + tag.slice(1)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">DM Status</Text>
              <Text className="text-white text-base">{openDMs ? 'Open to DMs' : 'DMs Closed'}</Text>
            </View>

            <View className="w-full mb-6">
              <Text className="text-gray-400 text-lg mb-2">Races Completed</Text>
              <Text className="text-white text-base mb-2">{completedCount}</Text>
              <View className="flex-row flex-wrap gap-2">
                {earnedBadges.length === 0 ? (
                  <Text className="text-gray-400">No badges yet</Text>
                ) : (
                  earnedBadges.map((threshold) => (
                    <View key={threshold} className="bg-green-500/20 px-3 py-1 rounded-full">
                      <Text className="text-green-400 text-sm">{threshold} Races</Text>
                    </View>
                  ))
                )}
              </View>
            </View>

            {/* Start Chat Button */}
            {/* Hide Start Chat if user is private (unless current user is admin or the private user themselves) */}
            {auth.currentUser?.uid !== userId && !isBlocked && !isPrivate && openDMs && (
              <Pressable
                onPress={handleStartChat}
                className="w-full bg-green-500 hover:bg-green-600 py-4 rounded-lg items-center mt-4"
              >
                <Text className="text-white text-lg font-bold">Start Chat</Text>
              </Pressable>
            )}
            
            {/* Message for private users */}
            {auth.currentUser?.uid !== userId && isPrivate && (
              <View className="w-full py-4 rounded-lg items-center mt-4 bg-gray-700/50">
                <Text className="text-gray-400 text-sm text-center px-4">
                  This user has a private profile and cannot be contacted directly.
                </Text>
              </View>
            )}

            {auth.currentUser?.uid !== userId && !isPrivate && !openDMs && (
              <View className="w-full py-4 rounded-lg items-center mt-4 bg-gray-700/50">
                <Text className="text-gray-400 text-sm text-center px-4">
                  This runner has closed their DMs.
                </Text>
              </View>
            )}

            {/* Report User Button */}
            {auth.currentUser?.uid !== userId && (
              <Pressable
                onPress={() => setShowReportModal(true)}
                className="w-full py-4 rounded-lg items-center mt-4 bg-transparent border border-orange-500"
              >
                <Text className="text-lg font-bold text-orange-500">
                  Report User
                </Text>
              </Pressable>
            )}

            {/* Block User Button */}
            {auth.currentUser?.uid !== userId && (
              <Pressable
                onPress={handleBlockUser}
                disabled={blocking || isBlocked}
                className={`w-full py-4 rounded-lg items-center mt-4 ${
                  isBlocked ? 'bg-gray-600' : 'bg-transparent'
                }`}
              >
                <Text className={`text-lg font-bold ${isBlocked ? 'text-gray-400' : 'text-red-500'}`}>
                  {isBlocked ? 'Blocked' : 'Block User'}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      
      {/* Report Modal */}
      {showReportModal && (
        <ReportModal
          visible={showReportModal}
          reportedUserId={userId}
          reportedUserName={displayName}
          onClose={() => setShowReportModal(false)}
          onReportSubmitted={() => {
            setShowReportModal(false);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

