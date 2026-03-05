import { useNavigation, useRouter } from 'expo-router';
import { arrayRemove, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import { ArrowLeft, Calendar, Clock, MapPin, Pin, Trophy, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, FlatList, Image, LayoutAnimation, Linking, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../src/firebaseConfig';
import DistancePickerModal, { DistanceOption } from './components/DistancePickerModal';
import RegistrationForm from './components/RegistrationForm';
import { SkeletonLoader } from './components/SkeletonLoader';

type TabType = 'Liked' | 'Registered' | 'Completed';

interface Race {
  id: string;
  name: string;
  date: any;
  imageUrl: string;
  location?: string;
  trailId: string;
  matchId?: string; // ID of the match document
  isPinned?: boolean; // Whether the race is pinned
  [key: string]: any;
}

interface Registration extends Race {
  registrationId: string;
  registeredAt: any;
  bibNumber?: string;
  shirtSize?: string;
  startTime?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}

interface CompletedRace extends Race {
  completedId: string;
  completedAt: any;
  finishTime?: string;
  photo?: string;
}

const normalizeImageUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const cleaned = trimmed.replace(/^['"]+|['"]+$/g, '');
  if (!cleaned) return '';
  // Don't encodeURI URLs that are already valid — it double-encodes %2F in Firebase Storage URLs
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
  if (cleaned.startsWith('//')) return `https:${cleaned}`;
  if (cleaned.startsWith('www.')) return `https://${cleaned}`;
  const encoded = encodeURI(cleaned);
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/|$)/.test(encoded)) {
    return `https://${encoded}`;
  }
  return '';
};

const getRaceImageUrl = (trailData: Record<string, any> | undefined) =>
  normalizeImageUrl(trailData?.imageUrl) ||
  normalizeImageUrl(trailData?.image) ||
  normalizeImageUrl(trailData?.featuredImageUrl) ||
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8bW91bnRhaW5zJTIwYW5kJTIwbGFrZXxlbnwwfHwwfHx8MA%3D%3D";

// Segmented Control Component
const SegmentedControl = ({ 
  selectedTab, 
  onTabChange 
}: { 
  selectedTab: TabType; 
  onTabChange: (tab: TabType) => void;
}) => {
  const tabs: TabType[] = ['Liked', 'Registered', 'Completed'];
  
  return (
    <View className="flex-row bg-slate-800 rounded-xl p-1 mx-4 mb-4">
      {tabs.map((tab) => {
        const isActive = selectedTab === tab;
        return (
          <TouchableOpacity
            key={tab}
            onPress={() => onTabChange(tab)}
            className={`flex-1 py-3 rounded-lg ${
              isActive ? 'bg-emerald-500' : 'bg-transparent'
            }`}
          >
            <Text
              className={`text-center font-semibold ${
                isActive ? 'text-slate-950' : 'text-gray-400'
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Liked Race Card Component - Memoized for performance
const LikedRaceCard = React.memo(({ 
  race, 
  onPress, 
  onUnsave,
  onRegister,
  onPin,
  onUnpin
}: { 
  race: Race; 
  onPress: () => void;
  onUnsave: (id: string) => void;
  onRegister: (race: Race) => void;
  onPin: (race: Race) => void;
  onUnpin: (race: Race) => void;
}) => {
  const formatDate = (rawDate: any): string => {
    if (!rawDate) return "Coming Soon";
    if (typeof rawDate === "string") {
      if (rawDate.includes("T")) {
        try {
          const date = new Date(rawDate);
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
        } catch {}
      }
      return rawDate;
    }
    if (rawDate instanceof Date) {
      return rawDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
    if (typeof rawDate === "object" && rawDate !== null) {
      try {
        if (typeof rawDate.toDate === "function") {
          return rawDate.toDate().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if ("seconds" in rawDate) {
          return new Date(rawDate.seconds * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
      } catch {}
    }
    return String(rawDate);
  };

  const isPinned = race.isPinned === true;

  return (
    <Pressable
      className={`bg-[#2C3440] rounded-2xl p-4 mb-4 ${
        isPinned ? 'border-2 border-emerald-500/30' : ''
      }`}
      onPress={onPress}
    >
      <View className="flex-row">
        <Image 
          source={{ uri: race.imageUrl }} 
          className="w-20 h-20 rounded-xl"
        />
        <View className="flex-1 ml-4">
          <Text className="text-white text-lg font-bold">{race.name}</Text>
          <View className="flex-row items-center mt-1">
            <Calendar size={14} color="#9CA3AF" />
            <Text className="text-gray-400 ml-1 text-sm">{formatDate(race.date)}</Text>
          </View>
          {race.location && (
            <View className="flex-row items-center mt-1">
              <MapPin size={14} color="#9CA3AF" />
              <Text className="text-gray-400 ml-1 text-sm">{race.location}</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity 
            className="p-2 mr-1"
            onPress={(e) => {
              e.stopPropagation();
              if (isPinned) {
                onUnpin(race);
              } else {
                onPin(race);
              }
            }}
            activeOpacity={0.7}
          >
            {isPinned ? (
              <Pin size={20} color="#10b981" fill="#10b981" />
            ) : (
              <Pin size={20} color="#64748b" />
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            className="p-2"
            onPress={(e) => {
              e.stopPropagation();
              onUnsave(race.id);
            }}
            activeOpacity={0.7}
          >
            <X size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => onRegister(race)}
        className="mt-3 bg-emerald-500 rounded-lg py-2 px-4"
      >
        <Text className="text-white font-bold text-center">Register</Text>
      </TouchableOpacity>
    </Pressable>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memoization
  return (
    prevProps.race.id === nextProps.race.id &&
    prevProps.race.isPinned === nextProps.race.isPinned
  );
});

// Registered Race Card Component - Memoized for performance
const RegisteredRaceCard = React.memo(({ 
  race, 
  onPress, 
  onViewRegistration,
  onMarkComplete,
  onViewDigitalBib
}: { 
  race: Registration; 
  onPress: () => void;
  onViewRegistration: (race: Registration) => void;
  onMarkComplete: (race: Registration) => void;
  onViewDigitalBib?: (race: Registration) => void;
}) => {
  const formatDate = (rawDate: any): string => {
    if (!rawDate) return "Coming Soon";
    if (typeof rawDate === "string") {
      if (rawDate.includes("T")) {
        try {
          const date = new Date(rawDate);
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
        } catch {}
      }
      return rawDate;
    }
    if (rawDate instanceof Date) {
      return rawDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
    if (typeof rawDate === "object" && rawDate !== null) {
      try {
        if (typeof rawDate.toDate === "function") {
          return rawDate.toDate().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if ("seconds" in rawDate) {
          return new Date(rawDate.seconds * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
      } catch {}
    }
    return String(rawDate);
  };

  const getDaysUntilRace = (raceDate: any): number | null => {
    if (!raceDate) return null;
    let date: Date;
    try {
      if (typeof raceDate === "string") {
        date = new Date(raceDate);
      } else if (raceDate instanceof Date) {
        date = raceDate;
      } else if (typeof raceDate === "object" && raceDate !== null) {
        if (typeof raceDate.toDate === "function") {
          date = raceDate.toDate();
        } else if ("seconds" in raceDate) {
          date = new Date(raceDate.seconds * 1000);
        } else {
          return null;
        }
      } else {
        return null;
      }
      if (isNaN(date.getTime())) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      date.setHours(0, 0, 0, 0);
      const diffTime = date.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch {
      return null;
    }
  };

  const daysUntil = getDaysUntilRace(race.date);
  const countdownText = daysUntil !== null 
    ? daysUntil > 0 
      ? `${daysUntil} day${daysUntil !== 1 ? 's' : ''} until race day`
      : daysUntil === 0
      ? "Race day is today!"
      : "Race day has passed"
    : null;

  return (
    <Pressable
      className="bg-[#2C3440] rounded-2xl p-4 mb-4"
      onPress={onPress}
    >
      <View className="flex-row">
        <Image 
          source={{ uri: race.imageUrl }} 
          className="w-20 h-20 rounded-xl"
        />
        <View className="flex-1 ml-4">
          <Text className="text-white text-lg font-bold">{race.name}</Text>
          <View className="flex-row items-center mt-1">
            <Calendar size={14} color="#9CA3AF" />
            <Text className="text-gray-400 ml-1 text-sm">{formatDate(race.date)}</Text>
          </View>
          {race.location && (
            <View className="flex-row items-center mt-1">
              <MapPin size={14} color="#9CA3AF" />
              <Text className="text-gray-400 ml-1 text-sm">{race.location}</Text>
            </View>
          )}
          {countdownText && (
            <View className="flex-row items-center mt-2 bg-emerald-500/20 rounded-lg px-2 py-1 self-start">
              <Clock size={12} color="#10b981" />
              <Text className="text-emerald-400 ml-1 text-xs font-semibold">{countdownText}</Text>
            </View>
          )}
        </View>
      </View>
      <View className="flex-row gap-2 mt-3">
        <TouchableOpacity
          onPress={() => onViewRegistration(race)}
          className="flex-1 bg-slate-700 rounded-lg py-2 px-4"
        >
          <Text className="text-white font-semibold text-center text-sm">View Registration</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onMarkComplete(race)}
          className="flex-1 bg-emerald-500 rounded-lg py-2 px-4"
        >
          <Text className="text-white font-bold text-center text-sm">Mark as Complete</Text>
        </TouchableOpacity>
      </View>
      {/* Digital Bib hidden for now */}
    </Pressable>
  );
}, (prevProps, nextProps) => prevProps.race.id === nextProps.race.id);

// Completed Race Card Component - Memoized for performance
const CompletedRaceCard = React.memo(({ 
  race, 
  onPress 
}: { 
  race: CompletedRace; 
  onPress: () => void;
}) => {
  const formatDate = (rawDate: any): string => {
    if (!rawDate) return "Coming Soon";
    if (typeof rawDate === "string") {
      if (rawDate.includes("T")) {
        try {
          const date = new Date(rawDate);
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
        } catch {}
      }
      return rawDate;
    }
    if (rawDate instanceof Date) {
      return rawDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
    if (typeof rawDate === "object" && rawDate !== null) {
      try {
        if (typeof rawDate.toDate === "function") {
          return rawDate.toDate().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if ("seconds" in rawDate) {
          return new Date(rawDate.seconds * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
      } catch {}
    }
    return String(rawDate);
  };

  return (
    <Pressable
      className="bg-[#2C3440] rounded-2xl p-4 mb-4"
      onPress={onPress}
    >
      <View className="flex-row">
        <View className="relative">
          <Image 
            source={{ uri: race.imageUrl }}
            className="w-20 h-20 rounded-xl"
          />
          <View className="absolute -top-1 -right-1 bg-emerald-500 rounded-full p-1">
            <Trophy size={16} color="#1A1F25" />
          </View>
        </View>
        <View className="flex-1 ml-4">
          <View className="flex-row items-center mb-1">
            <Text className="text-white text-lg font-bold mr-2">{race.name}</Text>
            <View className="bg-emerald-500/20 rounded px-2 py-0.5">
              <Text className="text-emerald-400 text-xs font-bold">FINISHER</Text>
            </View>
          </View>
          <View className="flex-row items-center mt-1">
            <Calendar size={14} color="#9CA3AF" />
            <Text className="text-gray-400 ml-1 text-sm">{formatDate(race.date)}</Text>
          </View>
          {race.location && (
            <View className="flex-row items-center mt-1">
              <MapPin size={14} color="#9CA3AF" />
              <Text className="text-gray-400 ml-1 text-sm">{race.location}</Text>
            </View>
          )}
          {race.finishTime && (
            <View className="mt-2 bg-slate-700 rounded-lg px-3 py-1.5">
              <Text className="text-white text-sm">
                <Text className="text-gray-400">Finish Time: </Text>
                {race.finishTime}
              </Text>
            </View>
          )}
          {!race.finishTime && (
            <View className="mt-2 bg-slate-700 rounded-lg px-3 py-1.5">
              <Text className="text-gray-400 text-sm">Finish time not recorded</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}, (prevProps, nextProps) => prevProps.race.id === nextProps.race.id);

// Empty State Component
const EmptyState = ({ 
  tab, 
  onNavigate 
}: { 
  tab: TabType; 
  onNavigate?: () => void;
}) => {
  const messages = {
    Liked: {
      title: "Your wishlist is empty",
      subtitle: "Start swiping to discover races you love!",
      actionText: "Discover Races",
    },
    Registered: {
      title: "No upcoming adventures",
      subtitle: "Find your next start line and register for a race!",
      actionText: "Browse Races",
    },
    Completed: {
      title: "The journey starts here",
      subtitle: "Complete a race to see it here!",
      actionText: "Find Races",
    },
  };

  const message = messages[tab];

  return (
    <View className="flex-1 justify-center items-center px-4 mt-20">
      <Text className="text-white text-xl font-bold mb-2 text-center">
        {message.title}
      </Text>
      <Text className="text-gray-400 text-base mb-6 text-center">
        {message.subtitle}
      </Text>
      {onNavigate && (
        <TouchableOpacity
          onPress={onNavigate}
          className="bg-emerald-500 rounded-full px-6 py-3"
        >
          <Text className="text-white font-bold">{message.actionText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default function SavedRacesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [selectedTab, setSelectedTab] = useState<TabType>('Liked');
  const [likedRaces, setLikedRaces] = useState<Race[]>([]);
  const [registeredRaces, setRegisteredRaces] = useState<Registration[]>([]);
  const [completedRaces, setCompletedRaces] = useState<CompletedRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [trailCache, setTrailCache] = useState<Map<string, any>>(new Map());
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showDistancePicker, setShowDistancePicker] = useState(false);
  const [activeRegistrationRace, setActiveRegistrationRace] = useState<Race | null>(null);
  const [selectedRegistrationDistance, setSelectedRegistrationDistance] = useState<string | undefined>(undefined);
  const user = auth.currentUser;

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Optimized: Fetch all data in parallel on mount
  useEffect(() => {
    const fetchAllData = async () => {
      if (!user) {
        setLikedRaces([]);
        setRegisteredRaces([]);
        setCompletedRaces([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Bail out early if user signed out before we started
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }

        // Parallelize all root collection queries
        const [matchesSnapshot, registrationsSnapshot, completedSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'matches'), where('userId', '==', user.uid))),
          getDocs(query(collection(db, 'registrations'), where('userId', '==', user.uid))),
          getDocs(query(collection(db, 'completed_races'), where('userId', '==', user.uid))),
        ]);

        // Bail out if user signed out during the queries
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }

        // Extract trail IDs from all collections
        const registeredTrailIds = new Set(registrationsSnapshot.docs.map(doc => doc.data().trailId));
        const completedTrailIds = new Set(completedSnapshot.docs.map(doc => doc.data().trailId));
        
        // Collect all unique trail IDs that need to be fetched
        const trailIdsToFetch = new Set<string>();
        
        // From matches (for Liked tab)
        matchesSnapshot.docs.forEach(matchDoc => {
          const trailId = matchDoc.data().trailId;
          if (!registeredTrailIds.has(trailId) && !completedTrailIds.has(trailId)) {
            trailIdsToFetch.add(trailId);
          }
        });
        
        // From registrations (for Registered tab)
        registrationsSnapshot.docs.forEach(regDoc => {
          trailIdsToFetch.add(regDoc.data().trailId);
        });
        
        // From completed (for Completed tab)
        completedSnapshot.docs.forEach(completedDoc => {
          trailIdsToFetch.add(completedDoc.data().trailId);
        });

        // Parallel fetch all trail documents (solve N+1 problem)
        const trailDocs = await Promise.all(
          Array.from(trailIdsToFetch).map(trailId => 
            getDoc(doc(db, 'trails', trailId)).catch(error => {
              // Only log if user is still authenticated (suppress logout errors)
              if (auth.currentUser) {
                console.error(`Failed to fetch trail ${trailId}:`, error);
              }
              return null;
            })
          )
        );

        // Bail out if user signed out during trail fetches
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }

        // Build trail cache — only include races from allowed sources
        const ALLOWED_SOURCES = new Set(['runsignup', 'ultrasignup']);
        const newCache = new Map<string, any>();
        trailDocs.forEach((trailDoc, index) => {
          if (trailDoc?.exists()) {
            const data = trailDoc.data();
            if (ALLOWED_SOURCES.has(data?.source)) {
              const trailId = Array.from(trailIdsToFetch)[index];
              newCache.set(trailId, data);
            }
          }
        });
        setTrailCache(newCache);

        // Process Liked Races
        const likedRacesList: Race[] = [];
        const seenTrailIds = new Set<string>();
        matchesSnapshot.docs.forEach(matchDoc => {
          const matchData = matchDoc.data();
          const trailId = matchData.trailId;
          
          if (seenTrailIds.has(trailId) || registeredTrailIds.has(trailId) || completedTrailIds.has(trailId)) {
            return;
          }
          
          const trailData = newCache.get(trailId);
          if (trailData) {
            seenTrailIds.add(trailId);
            likedRacesList.push({
              ...trailData,
              id: trailId,
              trailId: trailId,
              matchId: matchDoc.id,
              isPinned: matchData.isPinned === true,
              name: trailData?.name || "Unnamed Trail",
              date: trailData?.date,
              location: trailData?.location,
              imageUrl: getRaceImageUrl(trailData),
            });
          }
        });
        likedRacesList.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        setLikedRaces(likedRacesList);

        // Process Registered Races
        const registeredRacesList: Registration[] = [];
        registrationsSnapshot.docs.forEach(regDoc => {
          const regData = regDoc.data();
          const trailId = regData.trailId;
          const trailData = newCache.get(trailId);
          
          if (trailData) {
            registeredRacesList.push({
              ...trailData,
              id: trailId,
              registrationId: regDoc.id,
              trailId: trailId,
              name: trailData?.name || "Unnamed Trail",
              date: trailData?.date,
              location: trailData?.location,
              imageUrl: getRaceImageUrl(trailData),
              registeredAt: regData.registeredAt,
              bibNumber: regData.bibNumber,
              shirtSize: regData.shirtSize,
              startTime: regData.startTime || trailData?.startTime || trailData?.start_time || '',
              firstName: regData.firstName,
              lastName: regData.lastName,
              fullName: regData.fullName,
            });
          }
        });
        setRegisteredRaces(registeredRacesList);

        // Process Completed Races
        const completedRacesList: CompletedRace[] = [];
        completedSnapshot.docs.forEach(completedDoc => {
          const completedData = completedDoc.data();
          const trailId = completedData.trailId;
          const trailData = newCache.get(trailId);
          
          if (trailData) {
            completedRacesList.push({
              ...trailData,
              id: trailId,
              completedId: completedDoc.id,
              trailId: trailId,
              name: trailData?.name || "Unnamed Trail",
              date: trailData?.date,
              location: trailData?.location,
              imageUrl: getRaceImageUrl(trailData),
              completedAt: completedData.completedAt,
              finishTime: completedData.finishTime,
              photo: completedData.photo,
            });
          }
        });
        setCompletedRaces(completedRacesList);
        
        setLoading(false);
      } catch (error: any) {
        // Suppress permission errors caused by logout (auth token revoked mid-fetch)
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }
        console.error("Error fetching saved races:", error);
        if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
          console.warn("Permission denied. Make sure Firestore rules are deployed.");
        }
        setLikedRaces([]);
        setRegisteredRaces([]);
        setCompletedRaces([]);
        setLoading(false);
      }
    };

    fetchAllData();
  }, [user]);

  // NOTE: Removed expensive onSnapshot on ALL trails collection.
  // Race data refreshes on screen focus via useFocusEffect above.
  // This saves thousands of Firestore reads per session.

  const handleUnsaveRace = async (raceId: string) => {
    if (!user) return;

    try {
      // Remove from matches
      const matchesQuery = query(
        collection(db, 'matches'),
        where('userId', '==', user.uid),
        where('trailId', '==', raceId)
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      for (const matchDoc of matchesSnapshot.docs) {
        await deleteDoc(matchDoc.ref);
      }

      // Remove from user's matchedTrails
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        matchedTrails: arrayRemove(raceId),
      });

      setLikedRaces(current => current.filter(race => race.id !== raceId));
    } catch (error) {
      console.error("Failed to unsave race:", error);
      Alert.alert("Error", "Failed to remove race from liked list");
    }
  };

  const handleRegister = async (race: Race) => {
    if (!user) {
      Alert.alert("Error", "Please log in to register for races");
      return;
    }

    // External race (RunSignup or UltraSignup) — open external URL + confirm
    const source = race.source;
    const externalUrl = source === 'runsignup' ? race.runsignupUrl
                      : source === 'ultrasignup' ? race.ultrasignupUrl
                      : null;

    if (externalUrl) {
      const sourceName = source === 'runsignup' ? 'RunSignup' : 'UltraSignup';

      // Listen for app returning to foreground after browser redirect
      const subscription = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') {
          subscription.remove();
          Alert.alert(
            'Registration Complete?',
            `Did you complete your registration on ${sourceName}?`,
            [
              { text: 'Not Yet', style: 'cancel' },
              {
                text: 'Yes, I Registered!',
                onPress: async () => {
                  try {
                    const uid = user.uid;
                    const trailId = race.trailId || race.id;
                    // Create registration record
                    const regRef = doc(collection(db, 'registrations'));
                    await setDoc(regRef, {
                      userId: uid,
                      trailId: trailId,
                      registeredAt: Timestamp.now(),
                      registrationType: 'external',
                      source: source,
                      distance: race.distancesOffered?.[0] || race.distance || '',
                    });
                    // Remove from matches (move from Liked → Registered)
                    const matchesQuery = query(
                      collection(db, 'matches'),
                      where('userId', '==', uid),
                      where('trailId', '==', trailId)
                    );
                    const matchesSnap = await getDocs(matchesQuery);
                    for (const matchDoc of matchesSnap.docs) {
                      await deleteDoc(matchDoc.ref);
                    }
                    // Refresh data
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setLikedRaces(prev => prev.filter(r => r.id !== trailId && r.trailId !== trailId));
                    Alert.alert('🎉 Registered!', 'This race is now in your Registered tab.');
                  } catch (err) {
                    console.error('Error saving external registration:', err);
                    Alert.alert('Error', 'Could not save your registration. Please try again.');
                  }
                },
              },
            ]
          );
        }
      });

      Linking.openURL(externalUrl);
      return;
    }

    // Native race — in-app Stripe registration
    setActiveRegistrationRace(race);

    // If race has multiple distances, show picker first
    const distancesArray = Array.isArray(race.distances) ? race.distances : [];
    if (distancesArray.length > 1) {
      setShowDistancePicker(true);
    } else {
      // Single distance — go straight to registration
      const distance = race.distancesOffered?.[0] || race.distance || undefined;
      setSelectedRegistrationDistance(distance);
      setShowRegistrationModal(true);
    }
  };

  const handlePinRace = useCallback(async (race: Race) => {
    if (!user || !race.matchId) return;

    try {
      // Optimistic UI update - update immediately
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      
      // Check current pinned count from local state (optimistic)
      const currentPinnedCount = likedRaces.filter(r => r.isPinned).length;
      
      if (currentPinnedCount >= 5) {
        Alert.alert(
          "Limit Reached",
          "You can only pin up to 5 races to your favorites. Unpin a race to add a new one."
        );
        return;
      }

      // Update local state immediately (optimistic)
      setLikedRaces(current => {
        const updated = current.map(r => 
          r.id === race.id ? { ...r, isPinned: true } : r
        );
        updated.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        return updated;
      });

      // Update Firestore in background
      const matchDocRef = doc(db, 'matches', race.matchId);
      await updateDoc(matchDocRef, {
        isPinned: true,
      });
    } catch (error) {
      console.error("Error pinning race:", error);
      // Rollback optimistic update on error
      setLikedRaces(current => {
        const updated = current.map(r => 
          r.id === race.id ? { ...r, isPinned: false } : r
        );
        updated.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        return updated;
      });
      Alert.alert("Error", "Failed to pin race");
    }
  }, [user, likedRaces]);

  const handleUnpinRace = useCallback(async (race: Race) => {
    if (!user || !race.matchId) return;

    try {
      // Optimistic UI update
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

      // Update local state immediately
      setLikedRaces(current => {
        const updated = current.map(r => 
          r.id === race.id ? { ...r, isPinned: false } : r
        );
        updated.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        return updated;
      });

      // Update Firestore in background
      const matchDocRef = doc(db, 'matches', race.matchId);
      await updateDoc(matchDocRef, {
        isPinned: false,
      });
    } catch (error) {
      console.error("Error unpinning race:", error);
      // Rollback optimistic update
      setLikedRaces(current => {
        const updated = current.map(r => 
          r.id === race.id ? { ...r, isPinned: true } : r
        );
        updated.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        return updated;
      });
      Alert.alert("Error", "Failed to unpin race");
    }
  }, [user]);

  const handleViewRegistration = (race: Registration) => {
    router.push({
      pathname: "/registration-confirmation",
      params: {
        trailId: race.trailId || race.id,
        raceName: race.name || 'Race',
        distance: race.distancesOffered?.[0] || race.distance || 'Unknown',
        location: race.location || '',
        date: race.date || '',
        price: race.price ? String(race.price) : '0',
        simpleRegistrationId: race.registrationId || '',
        bibNumber: race.bibNumber || '',
        shirtSize: race.shirtSize || '',
        startTime: race.startTime || '',
      },
    });
  };

  const handleMarkComplete = useCallback(async (race: Registration) => {
    if (!user) return;

    Alert.alert(
      "Mark as Complete",
      `Mark ${race.name} as completed?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            try {
              // Optimistic UI update - move to completed immediately
              const completedRace: CompletedRace = {
                ...race,
                completedId: 'temp-' + Date.now(), // Temporary ID
                completedAt: Timestamp.now(),
                finishTime: undefined,
                photo: undefined,
              };
              
              setCompletedRaces(current => [...current, completedRace]);
              setRegisteredRaces(current => current.filter(r => r.id !== race.id));
              setSelectedTab('Completed');

              // Update Firestore in background
              const completedRef = doc(collection(db, 'completed_races'));
              await setDoc(completedRef, {
                userId: user.uid,
                trailId: race.trailId,
                completedAt: Timestamp.now(),
                finishTime: null,
                photo: null,
              });

              // Delete registration
              await deleteDoc(doc(db, 'registrations', race.registrationId));

              // Refresh to get real completed ID
              const completedQuery = query(
                collection(db, 'completed_races'),
                where('userId', '==', user.uid),
                where('trailId', '==', race.trailId)
              );
              const completedSnapshot = await getDocs(completedQuery);
              if (!completedSnapshot.empty) {
                const completedDoc = completedSnapshot.docs[0];
                setCompletedRaces(current => 
                  current.map(r => 
                    r.id === race.id ? { ...r, completedId: completedDoc.id } : r
                  )
                );
              }
            } catch (error) {
              console.error("Error marking race as complete:", error);
              // Rollback optimistic update
              setCompletedRaces(current => current.filter(r => r.id !== race.id));
              setRegisteredRaces(current => [...current, race]);
              Alert.alert("Error", "Failed to mark race as complete");
            }
          },
        },
      ]
    );
  }, [user]);

  // Memoized current races based on selected tab
  const currentRaces = useMemo(() => {
    switch (selectedTab) {
      case 'Liked':
        return likedRaces;
      case 'Registered':
        return registeredRaces;
      case 'Completed':
        return completedRaces;
    }
  }, [selectedTab, likedRaces, registeredRaces, completedRaces]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
        <View className="px-4 pb-2 flex-row items-center">
          <TouchableOpacity 
            onPress={() => router.back()}
            className="mr-4"
          >
            <ArrowLeft size={24} color="#8BC34A" />
          </TouchableOpacity>
          <Text className="text-3xl font-bold text-white">Saved Races</Text>
        </View>
        <SegmentedControl selectedTab={selectedTab} onTabChange={setSelectedTab} />
        <View className="flex-1 px-4">
          <SkeletonLoader count={5} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="px-4 pb-2 flex-row items-center">
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mr-4"
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <Text className="text-3xl font-bold text-white">Saved Races</Text>
      </View>
      
      {/* Segmented Control */}
      <SegmentedControl selectedTab={selectedTab} onTabChange={setSelectedTab} />
      
      {/* Races List */}
      <View className="flex-1 px-4">
        <FlatList
          data={currentRaces}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          keyExtractor={(item, index) => {
            // Use unique identifiers based on tab type
            if (selectedTab === 'Registered' && 'registrationId' in item) {
              return `registered-${(item as Registration).registrationId}`;
            }
            if (selectedTab === 'Completed' && 'completedId' in item) {
              return `completed-${(item as CompletedRace).completedId}`;
            }
            // For Liked tab, use trailId to ensure uniqueness (trailId should be unique per race)
            return `liked-${item.trailId || item.id}`;
          }}
          renderItem={({ item }) => {
            if (selectedTab === 'Liked') {
              return (
                <LikedRaceCard
                  race={item as Race}
                  onPress={() => {
                    router.push({
                      pathname: "/race-details",
                      params: { id: item.trailId || item.id },
                    });
                  }}
                  onUnsave={handleUnsaveRace}
                  onRegister={handleRegister}
                  onPin={handlePinRace}
                  onUnpin={handleUnpinRace}
                />
              );
            } else if (selectedTab === 'Registered') {
              return (
                <RegisteredRaceCard
                  race={item as Registration}
                  onPress={() => {
                    handleViewRegistration(item as Registration);
                  }}
                  onViewRegistration={handleViewRegistration}
                  onMarkComplete={handleMarkComplete}
                  onViewDigitalBib={(race) => {
                    router.push({
                      pathname: '/digital-bib',
                      params: {
                        registrationId: race.registrationId || '',
                        bibNumber: race.bibNumber || '',
                        raceName: race.name || 'Race',
                        runnerName: race.fullName || [race.firstName, race.lastName].filter(Boolean).join(' ') || 'Runner',
                        distance: race.distancesOffered?.[0] || race.distance || '',
                        shirtSize: race.shirtSize || '',
                        startTime: race.startTime || '',
                        trailId: race.trailId || race.id || '',
                      },
                    });
                  }}
                />
              );
            } else {
              return (
                <CompletedRaceCard
                  race={item as CompletedRace}
                  onPress={() => {
                    router.push({
                      pathname: "/race-details",
                      params: { id: item.trailId || item.id },
                    });
                  }}
                />
              );
            }
          }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <EmptyState 
              tab={selectedTab} 
              onNavigate={() => router.push('/(tabs)')}
            />
          }
        />
      </View>

      {/* Distance Picker Modal - shown when race has multiple distances */}
      <DistancePickerModal
        visible={showDistancePicker}
        onClose={() => {
          setShowDistancePicker(false);
          setActiveRegistrationRace(null);
        }}
        onSelect={(d: DistanceOption) => {
          setShowDistancePicker(false);
          setSelectedRegistrationDistance(d.label);
          setShowRegistrationModal(true);
        }}
        distances={
          (Array.isArray(activeRegistrationRace?.distances)
            ? activeRegistrationRace.distances
            : []
          ).map((d: any) => ({
            label: d.label || '',
            price: typeof d.price === 'number' ? d.price : parseFloat(d.price) || undefined,
            startTime: d.startTime || '',
            elevationGain: d.elevationGain || '',
          }))
        }
        raceName={activeRegistrationRace?.name || 'Race'}
      />

      {/* Registration Form Modal - shared with race-details */}
      <RegistrationForm
        key={showRegistrationModal ? 'open' : 'closed'}
        visible={showRegistrationModal}
        onClose={() => {
          setShowRegistrationModal(false);
          setActiveRegistrationRace(null);
          setSelectedRegistrationDistance(undefined);
        }}
        race={activeRegistrationRace ?? undefined}
        selectedDistance={selectedRegistrationDistance}
        onRegistered={(payload) => {
          const race = activeRegistrationRace;
          if (!race) {
            return;
          }
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setLikedRaces(current => current.filter(item => item.id !== race.id));
          setRegisteredRaces(current => {
            const withoutRace = current.filter(item => item.id !== race.id);
            const newRegistration: Registration = {
              ...race,
              registrationId: payload.simpleRegistrationId,
              registeredAt: payload.registeredAt,
              bibNumber: payload.bibNumber,
              shirtSize: payload.shirtSize,
              startTime: payload.startTime,
              firstName: payload.firstName,
              lastName: payload.lastName,
              fullName: payload.fullName,
            };
            return [newRegistration, ...withoutRace];
          });
          setSelectedTab('Registered');
        }}
      />
    </SafeAreaView>
  );
}
