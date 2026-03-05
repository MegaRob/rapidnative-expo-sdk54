import { useFocusEffect } from "@react-navigation/native";
import { Image as ExpoImage } from "expo-image";
import * as Location from 'expo-location';
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { signOut } from 'firebase/auth';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, startAfter, Timestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import {
  Bookmark,
  Calendar,
  Filter,
  Heart,
  MapPin,
  MessageCircle,
  Mountain,
  Route,
  Search,
  Send,
  Star,
  User,
  X
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Button,
  Dimensions,
  PanResponder,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db } from '../../src/firebaseConfig';
import { calculateDistance, geocodeLocation, getCoordinatesForCity } from '../../utils/geolocationUtils';
import { applyRaceFilters } from '../../utils/raceFilters';
import FilterModal, { RaceFilters } from '../components/FilterModal';

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25; // 25% of screen width to trigger swipe
const PREFETCH_BATCH_SIZE = 10;
const RACE_BATCH_SIZE = 100; // Load 100 races per Firestore batch (pagination)

// This interface defines the structure our UI needs
interface Trail {
  id: string; // <-- Changed to string for Firebase
  name: string;
  image: string;
  location: string;
  date: string;
  distancesOffered?: string[]; // Array of distance strings (e.g., ["100M", "50K", "10M"])
  elevation: string;
  elevationsByDistance?: { label: string; elevation: string }[]; // Per-distance elevations
  participants: number;
  slogan: string;
  description?: string; // Race description
  matchCount?: number; // Number of users who matched this trail
  sponsorLogos?: string[]; // Array of sponsor logo image URLs
  sponsorText?: string[]; // Array of sponsor text names
  latitude?: number; // Race latitude
  longitude?: number; // Race longitude
  distance?: number; // Distance from user in miles (calculated)
  avgRating?: number; // Average star rating (1-5)
  reviewCount?: number; // Number of reviews
  dateRaw?: Date; // Raw date for filtering
  source?: string; // Race source (e.g. 'runsignup')
  position: Animated.ValueXY;
}

