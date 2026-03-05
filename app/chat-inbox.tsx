import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const navigation = useNavigation();

  // Hide the default header (removes "(tabs)" back label and "chat-inbox" title)
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

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
        // Firestore 'IN' operator supports max 30 values — fire ALL batches in parallel
        const matchBatchPromises = [];
        for (let i = 0; i < myTrailIds.length; i += 30) {
          const batch = myTrailIds.slice(i, i + 30);
          matchBatchPromises.push(getDocs(query(collection(db, 'matches'), where('trailId', 'in', batch))));
        }
        const allMatchesSnapshots = await Promise.all(matchBatchPromises);
        
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

        // 4. Fetch ALL chat documents in PARALLEL (instead of one-by-one)
        if (!auth.currentUser) return;
        const chatFetchPromises = buddyIds.map(async (buddyId) => {
          const chatId = getChatId(user.uid, buddyId);
          try {
            const chatDocRef = doc(db, 'chats', chatId);
            const chatDoc = await getDoc(chatDocRef);
            if (chatDoc.exists()) {
              const chatData = chatDoc.data();
              const trailId = chatData.trailId || (buddyTrailMap.get(buddyId)?.[0]);
              if (trailId) {
                return { chatDoc: { id: chatDoc.id, data: chatData }, trailId, buddyId };
              }
            }
          } catch (error) {
            // Chat doesn't exist or permission denied - skip it
          }
          return null;
        });
        const chatResults = await Promise.all(chatFetchPromises);
        const userChats = chatResults.filter((r): r is NonNullable<typeof r> => r !== null);

        if (userChats.length === 0) {
          setLoading(false);
          return;
        }

        // 5. Collect unique trailIds and buddy user IDs we need to fetch
        const trailIdsToFetch = new Set<string>();
        const buddyIdsToFetch = new Set<string>();
        const chatTrailMap = new Map<string, string>(); // chatId -> trailId

        userChats.forEach(({ chatDoc, trailId, buddyId }) => {
          if (trailId) {
            trailIdsToFetch.add(trailId);
            chatTrailMap.set(chatDoc.id, trailId);
          }
          // Figure out the other user ID from userIds array
          const userIds = chatDoc.data.userIds || [];
          const otherUserId = userIds.find((uid: string) => uid !== user.uid);
          if (otherUserId) buddyIdsToFetch.add(otherUserId);
        });

        // 6. Fetch ALL trail names + ALL buddy profiles + ALL last messages in PARALLEL
        if (!auth.currentUser) return;

        // Trail name fetches (parallel)
        const trailPromises = Array.from(trailIdsToFetch).map(async (trailId) => {
          try {
            const trailDoc = await getDoc(doc(db, 'trails', trailId));
            if (trailDoc.exists()) {
              return { trailId, name: trailDoc.data().name || 'Unknown Race' };
            }
          } catch (error) { /* skip */ }
          return { trailId, name: 'Unknown Race' };
        });

        // Buddy profile fetches (parallel)
        const buddyProfilePromises = Array.from(buddyIdsToFetch).map(async (buddyId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', buddyId));
            if (userDoc.exists()) {
              return { buddyId, data: userDoc.data() };
            }
          } catch (error) { /* skip */ }
          return { buddyId, data: null };
        });

        // Last message time — prefer lastMessageAt on chat doc (fast), fall back to subcollection query
        const lastMessagePromises = userChats.map(async ({ chatDoc }) => {
          // Fast path: use lastMessageAt stored directly on the chat document
          const chatData = chatDoc.data;
          if (chatData.lastMessageAt) {
            const ts = chatData.lastMessageAt;
            const lastMessageTime = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : null);
            if (lastMessageTime) return { chatId: chatDoc.id, lastMessageTime };
          }
          // Slow fallback: query messages subcollection (only for old chats without lastMessageAt)
          try {
            const messagesRef = collection(db, 'chats', chatDoc.id, 'messages');
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));
            const messagesSnapshot = await getDocs(messagesQuery);
            if (!messagesSnapshot.empty) {
              const lastMessage = messagesSnapshot.docs[0].data();
              let lastMessageTime: Date | null = null;
              if (lastMessage.createdAt) {
                if (lastMessage.createdAt.toDate) {
                  lastMessageTime = lastMessage.createdAt.toDate();
                } else if (lastMessage.createdAt.seconds) {
                  lastMessageTime = new Date(lastMessage.createdAt.seconds * 1000);
                }
              }
              return { chatId: chatDoc.id, lastMessageTime };
            }
          } catch (error) { /* no messages yet */ }
          return { chatId: chatDoc.id, lastMessageTime: null as Date | null };
        });

        // Fire ALL three groups of fetches simultaneously
        const [trailResults, buddyProfileResults, lastMessageResults] = await Promise.all([
          Promise.all(trailPromises),
          Promise.all(buddyProfilePromises),
          Promise.all(lastMessagePromises),
        ]);

        if (!auth.currentUser) return;

        // Build lookup maps from parallel results
        const trailNamesMap = new Map<string, string>();
        trailResults.forEach(r => trailNamesMap.set(r.trailId, r.name));

        const buddyProfileMap = new Map<string, any>();
        buddyProfileResults.forEach(r => { if (r.data) buddyProfileMap.set(r.buddyId, r.data); });

        const lastMessageMap = new Map<string, Date | null>();
        lastMessageResults.forEach(r => lastMessageMap.set(r.chatId, r.lastMessageTime));

        // 7. Assemble enriched chat list (no more network calls needed)
        const enrichedChats: Buddy[] = [];
        
        for (const { chatDoc, trailId: chatTrailId } of userChats) {
          const chatData = chatDoc.data;
          const userIds = chatData.userIds || [];
          const otherUserId = userIds.find((uid: string) => uid !== user.uid);
          if (!otherUserId) continue;

          const userData = buddyProfileMap.get(otherUserId);
          if (!userData) continue;

          const username = userData.username || '';
          const displayName = (username.trim() === '' || username === 'NewUser') ? 'Runner' : username;

          const trailId = chatTrailMap.get(chatDoc.id) || chatTrailId;
          const raceName = trailId && trailNamesMap.has(trailId) 
            ? trailNamesMap.get(trailId)! 
            : 'Unknown Race';

          enrichedChats.push({
            id: otherUserId,
            username: displayName,
            bio: userData.bio || 'No bio available',
            avatarUrl: userData.avatarUrl || userData.photoURL || null,
            lastMessageTime: lastMessageMap.get(chatDoc.id) || null,
            raceName: raceName,
            chatId: chatDoc.id
          });
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
        // Suppress errors caused by logout
        if (auth.currentUser) {
          console.error("Error fetching all buddies: ", error);
        }
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
      <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8BC34A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="px-4 pb-2 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <View>
          <Text className="text-2xl font-bold text-white">My Chats</Text>
          <Text className="text-sm text-gray-400">Conversations grouped by race</Text>
        </View>
      </View>

      <View className="flex-1 px-4">
        {Object.keys(groupedChats).length === 0 ? (
          <Text className="text-base text-gray-400 text-center mt-12">No chats found yet. Start a conversation!</Text>
        ) : (
          <FlatList
            data={Object.entries(groupedChats)}
            keyExtractor={([raceName]) => raceName}
            contentContainerStyle={{ paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: [raceName, buddies] }) => {
              return (
                <View className="mb-4">
                  {/* Race Name Header */}
                  <Text className="text-lg font-bold text-emerald-400 mt-4 mb-2">{raceName}</Text>
                  
                  {/* List of chats for this race */}
                  {buddies.map((buddy) => {
                    const hasUnread = false; // TODO: Replace with actual unread count logic
                    const displayName = (buddy.username && buddy.username.trim() !== '' && buddy.username !== 'NewUser') 
                      ? buddy.username 
                      : 'Runner';
                    
                    return (
                      <Pressable 
                        key={buddy.id}
                        className="bg-[#2C3440] rounded-2xl p-4 flex-row items-center mb-3"
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
                          {/* Unread badge */}
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
    </SafeAreaView>
  );
}
