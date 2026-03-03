import { useFocusEffect, useRouter } from 'expo-router';
import { collection, doc, documentId, getDoc, getDocs, query, setDoc, updateDoc, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, Text, View } from 'react-native';
import { auth, db } from '../src/firebaseConfig';

// Helper to create a unique chat ID
const getChatId = (uid1: string, uid2: string) => {
  return uid1 > uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

// Helper to format time ago
const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return 'just now';
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  }
  
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) {
    return `${diffInWeeks}w ago`;
  }
  
  // Return formatted date for older messages
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Define a type for our user data
interface Buddy {
  id: string;
  username: string;
  bio: string;
  avatarUrl?: string;
  lastMessageTime?: Date | null;
  raceName?: string; // The name of the race/trail that connects this user
  chatId: string; // The chat document ID
}

// Define a type for grouped chats
interface GroupedChats {
  [raceName: string]: Buddy[];
}

export default function ChatInboxScreen() {
  const [groupedChats, setGroupedChats] = useState<GroupedChats>({});
  const [loading, setLoading] = useState(true);

  const user = auth.currentUser;
  const router = useRouter();

  const fetchAllBuddies = useCallback(async () => {
      if (!user) {
        setLoading(false);
        return; // Not logged in
      }

      try {
        // 1. Get all of the current user's matches to find potential chat partners
        const myMatchesQuery = query(collection(db, 'matches'), where('userId', '==', user.uid));
        const myMatchesSnapshot = await getDocs(myMatchesQuery);
        const myMatches = myMatchesSnapshot.docs.map(doc => ({
          trailId: doc.data().trailId,
          doc: doc
        }));
        const myTrailIds = myMatches.map(m => m.trailId);

        if (myTrailIds.length === 0) {
          setLoading(false);
          return;
        }

        // 2. Find all other matches for those same trails to get potential buddy IDs
        // Firestore 'IN' operator supports max 30 values, so we need to batch
        const allMatchesSnapshots = [];
        for (let i = 0; i < myTrailIds.length; i += 30) {
          const batch = myTrailIds.slice(i, i + 30);
          const batchQuery = query(collection(db, 'matches'), where('trailId', 'in', batch));
          const batchSnapshot = await getDocs(batchQuery);
          allMatchesSnapshots.push(batchSnapshot);
        }
        
        // Combine all results
        const allMatchesDocs = allMatchesSnapshots.flatMap(snapshot => snapshot.docs);

        // 3. Create a map of buddyId -> shared trailIds
        const buddyTrailMap = new Map<string, string[]>(); // buddyId -> array of shared trailIds
        allMatchesDocs.forEach(matchDoc => {
          const matchData = matchDoc.data();
          const matchUserId = matchData.userId;
          const matchTrailId = matchData.trailId;
          
          if (matchUserId !== user.uid && myTrailIds.includes(matchTrailId)) {
            if (!buddyTrailMap.has(matchUserId)) {
              buddyTrailMap.set(matchUserId, []);
            }
            buddyTrailMap.get(matchUserId)!.push(matchTrailId);
          }
        });
        
        const buddyIds = Array.from(buddyTrailMap.keys());

        if (buddyIds.length === 0) {
          setLoading(false);
          return;
        }

        // 4. For each buddy, construct the chatId and try to fetch the chat document
        // This way we only read chats where we know the user is a participant
        const userChats: Array<{ chatDoc: any, trailId: string }> = [];
        
        for (const buddyId of buddyIds) {
          const chatId = getChatId(user.uid, buddyId);
          try {
            const chatDocRef = doc(db, 'chats', chatId);
            const chatDoc = await getDoc(chatDocRef);
            
            if (chatDoc.exists()) {
              const chatData = chatDoc.data();
              // Get the trailId from the chat document, or use the first shared trailId as fallback
              const trailId = chatData.trailId || (buddyTrailMap.get(buddyId)?.[0]);
              if (trailId) {
                userChats.push({ chatDoc: { id: chatDoc.id, data: chatData }, trailId });
              }
            }
          } catch (error) {
            // Chat doesn't exist or permission denied - skip it
            console.log(`Chat ${chatId} not accessible:`, error);
          }
        }

        if (userChats.length === 0) {
          setLoading(false);
          return;
        }

        // 5. Get unique trailIds from chat documents and fetch trail names
        const trailIds = new Set<string>();
        const chatTrailMap = new Map<string, string>(); // chatId -> trailId
        
        userChats.forEach(({ chatDoc, trailId }) => {
          if (trailId) {
            trailIds.add(trailId);
            chatTrailMap.set(chatDoc.id, trailId);
          }
        });

        // 6. Fetch trail names for all unique trailIds
        const trailNamesMap = new Map<string, string>(); // trailId -> trailName
        for (const trailId of trailIds) {
          try {
            const trailDocRef = doc(db, 'trails', trailId);
            const trailDoc = await getDoc(trailDocRef);
            if (trailDoc.exists()) {
              const trailData = trailDoc.data();
              trailNamesMap.set(trailId, trailData.name || 'Unknown Race');
            }
          } catch (error) {
            console.error(`Error fetching trail ${trailId}:`, error);
          }
        }

        // 7. For each chat, get the other user's profile and last message
        const enrichedChats: Buddy[] = [];
        
        for (const { chatDoc, trailId: chatTrailId } of userChats) {
          try {
            const chatData = chatDoc.data;
            const userIds = chatData.userIds || [];
            const otherUserId = userIds.find((uid: string) => uid !== user.uid);
            
            if (!otherUserId) continue; // Skip if no other user found
            
            // Get the other user's profile
            const userDocRef = doc(db, 'users', otherUserId);
            const userDoc = await getDoc(userDocRef);
            
            if (!userDoc.exists()) continue;
            
            const userData = userDoc.data();
            const username = userData.username || '';
            const displayName = (username.trim() === '' || username === 'NewUser') ? 'Runner' : username;
            
            // Get race name from trailId
            const trailId = chatTrailMap.get(chatDoc.id) || chatTrailId;
            const raceName = trailId && trailNamesMap.has(trailId) 
              ? trailNamesMap.get(trailId)! 
              : 'Unknown Race';
            
            // Get last message time
            let lastMessageTime: Date | null = null;
            try {
              const messagesRef = collection(db, 'chats', chatDoc.id, 'messages');
              const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));
              const messagesSnapshot = await getDocs(messagesQuery);
              
              if (!messagesSnapshot.empty) {
                const lastMessage = messagesSnapshot.docs[0].data();
                if (lastMessage.createdAt) {
                  if (lastMessage.createdAt.toDate) {
                    lastMessageTime = lastMessage.createdAt.toDate();
                  } else if (lastMessage.createdAt.seconds) {
                    lastMessageTime = new Date(lastMessage.createdAt.seconds * 1000);
                  }
                }
              }
            } catch (chatError) {
              // No messages yet - that's okay
              console.log(`No messages found for chat ${chatDoc.id}:`, chatError);
            }
            
            enrichedChats.push({
              id: otherUserId,
              username: displayName,
              bio: userData.bio || 'No bio available',
              avatarUrl: userData.avatarUrl || userData.photoURL || null,
              lastMessageTime: lastMessageTime,
              raceName: raceName,
              chatId: chatDoc.id
            });
          } catch (error) {
            console.error(`Error processing chat ${chatDoc.id}:`, error);
          }
        }

        // 8. Sort chats by last message time (most recent first)
        enrichedChats.sort((a, b) => {
          if (a.lastMessageTime && b.lastMessageTime) {
            return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
          }
          if (a.lastMessageTime && !b.lastMessageTime) return -1;
          if (!a.lastMessageTime && b.lastMessageTime) return 1;
          return a.username.localeCompare(b.username);
        });

        // 9. Group chats by race name
        const grouped: GroupedChats = {};
        enrichedChats.forEach(buddy => {
          const raceName = buddy.raceName || 'Other Races';
          if (!grouped[raceName]) {
            grouped[raceName] = [];
          }
          grouped[raceName].push(buddy);
        });

        // 10. Sort chats within each group by last message time
        Object.keys(grouped).forEach(raceName => {
          grouped[raceName].sort((a, b) => {
            if (a.lastMessageTime && b.lastMessageTime) {
              return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
            }
            if (a.lastMessageTime && !b.lastMessageTime) return -1;
            if (!a.lastMessageTime && b.lastMessageTime) return 1;
            return a.username.localeCompare(b.username);
          });
        });

        setGroupedChats(grouped);
      } catch (error) {
        console.error("Error fetching all buddies: ", error);
      } finally {
        setLoading(false);
      }
    }, [user]);

  // Fetch buddies on mount
  useEffect(() => {
    fetchAllBuddies();
  }, [fetchAllBuddies]);

  // Refresh buddies when screen comes into focus (new messages might have arrived)
  useFocusEffect(
    useCallback(() => {
      fetchAllBuddies();
    }, [fetchAllBuddies])
  );

  // Clear the unread messages flag when the screen is focused
  useFocusEffect(
    useCallback(() => {
      const clearNotification = async () => {
        if (auth.currentUser) {
          const uid = auth.currentUser.uid;
          const userDocRef = doc(db, 'users', uid);
          try {
            // This is for clearing the flag on the CURRENT user
            await setDoc(userDocRef, {
              hasUnreadMessages: false
            }, { merge: true }); 
          } catch (e) {
            // Wrap in try-catch just in case the security rule fails
            console.error("Failed to clear notification flag:", e);
          }
        }
      };
      clearNotification();
    }, [])
  );

  // --- Render Logic ---

  if (loading) {
    return (
      <View className="flex-1 bg-gray-900 items-center justify-center">
        <ActivityIndicator size="large" color="#8BC34A" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-900 p-5">
      <Text className="text-2xl font-bold text-white mb-1 mt-10">My Chats</Text>
      <Text className="text-sm text-gray-400 mb-5">Conversations grouped by race</Text>

      {Object.keys(groupedChats).length === 0 ? (
        <Text className="text-base text-gray-400 text-center mt-12">No chats found yet. Start a conversation!</Text>
      ) : (
        <FlatList
          data={Object.entries(groupedChats)}
          keyExtractor={([raceName]) => raceName}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item: [raceName, buddies] }) => {
            return (
              <View className="mb-6">
                {/* Race Name Header */}
                <Text className="text-xl font-bold text-white mt-6 mb-2">{raceName}</Text>
                
                {/* List of chats for this race */}
                {buddies.map((buddy) => {
                  const hasUnread = false; // TODO: Replace with actual unread count logic
                  const displayName = (buddy.username && buddy.username.trim() !== '' && buddy.username !== 'NewUser') 
                    ? buddy.username 
                    : 'Runner';
                  
                  return (
                    <Pressable 
                      key={buddy.id}
                      className="bg-gray-800 rounded-lg p-4 flex-row items-center mb-3"
                      onPress={() => router.push({ 
                        pathname: "/chat", 
                        params: { 
                          chatId: buddy.chatId,
                          buddyId: buddy.id, 
                          buddyName: displayName 
                        } 
                      })}
                    >
                      {/* Avatar */}
                      <Image
                        source={{
                          uri: buddy.avatarUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D'
                        }}
                        className="rounded-full w-12 h-12"
                      />
                      
                      {/* Text Content (Middle) */}
                      <View className="flex-1 ml-4 mr-3">
                        <Text className="text-white font-bold text-lg">{displayName}</Text>
                      </View>
                      
                      {/* Metadata (Right Side) */}
                      <View className="items-end" style={{ minWidth: 75, flexShrink: 0 }}>
                        {buddy.lastMessageTime ? (
                          <Text className="text-gray-400 text-xs mb-1" numberOfLines={1} style={{ textAlign: 'right' }}>
                            {formatTimeAgo(buddy.lastMessageTime)}
                          </Text>
                        ) : (
                          <Text className="text-gray-400 text-xs mb-1">New</Text>
                        )}
                        {/* Unread badge - conditionally render if there are unread messages */}
                        {hasUnread && (
                          <View className="bg-green-500 rounded-full w-5 h-5 items-center justify-center">
                            <Text className="text-white text-xs font-bold">2</Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
