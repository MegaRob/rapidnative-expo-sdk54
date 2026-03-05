import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  setDoc,
  startAfter,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { ArrowLeft, Check, MoreVertical, Send, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Bubble, GiftedChat, IMessage } from 'react-native-gifted-chat';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../src/firebaseConfig';
import { blockUser, isUserBlocked } from '../utils/blockUtils';
import ReportModal from './components/ReportModal';
import UserProfileModal from './components/UserProfileModal';

// Helper to create a unique chat ID
const getChatId = (uid1: string, uid2: string) => {
  return uid1 > uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

// Extended IMessage with status for optimistic updates
type MessageStatus = 'sending' | 'sent' | 'error' | 'received' | 'pending';

interface ExtendedIMessage extends IMessage {
  status?: MessageStatus;
  tempId?: string;
}

const coerceMessageStatus = (value: unknown): MessageStatus => {
  switch (value) {
    case 'sending':
    case 'sent':
    case 'error':
    case 'received':
    case 'pending':
      return value;
    default:
      return 'sent';
  }
};

const markMessagesReceived = async (
  chatId: string,
  currentUserId: string,
  docs: QueryDocumentSnapshot[]
) => {
  const batch = writeBatch(db);
  let hasUpdates = false;

  docs.forEach((messageDoc) => {
    const data = messageDoc.data();
    const senderId = data.userId || data.user?._id || data.user;
    const status = data.status;

    if (senderId && senderId !== currentUserId && status !== 'received') {
      batch.update(messageDoc.ref, { status: 'received' });
      hasUpdates = true;
    }
  });

  if (hasUpdates) {
    await batch.commit();
  }
};

// Memoized message bubble component
const MemoizedBubble = React.memo((props: any) => {
  const user = auth.currentUser;
  
  if (!props || !user?.uid) {
    return null;
  }
  
  try {
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          right: {
            backgroundColor: '#8BC34A',
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginRight: 8,
          },
          left: {
            backgroundColor: '#1F2937',
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginLeft: 8,
          },
        }}
        textStyle={{
          right: {
            color: '#FFFFFF',
            fontSize: 16,
          },
          left: {
            color: '#FFFFFF',
            fontSize: 16,
          },
        }}
        renderTime={(timeProps: any) => {
          try {
            const isCurrentUser = timeProps?.currentMessage?.user?._id === user?.uid;
            const statusValue = timeProps?.currentMessage?.status as MessageStatus | undefined;
            const statusLabel =
              statusValue === 'sending'
                ? 'Sending'
                : statusValue === 'received'
                ? 'Received'
                : statusValue === 'error'
                ? 'Failed'
                : statusValue === 'pending'
                ? 'Pending'
                : statusValue === 'sent'
                ? 'Sent'
                : '';
            return (
              <Text style={[
                styles.timestampText,
                isCurrentUser ? styles.timestampTextCurrentUser : styles.timestampTextOtherUser
              ]}>
                {timeProps?.currentMessage?.createdAt &&
                  new Date(timeProps.currentMessage.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                {isCurrentUser && statusLabel ? ` · ${statusLabel}` : ''}
              </Text>
            );
          } catch (error) {
            console.error('Error rendering time:', error);
            return null;
          }
        }}
      />
    );
  } catch (error) {
    console.error('Error rendering bubble:', error);
    return null;
  }
}, (prevProps, nextProps) => {
  // Custom comparison for memoization
  return (
    prevProps?.currentMessage?._id === nextProps?.currentMessage?._id &&
    prevProps?.currentMessage?.text === nextProps?.currentMessage?.text &&
    prevProps?.currentMessage?.status === nextProps?.currentMessage?.status
  );
});

