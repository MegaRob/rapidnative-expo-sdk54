import { useNavigation, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../src/firebaseConfig';
import { unblockUser } from '../../utils/blockUtils';

interface BlockedUser {
  id: string;
  name: string;
  avatarUrl?: string;
  blockId: string; // The document ID in the blocks collection
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  const fetchBlockedUsers = useCallback(async () => {
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

      const blockedUsersList: BlockedUser[] = [];

      // Fetch user details for each blocked user
      for (const blockDoc of blockedSnapshot.docs) {
        const blockData = blockDoc.data();
        const blockedUserId = blockData.blockedId;

        if (blockedUserId) {
          try {
            const userDocRef = doc(db, 'users', blockedUserId);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
              const userData = userDoc.data();
              const displayName = userData.name || userData.username || userData.displayName || 'Unknown User';
              
              blockedUsersList.push({
                id: blockedUserId,
                name: displayName,
                avatarUrl: userData.avatarUrl || userData.photoURL || null,
                blockId: blockDoc.id,
              });
            }
          } catch (error) {
            console.error(`Error fetching user ${blockedUserId}:`, error);
          }
        }
      }

      setBlockedUsers(blockedUsersList);
    } catch (error) {
      console.error('Error fetching blocked users:', error);
      Alert.alert('Error', 'Failed to load blocked users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const handleUnblock = async (blockedUser: BlockedUser) => {
    Alert.alert(
      'Unblock User',
      `Are you sure you want to unblock ${blockedUser.name}?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Unblock',
          style: 'default',
          onPress: async () => {
            setUnblocking(blockedUser.id);
            try {
              await unblockUser(blockedUser.id);
              // Refresh the list
              await fetchBlockedUsers();
              Alert.alert('Success', `${blockedUser.name} has been unblocked.`);
            } catch (error: any) {
              console.error('Error unblocking user:', error);
              Alert.alert('Error', error.message || 'Failed to unblock user. Please try again.');
            } finally {
              setUnblocking(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-900" edges={['top', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8BC34A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-900" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mr-4"
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-2xl font-bold text-white">Blocked Users</Text>
          <Text className="text-sm text-gray-400">Manage your blocked users</Text>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 p-5 pt-2">
        {blockedUsers.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-base text-gray-400 text-center">
              {`You haven't blocked any users yet.`}
            </Text>
          </View>
        ) : (
          <FlashList
            data={blockedUsers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item }) => (
              <View className="bg-gray-800 rounded-lg p-4 mb-3 flex-row items-center">
                {/* Avatar */}
                <Image
                  source={{
                    uri: item.avatarUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D'
                  }}
                  className="w-12 h-12 rounded-full mr-4"
                />
                
                {/* Name */}
                <View className="flex-1">
                  <Text className="text-white text-lg font-semibold">{item.name}</Text>
                </View>

                {/* Unblock Button */}
                <TouchableOpacity
                  onPress={() => handleUnblock(item)}
                  disabled={unblocking === item.id}
                  className={`bg-green-500 px-4 py-2 rounded-lg ${
                    unblocking === item.id ? 'opacity-50' : ''
                  }`}
                >
                  {unblocking === item.id ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-semibold">Unblock</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}


