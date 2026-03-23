import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  Keyboard,
} from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Plus, Car, Users, Info } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  Timestamp,
  where,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
} from "firebase/firestore";
import { auth, db } from "../../src/firebaseConfig";
import StandardBottomSheet, {
  StandardBottomSheetHandle,
} from "../components/StandardBottomSheet";

type PostCategory = "All" | "Carpool" | "Pacer" | "Crew";
type PostType = "Carpool" | "Pacer" | "Crew";
type PostIntent = "seeking" | "offering";

interface CommunityPost {
  id: string;
  authorId: string;
  author: string;
  authorName?: string;
  trailId?: string;
  trailName?: string;
  type: PostType;
  intent?: PostIntent;
  content: string;
  tags: string[];
  interactionCount: number;
  timestamp?: any;
}

const APP_ID = "1:1048323489461:web:e3c514fcf0d7748ef848fc";
const COMMUNITY_COLLECTION = collection(db, "artifacts", APP_ID, "public", "data", "community_posts");

const formatTimestamp = (value: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
  if (value?.toDate) return value.toDate().toLocaleString();
  return "";
};

export default function RaceCommunityHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const trailId = Array.isArray(params?.trailId) ? params.trailId[0] : params?.trailId;
  const trailName = Array.isArray(params?.trailName) ? params.trailName[0] : params?.trailName;
  const [activeCategory, setActiveCategory] = useState<PostCategory>("All");
  const [newPostCategory, setNewPostCategory] = useState<PostType>("Carpool");
  const [newPostIntent, setNewPostIntent] = useState<PostIntent>("seeking");
  const [newPostContent, setNewPostContent] = useState("");
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [interestedMap, setInterestedMap] = useState<Record<string, boolean>>({});
  const [activePost, setActivePost] = useState<CommunityPost | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<PostType>("Carpool");
  const [editIntent, setEditIntent] = useState<PostIntent>("seeking");

  // Refs for bottom sheets
  const createPostSheetRef = useRef<StandardBottomSheetHandle>(null);
  const editPostSheetRef = useRef<StandardBottomSheetHandle>(null);

  // Keyboard-aware padding so Post/Save buttons stay scrollable above keyboard
  const [keyboardBottomPadding, setKeyboardBottomPadding] = useState(160);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardBottomPadding(e.endCoordinates.height + 80);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardBottomPadding(160);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!trailId) {
      setPosts([]);
      return;
    }

    const postQuery = query(COMMUNITY_COLLECTION, where("trailId", "==", trailId));
    const unsubscribe = onSnapshot(postQuery, (snapshot) => {
      const list = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            authorId: data.authorId,
            author: data.authorName || data.author || "Runner",
            authorName: data.authorName || data.author || "Runner",
            trailId: data.trailId,
            trailName: data.trailName,
            type: data.type as PostType,
            intent: data.intent as PostIntent | undefined,
            content: data.content || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            interactionCount: typeof data.interactionCount === "number" ? data.interactionCount : 0,
            timestamp: data.timestamp,
          } as CommunityPost;
        })
        .sort((a, b) => {
          const aTime = a.timestamp?.seconds || 0;
          const bTime = b.timestamp?.seconds || 0;
          return bTime - aTime;
        });
      setPosts(list);
    });
    return () => unsubscribe();
  }, [trailId]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const fetchProfile = async () => {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (profileSnap.exists()) {
        const data = profileSnap.data();
        setAuthorName(data.name || data.username || user.email || "Runner");
      } else {
        setAuthorName(user.email || "Runner");
      }
    };
    fetchProfile();
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || posts.length === 0) {
      setInterestedMap({});
      return;
    }

    const fetchInterest = async () => {
      const updates: Record<string, boolean> = {};
      await Promise.all(
        posts.map(async (post) => {
          const interestRef = doc(
            db,
            "artifacts",
            APP_ID,
            "public",
            "data",
            "community_posts",
            post.id,
            "interested",
            user.uid
          );
          const interestSnap = await getDoc(interestRef);
          updates[post.id] = interestSnap.exists();
        })
      );
      setInterestedMap(updates);
    };

    fetchInterest();
  }, [posts]);

  const filteredPosts =
    activeCategory === "All"
      ? posts
      : posts.filter((post) => post.type === activeCategory);

  const getPostIcon = (type: PostType) => {
    switch (type) {
      case "Carpool":
        return <Car size={16} color="#34C759" />;
      case "Pacer":
        return <Users size={16} color="#34C759" />;
      case "Crew":
        return <Info size={16} color="#34C759" />;
      default:
        return <Info size={16} color="#34C759" />;
    }
  };

  const getPostLabel = (type: PostType) => {
    switch (type) {
      case "Carpool":
        return "Carpool";
      case "Pacer":
        return "Pacer";
      case "Crew":
        return "Crew";
      default:
        return "General";
    }
  };

  const getDefaultIntent = (type: PostType): PostIntent => {
    switch (type) {
      case "Carpool":
      case "Pacer":
      case "Crew":
        return "seeking";
      default:
        return "seeking";
    }
  };

  const getIntentLabel = (type: PostType, intent: PostIntent) => {
    if (type === "Carpool") {
      return intent === "seeking" ? "Seeking Ride" : "Offering Ride";
    }
    if (type === "Pacer") {
      return intent === "seeking" ? "Seeking Pacer" : "Offering Pacer";
    }
    return intent === "seeking" ? "Seeking" : "Offering";
  };

  const handlePostSubmit = async () => {
    if (!newPostContent.trim()) {
      Alert.alert("Missing details", "Please describe what you're offering or seeking.");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Sign in required", "Please sign in to post to the Community Hub.");
      return;
    }

    if (!trailId) {
      Alert.alert("Missing race", "Please open a race community board first.");
      return;
    }

    await addDoc(COMMUNITY_COLLECTION, {
      type: newPostCategory,
      intent: newPostIntent,
      authorId: user.uid,
      authorName: authorName || user.email || "Runner",
      author: authorName || user.email || "Runner",
      trailId: trailId,
      trailName: trailName || "",
      content: newPostContent.trim(),
      tags: [newPostCategory, getIntentLabel(newPostCategory, newPostIntent)],
      interactionCount: 0,
      timestamp: Timestamp.now(),
    });

    createPostSheetRef.current?.close();
    setNewPostContent("");
    setNewPostIntent(getDefaultIntent(newPostCategory));
  };

  const openPostMenu = (post: CommunityPost) => {
    setActivePost(post);
    setEditContent(post.content || "");
    setEditCategory(post.type || "Carpool");
    setEditIntent(post.intent || getDefaultIntent(post.type || "Carpool"));
    editPostSheetRef.current?.present();
  };

  const handleUpdatePost = async () => {
    const user = auth.currentUser;
    if (!user || !activePost) return;
    if (!editContent.trim()) {
      Alert.alert("Missing details", "Please enter post details.");
      return;
    }
    try {
      const postRef = doc(
        db,
        "artifacts",
        APP_ID,
        "public",
        "data",
        "community_posts",
        activePost.id
      );
      await updateDoc(postRef, {
        content: editContent.trim(),
        type: editCategory,
        intent: editIntent,
        tags: [editCategory, getIntentLabel(editCategory, editIntent)],
        updatedAt: Timestamp.now(),
      });
      editPostSheetRef.current?.close();
      setActivePost(null);
    } catch (error) {
      console.error("Failed to update post:", error);
      Alert.alert("Error", "Unable to update the post.");
    }
  };

  const handleDeletePost = async () => {
    const user = auth.currentUser;
    if (!user || !activePost) return;
    try {
      const postRef = doc(
        db,
        "artifacts",
        APP_ID,
        "public",
        "data",
        "community_posts",
        activePost.id
      );
      await deleteDoc(postRef);
      editPostSheetRef.current?.close();
      setActivePost(null);
    } catch (error) {
      console.error("Failed to delete post:", error);
      Alert.alert("Error", "Unable to delete the post.");
    }
  };

  const toggleInterested = async (post: CommunityPost) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Sign in required", "Please sign in to show interest.");
      return;
    }

    const postRef = doc(db, "artifacts", APP_ID, "public", "data", "community_posts", post.id);
    const interestRef = doc(
      db,
      "artifacts",
      APP_ID,
      "public",
      "data",
      "community_posts",
      post.id,
      "interested",
      user.uid
    );
    const isInterested = !!interestedMap[post.id];

    try {
      if (isInterested) {
        await deleteDoc(interestRef);
        await updateDoc(postRef, { interactionCount: increment(-1) });
      } else {
        await setDoc(interestRef, {
          userId: user.uid,
          createdAt: Timestamp.now(),
        });
        await updateDoc(postRef, { interactionCount: increment(1) });
      }

      setInterestedMap((prev) => ({ ...prev, [post.id]: !isInterested }));
    } catch (error) {
      console.error("Failed to update interest:", error);
      Alert.alert("Error", "Unable to update interest right now.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="px-4 pt-2 pb-4">
        <View className="flex-row items-center mb-2">
          <TouchableOpacity onPress={() => router.back()} className="p-2 mr-2">
            <ArrowLeft size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View>
            <Text className="text-white text-2xl font-bold">Race Community</Text>
            <Text className="text-slate-400 text-base">
              {trailName ? `${trailName} · Logistics & Support` : "Logistics & Support"}
            </Text>
          </View>
        </View>
      </View>

      <View className="mx-4 mt-2 mb-3">
        <View className="flex-row bg-slate-800 rounded-xl p-1">
          {(["All", "Carpool", "Pacer", "Crew"] as PostCategory[]).map((category) => {
            const isActive = activeCategory === category;
            return (
              <TouchableOpacity
                key={category}
                onPress={() => setActiveCategory(category)}
                className={`flex-1 py-2 rounded-lg ${isActive ? "bg-emerald-500" : "bg-transparent"}`}
              >
                <Text
                  className={`text-center font-semibold text-sm ${
                    isActive ? "text-slate-950" : "text-gray-400"
                  }`}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        className="mx-4 mb-4 p-4 rounded-[2rem] border-2 border-dashed border-emerald-500 items-center justify-center"
        onPress={() => createPostSheetRef.current?.present()}
      >
        <Plus size={32} color="#34C759" />
        <Text className="text-emerald-500 text-lg font-bold mt-2">Post a Need or Offer</Text>
        <Text className="text-emerald-500 text-base">Carpools, Pacers, or Crew Support</Text>
      </TouchableOpacity>

      <ScrollView className="px-4 pb-6">
        {!trailId ? (
          <View className="bg-slate-900 rounded-[2rem] p-4 border border-slate-800">
            <Text className="text-slate-300">
              Open a specific race to view its community board.
            </Text>
          </View>
        ) : (
          filteredPosts.map((post) => (
          <View
            key={post.id}
            className="bg-slate-900 rounded-[2rem] p-4 mb-4 border border-slate-800"
          >
            <View className="flex-row items-center mb-3">
              <View className="w-8 h-8 rounded-full bg-slate-700 mr-2" />
              <Text className="text-white font-bold mr-3">{post.author}</Text>
              <View className="flex-row items-center bg-emerald-900/30 px-2 py-1 rounded-full">
                {getPostIcon(post.type)}
                <Text className="text-emerald-500 text-xs font-medium ml-1">
                  {getPostLabel(post.type)}
                </Text>
              </View>
              {post.authorId === auth.currentUser?.uid && (
                <TouchableOpacity
                  className="ml-auto bg-slate-800 px-3 py-1 rounded-full"
                  onPress={() => openPostMenu(post)}
                >
                  <Text className="text-xs text-slate-300">Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text className="text-slate-200 mb-3">{post.content}</Text>

            <View className="flex-row flex-wrap gap-2 mb-3">
              {post.tags?.map((tag, index) => (
                <View key={`${post.id}-${index}`} className="bg-emerald-900/20 px-3 py-1 rounded-full">
                  <Text className="text-emerald-400 text-xs">{tag}</Text>
                </View>
              ))}
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-slate-400 text-sm">
                {post.interactionCount} interested
              </Text>

              <View className="flex-row items-center gap-2">
                {post.authorId !== auth.currentUser?.uid && (
                  <TouchableOpacity
                    className={`px-4 py-2 rounded-full ${
                      interestedMap[post.id] ? "bg-emerald-500" : "border border-emerald-500"
                    }`}
                    onPress={() => toggleInterested(post)}
                  >
                    <Text
                      className={`font-bold ${
                        interestedMap[post.id] ? "text-slate-900" : "text-emerald-400"
                      }`}
                    >
                      Interested
                    </Text>
                  </TouchableOpacity>
                )}
                {post.authorId !== auth.currentUser?.uid && (
                  <TouchableOpacity
                    className="bg-emerald-500 px-4 py-2 rounded-full"
                    onPress={() =>
                      router.push({
                        pathname: "/chat",
                        params: { buddyId: post.authorId, buddyName: post.author },
                      })
                    }
                  >
                    <Text className="text-slate-900 font-bold">Connect</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text className="text-xs text-slate-500 mt-3">
              {formatTimestamp(post.timestamp)}
            </Text>
          </View>
        ))
        )}
      </ScrollView>

      {/* Create Post Bottom Sheet */}
      <StandardBottomSheet
        ref={createPostSheetRef}
        title="Create Post"
        snapPoints={['60%', '85%']}
        contentContainerStyle={{ paddingBottom: keyboardBottomPadding }}
      >
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Category</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(["Carpool", "Pacer", "Crew"] as PostType[]).map((category) => (
              <TouchableOpacity
                key={category}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: newPostCategory === category ? '#10B981' : 'transparent',
                  borderWidth: newPostCategory === category ? 0 : 1,
                  borderColor: '#334155',
                }}
                onPress={() => {
                  setNewPostCategory(category);
                  setNewPostIntent(getDefaultIntent(category));
                }}
              >
                <Text
                  style={{
                    fontWeight: '500',
                    color: newPostCategory === category ? '#0F172A' : '#CBD5E1',
                  }}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Offering or Seeking</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(["seeking", "offering"] as PostIntent[]).map((intent) => (
              <TouchableOpacity
                key={intent}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: newPostIntent === intent ? '#10B981' : 'transparent',
                  borderWidth: newPostIntent === intent ? 0 : 1,
                  borderColor: '#334155',
                }}
                onPress={() => setNewPostIntent(intent)}
              >
                <Text
                  style={{
                    fontWeight: '500',
                    color: newPostIntent === intent ? '#0F172A' : '#CBD5E1',
                  }}
                >
                  {getIntentLabel(newPostCategory, intent)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Details</Text>
          <BottomSheetTextInput
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              borderRadius: 12,
              padding: 16,
              color: '#FFFFFF',
              fontSize: 16,
              height: 128,
              borderWidth: 1,
              borderColor: 'rgba(71, 85, 105, 0.5)',
              textAlignVertical: 'top',
            }}
            placeholder="Describe what you're offering or seeking..."
            placeholderTextColor="#94a3b8"
            selectionColor="#10B981"
            multiline
            value={newPostContent}
            onChangeText={setNewPostContent}
            onFocus={() => createPostSheetRef.current?.expand()}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#1E293B', paddingVertical: 12, borderRadius: 20, alignItems: 'center' }}
            onPress={() => createPostSheetRef.current?.close()}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 20, alignItems: 'center' }}
            onPress={handlePostSubmit}
          >
            <Text style={{ color: '#0F172A', fontWeight: '700' }}>Post</Text>
          </TouchableOpacity>
        </View>
      </StandardBottomSheet>

      {/* Edit Post Bottom Sheet */}
      <StandardBottomSheet
        ref={editPostSheetRef}
        title="Edit Post"
        snapPoints={['60%', '85%']}
        onClose={() => setActivePost(null)}
        contentContainerStyle={{ paddingBottom: keyboardBottomPadding }}
      >
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Category</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(["Carpool", "Pacer", "Crew"] as PostType[]).map((category) => (
              <TouchableOpacity
                key={category}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: editCategory === category ? '#10B981' : 'transparent',
                  borderWidth: editCategory === category ? 0 : 1,
                  borderColor: '#334155',
                }}
                onPress={() => {
                  setEditCategory(category);
                  setEditIntent(getDefaultIntent(category));
                }}
              >
                <Text
                  style={{
                    fontWeight: '500',
                    color: editCategory === category ? '#0F172A' : '#CBD5E1',
                  }}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Offering or Seeking</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(["seeking", "offering"] as PostIntent[]).map((intent) => (
              <TouchableOpacity
                key={intent}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: editIntent === intent ? '#10B981' : 'transparent',
                  borderWidth: editIntent === intent ? 0 : 1,
                  borderColor: '#334155',
                }}
                onPress={() => setEditIntent(intent)}
              >
                <Text
                  style={{
                    fontWeight: '500',
                    color: editIntent === intent ? '#0F172A' : '#CBD5E1',
                  }}
                >
                  {getIntentLabel(editCategory, intent)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#CBD5E1', marginBottom: 8 }}>Details</Text>
          <BottomSheetTextInput
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              borderRadius: 12,
              padding: 16,
              color: '#FFFFFF',
              fontSize: 16,
              height: 128,
              borderWidth: 1,
              borderColor: 'rgba(71, 85, 105, 0.5)',
              textAlignVertical: 'top',
            }}
            placeholder="Update your post..."
            placeholderTextColor="#94a3b8"
            selectionColor="#10B981"
            multiline
            value={editContent}
            onChangeText={setEditContent}
            onFocus={() => editPostSheetRef.current?.expand()}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#1E293B', paddingVertical: 12, borderRadius: 20, alignItems: 'center' }}
            onPress={() => editPostSheetRef.current?.close()}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.8)', paddingVertical: 12, borderRadius: 20, alignItems: 'center' }}
            onPress={handleDeletePost}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 20, alignItems: 'center' }}
            onPress={handleUpdatePost}
          >
            <Text style={{ color: '#0F172A', fontWeight: '700' }}>Save</Text>
          </TouchableOpacity>
        </View>
      </StandardBottomSheet>
    </SafeAreaView>
  );
}
