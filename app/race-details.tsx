import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { ArrowLeft, Calendar, Clock, Heart, Mountain, Share2, Star } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import React, { useEffect, useState } from 'react';
import { Alert, Dimensions, Image, Linking, Pressable, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { auth, db } from '../src/firebaseConfig';
import ConfettiEffect from './components/ConfettiEffect';
import FinisherCard from './components/FinisherCard';
import RegistrationForm from './components/RegistrationForm';
import ReviewForm from './components/ReviewForm';
import StarRating from './components/StarRating';
import UserProfileModal from './components/UserProfileModal';

// Enable className support for LinearGradient
cssInterop(LinearGradient, {
  className: 'style',
});

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OtherRunner {
  userId: string;
  name: string;
  photoURL?: string;
  avatarUrl?: string;
  isRegistered: boolean;
  distance?: string;
}

export default function RaceDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const trail = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const [isSaved, setIsSaved] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [otherRunners, setOtherRunners] = useState<OtherRunner[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [raceData, setRaceData] = useState<any>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedRaceData, setCompletedRaceData] = useState<any>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [selectedDistance, setSelectedDistance] = useState<string | undefined>(undefined);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showFullNotes, setShowFullNotes] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const { allBlockedIds } = useBlockedUsers();

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Get the raceId from route parameters
  const raceId = Array.isArray(trail.id) ? trail.id[0] : trail.id;

  // Check if race is completed
  useEffect(() => {
    const checkIfCompleted = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid || !raceId) return;

      try {
        const completedQuery = query(
          collection(db, 'completed_races'),
          where('userId', '==', uid),
          where('trailId', '==', raceId)
        );
        const completedSnapshot = await getDocs(completedQuery);
        
        if (!completedSnapshot.empty) {
          const completedDoc = completedSnapshot.docs[0];
          setCompletedRaceData(completedDoc.data());
          setIsCompleted(true);
          // Show confetti on first load
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 3000);
        }
      } catch (error) {
        console.error('Error checking if race is completed:', error);
      }
    };

    checkIfCompleted();
  }, [raceId]);

  // Fetch reviews for this race
  const fetchReviews = async () => {
    if (!raceId) return;
    try {
      const reviewsQuery = query(
        collection(db, 'reviews'),
        where('trailId', '==', raceId)
      );
      const snap = await getDocs(reviewsQuery);
      const reviewsList: any[] = [];
      let total = 0;
      for (const reviewDoc of snap.docs) {
        const data = reviewDoc.data();
        total += data.rating || 0;
        // Fetch reviewer name
        let reviewerName = 'Runner';
        try {
          const userDoc = await getDoc(doc(db, 'users', data.userId));
          if (userDoc.exists()) {
            const ud = userDoc.data();
            reviewerName = ud.firstName || ud.name?.split(' ')[0] || 'Runner';
          }
        } catch {}
        reviewsList.push({ id: reviewDoc.id, ...data, reviewerName });
      }
      // Sort newest first
      reviewsList.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.updatedAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || b.updatedAt?.seconds || 0;
        return bTime - aTime;
      });
      setReviews(reviewsList);
      if (snap.size > 0) {
        setAvgRating(Math.round((total / snap.size) * 10) / 10);
        setReviewCount(snap.size);
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [raceId]);

  // Fetch race data from Firestore to ensure we have complete data including description
  useEffect(() => {
    if (!raceId) return;

    const raceDocRef = doc(db, 'trails', raceId);
    const unsubscribe = onSnapshot(
      raceDocRef,
      (raceDoc) => {
        if (raceDoc.exists()) {
          setRaceData(raceDoc.data());
        }
      },
      (error) => {
        console.error('Error fetching race data:', error);
      }
    );

    return () => unsubscribe();
  }, [raceId]);

  // Check if the race is already saved
  useEffect(() => {
    const checkIfSaved = async () => {
      const uid = auth.currentUser?.uid;
      
      if (!uid || !raceId) {
        return;
      }

      try {
        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          const matchedTrails = userData.matchedTrails || [];
          
          if (Array.isArray(matchedTrails) && matchedTrails.includes(raceId)) {
            setIsSaved(true);
          }
        }
      } catch (error) {
        console.error('Error checking if race is saved:', error);
      }
    };

    checkIfSaved();
  }, [raceId]);

  // Check if the user is already registered for this race
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !raceId) {
      setIsRegistered(false);
      return;
    }
    const registrationQuery = query(
      collection(db, 'registrations'),
      where('userId', '==', uid),
      where('trailId', '==', raceId)
    );
    const unsubscribe = onSnapshot(
      registrationQuery,
      (snapshot) => {
        const registered = !snapshot.empty;
        setIsRegistered(registered);
        if (registered) {
          setShowRegistrationModal(false);
        }
      },
      (error) => {
        console.error('Error checking registration status:', error);
      }
    );
    return () => unsubscribe();
  }, [raceId]);

  // Fetch other runners: both interested (matches) and registered (registrations)
  useEffect(() => {
    if (!raceId) return;

    const currentUid = auth.currentUser?.uid;
    if (!currentUid) {
      setOtherRunners([]);
      return;
    }

    const isAdmin = currentUid === 'gveHJNWFRgZKj0qz8ZOJuT976j13';

    // Helper: fetch a user profile and build an OtherRunner
    const fetchRunner = async (
      userId: string,
      isRegistered: boolean,
      distance?: string
    ): Promise<OtherRunner | null> => {
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) return null;
        const userData = userDoc.data();
        if (userData.isPrivate === true && !isAdmin) return null;

        const rawName = userData.name || userData.username || '';
        const derivedFirstName = rawName ? String(rawName).split(' ')[0] : '';
        const firstName = userData.firstName || derivedFirstName || 'Runner';

        return {
          userId,
          name: firstName,
          photoURL: userData.photoURL ?? undefined,
          avatarUrl: userData.avatarUrl ?? undefined,
          isRegistered,
          distance,
        };
      } catch (error) {
        console.error(`Error fetching user ${userId}:`, error);
        return null;
      }
    };

    // Listen to both matches (interested) and registrations (registered)
    const matchesQuery = query(collection(db, 'matches'), where('trailId', '==', raceId));
    const registrationsQuery = query(collection(db, 'registrations'), where('trailId', '==', raceId));

    let matchesData: { userId: string }[] = [];
    let registrationsData: { userId: string; distance?: string }[] = [];
    let initialMatchesLoaded = false;
    let initialRegistrationsLoaded = false;

    const mergeAndFetch = async () => {
      // Wait until both listeners have fired at least once
      if (!initialMatchesLoaded || !initialRegistrationsLoaded) return;

      // Build a set of registered userIds so we can exclude them from "interested"
      const registeredUserIds = new Set(registrationsData.map(r => r.userId));

      const runnerPromises: Promise<OtherRunner | null>[] = [];

      // Add registered runners
      registrationsData.forEach(reg => {
        if (reg.userId !== currentUid && !allBlockedIds.has(reg.userId)) {
          runnerPromises.push(fetchRunner(reg.userId, true, reg.distance));
        }
      });

      // Add interested runners (matched but NOT registered)
      matchesData.forEach(match => {
        if (
          match.userId !== currentUid &&
          !allBlockedIds.has(match.userId) &&
          !registeredUserIds.has(match.userId)
        ) {
          runnerPromises.push(fetchRunner(match.userId, false));
        }
      });

      const runners = await Promise.all(runnerPromises);
      // Deduplicate by userId (keep first occurrence — registered takes priority)
      const seen = new Set<string>();
      const unique = runners.filter((r): r is OtherRunner => {
        if (!r || seen.has(r.userId)) return false;
        seen.add(r.userId);
        return true;
      });
      setOtherRunners(unique);
    };

    const unsubMatches = onSnapshot(matchesQuery, (snapshot) => {
      matchesData = snapshot.docs.map(d => ({ userId: d.data().userId }));
      initialMatchesLoaded = true;
      mergeAndFetch();
    }, (error) => {
      console.error('Error listening to matches:', error);
    });

    const unsubRegistrations = onSnapshot(registrationsQuery, (snapshot) => {
      registrationsData = snapshot.docs.map(d => {
        const data = d.data();
        return { userId: data.userId, distance: data.distance || undefined };
      });
      initialRegistrationsLoaded = true;
      mergeAndFetch();
    }, (error) => {
      console.error('Error listening to registrations:', error);
    });

    return () => {
      unsubMatches();
      unsubRegistrations();
    };
  }, [raceId, allBlockedIds]);

  const handleSaveRace = async () => {
    const uid = auth.currentUser?.uid;

    // 'raceId' should be available from your page's props or state
    if (!uid || !raceId) {
      console.error("Save failed: No user or raceId");
      return;
    }

    try {
      // 1. Create the match document
      const matchDocRef = doc(collection(db, "matches"));
      await setDoc(matchDocRef, {
        matchId: matchDocRef.id,
        userId: uid,
        trailId: raceId,
        createdAt: Timestamp.now(),
      });

      // 2. Add to user's saved list
      const userDocRef = doc(db, "users", uid);
      await updateDoc(userDocRef, {
        matchedTrails: arrayUnion(raceId)
      });

      console.log("Successfully saved match from details page!");

      // 3. Hide the button
      setIsSaved(true);
    } catch (error) {
      console.error("Error saving match:", error);
    }
  };

  const handleShareFinish = async () => {
    try {
      const shareMessage = `🏆 I just finished ${name}! What an incredible race! #TrailMatch #UltraRunning`;
      await Share.share({
        message: shareMessage,
        title: `Finished ${name}`,
      });
    } catch (error) {
      console.error('Error sharing finish:', error);
      Alert.alert('Error', 'Failed to share your finish. Please try again.');
    }
  };

  const handleShareRace = async () => {
    try {
      const shareUrl = `https://trailmatch-49203553-49000.web.app/race/${raceId}`;
      const shareMessage = `🏔️ Check out ${name}${location ? ` in ${location}` : ''}${date ? ` on ${date}` : ''}! ${shareUrl}`;
      await Share.share({
        message: shareMessage,
        title: name,
        url: shareUrl, // iOS uses this for the share preview
      });
    } catch (error) {
      console.error('Error sharing race:', error);
    }
  };

  // Helper function to get string value from params (can be string or string[])
  const getParam = (param: string | string[] | undefined, fallback: string = '') => {
    if (!param) return fallback;
    return Array.isArray(param) ? param[0] : param;
  };

  const normalizeImageUrl = (value: string | string[] | undefined) => {
    const resolved = getParam(value, '').trim();
    if (!resolved) return '';
    const cleaned = resolved.replace(/^['"]+|['"]+$/g, '');
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

  // Helper function to get number value
  const getNumberParam = (param: string | string[] | undefined, fallback: number = 0) => {
    const value = getParam(param);
    return value ? parseInt(value, 10) || fallback : fallback;
  };

  // Helper function to format date
  const formatDate = (value: any): string => {
    if (!value) return "Coming Soon";
    
    // If it's a string, check if it's an ISO string and format it
    if (typeof value === "string") {
      // If it's already a formatted date string (not ISO), return as-is
      if (!value.includes("T") || !value.includes("Z")) {
        return value;
      }
      // Try to parse ISO string
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
      } catch (error) {
        // If parsing fails, return the string as-is
        return value;
      }
    }

    // Handle Firestore Timestamp objects
    if (typeof value === "object" && value !== null) {
      try {
        if (typeof value.toDate === "function") {
          return value.toDate().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if ("seconds" in value && typeof value.seconds === "number") {
          return new Date(value.seconds * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
      } catch (error) {
        console.warn("Failed to format date:", error);
      }
    }

    return "Coming Soon";
  };

  // Use raceData from Firestore if available (more reliable), otherwise use route params as fallback
  const raceData_merged = raceData || trail;
  const priceValue = raceData_merged?.price;
  const priceNumber =
    typeof priceValue === 'number' ? priceValue : parseFloat(String(priceValue));
  const hasPrice = Number.isFinite(priceNumber) && priceNumber > 0;
  
  const imageUrl =
    normalizeImageUrl(raceData_merged?.imageUrl) ||
    normalizeImageUrl(raceData_merged?.image) ||
    normalizeImageUrl(raceData_merged?.featuredImageUrl) ||
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8bW91bnRhaW5zJTIwYW5kJTIwbGFrZXxlbnwwfHwwfHx8MA%3D%3D';
  const name = getParam(raceData_merged?.name, 'Unnamed Trail');
  const slogan = getParam(raceData_merged?.slogan, 'Discover new trails');
  const date = formatDate(raceData_merged?.date);
  
  // Handle per-distance array (new) with fallback to legacy flat fields
  const distancesArray: any[] = Array.isArray(raceData_merged?.distances) ? raceData_merged.distances : [];

  let distancesOffered: string[] = [];
  if (distancesArray.length > 0) {
    distancesOffered = distancesArray.map((d: any) => d.label).filter(Boolean);
  } else if (Array.isArray(raceData_merged?.distancesOffered) && raceData_merged.distancesOffered.length > 0) {
    distancesOffered = raceData_merged.distancesOffered;
  } else if (raceData_merged?.distance) {
    const distanceValue = getParam(raceData_merged?.distance, '');
    if (distanceValue) distancesOffered = [distanceValue];
  }

  // Selected distance details (from per-distance array, or fall back to flat fields)
  const selectedDist = distancesArray.find((d: any) => d.label === selectedDistance) || distancesArray[0];
  const hasMultipleDistances = distancesArray.length > 1;

  // Per-distance values with event-level fallbacks
  const distStartTime = selectedDist?.startTime || getParam(raceData_merged?.startTime || raceData_merged?.start_time, 'TBD');
  const distCutoff = selectedDist?.cutoffTime || getParam(raceData_merged?.cutoffTime, 'TBD');
  const distElevation = selectedDist?.elevationGain || getParam(raceData_merged?.elevation, '0m');
  const distPrice = selectedDist ? (parseFloat(selectedDist.price) || 0) : (Number.isFinite(priceNumber) ? priceNumber : 0);
  const distCapacity = selectedDist?.capacity || raceData_merged?.capacity || '';

  // Per-distance guide fields with event-level fallbacks
  const distAidStationsRaw = selectedDist?.aidStations ?? raceData_merged?.aidStations;
  const distAidStations =
    typeof distAidStationsRaw === 'number' ? String(distAidStationsRaw) :
    typeof distAidStationsRaw === 'string' && distAidStationsRaw.trim().length > 0 ? distAidStationsRaw.trim() : 'TBD';
  const distAidStationDetails = selectedDist?.aidStationDetails || getParam(raceData_merged?.aidStationDetails, '');
  const distMandatoryGear = selectedDist?.mandatoryGear || getParam(raceData_merged?.mandatoryGear, '');
  const distCheckInDetails = getParam(raceData_merged?.checkInDetails, '');
  const distTerrainNotes = selectedDist?.terrainNotes || getParam(raceData_merged?.terrainNotes, '');
  const distPacerPolicy = selectedDist?.pacerPolicy || getParam(raceData_merged?.pacerPolicy, '');
  const distCrewAccess = selectedDist?.crewAccess || getParam(raceData_merged?.crewAccess, '');
  const distCrewParking = selectedDist?.crewParking || getParam(raceData_merged?.crewParking, '');
  const distDescription = selectedDist?.description || getParam(raceData_merged?.description, 'No description available.');
  const distGpxRouteLink = selectedDist?.gpxRouteLink || getParam(raceData_merged?.gpxRouteLink, '');

  // Event-level only fields
  const location = getParam(raceData_merged?.location, 'Unknown Location');
  const difficulty = getParam(raceData_merged?.difficulty, 'Intermediate');
  const terrain = getParam(raceData_merged?.terrain, 'Various terrain');
  const elevationProfiles = getParam(raceData_merged?.elevationProfiles, '');
  const website = getParam(raceData_merged?.website, '');

  // If race is completed, show Finisher Summary view
  if (isCompleted) {
    const isPendingVerification = !completedRaceData?.finishTime && !completedRaceData?.rank;
    
    return (
      <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
        {showConfetti && <ConfettiEffect />}
        
        {/* Back Button */}
        <View className="absolute top-4 left-4 z-10">
          <TouchableOpacity 
            onPress={() => router.back()}
            className="bg-black/50 rounded-full p-2"
          >
            <ArrowLeft size={24} color="#8BC34A" />
          </TouchableOpacity>
        </View>
        
        <ScrollView className="flex-1">
          {/* Congratulations Header */}
          <View className="p-6 pt-16">
            <View className="items-center mb-6">
              <Text className="text-white text-3xl font-bold text-center mb-2">
                Congratulations on Finishing
              </Text>
              <Text className="text-emerald-400 text-2xl font-bold text-center">
                {name}!
              </Text>
            </View>
            
            {/* Finisher Card */}
            <FinisherCard
              raceName={name}
              raceImageUrl={imageUrl}
              finishTime={completedRaceData?.finishTime}
              rank={completedRaceData?.rank}
              isPendingVerification={isPendingVerification}
            />
            
            {/* Race Details Summary */}
            <View className="bg-[#2C3440] rounded-2xl p-4 mb-4">
              <View className="flex-row items-center mb-3">
                <Calendar size={20} color="#8BC34A" />
                <Text className="text-white ml-3">{date}</Text>
              </View>
              <View className="flex-row items-center">
                <Mountain size={20} color="#8BC34A" />
                <Text className="text-white ml-3">{location}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
        
        {/* Share My Finish Button + Rate Button */}
        <View className="p-6 pt-0" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => setShowReviewForm(true)}
            style={{
              backgroundColor: '#1E293B',
              borderWidth: 1.5,
              borderColor: '#FBBF24',
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
            }}
            activeOpacity={0.8}
          >
            <Star size={20} color="#FBBF24" fill="#FBBF24" />
            <Text style={{ color: '#FBBF24', fontSize: 17, fontWeight: '700' }}>
              {reviews.some(r => r.userId === auth.currentUser?.uid) ? 'Edit Your Review' : 'Rate This Race'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleShareFinish}
            className="bg-emerald-500 py-4 rounded-2xl items-center"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center">
              <Share2 size={20} color="white" />
              <Text className="text-white text-lg font-bold ml-2">Share My Finish</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Review Form Modal (completed race view) */}
        <ReviewForm
          visible={showReviewForm}
          onClose={() => setShowReviewForm(false)}
          trailId={raceId || ''}
          raceName={name}
          onReviewSubmitted={fetchReviews}
        />
      </SafeAreaView>
    );
  }

  // Normal race details view
  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      {/* Back Button - positioned absolutely over the image */}
      <View className="absolute left-4 z-10" style={{ top: insets.top + 8 }}>
        <TouchableOpacity 
          onPress={() => router.back()}
          className="bg-black/50 rounded-full p-2"
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
      </View>
      {/* Share Button - positioned absolutely top right */}
      <View className="absolute right-4 z-10" style={{ top: insets.top + 8 }}>
        <TouchableOpacity 
          onPress={handleShareRace}
          className="bg-black/50 rounded-full p-2"
        >
          <Share2 size={24} color="#8BC34A" />
        </TouchableOpacity>
      </View>
      <ScrollView className="flex-1">
        {/* Header Image */}
        <View className="relative">
          <Image
            source={{ uri: imageUrl }}
            style={{ width: SCREEN_WIDTH, height: 180 }}
            className="w-full"
          />
          
          {/* Gradient overlay for text readability */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.9)']}
            className="absolute bottom-0 left-0 right-0 p-4"
          >
            <Text className="text-white text-3xl font-bold mb-1">
              {name}
            </Text>
            {avgRating > 0 && (
              <View style={{ marginBottom: 4 }}>
                <StarRating rating={avgRating} reviewCount={reviewCount} size={14} textColor="#E2E8F0" />
              </View>
            )}
            <Text className="text-white text-lg">
              {slogan}
            </Text>
          </LinearGradient>
        </View>

        {/* Content */}
        <View className="p-4">

          {/* Distance Tabs (sticky above all sections) */}
          {hasMultipleDistances && (
            <View className="mb-4">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                {distancesArray.map((d: any, i: number) => {
                  const isSelected = (selectedDistance || distancesArray[0]?.label) === d.label;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => setSelectedDistance(d.label)}
                      className={`mr-2 px-5 py-3 rounded-full ${isSelected ? 'bg-emerald-500' : 'bg-[#2C3440]'}`}
                    >
                      <Text className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                        {d.raceTitle || d.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Quick Overview */}
          <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
            <Text className="text-white text-xl font-bold mb-3">Quick Overview</Text>

            <View className="space-y-2">
              <View className="flex-row justify-between">
                <Text className="text-gray-400 text-xs">📅 Race Date</Text>
                <Text className="text-white text-sm">{date}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-gray-400 text-xs">📍 Location</Text>
                <Text className="text-white text-sm">{location}</Text>
              </View>
              {hasMultipleDistances && selectedDist && (
                <View className="flex-row justify-between">
                  <Text className="text-gray-400 text-xs">🏃 Distance</Text>
                  <Text className="text-emerald-400 text-sm font-semibold">{selectedDist.label}</Text>
                </View>
              )}
              {!hasMultipleDistances && distancesOffered.length > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-gray-400 text-xs">🏃 Distance</Text>
                  <Text className="text-white text-sm">{distancesOffered.join(' / ')}</Text>
                </View>
              )}
              {distPrice > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-gray-400 text-xs">💰 Price</Text>
                  <Text className="text-white text-sm">${distPrice}</Text>
                </View>
              )}
              {distCapacity ? (
                <View className="flex-row justify-between">
                  <Text className="text-gray-400 text-xs">👥 Capacity</Text>
                  <Text className="text-white text-sm">{distCapacity}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Race Day Essentials */}
          <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
            <Text className="text-white text-xl font-bold mb-3">Race Day Essentials</Text>
            <View className="flex-row items-center mb-2">
              <Clock size={18} color="#8BC34A" />
              <Text className="text-white ml-3">Start Time: {distStartTime}</Text>
            </View>
            <View className="flex-row items-center mb-2">
              <Clock size={18} color="#8BC34A" />
              <Text className="text-white ml-3">Cutoff: {distCutoff}</Text>
            </View>
            {distCheckInDetails ? (
              <View className="mt-3">
                <Text className="text-gray-400 text-xs mb-1">Check-In</Text>
                <Text className="text-white text-sm">{distCheckInDetails}</Text>
              </View>
            ) : null}
            {distMandatoryGear ? (
              <View className="mt-3">
                <Text className="text-gray-400 text-xs mb-1">Mandatory Gear</Text>
                <Text className="text-white text-sm">{distMandatoryGear}</Text>
              </View>
            ) : null}
          </View>

          {/* Course Profile — only show if there's real data */}
          {(distElevation && distElevation !== '0m') ||
           (difficulty && difficulty !== 'Intermediate') ||
           (terrain && terrain !== 'Various terrain') ||
           distTerrainNotes || elevationProfiles || distGpxRouteLink ? (
            <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
              <Text className="text-white text-xl font-bold mb-3">Course Profile</Text>
              {distElevation && distElevation !== '0m' ? (
                <Text className="text-gray-300 text-sm mb-2">
                  Elevation Gain: <Text className="text-white">{distElevation}</Text>
                </Text>
              ) : null}
              {difficulty && difficulty !== 'Intermediate' ? (
                <Text className="text-gray-300 text-sm mb-2">
                  Difficulty: <Text className="text-white">{difficulty}</Text>
                </Text>
              ) : null}
              {terrain && terrain !== 'Various terrain' ? (
                <Text className="text-gray-300 text-sm mb-2">
                  Terrain: <Text className="text-white">{terrain}</Text>
                </Text>
              ) : null}
              {distTerrainNotes ? (
                <View className="mt-2">
                  <Text className="text-gray-400 text-xs mb-1">Terrain Notes</Text>
                  <Text className="text-white text-sm">{distTerrainNotes}</Text>
                </View>
              ) : null}
              {elevationProfiles ? (
                <View className="mt-3">
                  <Text className="text-gray-400 text-xs mb-1">Elevation by Segment</Text>
                  <Text className="text-white text-sm">{elevationProfiles}</Text>
                </View>
              ) : null}
              {distGpxRouteLink ? (
                <Text className="text-emerald-400 text-sm mt-3">
                  GPX Route: {distGpxRouteLink}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Aid Stations — only show if there's real data */}
          {distAidStations !== 'TBD' || distAidStationDetails ? (
            <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
              <Text className="text-white text-xl font-bold mb-3">Aid Stations</Text>
              {distAidStations !== 'TBD' && (
                <Text className="text-emerald-400 text-sm font-semibold mb-2">{distAidStations} stations</Text>
              )}
              {distAidStationDetails ? (
                <Text className="text-white text-sm">{distAidStationDetails}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Pacer + Crew Rules — only show if there's real data */}
          {distPacerPolicy || distCrewAccess || distCrewParking ? (
            <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
              <Text className="text-white text-xl font-bold mb-3">Pacer + Crew Rules</Text>
              {distPacerPolicy ? (
                <>
                  <Text className="text-gray-400 text-xs mb-1">Pacers</Text>
                  <Text className="text-white text-sm mb-3">{distPacerPolicy}</Text>
                </>
              ) : null}
              {distCrewAccess ? (
                <>
                  <Text className="text-gray-400 text-xs mb-1">Crew Access</Text>
                  <Text className="text-white text-sm">{distCrewAccess}</Text>
                </>
              ) : null}
              {distCrewParking ? (
                <View className="mt-3">
                  <Text className="text-gray-400 text-xs mb-1">Crew Parking</Text>
                  <Text className="text-white text-sm">{distCrewParking}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Race Notes */}
          {distDescription && distDescription !== 'No description available.' ? (() => {
            // Clean up the raw text
            const cleaned = distDescription
              .replace(/\r\n/g, '\n')
              .replace(/\n{2,}/g, '\n\n')
              .trim();

            // Split into paragraphs — if text has real newlines, use those
            let paragraphs = cleaned.split(/\n\n+/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);

            // If we still have just 1 big paragraph (>200 chars with no breaks), split at sentences
            if (paragraphs.length === 1 && paragraphs[0].length > 200) {
              const text = paragraphs[0];
              // Split on sentence-ending punctuation followed by a space
              const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
              // Group sentences into chunks of ~2-3 sentences per paragraph
              const grouped: string[] = [];
              let current = '';
              for (const s of sentences) {
                if (current.length + s.length > 180 && current.length > 0) {
                  grouped.push(current.trim());
                  current = s;
                } else {
                  current += s;
                }
              }
              if (current.trim()) grouped.push(current.trim());
              paragraphs = grouped;
            }

            const NOTE_CHAR_LIMIT = 300;
            const totalLength = paragraphs.reduce((sum: number, p: string) => sum + p.length, 0);
            const isLong = totalLength > NOTE_CHAR_LIMIT;
            const displayParagraphs = showFullNotes ? paragraphs : (() => {
              let charCount = 0;
              const result: string[] = [];
              for (const p of paragraphs) {
                if (charCount + p.length > NOTE_CHAR_LIMIT && result.length > 0) break;
                result.push(p);
                charCount += p.length;
              }
              return result;
            })();

            return (
              <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
                <Text className="text-white text-xl font-bold mb-3">📝 Race Notes</Text>
                {displayParagraphs.map((paragraph: string, idx: number) => {
                  // Check if paragraph has bullet points (lines starting with - or • or *)
                  const lines = paragraph.split('\n');
                  const hasBullets = lines.some((l: string) => /^\s*[-•*]\s/.test(l));

                  if (hasBullets) {
                    return (
                      <View key={idx} className={idx > 0 ? 'mt-3' : ''}>
                        {lines.map((line: string, lineIdx: number) => {
                          const isBullet = /^\s*[-•*]\s/.test(line);
                          const bulletText = isBullet ? line.replace(/^\s*[-•*]\s*/, '') : line;
                          if (!line.trim()) return null;
                          return (
                            <View key={lineIdx} className={`flex-row ${lineIdx > 0 ? 'mt-1.5' : ''}`}>
                              {isBullet && <Text className="text-emerald-400 text-sm mr-2">•</Text>}
                              <Text className={`text-gray-300 text-sm flex-1 leading-5 ${isBullet ? '' : 'mb-1'}`}>
                                {isBullet ? bulletText : line}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  }

                  return (
                    <Text key={idx} className={`text-gray-300 text-sm leading-5 ${idx > 0 ? 'mt-3' : ''}`}>
                      {paragraph}
                    </Text>
                  );
                })}
                {isLong && !showFullNotes && (
                  <Text className="text-gray-500 text-sm mt-1">...</Text>
                )}
                {isLong && (
                  <TouchableOpacity onPress={() => setShowFullNotes(!showFullNotes)} className="mt-2">
                    <Text className="text-emerald-400 text-sm font-semibold">
                      {showFullNotes ? '▲ Show Less' : '▼ Read More'}
                    </Text>
                  </TouchableOpacity>
                )}
                {website ? (
                  <TouchableOpacity onPress={() => Linking.openURL(website)} className="mt-3">
                    <Text className="text-emerald-400 text-sm">🌐 Visit Website</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })() : null}

          {/* Who is Going */}
          {otherRunners.length > 0 && (() => {
            const registeredRunners = otherRunners.filter(r => r.isRegistered);
            const interestedRunners = otherRunners.filter(r => !r.isRegistered);

            // Helper: render a horizontal avatar row
            const renderAvatarRow = (runners: OtherRunner[]) => (
              <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} className="flex-row">
                {runners.map((runner) => {
                  const photoUrl = runner.avatarUrl || runner.photoURL;
                  return (
                    <Pressable
                      key={runner.userId}
                      onPress={() => {
                        setSelectedUserId(runner.userId);
                        setModalVisible(true);
                      }}
                      className="mr-3 items-center"
                    >
                      {photoUrl ? (
                        <Image
                          source={{ uri: photoUrl }}
                          className="w-12 h-12 rounded-full bg-gray-700"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="w-12 h-12 rounded-full bg-gray-700 items-center justify-center">
                          <Text className="text-white text-lg font-bold">
                            {runner.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            );

            // Multi-distance: group registered runners by distance
            if (hasMultipleDistances) {
              // Build groups from registered runners, keyed by distance
              const distanceGroups = new Map<string, OtherRunner[]>();
              registeredRunners.forEach(runner => {
                const key = runner.distance || 'Unknown';
                const group = distanceGroups.get(key) || [];
                group.push(runner);
                distanceGroups.set(key, group);
              });

              // Sort groups to match the race's distance order
              const distanceOrder = distancesArray.map((d: any) => d.label);
              const sortedKeys = [...distanceGroups.keys()].sort((a, b) => {
                const idxA = distanceOrder.indexOf(a);
                const idxB = distanceOrder.indexOf(b);
                return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
              });

              return (
                <View className="mb-4">
                  <Text className="text-white text-xl font-bold mb-4">
                    Who's Going ({otherRunners.length})
                  </Text>

                  {sortedKeys.map(distLabel => {
                    const group = distanceGroups.get(distLabel) || [];
                    return (
                      <View key={distLabel} className="mb-4">
                        <Text className="text-emerald-400 text-sm font-semibold mb-2">
                          {distLabel} · {group.length} registered
                        </Text>
                        {renderAvatarRow(group)}
                      </View>
                    );
                  })}

                  {interestedRunners.length > 0 && (
                    <View className="mb-2">
                      <Text className="text-gray-400 text-sm font-semibold mb-2">
                        Interested · {interestedRunners.length}
                      </Text>
                      {renderAvatarRow(interestedRunners)}
                    </View>
                  )}
                </View>
              );
            }

            // Single distance: show registered vs interested
            return (
              <View className="mb-4">
                <Text className="text-white text-xl font-bold mb-4">
                  Who's Going ({otherRunners.length})
                </Text>

                {registeredRunners.length > 0 && (
                  <View className="mb-4">
                    <Text className="text-emerald-400 text-sm font-semibold mb-2">
                      Registered · {registeredRunners.length}
                    </Text>
                    {renderAvatarRow(registeredRunners)}
                  </View>
                )}

                {interestedRunners.length > 0 && (
                  <View className="mb-2">
                    <Text className="text-gray-400 text-sm font-semibold mb-2">
                      Interested · {interestedRunners.length}
                    </Text>
                    {renderAvatarRow(interestedRunners)}
                  </View>
                )}
              </View>
            );
          })()}

          {/* Ratings & Reviews Section */}
          <View className="bg-[#2C3440] p-4 rounded-2xl mb-6">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text className="text-white text-xl font-bold">
                Ratings & Reviews
              </Text>
              {reviewCount > 0 && (
                <StarRating rating={avgRating} reviewCount={reviewCount} size={16} />
              )}
            </View>

            {reviews.length === 0 ? (
              <Text style={{ color: '#64748B', fontSize: 14, textAlign: 'center', paddingVertical: 12 }}>
                No reviews yet. Be the first to review!
              </Text>
            ) : (
              reviews.slice(0, 5).map((review) => (
                <View
                  key={review.id}
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(71, 85, 105, 0.4)',
                    paddingVertical: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: '#E2E8F0', fontWeight: '700', fontSize: 14 }}>
                      {review.reviewerName}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          size={12}
                          color={s <= review.rating ? '#FBBF24' : '#475569'}
                          fill={s <= review.rating ? '#FBBF24' : 'transparent'}
                        />
                      ))}
                    </View>
                  </View>
                  {review.title ? (
                    <Text style={{ color: '#CBD5E1', fontWeight: '600', fontSize: 14, marginBottom: 2 }}>
                      {review.title}
                    </Text>
                  ) : null}
                  {review.body ? (
                    <Text style={{ color: '#94A3B8', fontSize: 13, lineHeight: 20 }}>
                      {review.body}
                    </Text>
                  ) : null}
                </View>
              ))
            )}

            {/* Write/Edit review button (only if user completed this race) */}
            {isCompleted && (
              <TouchableOpacity
                onPress={() => setShowReviewForm(true)}
                style={{
                  marginTop: 8,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: 'rgba(251, 191, 36, 0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(251, 191, 36, 0.3)',
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
                activeOpacity={0.8}
              >
                <Star size={16} color="#FBBF24" fill="#FBBF24" />
                <Text style={{ color: '#FBBF24', fontWeight: '700', fontSize: 14 }}>
                  {reviews.some(r => r.userId === auth.currentUser?.uid) ? 'Edit Your Review' : 'Write a Review'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Community Board Button */}
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/community",
                params: { trailId: raceId, trailName: raceData_merged?.name || name },
              })
            }
            className="bg-slate-900 border border-emerald-500 py-4 rounded-2xl items-center mb-6"
            activeOpacity={0.8}
          >
            <Text className="text-emerald-400 text-lg font-bold">Community Board</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View className="p-6 pt-0">
        {/* Registration Button */}
        {!isRegistered && raceData_merged?.source === 'runsignup' && raceData_merged?.runsignupUrl ? (
          /* External race — open RunSignup in browser */
          <TouchableOpacity
            onPress={() => {
              Linking.openURL(raceData_merged.runsignupUrl);
            }}
            className="bg-orange-500 py-4 rounded-2xl items-center mb-3"
            activeOpacity={0.8}
          >
            <Text className="text-white text-lg font-bold">
              Register on RunSignup →
            </Text>
          </TouchableOpacity>
        ) : !isRegistered && raceData_merged?.source === 'ultrasignup' && raceData_merged?.ultrasignupUrl ? (
          /* External race — open UltraSignup in browser */
          <TouchableOpacity
            onPress={() => {
              Linking.openURL(raceData_merged.ultrasignupUrl);
            }}
            className="bg-purple-500 py-4 rounded-2xl items-center mb-3"
            activeOpacity={0.8}
          >
            <Text className="text-white text-lg font-bold">
              Register on UltraSignup →
            </Text>
          </TouchableOpacity>
        ) : !isRegistered && (
          /* Native race — in-app Stripe registration */
          <TouchableOpacity
            onPress={() => {
              const distance = selectedDistance || distancesOffered[0] || raceData_merged?.distance;
              const selectedDistObj = distancesArray.find((d: any) => d.label === distance);
              const displayTitle = selectedDistObj?.raceTitle || '';
              const displayDist = displayTitle
                ? `${displayTitle} (${distance})`
                : distance || 'this race';
              const priceText = distPrice > 0 ? ` for $${distPrice.toFixed(2)}` : '';

              Alert.alert(
                'Confirm Registration',
                `You're registering for ${displayDist}${priceText}. Is this correct?`,
                [
                  { text: 'Change', style: 'cancel' },
                  {
                    text: 'Continue',
                    onPress: () => {
                      setSelectedDistance(distance);
                      setShowRegistrationModal(true);
                    },
                  },
                ]
              );
            }}
            className="bg-emerald-500 py-4 rounded-2xl items-center mb-3"
            activeOpacity={0.8}
          >
            <Text className="text-white text-lg font-bold">
              {distPrice > 0
                ? `Register for $${distPrice.toFixed(2)}`
                : 'Register for Race'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Only show the Save button if isSaved is false */}
        {!isSaved && (
          <TouchableOpacity
            onPress={handleSaveRace}
            className="bg-[#8BC34A] py-4 rounded-2xl items-center"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center">
              <Heart size={20} color="white" fill="white" />
              <Text className="text-white text-lg font-bold ml-2">Save Race</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* User Profile Modal */}
      {selectedUserId && (
        <UserProfileModal
          visible={modalVisible}
          onClose={() => {
            setModalVisible(false);
            setSelectedUserId(null);
          }}
          userId={selectedUserId}
          trailId={raceId}
          distance={raceData_merged?.distancesOffered?.[0] || raceData_merged?.distance || undefined}
        />
      )}

      {/* Registration Form Modal - Always render, control via visible prop */}
      <RegistrationForm
        visible={showRegistrationModal}
        onClose={() => {
          setShowRegistrationModal(false);
          setSelectedDistance(undefined);
        }}
        race={raceData_merged ? {
          ...raceData_merged,
          id: raceId,
          trailId: raceId,
        } : undefined}
        selectedDistance={selectedDistance}
      />

      {/* Review Form Modal */}
      <ReviewForm
        visible={showReviewForm}
        onClose={() => setShowReviewForm(false)}
        trailId={raceId || ''}
        raceName={name}
        onReviewSubmitted={fetchReviews}
      />
    </SafeAreaView>
  );
}