export default function ChatScreen() {
  const [messages, setMessages] = useState<ExtendedIMessage[]>([]);
  const [username, setUsername] = useState('User');
  const [buddyAvatarUrl, setBuddyAvatarUrl] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [derivedBuddyId, setDerivedBuddyId] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<'pending' | 'accepted' | 'declined' | null>(null);
  const [isRequestSender, setIsRequestSender] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastVisibleDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const userProfileCache = useRef<Map<string, { name: string; avatarUrl: string | null }>>(new Map());
  const { buddyId, buddyName, chatId: chatIdParam } = useLocalSearchParams();
  const navigation = useNavigation();
  const router = useRouter();

  const user = auth.currentUser;

  // Read chatId from params first (new navigation from UserProfileModal)
  // Fall back to constructing from buddyId (old navigation from other screens)
  const chatIdString = Array.isArray(chatIdParam) ? chatIdParam[0] : chatIdParam;
  const buddyIdString = Array.isArray(buddyId) ? buddyId[0] : buddyId;
  const chatId = chatIdString || (user?.uid && buddyIdString ? getChatId(user.uid, buddyIdString) : null);
  
  // Use buddyId from params, or fall back to derivedBuddyId from chat document
  const activeBuddyId = buddyIdString || derivedBuddyId;

  // Hide the default header since we're using a custom one
  useEffect(() => {
    try {
      navigation.setOptions({
        headerShown: false,
      });
    } catch (error) {
      console.error('Error setting navigation options:', error);
    }
  }, [navigation]);

  // Listen to chat document for real-time status updates
  useEffect(() => {
    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '' || !user?.uid) {
      setChatStatus(null);
      setIsRequestSender(false);
      return;
    }

    const chatDocRef = doc(db, 'chats', chatId);
    
    const unsubscribe = onSnapshot(
      chatDocRef,
      (chatDoc) => {
        try {
          if (chatDoc.exists() && user?.uid) {
            const chatData = chatDoc.data();
            const userIds = Array.isArray(chatData?.userIds) ? chatData.userIds : [];
            const otherUserId = userIds.find((id: string) => id !== user.uid);
            
            // Set derivedBuddyId if not provided in params
            if (otherUserId && !buddyIdString) {
              setDerivedBuddyId(otherUserId);
            }
            
            // Get chat status
            const status = chatData?.status || null;
            setChatStatus(status);
            
            // Determine if current user is the request sender
            if (status === 'pending' || status === 'declined') {
              const requestedBy = chatData?.requestedBy;
              setIsRequestSender(requestedBy === user.uid);
            } else {
              setIsRequestSender(false);
            }
          } else {
            // Chat doesn't exist yet - set status to null (allows first message)
            setChatStatus(null);
            setIsRequestSender(false);
          }
        } catch (error: any) {
          console.error('Error processing chat document:', error);
          // If it's a permission error, the chat might not exist yet or user doesn't have access
          if (error?.code === 'permission-denied') {
            console.warn('Permission denied reading chat document - chat may not exist yet');
            setChatStatus(null);
            setIsRequestSender(false);
          } else {
            setChatStatus(null);
            setIsRequestSender(false);
          }
        }
      },
      (error: any) => {
        console.error('Error listening to chat document:', error);
        // Handle permission errors gracefully
        if (error?.code === 'permission-denied') {
          console.warn('Permission denied - chat may not exist yet or user lacks access');
        }
        setChatStatus(null);
        setIsRequestSender(false);
      }
    );

    return () => unsubscribe();
  }, [chatId, buddyIdString, user]);

  // Mark chat as viewed when user opens it (for both pending requests and regular chats)
  useEffect(() => {
    if (!user?.uid || !chatId) return;
    
    const markChatAsViewed = async () => {
      try {
        const chatDocRef = doc(db, 'chats', chatId);
        const chatDoc = await getDoc(chatDocRef);
        
        if (chatDoc.exists()) {
          const chatData = chatDoc.data();
          const now = Timestamp.now();
          
          // Get the last message timestamp to mark as viewed
          let lastMessageTime = now;
          try {
            const messagesRef = collection(db, 'chats', chatId, 'messages');
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));
            const messagesSnapshot = await getDocs(messagesQuery);
            if (!messagesSnapshot.empty) {
              const lastMessage = messagesSnapshot.docs[0].data();
              if (lastMessage.createdAt) {
                lastMessageTime = lastMessage.createdAt;
              }
            }
          } catch (error) {
            // No messages yet, use current time
            console.log('No messages found, using current time for lastViewedAt');
          }
          
          // Update lastViewedAt for this user
          const lastViewedAt = chatData.lastViewedAt || {};
          lastViewedAt[user.uid] = lastMessageTime;
          
          // Also add to viewedBy array for pending requests
          const viewedBy = chatData.viewedBy || [];
          if (!viewedBy.includes(user.uid)) {
            viewedBy.push(user.uid);
          }
          
          await setDoc(chatDocRef, {
            lastViewedAt: lastViewedAt,
            viewedBy: viewedBy
          }, { merge: true });
          
          // Clear the global notification flag if there were unread messages
          const userDocRef = doc(db, 'users', user.uid);
          await setDoc(userDocRef, {
            hasUnreadMessages: false
          }, { merge: true });
          
          console.log('Marked chat as viewed');
        }
      } catch (error: any) {
        // Log but don't fail - notification clearing is secondary
        if (error?.code === 'permission-denied') {
          console.warn('Permission denied marking chat as viewed (expected due to security rules)');
        } else {
          console.warn('Failed to mark chat as viewed:', error);
        }
      }
    };
    
    // Mark as viewed when chat screen loads (with a small delay to ensure messages are loaded)
    const timer = setTimeout(() => {
      markChatAsViewed();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [user?.uid, chatId]);

  // Fetch the user's username
  useEffect(() => {
    const fetchUsername = async () => {
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setUsername(userDoc.data().username || 'User');
        }
      }
    };
    fetchUsername();
  }, [user]);

  // Fetch the buddy's avatar and check if blocked
  useEffect(() => {
    const fetchBuddyAvatar = async () => {
      if (activeBuddyId) {
        try {
          const buddyDoc = await getDoc(doc(db, 'users', activeBuddyId));
          if (buddyDoc.exists()) {
            const data = buddyDoc.data();
            setBuddyAvatarUrl(data.avatarUrl || data.photoURL || null);
          }
          
          // Check if user is blocked
          const blocked = await isUserBlocked(activeBuddyId);
          setIsBlocked(blocked);
        } catch (error) {
          console.error('Error fetching buddy avatar:', error);
        }
      }
    };
    fetchBuddyAvatar();
  }, [activeBuddyId]);

  // Load initial messages with pagination
  const loadInitialMessages = useCallback(async () => {
    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      setMessages([]);
      return;
    }

    try {
      const messagesCollection = collection(db, 'chats', chatId, 'messages');
      const q = query(
        messagesCollection, 
        orderBy('createdAt', 'desc'),
        limit(25)
      );

      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setMessages([]);
        setHasMoreMessages(false);
        return;
      }

      const currentUserId = auth.currentUser?.uid || user?.uid;
      if (currentUserId) {
        await markMessagesReceived(chatId, currentUserId, snapshot.docs);
      }

      const loadedMessages: ExtendedIMessage[] = [];
      const userIdsToFetch = new Set<string>();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId || data.user?._id || data.user;
        if (userId && userId !== user?.uid) {
          userIdsToFetch.add(userId);
        }
        
        loadedMessages.push({
          _id: doc.id,
          text: data.text || '',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
          user: { _id: userId, name: '' },
          status: coerceMessageStatus(data.status),
        });
      });

      // Fetch user profiles in parallel (only for users not in cache)
      const uncachedUserIds = Array.from(userIdsToFetch).filter(id => !userProfileCache.current.has(id));
      if (uncachedUserIds.length > 0) {
        const profilePromises = uncachedUserIds.map(async (userId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              userProfileCache.current.set(userId, {
                name: userData.username || userData.name || 'User',
                avatarUrl: userData.avatarUrl || userData.photoURL || null,
              });
            }
          } catch (error) {
            console.error(`Error fetching profile for ${userId}:`, error);
          }
        });
        await Promise.all(profilePromises);
      }

      // Enrich messages with cached user data
      loadedMessages.forEach(msg => {
        const userId = typeof msg.user._id === 'string' ? msg.user._id : String(msg.user._id);
        const cachedProfile = userProfileCache.current.get(userId);
        if (cachedProfile) {
          msg.user.name = cachedProfile.name;
        }
      });

      setMessages(loadedMessages);
      lastVisibleDocRef.current = snapshot.docs[snapshot.docs.length - 1];
      setHasMoreMessages(snapshot.docs.length === 25);
    } catch (error) {
      console.error('Error loading initial messages:', error);
      setMessages([]);
    }
  }, [chatId, user]);

  // Listen for new messages (only the latest ones)
  useEffect(() => {
    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      return;
    }

    try {
      const messagesCollection = collection(db, 'chats', chatId, 'messages');
      const q = query(
        messagesCollection, 
        orderBy('createdAt', 'desc'),
        limit(1) // Only listen to the latest message
      );

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          if (snapshot.empty) return;
          
          const latestDoc = snapshot.docs[0];
          const data = latestDoc.data();
          const userId = data.userId || data.user?._id || data.user;

          const currentUserId = auth.currentUser?.uid || user?.uid;
          if (currentUserId) {
            markMessagesReceived(chatId, currentUserId, snapshot.docs).catch((error) => {
              console.error('Failed to mark message received:', error);
            });
          }
          
          // Check if this message is already in our list
          setMessages(prev => {
            const exists = prev.some(msg => msg._id === latestDoc.id);
            if (exists) return prev;
            
            // Get user profile from cache or fetch
            const cachedProfile = userProfileCache.current.get(userId);
            const newMessage: ExtendedIMessage = {
              _id: latestDoc.id,
              text: data.text || '',
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
              user: { 
                _id: userId, 
                name: cachedProfile?.name || '' 
              },
              status: coerceMessageStatus(data.status),
            };
            
            // If not cached, fetch in background
            const userIdStr = typeof userId === 'string' ? userId : String(userId);
            if (!cachedProfile && userIdStr !== user?.uid) {
              getDoc(doc(db, 'users', userIdStr)).then(userDoc => {
                if (userDoc.exists()) {
                  const userData = userDoc.data();
                  userProfileCache.current.set(userIdStr, {
                    name: userData.username || userData.name || 'User',
                    avatarUrl: userData.avatarUrl || userData.photoURL || null,
                  });
                  // Update message with name
                  setMessages(current => current.map(msg => 
                    msg._id === latestDoc.id 
                      ? { ...msg, user: { ...msg.user, name: userData.username || userData.name || 'User' } }
                      : msg
                  ));
                }
              }).catch(err => console.error('Error fetching user profile:', err));
            }
            
            return [newMessage, ...prev];
          });
        }, 
        (error) => {
          console.error('Error listening to messages:', error);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error('Error setting up messages listener:', error);
      return () => {};
    }
  }, [chatId, user]);

  // Load initial messages on mount
  useEffect(() => {
    loadInitialMessages();
  }, [loadInitialMessages]);

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(async () => {
    if (!chatId || !hasMoreMessages || loadingMore || !lastVisibleDocRef.current) return;

    setLoadingMore(true);
    try {
      const messagesCollection = collection(db, 'chats', chatId, 'messages');
      const q = query(
        messagesCollection,
        orderBy('createdAt', 'desc'),
        startAfter(lastVisibleDocRef.current),
        limit(25)
      );

      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setHasMoreMessages(false);
        setLoadingMore(false);
        return;
      }

      const currentUserId = auth.currentUser?.uid || user?.uid;
      if (currentUserId) {
        await markMessagesReceived(chatId, currentUserId, snapshot.docs);
      }

      const newMessages: ExtendedIMessage[] = [];
      const userIdsToFetch = new Set<string>();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId || data.user?._id || data.user;
        if (userId && userId !== user?.uid) {
          userIdsToFetch.add(userId);
        }
        
        newMessages.push({
          _id: doc.id,
          text: data.text || '',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
          user: { _id: userId, name: '' },
          status: coerceMessageStatus(data.status),
        });
      });

      // Fetch user profiles in parallel
      const uncachedUserIds = Array.from(userIdsToFetch).filter(id => !userProfileCache.current.has(id));
      if (uncachedUserIds.length > 0) {
        const profilePromises = uncachedUserIds.map(async (userId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              userProfileCache.current.set(userId, {
                name: userData.username || userData.name || 'User',
                avatarUrl: userData.avatarUrl || userData.photoURL || null,
              });
            }
          } catch (error) {
            console.error(`Error fetching profile for ${userId}:`, error);
          }
        });
        await Promise.all(profilePromises);
      }

      // Enrich messages with cached user data
      newMessages.forEach(msg => {
        const userId = typeof msg.user._id === 'string' ? msg.user._id : String(msg.user._id);
        const cachedProfile = userProfileCache.current.get(userId);
        if (cachedProfile) {
          msg.user.name = cachedProfile.name;
        }
      });

      setMessages(prev => [...prev, ...newMessages]);
      lastVisibleDocRef.current = snapshot.docs[snapshot.docs.length - 1];
      setHasMoreMessages(snapshot.docs.length === 25);
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, hasMoreMessages, loadingMore, user]);

  // Send a new message with optimistic UI
  const onSend = useCallback(async (messages: IMessage[] = []) => {
    if (!chatId || !user) return;
    
    // Block sending if user is blocked
    if (isBlocked) {
      Alert.alert("User Blocked", "You cannot send messages to a blocked user.");
      return;
    }
    
    // Block sending if chat is declined
    if (chatStatus === 'declined') {
      Alert.alert("Chat Declined", "This chat request has been declined.");
      return;
    }
    
    // Block sending if request is pending and user is the sender
    if (chatStatus === 'pending' && isRequestSender) {
      Alert.alert("Pending Request", "The recipient must accept your chat request before you can send more messages.");
      return;
    }
    
    // For new chats, we might not have activeBuddyId yet, so we need to get it from params or construct it
    const otherUserId = activeBuddyId || buddyIdString;
    if (!otherUserId) {
      console.error('Cannot send message: no buddy ID available');
      return;
    }
    
    const text = messages[0].text;
    const chatIdString = chatId;
    const currentUserId = auth.currentUser?.uid || user?.uid;
    
    if (!currentUserId) {
      console.error('Cannot send message: no authenticated user');
      return;
    }

    // Optimistic UI: Add message immediately with temporary ID
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const optimisticMessage: ExtendedIMessage = {
      _id: tempId,
      text,
      createdAt: new Date(),
      user: {
        _id: currentUserId,
        name: username,
      },
      status: 'sending',
      tempId,
    };

    setMessages(prev => [optimisticMessage, ...prev]);

    // Background sync: Save to Firestore
    try {
      const docRef = await addDoc(collection(db, 'chats', chatIdString, 'messages'), {
        text,
        createdAt: Timestamp.now(),
        userId: currentUserId,
        status: 'sent',
      });
      
      // Update optimistic message with real ID and status, then de-dupe by _id
      setMessages(prev => {
        const updated = prev.map(msg =>
          msg.tempId === tempId
            ? { ...msg, _id: docRef.id, status: 'sent' as MessageStatus, tempId: undefined }
            : msg
        );
        const seen = new Set<string>();
        return updated.filter(msg => {
          const id = String(msg._id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      });
      
      // Ensure chat document exists with userIds + update lastMessageAt for fast inbox loading
      const chatDocRef = doc(db, 'chats', chatIdString);
      await setDoc(chatDocRef, {
        userIds: [user.uid, otherUserId],
        lastMessageAt: Timestamp.now(),
      }, { merge: true });
    } catch (error) {
      // Rollback optimistic update on error
      setMessages(prev => prev.filter(msg => msg.tempId !== tempId));
      console.error("CRITICAL ERROR: Failed to send message:", error);
      Alert.alert("Error", "Failed to send message. Please check connection.");
      return;
    }

    // Notification write (can fail silently)
    try {
      const otherUserDocRef = doc(db, 'users', otherUserId);
      await setDoc(otherUserDocRef, {
        hasUnreadMessages: true
      }, { merge: true });
    } catch (error: any) {
      if (error?.code !== 'permission-denied') {
        console.warn("Failed to set notification flag:", error);
      }
    }
  }, [chatId, user, activeBuddyId, buddyIdString, chatStatus, isRequestSender, isBlocked, username]);

  // Custom render function for message bubbles (using memoized component)
  const renderBubble = useCallback((props: any) => {
    return <MemoizedBubble {...props} />;
  }, []);

  // Custom render function for messages (to add avatar for other user)
  const renderMessage = (props: any) => {
    if (!props || !user?.uid) {
      return null;
    }
    
    try {
      const isCurrentUser = props?.currentMessage?.user?._id === user?.uid;
      
      if (isCurrentUser) {
        // Current user's message - right aligned, green bubble
        return renderBubble(props);
      } else {
        // Other user's message - left aligned, gray bubble with avatar
        const otherUserId = props?.currentMessage?.user?._id || activeBuddyId || '';
        return (
          <View style={styles.messageRowLeft}>
            <Pressable onPress={() => handleAvatarTap(otherUserId)}>
              <Image
                source={{
                  uri: buddyAvatarUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D'
                }}
                style={styles.avatar}
              />
            </Pressable>
            {renderBubble(props)}
          </View>
        );
      }
    } catch (error) {
      console.error('Error rendering message:', error);
      return null;
    }
  };

  // Hide GiftedChat's input toolbar - we'll use custom footer instead
  const renderInputToolbar = () => null;

  // Handle send button press
  const handleSend = () => {
    if (!inputText.trim() || !user || !chatId) return;
    
    // Block sending if user is blocked
    if (isBlocked) {
      Alert.alert("User Blocked", "You cannot send messages to a blocked user.");
      return;
    }
    
    // Block sending if chat is declined
    if (chatStatus === 'declined') {
      Alert.alert("Chat Declined", "This chat request has been declined.");
      return;
    }
    
    // Block sending if request is pending and user is the sender
    if (chatStatus === 'pending' && isRequestSender) {
      Alert.alert("Pending Request", "The recipient must accept your chat request before you can send more messages.");
      return;
    }
    
    const messageText = inputText.trim();
    setInputText(''); // Clear input
    
    // Create message object
    if (!user?.uid) {
      console.error('Cannot send message: user not authenticated');
      return;
    }
    
    const newMessage: IMessage = {
      _id: Math.random().toString(36).substring(7),
      text: messageText,
      createdAt: new Date(),
      user: {
        _id: user.uid,
        name: username,
      },
    };
    
    // Call the onSend function to save to Firestore
    onSend([newMessage]);
  };

  // Handle accepting chat request
  const handleAcceptRequest = async () => {
    if (!chatId || !user) return;
    
    try {
      const chatDocRef = doc(db, 'chats', chatId);
      await setDoc(chatDocRef, {
        status: 'accepted',
        acceptedAt: Timestamp.now(),
      }, { merge: true });
      // Status will update via the real-time listener
    } catch (error) {
      console.error('Error accepting chat request:', error);
      Alert.alert("Error", "Failed to accept chat request.");
    }
  };

  // Handle declining chat request
  const handleDeclineRequest = async () => {
    if (!chatId || !user) return;
    
    try {
      const chatDocRef = doc(db, 'chats', chatId);
      await setDoc(chatDocRef, {
        status: 'declined',
        declinedAt: Timestamp.now(),
      }, { merge: true });
      // Navigate back to chat inbox - the declined chat will be filtered out
      router.back();
    } catch (error) {
      console.error('Error declining chat request:', error);
      Alert.alert("Error", "Failed to decline chat request.");
    }
  };

  // Handle avatar tap to open profile modal
  const handleAvatarTap = (userId: string) => {
    console.log("DEBUG: Avatar tapped for userId:", userId);
    setSelectedUserId(userId);
    setModalVisible(true);
  };

  // Handle blocking a user
  const handleBlockUser = () => {
    if (!activeBuddyId) return;
    
    const displayName = Array.isArray(buddyName) ? buddyName[0] : buddyName || 'this user';
    Alert.alert(
      `Block ${displayName}?`,
      `You will no longer see each other's messages, profiles, or race activity. This can be undone in Settings.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => setShowMenu(false),
        },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!activeBuddyId || !auth.currentUser) return;
            
            try {
              await blockUser(activeBuddyId);
              setIsBlocked(true);
              setShowMenu(false);
              Alert.alert('User Blocked', `${displayName} has been blocked.`, [
                {
                  text: 'OK',
                  onPress: () => {
                    router.back();
                  },
                },
              ]);
            } catch (error: any) {
              console.error('Error blocking user:', error);
              Alert.alert('Error', error.message || 'Failed to block user. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Early return if user is not loaded
  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Please log in to use chat.</Text>
      </SafeAreaView>
    );
  }

  // Early return if chatId cannot be determined
  if (!chatId) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Could not load chat. Missing chat ID.</Text>
      </SafeAreaView>
    );
  }
  
  // Ensure we have a valid user.uid
  if (!user?.uid || user.uid.trim() === '') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Invalid user session.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#111827' }} edges={['top', 'left', 'right']}>
      {/* Custom Header with Back Button */}
      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>
            {Array.isArray(buddyName) ? buddyName[0] : buddyName || 'Chat'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {chatStatus === 'pending' && isRequestSender 
              ? 'Waiting for acceptance' 
              : chatStatus === 'pending' && !isRequestSender
              ? 'New chat request'
              : 'Online'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => setShowMenu(!showMenu)}
            style={styles.menuButton}
          >
            <MoreVertical size={24} color="#8BC34A" />
          </Pressable>
          <Pressable
            onPress={() => {
              if (!activeBuddyId) {
                console.error("CRITICAL: Cannot open modal, activeBuddyId is undefined.");
                return;
              }
              setSelectedUserId(activeBuddyId);
              setModalVisible(true);
            }}
            style={styles.headerAvatarButton}
          >
            <Image
              source={{
                uri: buddyAvatarUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D'
              }}
              style={styles.headerAvatar}
            />
          </Pressable>
        </View>
      </View>
      
      {/* Menu Dropdown */}
      {showMenu && (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowMenu(false)}
          />
          <View style={styles.menuContainer}>
          <Pressable
            onPress={() => {
              if (!activeBuddyId) return;
              setSelectedUserId(activeBuddyId);
              setModalVisible(true);
              setShowMenu(false);
            }}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemText}>View Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setShowReportModal(true);
              setShowMenu(false);
            }}
            style={[styles.menuItem, { borderTopWidth: 1, borderTopColor: '#374151' }]}
          >
            <Text style={[styles.menuItemText, { color: '#F97316' }]}>Report User</Text>
          </Pressable>
          {!isBlocked && (
            <Pressable
              onPress={handleBlockUser}
              style={[styles.menuItem, styles.menuItemDanger]}
            >
              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>Block User</Text>
            </Pressable>
          )}
          {isBlocked && (
            <View style={[styles.menuItem, styles.menuItemDisabled]}>
              <Text style={[styles.menuItemText, styles.menuItemTextDisabled]}>User Blocked</Text>
            </View>
          )}
          </View>
        </>
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={{ flex: 1 }}>
          <GiftedChat
            messages={messages || []}
            onSend={messages => onSend(messages)}
            user={{
              _id: user.uid,
              name: username || 'User',
            }}
            renderMessage={renderMessage}
            renderBubble={renderBubble}
            renderInputToolbar={renderInputToolbar}
            onLoadEarlier={loadMoreMessages}
            loadEarlier={hasMoreMessages && !loadingMore}
            isLoadingEarlier={loadingMore}
            infiniteScroll={true}
            messagesContainerStyle={{
              backgroundColor: '#111827',
            }}
            isKeyboardInternallyHandled={false}
          />
          
          {/* Pending Request Actions - For Request Recipient */}
          {chatStatus === 'pending' && !isRequestSender && (
            <View style={styles.requestActionsContainer}>
              <Text style={styles.requestActionsTitle}>
                New chat request from {Array.isArray(buddyName) ? buddyName[0] : buddyName || 'user'}
              </Text>
              <View style={styles.requestButtons}>
                <TouchableOpacity
                  onPress={handleAcceptRequest}
                  style={styles.acceptButton}
                >
                  <Check size={20} color="white" />
                  <Text style={styles.acceptButtonText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDeclineRequest}
                  style={styles.declineButton}
                >
                  <X size={20} color="white" />
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        
        {/* Custom Footer - Show only if chat is accepted or null (allows first message) */}
        {(chatStatus === 'accepted' || chatStatus === null) && (
          <View style={styles.footerContainer}>
            <TextInput
              placeholder="Type a message..."
              placeholderTextColor="#9CA3AF"
              value={inputText}
              onChangeText={setInputText}
              style={styles.textInput}
              multiline
            />
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim()}
              style={[
                styles.sendButton,
                !inputText.trim() && styles.sendButtonDisabled
              ]}
            >
              <Send size={20} color="white" />
            </Pressable>
          </View>
        )}
        
        {/* Sender View - Show pending message when request is pending and user is sender */}
        {chatStatus === 'pending' && isRequestSender && (
          <View style={styles.footerContainer}>
            <View style={styles.pendingMessageContainer}>
              <Text style={styles.pendingMessageText}>
                Your chat request is pending. You can continue the conversation once {Array.isArray(buddyName) ? buddyName[0] : buddyName || 'the recipient'} accepts your request.
              </Text>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
      {selectedUserId && (
        <UserProfileModal
          visible={modalVisible}
          onClose={() => {
            setModalVisible(false);
            setSelectedUserId(null);
          }}
          userId={selectedUserId}
        />
      )}
      {activeBuddyId && (
        <ReportModal
          visible={showReportModal}
          reportedUserId={activeBuddyId}
          reportedUserName={Array.isArray(buddyName) ? buddyName[0] : buddyName || 'User'}
          chatId={chatId || undefined}
          onClose={() => setShowReportModal(false)}
          onReportSubmitted={() => {
            setShowReportModal(false);
            // Navigate back after report is submitted
            router.back();
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827', // Very dark gray/black background
  },
  errorText: {
    color: 'white',
    textAlign: 'center',
    marginTop: 50,
  },
  // Message row styles
  messageRowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    marginBottom: 4,
  },
  // Avatar style
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  // Bubble styles
  otherUserBubble: {
    backgroundColor: '#1F2937', // Dark gray
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '70%',
    marginLeft: 8,
  },
  currentUserBubble: {
    backgroundColor: '#8BC34A', // Bright green
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '70%',
    marginRight: 8,
  },
  // Text styles
  messageTextLight: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  messageTextDark: {
    color: '#000000',
    fontSize: 16,
  },
  timestampText: {
    fontSize: 12,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timestampTextCurrentUser: {
    color: '#E5E7EB', // text-gray-200 - lighter gray for green bubbles
  },
  timestampTextOtherUser: {
    color: '#9CA3AF', // text-gray-400 - medium gray for gray bubbles
  },
  // Footer container styles
  footerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#111827', // bg-gray-900 equivalent
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  textInput: {
    backgroundColor: '#1F2937', // bg-gray-800 equivalent
    borderRadius: 24, // rounded-full
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 16,
    marginRight: 16,
    flex: 1,
    minHeight: 48,
    maxHeight: 100,
  },
  // Send button style
  sendButton: {
    backgroundColor: '#22C55E', // bg-green-500 equivalent
    borderRadius: 24, // rounded-full
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#374151', // bg-gray-700 equivalent
  },
  // New chat banner styles
  // Header styles
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 4,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 18,
  },
  headerSubtitle: {
    color: '#8BC34A',
    fontSize: 12,
    marginTop: 2,
  },
  menuButton: {
    marginRight: 8,
    padding: 4,
  },
  headerAvatarButton: {
    marginLeft: 4,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  menuContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 8,
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  menuItemDanger: {
    marginTop: 4,
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  menuItemText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  menuItemTextDanger: {
    color: '#EF4444',
  },
  menuItemTextDisabled: {
    color: '#9CA3AF',
  },
  // Request actions styles
  requestActionsContainer: {
    backgroundColor: '#1F2937', // gray-800
    padding: 16,
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151', // gray-700
  },
  requestActionsTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  requestButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#22C55E', // green-500
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#EF4444', // red-500
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  declineButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Pending message for sender
  pendingMessageContainer: {
    backgroundColor: '#374151', // gray-700
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4B5563', // gray-600
  },
  pendingMessageText: {
    color: '#D1D5DB', // gray-300
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});