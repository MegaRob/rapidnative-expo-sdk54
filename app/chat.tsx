import { useFocusEffect } from '@react-navigation/native';
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
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { ArrowLeft, Check, MoreVertical, RefreshCw, Send as SendIcon, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Bubble,
  Composer,
  GiftedChat,
  IMessage,
  InputToolbar,
  Send,
} from 'react-native-gifted-chat';
import type { InputToolbarProps } from 'react-native-gifted-chat/lib/InputToolbar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../src/firebaseConfig';
import { blockUser, isUserBlocked } from '../utils/blockUtils';
import { fetchPeerProfileForChat, userPublicDisplayRef } from '../utils/userProfile';
import ReportModal, { ReportModalHandle } from './components/ReportModal';
import UserProfileModal, { UserProfileModalHandle } from './components/UserProfileModal';

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

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** User-facing copy for Firestore failures (used with Alert.alert). */
function firestoreUserMessage(
  error: unknown,
  fallback = 'Something went wrong. Check your connection and try again.'
): string {
  const code = (error as { code?: string })?.code;
  if (code === 'permission-denied') {
    return "You don't have permission to access this. Try again or go back and reopen the chat.";
  }
  if (code === 'unavailable') {
    return 'The service is temporarily unavailable. Please try again in a moment.';
  }
  return fallback;
}

function parseLastActiveMs(data: Record<string, unknown> | undefined): number | null {
  try {
    if (!data) return null;
    const raw =
      data.lastActive ??
      data.lastActiveAt ??
      data.lastSeen ??
      data.lastOnlineAt;
    if (raw == null) return null;

    if (raw instanceof Timestamp) {
      return raw.toMillis();
    }

    if (typeof raw === 'object' && raw !== null) {
      const t = raw as {
        toMillis?: () => number;
        toDate?: () => Date;
        seconds?: number;
        nanoseconds?: number;
      };
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t.toDate === 'function') return t.toDate().getTime();
      if (typeof t.seconds === 'number') {
        const ns = typeof t.nanoseconds === 'number' ? t.nanoseconds : 0;
        return t.seconds * 1000 + Math.floor(ns / 1e6);
      }
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw > 1e12 ? raw : raw * 1000;
    }
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (raw instanceof Date) return raw.getTime();
    return null;
  } catch {
    return null;
  }
}

function formatPresenceLabel(lastMs: number | null): { online: boolean; label: string } {
  if (lastMs == null) return { online: false, label: 'Offline' };
  const diffMs = Date.now() - lastMs;
  if (diffMs <= ONLINE_WINDOW_MS) return { online: true, label: 'Online' };
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return { online: false, label: `Active ${mins}m ago` };
  const hours = Math.floor(mins / 60);
  if (hours < 48) return { online: false, label: `Active ${hours}h ago` };
  const days = Math.floor(hours / 24);
  return { online: false, label: `Active ${days}d ago` };
}

const markMessagesReceived = async (
  chatId: string,
  currentUserId: string,
  docs: QueryDocumentSnapshot[]
) => {
  try {
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
  } catch (e) {
    if (__DEV__) {
      console.error('markMessagesReceived failed:', e);
    }
  }
};

type MemoizedBubbleProps = {
  onRetryFailedMessage?: (msg: ExtendedIMessage) => void;
};

