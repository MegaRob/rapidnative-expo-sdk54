 import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../src/firebaseConfig';
import { useBlockedUsers } from '../hooks/useBlockedUsers';

// Define a type for our user data
interface Buddy {
  id: string;
  username: string;
  bio: string;
}

export default function RaceConnectionsScreen() {
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [loading, setLoading] = useState(true);
  const { allBlockedIds } = useBlockedUsers();

  // Get the trail data passed from the previous screen
  const { trailId, trailName } = useLocalSearchParams();
  const user = auth.currentUser;
  const router = useRouter();
  const navigation = useNavigation();

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    const fetchBuddies = async () => {
      if (!user || !trailId) {
        setLoading(false);
        return;
      }

      try {
        // 1. Find all 'matches' for this specific trail
        const matchesQuery = query(collection(db, 'matches'), where('trailId', '==', trailId));
        const matchSnapshot = await getDocs(matchesQuery);
        
        const userIds = matchSnapshot.docs
          .map(doc => doc.data().userId) // Get all user IDs from the matches
          .filter(id => id !== user.uid) // Filter out *ourself*
          .filter(id => !allBlockedIds.has(id)); // Filter out blocked users

        if (userIds.length === 0) {
          // No one else has matched this trail yet
          setLoading(false);
          return;
        }

        // 2. Fetch all user profiles that match those IDs
        // Note: Firestore 'in' queries are limited to 10 items, so we handle larger lists
        // Filter out private users (unless current user is admin/race director)
        const currentUid = user?.uid;
        const isAdmin = currentUid === 'gveHJNWFRgZKj0qz8ZOJuT976j13'; // Admin UID
        
        const buddyList: Buddy[] = [];
        
        // Process in batches of 10 (Firestore 'in' query limit)
        for (let i = 0; i < userIds.length; i += 10) {
          const batch = userIds.slice(i, i + 10);
          const usersQuery = query(collection(db, 'users'), where(documentId(), 'in', batch));
          const usersSnapshot = await getDocs(usersQuery);
          
          const batchBuddies = usersSnapshot.docs
            .filter(doc => {
              const userData = doc.data();
              // Filter out private users (unless admin viewing)
              if (userData.isPrivate === true && !isAdmin) {
                return false;
              }
              return true;
            })
            .map(doc => ({
              id: doc.id,
              username: doc.data().username || 'Trail User',
              bio: doc.data().bio || 'No bio available'
            })) as Buddy[];
          
          buddyList.push(...batchBuddies);
        }

        setBuddies(buddyList);
      } catch (error) {
        console.error("Error fetching buddies: ", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBuddies();
  }, [trailId, user, allBlockedIds]);

  // --- Render Logic ---
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#8BC34A" />
      </View>
    );
  }

  // Helper to get string from params (can be string or string[])
  const getParam = (param: string | string[] | undefined, fallback: string = '') => {
    if (!param) return fallback;
    return Array.isArray(param) ? param[0] : param;
  };

  const displayTrailName = getParam(trailName, 'this trail');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header with back button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 10 }}>
        <TouchableOpacity 
          onPress={() => router.back()}
          style={{ marginRight: 12 }}
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <Text style={styles.header}>Buddies for {displayTrailName}</Text>
      </View>

      {buddies.length === 0 ? (
        <Text style={styles.emptyText}>Be the first to match this trail and find a buddy!</Text>
      ) : (
        <FlatList
          data={buddies}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/chat", params: { buddyId: item.id, buddyName: item.username } })}
            >
              <View style={styles.itemContainer}>
                <Text style={styles.itemTitle}>{item.username}</Text>
                <Text style={styles.itemSubtitle}>{item.bio}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1F25',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  emptyText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginTop: 50,
  },
  itemContainer: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  itemSubtitle: {
    fontSize: 14,
    color: '#ccc',
  },
});