export default function HomeScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedRaces, setLoadedRaces] = useState<Trail[]>([]); // <-- State for our real data
  const [loading, setLoading] = useState(true); // <-- Loading state
  const [error, setError] = useState<string | null>(null);
  const [lastSwipedRace, setLastSwipedRace] = useState<Trail | null>(null);
  const [lastSwipeAction, setLastSwipeAction] = useState<'save' | 'dislike' | null>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [userLatitude, setUserLatitude] = useState<number | null>(null);
  const [userLongitude, setUserLongitude] = useState<number | null>(null);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [gpsStatus, setGpsStatus] = useState<'active' | 'denied' | 'unavailable' | 'loading'>('loading');
  const [gpsLocationName, setGpsLocationName] = useState<string>('');
  const [filters, setFilters] = useState<RaceFilters>({
    radius: 0,
    distance: 'All',
    difficulty: 'All',
    elevation: 'All',
    dateFrom: null,
    dateTo: null,
  });
  const [allRaces, setAllRaces] = useState<Trail[]>([]); // Store unfiltered races
  // --- Pagination state ---
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any>(null);
  const [hasMoreRaces, setHasMoreRaces] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchKey, setFetchKey] = useState(0); // Increment to re-trigger initial fetch

  const user = auth.currentUser;
  const uid = user ? user.uid : null;
  const insets = useSafeAreaInsets();

  // --- GPS LOCATION ---
  useEffect(() => {
    let isMounted = true;
    const getGPSLocation = async () => {
      try {
        setGpsStatus('loading');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isMounted) setGpsStatus('denied');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude } = location.coords;

        if (isMounted) {
          setUserLatitude(latitude);
          setUserLongitude(longitude);
          setGpsStatus('active');
        }

        // Reverse geocode for display name
        try {
          const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (geocode && geocode.length > 0 && isMounted) {
            const addr = geocode[0];
            const name = addr.city && addr.region
              ? `${addr.city}, ${addr.region}`
              : addr.city || addr.region || '';
            setGpsLocationName(name);
          }
        } catch {
          // Non-critical — GPS coordinates still work without a display name
        }
      } catch (error) {
        console.warn('GPS location error:', error);
        if (isMounted) setGpsStatus('unavailable');
      }
    };

    getGPSLocation();
    return () => { isMounted = false; };
  }, []);

  // Filter races by radius using GPS distance
  const filterByRadius = (
    races: Trail[],
    selectedRadius: RaceFilters['radius'],
    uLat?: number | null,
    uLon?: number | null
  ) => {
    // Global = no radius filter
    if (selectedRadius === 0 || !selectedRadius) return races;

    const lat = uLat ?? userLatitude;
    const lon = uLon ?? userLongitude;

    // Can't filter without user coordinates
    if (lat == null || lon == null) return races;

    return races.filter((race) => {
      // If race has no coordinates, include it rather than hiding it
      if (race.latitude == null || race.longitude == null || race.distance === undefined) {
        return true;
      }
      return race.distance <= selectedRadius;
    });
  };

  const resetRacePositions = (races: Trail[]) => {
    races.forEach((race) => {
      try {
        race.position?.setValue?.({ x: 0, y: 0 });
      } catch (error) {
        console.warn('Failed to reset race position:', race.id, error);
      }
    });
    return races;
  };

  // Refs to avoid stale state in PanResponder
  const loadedRacesRef = useRef(loadedRaces);
  const currentIndexRef = useRef(currentIndex);
  const prefetchedImagesRef = useRef<Set<string>>(new Set());
  const excludedIdsRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);

  // Sync refs with state
  useEffect(() => {
    loadedRacesRef.current = loadedRaces;
  }, [loadedRaces]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const prefetchRaceImages = useCallback((races: Trail[], startIndex: number, count: number) => {
    const end = Math.min(races.length, startIndex + count);
    for (let i = startIndex; i < end; i += 1) {
      const uri = races[i]?.image;
      if (typeof uri !== 'string' || uri.trim().length === 0) continue;
      if (prefetchedImagesRef.current.has(uri)) continue;
      prefetchedImagesRef.current.add(uri);
      ExpoImage.prefetch(uri).catch(() => {
        prefetchedImagesRef.current.delete(uri);
      });
    }
  }, []);

  useEffect(() => {
    if (loadedRaces.length === 0) return;
    const batchStart =
      Math.floor(currentIndex / PREFETCH_BATCH_SIZE) * PREFETCH_BATCH_SIZE;
    prefetchRaceImages(loadedRaces, batchStart, PREFETCH_BATCH_SIZE);
  }, [loadedRaces, currentIndex, prefetchRaceImages]);

  const formatDate = useCallback((value: any): string => {
    if (value && typeof value === "object") {
      if ("seconds" in value && typeof value.seconds === "number" && typeof value.nanoseconds === "number") {
        try {
          if (typeof value.toDate === "function") {
            return value.toDate().toLocaleDateString();
          }
          return new Date(value.seconds * 1000).toLocaleDateString();
        } catch (error) {
          console.warn("Failed to format Firestore Timestamp:", error);
        }
      } else if (value instanceof Date) {
        return value.toLocaleDateString();
      }
    }

    if (value instanceof Date) {
      return value.toLocaleDateString();
    }

    if (typeof value === "string") {
      return value;
    }

    return "Coming Soon";
  }, []);

  const buildTrail = useCallback((id: string, data: any): Trail => {
    // Handle distancesOffered array, with fallback to old distance field for backward compatibility
    let distancesOffered: string[] | undefined;
    if (Array.isArray(data?.distancesOffered) && data.distancesOffered.length > 0) {
      distancesOffered = data.distancesOffered;
    } else if (data?.distance) {
      // Fallback: convert old single distance field to array
      const distanceValue = typeof data.distance === "number" 
        ? `${data.distance} miles`
        : data.distance;
      distancesOffered = [distanceValue];
    }

    // Handle sponsor data
    let sponsorLogos: string[] | undefined;
    if (Array.isArray(data?.sponsorLogos) && data.sponsorLogos.length > 0) {
      sponsorLogos = data.sponsorLogos;
    }

    let sponsorText: string[] | undefined;
    if (Array.isArray(data?.sponsorText) && data.sponsorText.length > 0) {
      sponsorText = data.sponsorText;
    }

    const parsedLat = Number(data?.latitude);
    const parsedLon = Number(data?.longitude);
    let latitude = Number.isFinite(parsedLat) ? parsedLat : undefined;
    let longitude = Number.isFinite(parsedLon) ? parsedLon : undefined;

    if ((latitude === undefined || longitude === undefined) && data?.location) {
      const coords = getCoordinatesForCity(data.location);
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lon;
      }
    }

    const normalizeImageUrl = (value?: unknown) => {
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
    const safeImage =
      normalizeImageUrl(data?.imageUrl) ||
      normalizeImageUrl(data?.image) ||
      normalizeImageUrl(data?.featuredImageUrl) ||
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8bW91bnRhaW5zJTIwYW5kJTIwbGFrZXxlbnwwfHwwfHx8MA%3D%3D";
    const optimizedImage = safeImage.includes('images.unsplash.com')
      ? `${safeImage}${safeImage.includes('?') ? '&' : '?'}w=1200&auto=format&fit=crop&q=70`
      : safeImage;

    // Parse raw date for date-range filtering
    let dateRaw: Date | undefined;
    if (data?.date) {
      if (typeof data.date === 'object' && 'seconds' in data.date) {
        dateRaw = new Date(data.date.seconds * 1000);
      } else if (data.date instanceof Date) {
        dateRaw = data.date;
      } else if (typeof data.date === 'string') {
        const parsed = new Date(data.date);
        if (!isNaN(parsed.getTime())) dateRaw = parsed;
      }
    }

    // Build per-distance elevation data when multiple distances exist
    let elevationsByDistance: { label: string; elevation: string }[] | undefined;
    const distancesArr = Array.isArray(data?.distances) ? data.distances : [];
    if (distancesArr.length > 1) {
      elevationsByDistance = distancesArr
        .filter((d: any) => d.label)
        .map((d: any) => ({
          label: d.label,
          elevation: d.elevationGain || '',
        }));
    }

    const trail = {
      id,
      name: data?.name || "Unnamed Trail",
      location: data?.location || "Unknown Location",
      distancesOffered,
      image: optimizedImage,
      date: formatDate(data?.date),
      dateRaw,
      elevation: data?.elevation || "",
      elevationsByDistance,
      participants: data?.participants || 100,
      slogan: data?.slogan || "Discover new trails",
      description: data?.description || "No description available.",
      sponsorLogos,
      sponsorText,
      latitude,
      longitude,
      avgRating: typeof data?.avgRating === 'number' ? data.avgRating : undefined,
      reviewCount: typeof data?.reviewCount === 'number' ? data.reviewCount : undefined,
      source: data?.source || '',
      position: new Animated.ValueXY(),
    };
    return trail;
  }, [formatDate]);

  const onSignOut = async () => {
    try {
      await signOut(auth);
      router.replace('/login');
    } catch (error) {
      console.error("Sign out error", error);
    }
  };

  // --- FETCH REAL DATA FROM FIREBASE ---
  useEffect(() => {
    const fetchTrails = async () => {
      try {
        if (!uid) {
          setLoadedRaces([]);
          setLoading(false);
          return;
        }

        const userDocRef = doc(db, "users", uid);

        // Build paginated query — only load RACE_BATCH_SIZE at a time instead of ALL trails
        const trailsQuery = query(
          collection(db, "trails"),
          orderBy(documentId()),
          limit(RACE_BATCH_SIZE)
        );

        // Fire ALL Firestore queries in parallel — user doc + trails batch + exclusion lists
        const [userDoc, dislikedSnapshot, completedSnapshot, registrationsSnapshot, trailSnapshot] = await Promise.all([
          getDoc(userDocRef),
          getDocs(collection(db, "users", uid, "dislikedRaces")),
          getDocs(query(collection(db, 'completed_races'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'registrations'), where('userId', '==', uid))),
          getDocs(trailsQuery),
        ]);

        let matchedTrailIds: string[] = [];
        // Use GPS coordinates (from state) as primary source for distance calc
        let effectLat: number | null = userLatitude;
        let effectLon: number | null = userLongitude;

        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUserProfile(userData);
          if (Array.isArray(userData?.matchedTrails)) {
            matchedTrailIds = userData.matchedTrails.filter(
              (id: unknown): id is string => typeof id === "string"
            );
          }

          // Load saved preferences as default filters (from onboarding or saved settings)
          const savedRadius = typeof userData?.searchRadius === 'number'
            ? userData.searchRadius
            : typeof userData?.preferredRadius === 'number'
            ? userData.preferredRadius
            : 0;
          const savedDistance = userData?.preferredDistance || null;
          const savedDifficulty = userData?.preferredDifficulty || null;

          setFilters(prev => ({
            ...prev,
            ...(savedRadius === 25 || savedRadius === 50 || savedRadius === 100 || savedRadius === 250 || savedRadius === 500
              ? { radius: savedRadius as RaceFilters['radius'] }
              : {}),
            ...(savedDistance && ['5K-25K', '50K', '100K', '100M+'].includes(savedDistance)
              ? { distance: savedDistance as RaceFilters['distance'] }
              : {}),
            ...(savedDifficulty && ['Technical/Skyrunning', 'Moderate/Mountain', 'Easy/Fire Road'].includes(savedDifficulty)
              ? { difficulty: savedDifficulty as RaceFilters['difficulty'] }
              : {}),
          }));

          // If GPS hasn't set coordinates yet, fall back to profile location
          if (effectLat === null || effectLon === null) {
            const profileLat = typeof userData?.latitude === 'number' ? userData.latitude : null;
            const profileLon = typeof userData?.longitude === 'number' ? userData.longitude : null;
            if (profileLat !== null && profileLon !== null) {
              effectLat = profileLat;
              effectLon = profileLon;
            } else {
              // Geocode from location name as last resort (non-blocking — done after cards show)
              const locationName = userData?.locationName || userData?.hometown || userData?.location || '';
              if (locationName) {
                setIsResolvingLocation(true);
                const coords = await geocodeLocation(locationName);
                if (coords) {
                  effectLat = coords.lat;
                  effectLon = coords.lon;
                  try {
                    await updateDoc(userDocRef, { latitude: coords.lat, longitude: coords.lon });
                  } catch {}
                }
                setIsResolvingLocation(false);
              }
            }
            // Only set state if GPS hasn't already provided coords
            if (userLatitude === null && effectLat !== null) {
              setUserLatitude(effectLat);
              setUserLongitude(effectLon);
            }
          }
        }

        const dislikedTrailIds = dislikedSnapshot.docs.map(docSnap => docSnap.id);
        const completedTrailIds = completedSnapshot.docs.map(doc => doc.data().trailId);
        const registeredTrailIds = registrationsSnapshot.docs.map(doc => doc.data().trailId);
        const ignoredIds = new Set<string>([
          ...matchedTrailIds,
          ...dislikedTrailIds,
          ...completedTrailIds,
          ...registeredTrailIds,
        ]);
        // Save exclusion set for loadMore to use
        excludedIdsRef.current = ignoredIds;

        // Save pagination cursor
        if (!trailSnapshot.empty) {
          setLastVisibleDoc(trailSnapshot.docs[trailSnapshot.docs.length - 1]);
        }
        setHasMoreRaces(trailSnapshot.docs.length >= RACE_BATCH_SIZE);

        if (trailSnapshot.empty) {
          // No trails found
          setLoadedRaces([]);
          setLoading(false);
          return;
        }

        let trailsList = trailSnapshot.docs
          .filter(docSnap => docSnap.data()?.isVisibleOnApp !== false)
          .map(docSnap => buildTrail(docSnap.id, docSnap.data()))
          .filter(trail => !ignoredIds.has(trail.id));

        // Calculate distances for races that already have coordinates (instant)
        if (effectLat !== null && effectLon !== null) {
          trailsList = trailsList.map((trail) => {
            if (trail.latitude !== undefined && trail.longitude !== undefined) {
              const distance = calculateDistance(effectLat!, effectLon!, trail.latitude, trail.longitude);
              return { ...trail, distance };
            }
            return trail;
          });
        }

        // Store all races (unfiltered) and show cards immediately
        setAllRaces(trailsList);
        
        // Apply filters
        let filteredRaces = applyRaceFilters(trailsList, filters);
        filteredRaces = filterByRadius(filteredRaces, filters.radius, effectLat, effectLon);

        // Sort by distance (nearest first) for best swipe experience
        filteredRaces.sort((a, b) => {
          if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance;
          if (a.distance !== undefined) return -1;
          if (b.distance !== undefined) return 1;
          return 0;
        });
        
        resetRacePositions(filteredRaces);
        setLoadedRaces(filteredRaces);
        
        // Reset current index if filtered results change
        setCurrentIndex(0);
        prefetchRaceImages(filteredRaces, 0, PREFETCH_BATCH_SIZE);

        // --- Background: geocode races missing coordinates ---
        if (effectLat !== null && effectLon !== null) {
          const racesNeedingGeocode = trailsList.filter(
            t => (t.latitude === undefined || t.longitude === undefined) && t.location && t.location !== 'Unknown Location'
          );
          if (racesNeedingGeocode.length > 0) {
            Promise.all(racesNeedingGeocode.map(async (trail) => {
              const coords = await geocodeLocation(trail.location);
              if (coords) {
                // Cache coordinates to Firestore
                try { await updateDoc(doc(db, 'trails', trail.id), { latitude: coords.lat, longitude: coords.lon }); } catch {}
                const distance = calculateDistance(effectLat!, effectLon!, coords.lat, coords.lon);
                return { id: trail.id, latitude: coords.lat, longitude: coords.lon, distance };
              }
              return null;
            })).then(results => {
              const updates = results.filter(Boolean) as { id: string; latitude: number; longitude: number; distance: number }[];
              if (updates.length > 0) {
                const updateMap = new Map(updates.map(u => [u.id, u]));
                const patchRaces = (races: Trail[]) => races.map(r => {
                  const u = updateMap.get(r.id);
                  return u ? { ...r, latitude: u.latitude, longitude: u.longitude, distance: u.distance } : r;
                });
                setAllRaces(prev => patchRaces(prev));
                setLoadedRaces(prev => patchRaces(prev));
              }
            });
          }
        }
      } catch (error: any) {
        console.error("Error fetching trails: ", error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTrails();
  }, [buildTrail, uid, fetchKey]);

  // --- LOAD MORE RACES (PAGINATION) ---
  // Fetches the next batch of races when the user is running low on unswiped cards.
  // Uses refs to always access the latest state without stale closures.
  const loadMoreRaces = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRaces || !lastVisibleDoc || !uid) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const nextBatchQuery = query(
        collection(db, "trails"),
        orderBy(documentId()),
        startAfter(lastVisibleDoc),
        limit(RACE_BATCH_SIZE)
      );
      const snapshot = await getDocs(nextBatchQuery);

      if (snapshot.empty) {
        setHasMoreRaces(false);
        return;
      }

      // Update pagination cursor
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMoreRaces(snapshot.docs.length >= RACE_BATCH_SIZE);

      // Build new trails, filtering out hidden and already-seen races
      const excluded = excludedIdsRef.current;
      let newTrails = snapshot.docs
        .filter(docSnap => docSnap.data()?.isVisibleOnApp !== false)
        .map(docSnap => buildTrail(docSnap.id, docSnap.data()))
        .filter(trail => !excluded.has(trail.id));

      // Calculate distances from user
      if (userLatitude !== null && userLongitude !== null) {
        newTrails = newTrails.map((trail) => {
          if (trail.latitude !== undefined && trail.longitude !== undefined) {
            const dist = calculateDistance(userLatitude, userLongitude, trail.latitude, trail.longitude);
            return { ...trail, distance: dist };
          }
          return trail;
        });
      }

      if (newTrails.length === 0) return; // All excluded — auto-load will trigger again if hasMore

      // Sort new batch by distance (nearest first)
      newTrails.sort((a, b) => {
        if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance;
        if (a.distance !== undefined) return -1;
        if (b.distance !== undefined) return 1;
        return 0;
      });

      // Append to the unfiltered pool
      setAllRaces(prev => [...prev, ...newTrails]);

      // Apply current filters to the new batch and append to the swipe deck
      let filteredNew = applyRaceFilters(newTrails, filters);
      filteredNew = filterByRadius(filteredNew, filters.radius);

      if (filteredNew.length > 0) {
        resetRacePositions(filteredNew);
        setLoadedRaces(prev => [...prev, ...filteredNew]);
        prefetchRaceImages(
          [...loadedRacesRef.current, ...filteredNew],
          loadedRacesRef.current.length,
          PREFETCH_BATCH_SIZE
        );
      }
    } catch (error) {
      console.error("Error loading more races:", error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMoreRaces, lastVisibleDoc, uid, buildTrail, userLatitude, userLongitude, filters, prefetchRaceImages]);

  // Auto-load more races when the user is running low on unswiped cards
  useEffect(() => {
    const remainingCards = loadedRaces.length - currentIndex;
    if (remainingCards <= 10 && hasMoreRaces && !loadingMore) {
      loadMoreRaces();
    }
  }, [currentIndex, loadedRaces.length, hasMoreRaces, loadingMore, loadMoreRaces]);

  // Re-apply filters when filters change (but don't re-fetch from Firestore)
  useEffect(() => {
    if (allRaces.length > 0) {
      let racesWithDistance = allRaces;
      if (userLatitude !== null && userLongitude !== null) {
        racesWithDistance = allRaces.map(trail => {
          if (trail.latitude !== undefined && trail.longitude !== undefined) {
            const distance = calculateDistance(
              userLatitude,
              userLongitude,
              trail.latitude,
              trail.longitude
            );
            return { ...trail, distance };
          }
          return { ...trail, distance: undefined };
        });
      }

      let filteredRaces = applyRaceFilters(racesWithDistance, filters);
      filteredRaces = filterByRadius(filteredRaces, filters.radius);

      // Sort by distance (nearest first)
      filteredRaces.sort((a, b) => {
        if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance;
        if (a.distance !== undefined) return -1;
        if (b.distance !== undefined) return 1;
        return 0;
      });
      
      resetRacePositions(filteredRaces);
      setLoadedRaces(filteredRaces);
      setCurrentIndex(0);
      prefetchRaceImages(filteredRaces, 0, PREFETCH_BATCH_SIZE);
    }
  }, [filters, userLatitude, userLongitude, userProfile, prefetchRaceImages]);
  // --- END OF FETCH ---

  // --- LISTEN FOR UNREAD MESSAGES ---
  useEffect(() => {
    if (!auth.currentUser) return;

    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);

    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setHasUnreadMessages(data.hasUnreadMessages === true);
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser]);
  // --- END OF UNREAD MESSAGES LISTENER ---

  // --- SYNC SWIPE DECK ON SCREEN FOCUS ---
  // Removes newly saved/registered races AND restores unfavorited races
  useFocusEffect(
    useCallback(() => {
      const syncDeck = async () => {
        if (!uid) return;
        try {
          const [userDoc, regSnapshot, completedSnapshot, dislikedSnapshot] = await Promise.all([
            getDoc(doc(db, 'users', uid)),
            getDocs(query(collection(db, 'registrations'), where('userId', '==', uid))),
            getDocs(query(collection(db, 'completed_races'), where('userId', '==', uid))),
            getDocs(collection(db, 'users', uid, 'dislikedRaces')),
          ]);

          const matchedTrails = userDoc.exists() ? (userDoc.data()?.matchedTrails || []) : [];
          const registeredIds = regSnapshot.docs.map(d => d.data().trailId);
          const completedIds = completedSnapshot.docs.map(d => d.data().trailId);
          const dislikedIds = dislikedSnapshot.docs.map(d => d.id);
          const excludedIds = new Set([...matchedTrails, ...registeredIds, ...completedIds, ...dislikedIds]);

          setLoadedRaces(prev => {
            // Remove races that are now saved/registered/completed
            const filtered = prev.filter(race => !excludedIds.has(race.id));

            // Find races from allRaces that are no longer excluded (e.g. unfavorited)
            const currentIds = new Set(filtered.map(r => r.id));
            const racesToRestore = allRaces.filter(
              race => !excludedIds.has(race.id) && !currentIds.has(race.id)
            );

            if (racesToRestore.length > 0) {
              // Reset positions for restored races
              racesToRestore.forEach(race => {
                try {
                  race.position?.setValue?.({ x: 0, y: 0 });
                } catch (e) {}
              });
              const merged = [...filtered, ...racesToRestore];
              setCurrentIndex(ci => Math.min(ci, Math.max(merged.length - 1, 0)));
              return merged;
            }

            if (filtered.length < prev.length) {
              setCurrentIndex(ci => Math.min(ci, Math.max(filtered.length - 1, 0)));
            }
            return filtered;
          });
        } catch (error) {
          console.error('Error syncing swipe deck on focus:', error);
        }
      };

      syncDeck();
    }, [uid, allRaces])
  );
  // --- END SYNC SWIPE DECK ON FOCUS ---

  const removeRaceFromDeck = useCallback((raceId: string) => {
    setLoadedRaces(prevRaces => {
      const updated = prevRaces.filter(race => race.id !== raceId);

      setCurrentIndex(prevIndex => {
        if (updated.length === 0) {
          return 0;
        }
        return Math.min(prevIndex, updated.length - 1);
      });

      return updated;
    });
  }, []);


  // Updated to accept a STRING ID
  const handleSaveRace = useCallback(async (raceId: string) => {
    // Save race

    if (!uid) {
      console.error("Save failed: No user ID");
      return;
    }

    try {
      const matchDocRef = doc(collection(db, "matches"));
      await setDoc(matchDocRef, {
        matchId: matchDocRef.id,
        userId: uid,
        trailId: raceId,
        createdAt: Timestamp.now(),
      });

      const userDocRef = doc(db, "users", uid);
      // Add to matchedTrails
      await updateDoc(userDocRef, {
        matchedTrails: arrayUnion(raceId),
      });

      // Match saved

      const raceToUndo = loadedRacesRef.current.find(race => race.id === raceId);
      setLastSwipedRace(raceToUndo ?? null);
      setLastSwipeAction('save');
      removeRaceFromDeck(raceId);
      prefetchRaceImages(loadedRacesRef.current, currentIndexRef.current, 4);
    } catch (error) {
      console.error("Error saving match to Firestore:", error);
    }
  }, [uid, removeRaceFromDeck, prefetchRaceImages]);

  // Updated to accept a STRING ID
  const handleDiscardRace = useCallback(async (raceId: string) => {
    // Discard race

    // Use ref to avoid stale closure in PanResponder
    const raceToDiscard = loadedRacesRef.current.find(race => race.id === raceId);
    setLastSwipedRace(raceToDiscard ?? null);
    setLastSwipeAction('dislike');

    if (!uid) {
      console.error("CRITICAL: UserID is null or undefined. Cannot write to Firestore.");
      return;
    }

    try {
      const raceDocRef = doc(db, "users", uid, "dislikedRaces", raceId);
      await setDoc(
        raceDocRef,
        {
          trailId: raceId,
          createdAt: Timestamp.now(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Failed to add race to disliked list:", error);
    }

    removeRaceFromDeck(raceId);
    prefetchRaceImages(loadedRacesRef.current, currentIndexRef.current, 4);
  }, [uid, removeRaceFromDeck, prefetchRaceImages]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        // READ FROM REFS to avoid stale state
        const currentRace = loadedRacesRef.current[currentIndexRef.current];
        if (currentRace) {
          currentRace.position.setValue({ x: gesture.dx, y: gesture.dy });
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const { dx, dy } = gesture;
        // READ FROM REFS to avoid stale state
        const currentRace = loadedRacesRef.current[currentIndexRef.current];

        if (!currentRace) return; // Safety check

        // 1. CHECK FOR TAP
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
          // Navigate to details
          const { position: _position, ...routeParams } = currentRace;
          router.push({
            pathname: "/race-details",
            params: { id: currentRace.id, ...routeParams } as any,
          });
          // Spring back if it moved slightly
          Animated.spring(currentRace.position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
          return;
        }

        // 2. CHECK FOR SWIPE RIGHT
        else if (dx > SWIPE_THRESHOLD) {
          // Run swipe-away-right animation FIRST
          Animated.timing(currentRace.position, {
            toValue: { x: SCREEN_WIDTH + 100, y: dy }, // Move off-screen
            useNativeDriver: true,
            duration: 200, // Make it fast
          }).start(() => {
            // AFTER animation, call the save logic
            handleSaveRace(currentRace.id);
          });
        }

        // 3. CHECK FOR SWIPE LEFT
        else if (dx < -SWIPE_THRESHOLD) {
          // Run swipe-away-left animation FIRST
          Animated.timing(currentRace.position, {
            toValue: { x: -SCREEN_WIDTH - 100, y: dy }, // Move off-screen
            useNativeDriver: true,
            duration: 200,
          }).start(() => {
            // AFTER animation, call the discard logic
            handleDiscardRace(currentRace.id);
          });
        }

        // 4. CHECK FOR "SPRING BACK"
        else {
          // Not a tap, not a swipe... spring back to center
          Animated.spring(currentRace.position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current; // .current is important

  const currentRace = loadedRaces[currentIndex] ?? null;
  const nextRace = loadedRaces[currentIndex + 1] ?? null;

  const handleUndo = useCallback(async () => {
    if (!lastSwipedRace || !lastSwipeAction || !uid) {
      return;
    }

    try {
      if (lastSwipeAction === 'dislike') {
        // Remove from disliked list
        const raceDocRef = doc(db, "users", uid, "dislikedRaces", lastSwipedRace.id);
        await deleteDoc(raceDocRef);
      } else if (lastSwipeAction === 'save') {
        // Remove from matchedTrails array
        const userDocRef = doc(db, "users", uid);
        await updateDoc(userDocRef, {
          matchedTrails: arrayRemove(lastSwipedRace.id),
        });

        // Remove the match document
        const matchesQuery = query(
          collection(db, 'matches'),
          where('userId', '==', uid),
          where('trailId', '==', lastSwipedRace.id)
        );
        const matchSnapshot = await getDocs(matchesQuery);
        const batch = writeBatch(db);
        matchSnapshot.docs.forEach(matchDoc => batch.delete(matchDoc.ref));
        await batch.commit();
      }
    } catch (error) {
      console.error("Failed to undo last action:", error);
    }

    const restoredRace = lastSwipedRace;
    try {
      restoredRace.position?.setValue?.({ x: 0, y: 0 });
    } catch (error) {
      console.warn("Failed to reset race position for undo:", error);
    }

    setLoadedRaces(prev => resetRacePositions([restoredRace, ...prev]));
    setCurrentIndex(0);
    prefetchRaceImages([restoredRace, ...loadedRacesRef.current], 0, 4);
    setLastSwipedRace(null);
    setLastSwipeAction(null);
  }, [lastSwipedRace, lastSwipeAction, uid, prefetchRaceImages, resetRacePositions]);

  const handleSwipeRight = () => {
    if (!currentRace) {
      return;
    }
    Animated.spring(currentRace.position, {
      toValue: { x: SCREEN_WIDTH, y: 0 },
      useNativeDriver: true,
    }).start(() => {
      void handleSaveRace(currentRace.id);
    });
  };

  const handleSwipeLeft = () => {
    if (!currentRace) {
      return;
    }
    Animated.spring(currentRace.position, {
      toValue: { x: -SCREEN_WIDTH, y: 0 },
      useNativeDriver: true,
    }).start(() => {
      void handleDiscardRace(currentRace.id);
    });
  };

  const handleRefresh = useCallback(async () => {
    if (!uid) {
      alert("You must be logged in to refresh.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Clear the disliked list so those races come back into the pool
      const dislikedRef = collection(db, "users", uid, "dislikedRaces");
      const dislikedSnapshot = await getDocs(dislikedRef);

      if (!dislikedSnapshot.empty) {
        const batch = writeBatch(db);
        dislikedSnapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
        await batch.commit();
      }

      // Reset pagination state and trigger a fresh fetch from the beginning
      setLastVisibleDoc(null);
      setHasMoreRaces(true);
      setAllRaces([]);
      setLoadedRaces([]);
      setCurrentIndex(0);
      setFetchKey(prev => prev + 1); // Triggers the main fetchTrails useEffect
    } catch (error) {
      console.error("Error refreshing races:", error);
      setError("Unable to refresh races. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  // Navigation handlers
  const handleNavigateToSaved = useCallback(() => {
    router.push("/saved-races");
  }, [router]);

  const handleNavigateToChat = useCallback(() => {
    router.push("/chat-inbox");
  }, [router]);

  const handleNavigateToProfile = useCallback(() => {
    router.push("/profile");
  }, [router]);

  const handleNavigateToSearch = useCallback(() => {
    router.push("/search");
  }, [router]);

  // --- RENDER LOGIC ---

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A1F25', justifyContent: 'center', padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 18, textAlign: 'center', marginBottom: 20 }}>
          {error}
        </Text>
        <Button title="LOG OUT" onPress={onSignOut} color="#8BC34A" />
      </View>
    );
  }

  // Handle Loading State
  if (loading) {
    return (
      <View className="flex-1 bg-[#1A1F25] justify-center items-center">
        <ActivityIndicator size="large" color="#8BC34A" />
        <Text className="text-white mt-4">Loading trails...</Text>
      </View>
    );
  }
  if (isResolvingLocation) {
    return (
      <View className="flex-1 bg-[#1A1F25] justify-center items-center">
        <ActivityIndicator size="large" color="#8BC34A" />
        <Text className="text-white mt-4">Updating your location...</Text>
      </View>
    );
  }

  const hasActiveFilters = 
    filters.radius !== 0 ||
    filters.distance !== 'All' ||
    filters.difficulty !== 'All' ||
    filters.elevation !== 'All' ||
    filters.dateFrom !== null ||
    filters.dateTo !== null;

  const handleApplyFilters = async (newFilters: RaceFilters) => {
    setFilters(newFilters);

    // Persist radius preference to Firestore
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), {
          searchRadius: newFilters.radius,
        });
      } catch (error) {
        console.warn('Error saving search radius:', error);
      }
    }
  };

  const handleResetFilters = async () => {
    const resetFilters: RaceFilters = {
      radius: 0,
      distance: 'All',
      difficulty: 'All',
      elevation: 'All',
      dateFrom: null,
      dateTo: null,
    };
    setFilters(resetFilters);

    // Persist reset to Firestore
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { searchRadius: 0 });
      } catch (error) {
        console.warn('Error resetting search radius:', error);
      }
    }
  };

  // Show loading spinner if we've swiped through all cards but more are being fetched
  if ((loadedRaces.length === 0 || !currentRace) && loadingMore) {
    return (
      <View className="flex-1 bg-[#1A1F25] justify-center items-center">
        <ActivityIndicator size="large" color="#8BC34A" />
        <Text className="text-white mt-4">Loading more races...</Text>
      </View>
    );
  }

  if (loadedRaces.length === 0) {
    return (
      <EmptyScreen
        onRefresh={handleRefresh}
        loading={loading}
        onSaved={handleNavigateToSaved}
        onChat={handleNavigateToChat}
        onProfile={handleNavigateToProfile}
        onSearch={handleNavigateToSearch}
        hasUnreadMessages={hasUnreadMessages}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
        onFilter={() => setShowFilterModal(true)}
        showFilterModal={showFilterModal}
        filters={filters}
        onCloseFilterModal={() => setShowFilterModal(false)}
        onApplyFilters={handleApplyFilters}
        gpsStatus={gpsStatus}
        gpsLocationName={gpsLocationName}
      />
    );
  }

  if (!currentRace) {
    return (
      <EmptyScreen
        onRefresh={handleRefresh}
        loading={loading}
        onSaved={handleNavigateToSaved}
        onChat={handleNavigateToChat}
        onProfile={handleNavigateToProfile}
        onSearch={handleNavigateToSearch}
        hasUnreadMessages={hasUnreadMessages}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
        onFilter={() => setShowFilterModal(true)}
        showFilterModal={showFilterModal}
        filters={filters}
        onCloseFilterModal={() => setShowFilterModal(false)}
        onApplyFilters={handleApplyFilters}
        gpsStatus={gpsStatus}
        gpsLocationName={gpsLocationName}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['bottom', 'left', 'right']}>
      {/* --- HEADER --- */}
      <MainHeader
        onSaved={handleNavigateToSaved}
        onChat={handleNavigateToChat}
        onProfile={handleNavigateToProfile}
        onSearch={handleNavigateToSearch}
        hasUnreadMessages={hasUnreadMessages}
        onFilter={() => setShowFilterModal(true)}
        hasActiveFilters={hasActiveFilters}
      />

      {/* --- CARD CONTAINER (takes up all remaining space) --- */}
      {/* This 'p-4' provides the small frame around the card */}
      <View className="flex-1 p-4">
        {nextRace && (
          <View
            pointerEvents="none"
            className="absolute top-0 left-0 right-0 bottom-0"
            style={{ transform: [{ scale: 0.97 }] }}
          >
            <View className="flex-1 rounded-2xl overflow-hidden bg-[#0F172A]">
              {typeof nextRace.image === 'string' && nextRace.image.trim().length > 0 ? (
                <View className="flex-1">
                  {(nextRace.source === 'runsignup' || nextRace.source === 'ultrasignup') ? (
                    <>
                      <ExpoImage
                        source={{ uri: nextRace.image }}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                        contentFit="cover"
                        blurRadius={40}
                        cachePolicy="memory-disk"
                      />
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
                      <View style={{ position: 'absolute', top: '12%', left: 0, right: 0, alignItems: 'center' }}>
                        <View style={{
                          backgroundColor: 'rgba(255,255,255,0.12)',
                          borderRadius: 24,
                          padding: 12,
                        }}>
                          <ExpoImage
                            source={{ uri: nextRace.image }}
                            style={{ width: SCREEN_WIDTH * 0.5, height: SCREEN_WIDTH * 0.5, borderRadius: 16 }}
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            priority="high"
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <ExpoImage
                      source={{ uri: nextRace.image }}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      priority="high"
                    />
                  )}
                <LinearGradient
                  colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.04)']}
                  className="absolute top-0 left-0 right-0 bottom-0"
                />
                  <View className="p-6 pb-28">
                    <Text className="text-white text-2xl font-bold">{nextRace.name}</Text>
                  </View>
                </View>
              ) : (
                <View className="flex-1 justify-end">
                  <View className="p-6 pb-28">
                    <Text className="text-white text-2xl font-bold">{nextRace.name}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}
        {/* This is the card, it should be full-width */}
        <Animated.View
          key={currentRace.id}
          {...panResponder.panHandlers}
          className="flex-1"
          style={[
            {
              transform: [
                { translateX: currentRace.position.x },
                { translateY: currentRace.position.y },
              ],
            },
          ]}
        >
          <View className="flex-1 rounded-2xl overflow-hidden bg-[#0F172A]">
            {/* Background image */}
            {typeof currentRace.image === 'string' && currentRace.image.trim().length > 0 && (
              (currentRace.source === 'runsignup' || currentRace.source === 'ultrasignup') ? (
                // RunSignup: blurred full-bleed background + crisp centered logo
                <>
                  <ExpoImage
                    source={{ uri: currentRace.image }}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    contentFit="cover"
                    blurRadius={40}
                    cachePolicy="memory-disk"
                  />
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
                  <View style={{ position: 'absolute', top: '12%', left: 0, right: 0, alignItems: 'center' }}>
                    <View style={{
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderRadius: 24,
                      padding: 12,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.3,
                      shadowRadius: 16,
                      elevation: 12,
                    }}>
                      <ExpoImage
                        source={{ uri: currentRace.image }}
                        style={{ width: SCREEN_WIDTH * 0.5, height: SCREEN_WIDTH * 0.5, borderRadius: 16 }}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        priority="high"
                      />
                    </View>
                  </View>
                </>
              ) : (
                <ExpoImage
                  source={{ uri: currentRace.image }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  priority="high"
                />
              )
            )}

            {/* Bottom-up gradient for text readability */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.03)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']}
              locations={[0, 0.4, 0.65, 1]}
              className="absolute top-0 left-0 right-0 bottom-0"
            />

            {/* Share button — top right corner of card */}
            <View className="absolute top-4 right-4 z-10">
              <TouchableOpacity
                onPress={async () => {
                  try {
                    const shareUrl = `https://trailmatch-49203553-49000.web.app/race/${currentRace.id}`;
                    await Share.share({
                      message: `🏔️ Check out ${currentRace.name}${currentRace.location ? ` in ${currentRace.location}` : ''}! ${shareUrl}`,
                      title: currentRace.name,
                      url: shareUrl,
                    });
                  } catch (e) { /* user cancelled */ }
                }}
                className="bg-black/50 rounded-full p-2.5"
                activeOpacity={0.7}
              >
                <Send size={20} color="#8BC34A" />
              </TouchableOpacity>
            </View>

            {/* Spacer to push content to bottom */}
            <View className="flex-1" />

            {/* Race info anchored to bottom */}
            <View className="px-6 pb-28">
              <Text
                className="text-white text-3xl font-bold"
                style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }}
              >
                {currentRace.name || 'Race details loading...'}
              </Text>

              {/* Star Rating */}
              {currentRace.avgRating && currentRace.avgRating > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={14}
                      color={s <= Math.round(currentRace.avgRating!) ? '#FBBF24' : 'rgba(255,255,255,0.3)'}
                      fill={s <= Math.round(currentRace.avgRating!) ? '#FBBF24' : 'transparent'}
                    />
                  ))}
                  <Text
                    style={{
                      color: '#FBBF24',
                      fontSize: 13,
                      fontWeight: '700',
                      marginLeft: 4,
                      textShadowColor: 'rgba(0,0,0,0.8)',
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 5,
                    }}
                  >
                    {currentRace.avgRating.toFixed(1)}
                  </Text>
                  {currentRace.reviewCount ? (
                    <Text
                      style={{
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: 12,
                        marginLeft: 2,
                        textShadowColor: 'rgba(0,0,0,0.8)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 5,
                      }}
                    >
                      ({currentRace.reviewCount})
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Slogan */}
              {currentRace.slogan && currentRace.slogan !== 'Discover new trails' && (
                <Text
                  className="text-gray-300 text-base italic mt-1"
                  style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                >
                  {currentRace.slogan}
                </Text>
              )}

              <View className="flex-row items-center mt-3">
                <MapPin size={16} color="#8BC34A" />
                <Text
                  className="text-white text-base ml-2"
                  style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                >
                  {currentRace.location}
                </Text>
              </View>

              <View className="flex-row items-center mt-1.5">
                <Calendar size={16} color="#8BC34A" />
                <Text
                  className="text-white text-base ml-2"
                  style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                >
                  {formatDate(currentRace.date)}
                </Text>
              </View>

              {/* Elevation & Distances — cap at 3 visible, "+X more" for the rest */}
              {(() => {
                const MAX_VISIBLE = 3;
                const elevByDist = currentRace.elevationsByDistance || [];
                const distOffered = currentRace.distancesOffered || [];

                if (elevByDist.length > 1) {
                  // Multi-distance with elevation data
                  const visible = elevByDist.slice(0, MAX_VISIBLE);
                  const extra = elevByDist.length - MAX_VISIBLE;
                  return (
                    <View className="mt-1.5">
                      {visible.map((item, idx) => (
                        <View key={idx} className="flex-row items-center mt-1">
                          <Route size={16} color="#8BC34A" />
                          <Text
                            className="text-white text-base ml-2"
                            style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                          >
                            {item.label}
                          </Text>
                          {item.elevation ? (
                            <>
                              <View className="ml-3">
                                <Mountain size={14} color="#8BC34A" />
                              </View>
                              <Text
                                className="text-gray-300 text-sm ml-1"
                                style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                              >
                                {item.elevation}
                              </Text>
                            </>
                          ) : null}
                        </View>
                      ))}
                      {extra > 0 && (
                        <Text
                          className="text-gray-400 text-sm mt-1 ml-6"
                          style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                        >
                          +{extra} more distance{extra > 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                  );
                } else {
                  // Single distance or flat list
                  return (
                    <>
                      {currentRace.elevation ? (
                        <View className="flex-row items-center mt-1.5">
                          <Mountain size={16} color="#8BC34A" />
                          <Text
                            className="text-white text-base ml-2"
                            style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                          >
                            {currentRace.elevation} elevation
                          </Text>
                        </View>
                      ) : null}

                      {distOffered.length > 0 && (
                        <View className="flex-row items-center flex-wrap mt-1.5">
                          <Route size={16} color="#8BC34A" />
                          <Text
                            className="text-white text-base ml-2"
                            style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                            numberOfLines={1}
                          >
                            {distOffered.length <= MAX_VISIBLE
                              ? distOffered.join(' · ')
                              : distOffered.slice(0, MAX_VISIBLE).join(' · ') + ` +${distOffered.length - MAX_VISIBLE} more`}
                          </Text>
                        </View>
                      )}
                    </>
                  );
                }
              })()}

              {/* Miles away */}
              {currentRace.distance !== undefined && (
                <Text
                  className="text-gray-400 text-sm mt-2"
                  style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                >
                  {currentRace.distance} mi away
                </Text>
              )}
            </View>
          </View>
        </Animated.View>
      </View>

      {/* --- ACTION BUTTONS (absolutely positioned at bottom, with safe area padding) --- */}
      <View
        className="absolute bottom-0 left-0 right-0 z-10 flex-row justify-evenly items-center"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        <TouchableOpacity
          onPress={handleSwipeLeft}
          className="w-16 h-16 rounded-full bg-red-500 items-center justify-center"
          activeOpacity={0.8}
          style={{
            shadowColor: '#EF4444',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          <X size={28} color="white" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleUndo}
          disabled={!lastSwipedRace}
          className={`w-14 h-14 rounded-full items-center justify-center ${
            lastSwipedRace ? "bg-gray-600" : "bg-gray-800/40"
          }`}
          activeOpacity={0.8}
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
            elevation: 4,
          }}
        >
          <Text className="text-white text-xl font-bold">⟲</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSwipeRight}
          className="w-16 h-16 rounded-full bg-[#8BC34A] items-center justify-center"
          activeOpacity={0.8}
          style={{
            shadowColor: '#8BC34A',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          <Heart size={28} color="white" fill="white" />
        </TouchableOpacity>
      </View>

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        filters={filters}
        onClose={() => setShowFilterModal(false)}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
        gpsStatus={gpsStatus}
        gpsLocationName={gpsLocationName}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Styles moved to component classes
});

const EmptyScreen = ({
  onRefresh,
  loading,
  onSaved,
  onChat,
  onProfile,
  onSearch,
  hasUnreadMessages = false,
  onResetFilters,
  hasActiveFilters = false,
  onFilter,
  showFilterModal = false,
  filters,
  onCloseFilterModal,
  onApplyFilters,
  gpsStatus,
  gpsLocationName,
}: {
  onRefresh: () => void;
  loading: boolean;
  onSaved: () => void;
  onChat: () => void;
  onProfile: () => void;
  onSearch?: () => void;
  hasUnreadMessages?: boolean;
  onResetFilters?: () => void;
  hasActiveFilters?: boolean;
  onFilter?: () => void;
  showFilterModal?: boolean;
  filters?: RaceFilters;
  onCloseFilterModal?: () => void;
  onApplyFilters?: (filters: RaceFilters) => void;
  gpsStatus?: 'active' | 'denied' | 'unavailable' | 'loading';
  gpsLocationName?: string;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['bottom', 'left', 'right']}>
      <MainHeader 
        onSaved={onSaved} 
        onChat={onChat} 
        onProfile={onProfile} 
        onSearch={onSearch}
        hasUnreadMessages={hasUnreadMessages}
        onFilter={onFilter}
        hasActiveFilters={hasActiveFilters}
      />
    <View className="flex-1 justify-center items-center px-4">
      {hasActiveFilters ? (
        <>
          <Text className="text-white text-xl mb-2 text-center">
            No matching races found
          </Text>
          <Text className="text-gray-400 text-base mb-6 text-center">
            Try adjusting your filters or resetting them to see more races.
          </Text>
          <View className="flex-row gap-3 mb-3">
            {onFilter && (
              <TouchableOpacity
                onPress={onFilter}
                className="px-6 py-3 bg-slate-700 rounded-full"
              >
                <Text className="text-white font-bold">Adjust Filters</Text>
              </TouchableOpacity>
            )}
            {onResetFilters && (
              <TouchableOpacity
                onPress={onResetFilters}
                className="px-6 py-3 bg-emerald-500 rounded-full"
              >
                <Text className="text-white font-bold">Reset Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        <>
          <Text className="text-white text-xl mb-2 text-center">
            No more races to show.
          </Text>
        </>
      )}
      <TouchableOpacity
        onPress={onRefresh}
        disabled={loading}
        className="px-6 py-3 bg-[#8BC34A] rounded-full"
      >
        <Text className="text-white font-bold">Refresh</Text>
      </TouchableOpacity>
    </View>
    
    {/* Filter Modal */}
    {onFilter && filters && onCloseFilterModal && onApplyFilters && (
      <FilterModal
        visible={showFilterModal}
        filters={filters}
        onClose={onCloseFilterModal}
        onApply={onApplyFilters}
        onReset={onResetFilters}
        gpsStatus={gpsStatus}
        gpsLocationName={gpsLocationName}
      />
    )}
  </SafeAreaView>
  );
};

const MainHeader = ({
  onSaved,
  onChat,
  onProfile,
  onSearch,
  hasUnreadMessages = false,
  onFilter,
  hasActiveFilters = false,
}: {
  onSaved: () => void;
  onChat: () => void;
  onProfile: () => void;
  onSearch?: () => void;
  hasUnreadMessages?: boolean;
  onFilter?: () => void;
  hasActiveFilters?: boolean;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-row justify-between items-center px-4 pb-4 bg-[#1A1F25]" style={{ paddingTop: insets.top + 8 }}>
    <View className="flex-row items-center">
      <TouchableOpacity onPress={onSaved} className="p-2">
        <Bookmark size={24} color="#8BC34A" />
      </TouchableOpacity>
      {onFilter && (
        <TouchableOpacity onPress={onFilter} className="p-2 ml-2 relative">
          <Filter size={24} color="#8BC34A" />
          {hasActiveFilters && (
            <View className="absolute top-1 right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#1A1F25]" />
          )}
        </TouchableOpacity>
      )}
      {onSearch && (
        <TouchableOpacity onPress={onSearch} className="p-2 ml-2">
          <Search size={24} color="#8BC34A" />
        </TouchableOpacity>
      )}
    </View>

    <Text className="text-white text-xl font-bold">TrailMatch</Text>

    <View className="flex-row">
      {/* REQUIRED for absolute positioning */}
      <View className="relative">
        <TouchableOpacity onPress={onChat} className="p-2 mr-2">
          <MessageCircle size={24} color="#8BC34A" />
        </TouchableOpacity>
        {/* Ensure the dot is small and sits in the corner of the Pressable */}
        {hasUnreadMessages && (
          <View className="absolute top-1 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-black z-10" />
        )}
      </View>

      <TouchableOpacity onPress={onProfile} className="p-2">
        <User size={24} color="#8BC34A" />
      </TouchableOpacity>
    </View>
  </View>
  );
};