// Memoized message bubble component
const MemoizedBubble = React.memo((props: any & MemoizedBubbleProps) => {
  const user = auth.currentUser;
  const { onRetryFailedMessage, ...bubbleProps } = props;

  if (!bubbleProps || !user?.uid) {
    return null;
  }

  const statusValue = bubbleProps?.currentMessage?.status as MessageStatus | undefined;
  const bubbleOpacity =
    statusValue === 'sending' ? 0.7 : statusValue === 'error' ? 1 : 1;
  const isCurrentUser = bubbleProps?.currentMessage?.user?._id === user?.uid;

  const bubbleShadow = Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 2.5,
    },
    android: {
      elevation: 1,
    },
    default: {},
  });

  try {
    return (
      <View style={{ opacity: bubbleOpacity }}>
        <Bubble
          {...bubbleProps}
          wrapperStyle={{
            right: {
              backgroundColor: '#10B981',
              borderRadius: 20,
              borderBottomRightRadius: 4,
              paddingHorizontal: 16,
              paddingVertical: 12,
              marginRight: 8,
              borderWidth: statusValue === 'error' && isCurrentUser ? 1 : 0,
              borderColor: statusValue === 'error' ? 'rgba(239,68,68,0.9)' : 'transparent',
              ...bubbleShadow,
            },
            left: {
              backgroundColor: '#1F2937',
              borderRadius: 20,
              borderBottomLeftRadius: 4,
              paddingHorizontal: 16,
              paddingVertical: 12,
              marginLeft: 8,
              ...bubbleShadow,
            },
          }}
          textStyle={{
            right: {
              color: '#FFFFFF',
              fontSize: 16,
              lineHeight: 22,
            },
            left: {
              color: '#FFFFFF',
              fontSize: 16,
              lineHeight: 22,
            },
          }}
          renderTime={(timeProps: any) => {
            try {
              const isMe = timeProps?.currentMessage?.user?._id === user?.uid;
              const sv = timeProps?.currentMessage?.status as MessageStatus | undefined;
              const statusLabel =
                sv === 'sending'
                  ? 'Sending…'
                  : sv === 'received'
                  ? 'Received'
                  : sv === 'error'
                  ? 'Not sent'
                  : sv === 'pending'
                  ? 'Pending'
                  : sv === 'sent'
                  ? 'Sent'
                  : '';
              const timeStr = timeProps?.currentMessage?.createdAt
                ? new Date(timeProps.currentMessage.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
              return (
                <View
                  style={{
                    alignSelf: isMe ? 'flex-end' : 'flex-start',
                    marginTop: 2,
                    maxWidth: '100%',
                  }}
                >
                  <Text
                    style={[
                      styles.timestampText,
                      isMe ? styles.timestampTextCurrentUser : styles.timestampTextOtherUser,
                    ]}
                  >
                    {timeStr}
                    {isMe && statusLabel ? ` · ${statusLabel}` : ''}
                  </Text>
                  {isMe && sv === 'error' && onRetryFailedMessage && timeProps?.currentMessage && (
                    <Pressable
                      hitSlop={8}
                      onPress={() => onRetryFailedMessage(timeProps.currentMessage as ExtendedIMessage)}
                      style={styles.retryRow}
                    >
                      <RefreshCw size={14} color="#FCA5A5" />
                      <Text style={styles.retryText}>Tap to retry</Text>
                    </Pressable>
                  )}
                </View>
              );
            } catch {
              return null;
            }
          }}
        />
      </View>
    );
  } catch {
    return null;
  }
}, (prevProps, nextProps) => {
  return (
    prevProps?.currentMessage?._id === nextProps?.currentMessage?._id &&
    prevProps?.currentMessage?.text === nextProps?.currentMessage?.text &&
    prevProps?.currentMessage?.status === nextProps?.currentMessage?.status &&
    prevProps?.onRetryFailedMessage === nextProps?.onRetryFailedMessage
  );
});
MemoizedBubble.displayName = "MemoizedBubble";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ExtendedIMessage[]>([]);
  const [username, setUsername] = useState('User');
  const [buddyAvatarUrl, setBuddyAvatarUrl] = useState<string | null>(null);
  const userProfileRef = useRef<UserProfileModalHandle>(null);
  const reportModalRef = useRef<ReportModalHandle>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [derivedBuddyId, setDerivedBuddyId] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<'pending' | 'accepted' | 'declined' | null>(null);
  const [isRequestSender, setIsRequestSender] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastVisibleDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const userProfileCache = useRef<Map<string, { name: string; avatarUrl: string | null }>>(new Map());
  const [buddyPresence, setBuddyPresence] = useState<{ online: boolean; label: string }>({
    online: false,
    label: 'Offline',
  });
  /** Avoid spamming Alert when Firestore listeners retry */
  const chatDocListenerAlertedRef = useRef(false);
  const messagesListenerAlertedRef = useRef(false);
  const markChatViewedAlertRef = useRef(false);
  const initialMessagesAlertRef = useRef(false);
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

  // Reset one-shot Firestore alerts when opening a different chat
  useEffect(() => {
    chatDocListenerAlertedRef.current = false;
    messagesListenerAlertedRef.current = false;
    markChatViewedAlertRef.current = false;
    initialMessagesAlertRef.current = false;
  }, [chatId]);

  // Hide the default header since we're using a custom one
  useEffect(() => {
    try {
      navigation.setOptions({
        headerShown: false,
      });
    } catch {
      // Non-critical
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
        } catch (error: unknown) {
          if (!chatDocListenerAlertedRef.current) {
            chatDocListenerAlertedRef.current = true;
            Alert.alert('Chat status', firestoreUserMessage(error));
          }
          setChatStatus(null);
          setIsRequestSender(false);
        }
      },
      (error: unknown) => {
        if (!chatDocListenerAlertedRef.current) {
          chatDocListenerAlertedRef.current = true;
          Alert.alert('Chat status', firestoreUserMessage(error));
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
            // No messages yet — use current time for lastViewedAt
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
          
          // Marked chat as viewed
        }
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        if (code !== 'permission-denied' && !markChatViewedAlertRef.current) {
          markChatViewedAlertRef.current = true;
          Alert.alert('Could not update read status', firestoreUserMessage(error));
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
      if (!user) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setUsername(userDoc.data().username || 'User');
        }
      } catch (e) {
        if (__DEV__) {
          console.error('fetchUsername failed:', e);
        }
        setUsername('User');
      }
    };
    fetchUsername();
  }, [user]);

  // Fetch the buddy's avatar and check if blocked
  useEffect(() => {
    const fetchBuddyAvatar = async () => {
      if (activeBuddyId) {
        try {
          const peer = await fetchPeerProfileForChat(activeBuddyId);
          setBuddyAvatarUrl(peer?.avatarUrl ?? null);
          
          // Check if user is blocked
          const blocked = await isUserBlocked(activeBuddyId);
          setIsBlocked(blocked);
        } catch (e) {
          if (__DEV__) {
            console.error('Error fetching buddy avatar:', e);
          }
        }
      }
    };
    fetchBuddyAvatar();
  }, [activeBuddyId]);

  // Real-time presence: listen to buddy's user doc in `users` for lastActive / lastSeen
  useEffect(() => {
    if (!activeBuddyId) {
      setBuddyPresence({ online: false, label: 'Offline' });
      return;
    }

    const buddyDisplayRef = userPublicDisplayRef(activeBuddyId);
    const unsubscribe = onSnapshot(
      buddyDisplayRef,
      (snap) => {
        try {
          if (!snap.exists()) {
            setBuddyPresence({ online: false, label: 'Offline' });
            return;
          }
          const data = snap.data() as Record<string, unknown>;
          const lastMs = parseLastActiveMs(data);
          setBuddyPresence(formatPresenceLabel(lastMs));
        } catch {
          setBuddyPresence({ online: false, label: 'Offline' });
        }
      },
      () => {
        setBuddyPresence({ online: false, label: 'Offline' });
      }
    );

    return () => unsubscribe();
  }, [activeBuddyId]);

  // Heartbeat: while this screen is focused, refresh lastActive every 60s (cleared on blur / unmount)
  useFocusEffect(
    useCallback(() => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const userRef = doc(db, 'users', uid);
      const displayRef = userPublicDisplayRef(uid);
      const pulse = () => {
        const t = Timestamp.now();
        Promise.all([
          setDoc(userRef, { lastActive: t }, { merge: true }),
          setDoc(displayRef, { lastActive: t }, { merge: true }),
        ]).catch(() => {
          /* heartbeat is best-effort */
        });
      };
      pulse();
      const interval = setInterval(pulse, 60 * 1000);
      return () => clearInterval(interval);
    }, [])
  );

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
            const peer = await fetchPeerProfileForChat(userId);
            if (peer) {
              userProfileCache.current.set(userId, {
                name: peer.name,
                avatarUrl: peer.avatarUrl,
              });
            }
          } catch (e) {
            if (__DEV__) {
              console.error(`Error fetching profile for ${userId}:`, e);
            }
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
      if (!initialMessagesAlertRef.current) {
        initialMessagesAlertRef.current = true;
        Alert.alert('Messages', firestoreUserMessage(error, 'Could not load messages. Pull to refresh or try again later.'));
      }
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

      let isFirstListenerSnapshot = true;

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          if (snapshot.empty) return;
          
          const latestDoc = snapshot.docs[0];
          const data = latestDoc.data();
          const userId = data.userId || data.user?._id || data.user;
          const userIdStr = typeof userId === 'string' ? userId : String(userId);
          const me = auth.currentUser?.uid;

          // After the first snapshot, clear global unread only when a new latest message is from the
          // other person (avoids clearing on open while another chat still has unread, and when you send).
          if (!isFirstListenerSnapshot && me && userIdStr && userIdStr !== me) {
            updateDoc(doc(db, 'users', me), { hasUnreadMessages: false }).catch(() => {
              /* best-effort */
            });
          }
          isFirstListenerSnapshot = false;

          const currentUserId = auth.currentUser?.uid || user?.uid;
          if (currentUserId) {
            markMessagesReceived(chatId, currentUserId, snapshot.docs).catch(() => {
              /* non-blocking */
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
              fetchPeerProfileForChat(userIdStr).then((peer) => {
                if (peer) {
                  userProfileCache.current.set(userIdStr, {
                    name: peer.name,
                    avatarUrl: peer.avatarUrl,
                  });
                  setMessages((current) =>
                    current.map((msg) =>
                      msg._id === latestDoc.id
                        ? { ...msg, user: { ...msg.user, name: peer.name } }
                        : msg
                    )
                  );
                }
              }).catch(() => {
                /* profile name stays empty until next update */
              });
            }
            
            return [newMessage, ...prev];
          });
        }, 
        (error) => {
          if (!messagesListenerAlertedRef.current) {
            messagesListenerAlertedRef.current = true;
            Alert.alert('Live updates', firestoreUserMessage(error, 'Could not subscribe to new messages.'));
          }
        }
      );

      return () => unsubscribe();
    } catch (error) {
      if (!messagesListenerAlertedRef.current) {
        messagesListenerAlertedRef.current = true;
        Alert.alert('Live updates', firestoreUserMessage(error, 'Could not subscribe to new messages.'));
      }
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
            const peer = await fetchPeerProfileForChat(userId);
            if (peer) {
              userProfileCache.current.set(userId, {
                name: peer.name,
                avatarUrl: peer.avatarUrl,
              });
            }
          } catch (e) {
            if (__DEV__) {
              console.error(`Error fetching profile for ${userId}:`, e);
            }
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
      Alert.alert('Messages', firestoreUserMessage(error, 'Could not load older messages.'));
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
      Alert.alert('Cannot send', 'Missing chat partner. Go back and open the chat again.');
      return;
    }
    
    const text = messages[0].text;
    const chatIdString = chatId;
    const currentUserId = auth.currentUser?.uid || user?.uid;
    
    if (!currentUserId) {
      Alert.alert('Cannot send', 'You are not signed in. Please log in and try again.');
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
      setMessages((prev) =>
        prev.map((msg) =>
          msg.tempId === tempId ? { ...msg, status: 'error' as MessageStatus } : msg
        )
      );
      Alert.alert('Message not sent', firestoreUserMessage(error));
      return;
    }

    // Notification write (best-effort)
    try {
      const otherUserDocRef = doc(db, 'users', otherUserId);
      await setDoc(otherUserDocRef, {
        hasUnreadMessages: true
      }, { merge: true });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code !== 'permission-denied' && __DEV__) {
        console.warn('Failed to set notification flag:', error);
      }
    }
  }, [chatId, user, activeBuddyId, buddyIdString, chatStatus, isRequestSender, isBlocked, username]);

  const retryFailedMessage = useCallback(
    async (failedMsg: ExtendedIMessage) => {
      if (!chatId || !user?.uid) return;
      if (failedMsg.user._id !== user.uid) return;
      if (isBlocked) {
        Alert.alert('User Blocked', 'You cannot send messages to a blocked user.');
        return;
      }
      if (chatStatus === 'declined') {
        Alert.alert('Chat Declined', 'This chat request has been declined.');
        return;
      }
      if (chatStatus === 'pending' && isRequestSender) {
        Alert.alert(
          'Pending Request',
          'The recipient must accept your chat request before you can send more messages.'
        );
        return;
      }

      const text = failedMsg.text?.trim();
      if (!text) return;

      const otherUserId = activeBuddyId || buddyIdString;
      if (!otherUserId) return;

      const stableTempId = failedMsg.tempId ?? String(failedMsg._id);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.tempId === stableTempId || msg._id === failedMsg._id
            ? { ...msg, status: 'sending' as MessageStatus, tempId: stableTempId }
            : msg
        )
      );

      try {
        const docRef = await addDoc(collection(db, 'chats', chatId, 'messages'), {
          text,
          createdAt: Timestamp.now(),
          userId: user.uid,
          status: 'sent',
        });

        setMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.tempId === stableTempId || msg._id === failedMsg._id
              ? { ...msg, _id: docRef.id, status: 'sent' as MessageStatus, tempId: undefined }
              : msg
          );
          const seen = new Set<string>();
          return updated.filter((msg) => {
            const id = String(msg._id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        });

        await setDoc(
          doc(db, 'chats', chatId),
          {
            userIds: [user.uid, otherUserId],
            lastMessageAt: Timestamp.now(),
          },
          { merge: true }
        );

        try {
          await setDoc(doc(db, 'users', otherUserId), { hasUnreadMessages: true }, { merge: true });
        } catch (e: unknown) {
          const code = (e as { code?: string })?.code;
          if (code !== 'permission-denied' && __DEV__) {
            console.warn('Failed to set notification flag:', e);
          }
        }
      } catch (error) {
        Alert.alert('Message not sent', firestoreUserMessage(error));
        setMessages((prev) =>
          prev.map((msg) =>
            msg.tempId === stableTempId || msg._id === failedMsg._id
              ? { ...msg, status: 'error' as MessageStatus }
              : msg
          )
        );
      }
    },
    [chatId, user, activeBuddyId, buddyIdString, chatStatus, isRequestSender, isBlocked]
  );

  // Custom render function for message bubbles (using memoized component)
  const renderBubble = useCallback(
    (props: any) => <MemoizedBubble {...props} onRetryFailedMessage={retryFailedMessage} />,
    [retryFailedMessage]
  );

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
    } catch {
      return null;
    }
  };

  const handleAcceptRequest = useCallback(async () => {
    if (!chatId || !user) return;

    try {
      const chatDocRef = doc(db, 'chats', chatId);
      await setDoc(
        chatDocRef,
        {
          status: 'accepted',
          acceptedAt: Timestamp.now(),
        },
        { merge: true }
      );
    } catch (e) {
      Alert.alert('Error', firestoreUserMessage(e, 'Failed to accept chat request.'));
    }
  }, [chatId, user]);

  const handleDeclineRequest = useCallback(async () => {
    if (!chatId || !user) return;

    try {
      const chatDocRef = doc(db, 'chats', chatId);
      await setDoc(
        chatDocRef,
        {
          status: 'declined',
          declinedAt: Timestamp.now(),
        },
        { merge: true }
      );
      router.back();
    } catch (e) {
      Alert.alert('Error', firestoreUserMessage(e, 'Failed to decline chat request.'));
    }
  }, [chatId, user, router]);

  /** Accept / decline row — above the input (GiftedChat renderChatFooter) */
  const renderChatFooter = useCallback(() => {
    if (chatStatus === 'pending' && !isRequestSender) {
      return (
        <View style={styles.requestActionsContainer}>
          <Text style={styles.requestActionsTitle}>
            New chat request from {Array.isArray(buddyName) ? buddyName[0] : buddyName || 'user'}
          </Text>
          <View style={styles.requestButtons}>
            <TouchableOpacity onPress={handleAcceptRequest} style={styles.acceptButton}>
              <Check size={20} color="white" />
              <Text style={styles.acceptButtonText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeclineRequest} style={styles.declineButton}>
              <X size={20} color="white" />
              <Text style={styles.declineButtonText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return null;
  }, [chatStatus, isRequestSender, buddyName, handleAcceptRequest, handleDeclineRequest]);

  const renderInputToolbar = useCallback(
    (props: InputToolbarProps<IMessage>) => {
      const footerPad = { paddingBottom: Math.max(insets.bottom, 16) };

      if (chatStatus === 'pending' && !isRequestSender) {
        return null;
      }
      if (chatStatus === 'declined') {
        return null;
      }
      if (chatStatus === 'pending' && isRequestSender) {
        return (
          <View style={[styles.footerContainer, footerPad]}>
            <View style={styles.pendingMessageContainer}>
              <Text style={styles.pendingMessageText}>
                Your chat request is pending. You can continue the conversation once{' '}
                {Array.isArray(buddyName) ? buddyName[0] : buddyName || 'the recipient'} accepts your
                request.
              </Text>
            </View>
          </View>
        );
      }
      if (isBlocked) {
        return null;
      }
      if (chatStatus !== 'accepted' && chatStatus !== null) {
        return null;
      }

      return (
        <InputToolbar
          {...props}
          containerStyle={[styles.footerContainer, footerPad]}
          primaryStyle={styles.inputToolbarPrimary}
          renderComposer={composerProps => (
            <Composer
              {...composerProps}
              multiline
              placeholder="Type a message..."
              placeholderTextColor="#9CA3AF"
              textInputStyle={styles.textInput}
            />
          )}
          renderSend={sendProps => (
            <Send
              {...sendProps}
              alwaysShowSend
              disabled={!sendProps.text?.trim()}
              containerStyle={[
                styles.sendButton,
                !sendProps.text?.trim() && styles.sendButtonDisabled,
              ]}
            >
              <SendIcon size={20} color="white" />
            </Send>
          )}
        />
      );
    },
    [
      buddyName,
      chatStatus,
      insets.bottom,
      isBlocked,
      isRequestSender,
    ]
  );

  // Handle avatar tap to open profile modal
  const handleAvatarTap = (userId: string) => {
    setSelectedUserId(userId);
    userProfileRef.current?.present();
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
            } catch (error: unknown) {
              const msg =
                error instanceof Error && error.message
                  ? error.message
                  : 'Failed to block user. Please try again.';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  // Early returns: same edges as main screen (no bottom) to avoid layout jumps vs. loaded state
  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.errorText}>Please log in to use chat.</Text>
      </SafeAreaView>
    );
  }

  // Early return if chatId cannot be determined
  if (!chatId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.errorText}>Could not load chat. Missing chat ID.</Text>
      </SafeAreaView>
    );
  }
  
  // Ensure we have a valid user.uid
  if (!user?.uid || user.uid.trim() === '') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.errorText}>Invalid user session.</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#111827' }}>
      <View style={[styles.headerContainer, { paddingTop: 12 + insets.top }]}>
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
          {chatStatus === 'pending' && isRequestSender ? (
            <Text style={styles.headerSubtitle}>Waiting for acceptance</Text>
          ) : chatStatus === 'pending' && !isRequestSender ? (
            <Text style={styles.headerSubtitle}>New chat request</Text>
          ) : (
            <View style={styles.headerPresenceOuter}>
              <View style={styles.headerPresenceInner}>
                {buddyPresence.online ? <View style={styles.presenceDot} /> : null}
                <Text
                  style={[
                    styles.headerSubtitle,
                    buddyPresence.online
                      ? styles.headerPresenceOnline
                      : styles.headerSubtitleMuted,
                  ]}
                >
                  {buddyPresence.label}
                </Text>
              </View>
            </View>
          )}
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
                return;
              }
              setSelectedUserId(activeBuddyId);
              userProfileRef.current?.present();
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

      <View style={{ flex: 1 }}>
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
              userProfileRef.current?.present();
              setShowMenu(false);
            }}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemText}>View Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              reportModalRef.current?.present();
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
      {/* Chat column: flex-shrink body + footer pinned to bottom of this region */}
      {/* Android: plain View — OS resize (see app.json softwareKeyboardLayoutMode). iOS: KeyboardAvoidingView. */}
      <ChatKeyboardWrapper>
        <View style={styles.chatBody}>
          <View style={styles.giftedChatFill}>
          <GiftedChat
            messages={messages || []}
            onSend={messages => onSend(messages)}
            user={{
              _id: user.uid,
              name: username || 'User',
            }}
            renderMessage={renderMessage}
            renderBubble={renderBubble}
            renderChatFooter={renderChatFooter}
            renderInputToolbar={renderInputToolbar}
            onLoadEarlier={loadMoreMessages}
            loadEarlier={hasMoreMessages && !loadingMore}
            isLoadingEarlier={loadingMore}
            infiniteScroll={true}
            bottomOffset={insets.bottom}
            messagesContainerStyle={{
              backgroundColor: '#111827',
            }}
            listViewProps={{ keyboardDismissMode: 'on-drag' } as React.ComponentProps<typeof GiftedChat>['listViewProps']}
          />
          </View>
        </View>
      </ChatKeyboardWrapper>
      </View>
      <UserProfileModal
        ref={userProfileRef}
        userId={selectedUserId || ''}
        onClose={() => {
          setSelectedUserId(null);
        }}
      />
      <ReportModal
        ref={reportModalRef}
        reportedUserId={activeBuddyId || ''}
        reportedUserName={Array.isArray(buddyName) ? buddyName[0] : buddyName || 'User'}
        chatId={chatId || undefined}
        onReportSubmitted={() => {
          router.back();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingRoot: {
    flex: 1,
    flexDirection: 'column',
  },
  chatBody: {
    flex: 1,
    minHeight: 0,
  },
  giftedChatFill: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
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
    fontSize: 11,
    lineHeight: 14,
    opacity: 0.6,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timestampTextCurrentUser: {
    color: '#F9FAFB',
  },
  timestampTextOtherUser: {
    color: '#D1D5DB',
  },
  // Footer container styles (paddingBottom applied inline for keyboard / safe area)
  inputToolbarPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  footerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingTop: 12,
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
    paddingBottom: 12,
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
  headerSubtitleMuted: {
    color: '#9CA3AF',
  },
  /** Online label: vibrant green to match presence dot */
  headerPresenceOnline: {
    color: '#22C55E',
    fontWeight: '600',
  },
  headerPresenceOuter: {
    marginTop: 2,
  },
  headerPresenceInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  retryText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
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

/** iOS KAV: approximate custom header bar height (below safe area) so input clears the keyboard */
const IOS_KEYBOARD_VERTICAL_OFFSET = 64;

/**
 * Android: no KeyboardAvoidingView — let the window resize with the keyboard (Expo:
 * `android.softwareKeyboardLayoutMode` in app.json, typically `"resize"` ≈ adjustResize).
 * `minHeight: 0` lets the flex column shrink when the window resizes after keyboard dismiss.
 * If the input still misbehaves, confirm that setting and that bare AndroidManifest
 * uses `android:windowSoftInputMode="adjustResize"` when not using Expo config.
 * iOS: KeyboardAvoidingView + padding + header offset.
 */
function ChatKeyboardWrapper({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'android') {
    return <View style={{ flex: 1, minHeight: 0 }}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoidingRoot}
      behavior="padding"
      keyboardVerticalOffset={IOS_KEYBOARD_VERTICAL_OFFSET}
    >
      {children}
    </KeyboardAvoidingView>
  );
}