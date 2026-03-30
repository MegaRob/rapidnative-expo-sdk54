import { useFocusEffect } from "@react-navigation/native";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import * as Location from 'expo-location';
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, documentId, getCountFromServer, getDocs, limit, orderBy, query, setDoc, startAfter, Timestamp, updateDoc, where, writeBatch } from "firebase/firestore";
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Button,
  Dimensions,
  InteractionManager,
  PanResponder,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db, signOut } from '../../src/firebaseConfig';
import { useCurrentUserProfile } from '../../hooks/useCurrentUserProfile';
import { calculateDistance, geocodeLocation, getCoordinatesForCity } from '../../utils/geolocationUtils';
import { getTrailSocialTotal, sortTrailsForSwipeDeck } from '../../utils/raceFeedSort';
import { applyRaceFilters } from '../../utils/raceFilters';
import { fetchMergedUserProfile } from '../../utils/userProfile';
import FilterModal, { FilterModalHandle, RaceFilters } from '../components/FilterModal';

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25; // 25% of screen width to trigger swipe
const PREFETCH_BATCH_SIZE = 10;
const RACE_BATCH_SIZE = 100; // Load 100 races per Firestore batch (pagination)

// Keywords to identify bike/cycling races — filter these out client-side
const BIKE_KEYWORDS = [
  "bike", "biking", "cycling", "cyclist", "bicycle",
  "mtb", "mountain bike", "gravel ride", "gravel grind",
  "pedal", "criterium", "crit race", "velodrome",
  "cyclocross", "cx race", "tour de", "gran fondo",
  "fondo", "century ride", "fat tire",
];

/** Returns true if a Firestore race doc looks like a bike/cycling event */
function isBikeRace(data: any): boolean {
  const name = (data?.name || "").toLowerCase();
  const description = (data?.description || "").toLowerCase();
  return BIKE_KEYWORDS.some(kw => name.includes(kw) || description.includes(kw));
}

// This interface defines the structure our UI needs
export interface Trail {
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
  matchCount?: number; // Interested (matches) count — optional denormalized field
  registrationCount?: number; // Registration docs count — optional denormalized field
  /** Sum of interested + registered when known (Firestore or client-fetched). */
  socialTotal?: number;
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
  const [loading, setLoading] = useState(true); // <-- Loading state
  const [error, setError] = useState<string | null>(null);
  const [lastSwipedRace, setLastSwipedRace] = useState<Trail | null>(null);
  const [lastSwipeAction, setLastSwipeAction] = useState<'save' | 'dislike' | null>(null);
  const { profile: currentUserProfile } = useCurrentUserProfile();
  const hasUnreadMessages = currentUserProfile?.hasUnreadMessages === true;
  const filterModalRef = useRef<FilterModalHandle>(null);
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
  /** Client-fetched match+registration counts when trail docs omit denormalized fields. */
  const [socialTotals, setSocialTotals] = useState<Record<string, number>>({});
  const socialFetchRequestedRef = useRef<Set<string>>(new Set());
  // --- Pagination state ---
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any>(null);
  const [hasMoreRaces, setHasMoreRaces] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchKey, setFetchKey] = useState(0); // Increment to re-trigger initial fetch
  const filterRequestRef = useRef(0); // Prevent stale filter results from rendering

  const user = auth.currentUser;
  const uid = user ? user.uid : null;
  const insets = useSafeAreaInsets();

  // --- GPS LOCATION ---
  useEffect(() => {
    let isMounted = true;

    /** Race a promise against a timeout — resolves with null if it takes too long */
    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
      ]);

    const getGPSLocation = async () => {
      try {
        setGpsStatus('loading');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isMounted) setGpsStatus('denied');
          return;
        }

        // Timeout after 10 seconds — Android cold GPS can hang for 30s+
        const location = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          10000,
        );

        if (!location) {
          // GPS timed out — try last known position as fallback
          console.warn('GPS timed out after 10s, trying last known position');
          const lastKnown = await withTimeout(
            Location.getLastKnownPositionAsync(),
            3000,
          );
          if (lastKnown && isMounted) {
            setUserLatitude(lastKnown.coords.latitude);
            setUserLongitude(lastKnown.coords.longitude);
            setGpsStatus('active');
          } else if (isMounted) {
            setGpsStatus('unavailable');
          }
          return;
        }

        const { latitude, longitude } = location.coords;

        if (isMounted) {
          setUserLatitude(latitude);
          setUserLongitude(longitude);
          setGpsStatus('active');
        }

        // Reverse geocode for display name (non-blocking, 5s timeout)
        try {
          const geocode = await withTimeout(
            Location.reverseGeocodeAsync({ latitude, longitude }),
            5000,
          );
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

    // Can't filter without user coordinates — exclude races without coords
    // but keep races that DO have a pre-calculated distance
    if (lat == null || lon == null) {
      return races.filter((race) => {
        if (race.distance != null) return race.distance <= selectedRadius;
        return false; // No user GPS and no pre-calculated distance — can't verify
      });
    }

    return races.filter((race) => {
      if (race.latitude == null || race.longitude == null) {
        return false;
      }
      // Always recalculate distance to ensure accuracy with current GPS
      const dist = calculateDistance(lat, lon, race.latitude, race.longitude);
      return dist <= selectedRadius;
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

  const filteredRaces = useMemo(() => {
    if (allRaces.length === 0) return [] as Trail[];

    let racesWithDistance = allRaces;
    if (userLatitude !== null && userLongitude !== null) {
      // Spread preserves each trail's distancesOffered (raw Firestore strings) for applyRaceFilters / strict 50mi regex.
      racesWithDistance = allRaces.map((trail) => {
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

    let filtered = applyRaceFilters(racesWithDistance, filters);
    filtered = filterByRadius(filtered, filters.radius, userLatitude, userLongitude);

    return sortTrailsForSwipeDeck(filtered, socialTotals);
  }, [allRaces, filters, userLatitude, userLongitude, socialTotals]);

  // Aggregate Interested + Registered counts when trail docs lack denormalized fields.
  useEffect(() => {
    let cancelled = false;

    const uniqueIds = [...new Set(allRaces.map((trail) => trail.id))];
    const toFetch = uniqueIds.filter((id) => {
      const trail = allRaces.find((t) => t.id === id);
      if (!trail) return false;
      if (typeof trail.socialTotal === 'number') return false;
      if (typeof trail.matchCount === 'number' || typeof trail.registrationCount === 'number') {
        return false;
      }
      if (socialTotals[id] !== undefined) return false;
      if (socialFetchRequestedRef.current.has(id)) return false;
      return true;
    });

    if (toFetch.length === 0) return;

    toFetch.forEach((id) => socialFetchRequestedRef.current.add(id));

    const BATCH = 8;
    const run = async () => {
      for (let i = 0; i < toFetch.length; i += BATCH) {
        if (cancelled) return;
        const chunk = toFetch.slice(i, i + BATCH);

        const results = await Promise.all(
          chunk.map(async (trailId) => {
            try {
              // `matches` is readable by any signed-in user. `registrations` docs are restricted to
              // owner/admin/director — aggregate counts always fail with permission-denied and spam the console.
              const trail = allRaces.find((t) => t.id === trailId);
              const registrationCountFromTrail =
                trail && typeof trail.registrationCount === "number"
                  ? trail.registrationCount
                  : 0;
              const m = await getCountFromServer(
                query(collection(db, "matches"), where("trailId", "==", trailId))
              );
              return {
                trailId,
                total: m.data().count + registrationCountFromTrail,
              };
            } catch {
              return { trailId, total: 0 };
            }
          })
        );

        if (cancelled) return;
        setSocialTotals((prev) => {
          const next = { ...prev };
          for (const { trailId, total } of results) {
            next[trailId] = total;
          }
          return next;
        });
      }
    };

    const interaction = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void run();
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [allRaces, socialTotals]);

  // Refs to avoid stale state in PanResponder
  const loadedRacesRef = useRef(filteredRaces);
  const currentIndexRef = useRef(currentIndex);
  const prefetchedImagesRef = useRef<Set<string>>(new Set());
  /** Fire at most once per direction when pan crosses swipe threshold (reset in dead zone / on release). */
  const swipeHapticCommittedRef = useRef<"left" | "right" | null>(null);
  const excludedIdsRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);

  // Sync refs with state
  useEffect(() => {
    loadedRacesRef.current = filteredRaces;
  }, [filteredRaces]);

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
    if (filteredRaces.length === 0) return;
    const batchStart =
      Math.floor(currentIndex / PREFETCH_BATCH_SIZE) * PREFETCH_BATCH_SIZE;
    prefetchRaceImages(filteredRaces, batchStart, PREFETCH_BATCH_SIZE);
    // Always warm the next few cards ahead of the finger (batch window can lag at index boundaries).
    prefetchRaceImages(filteredRaces, currentIndex, 6);
  }, [filteredRaces, currentIndex, prefetchRaceImages]);

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
    const distancesArr = Array.isArray(data?.distances) ? data.distances : [];
    const labelsFromStructuredDistances: string[] = distancesArr
      .map((d: { label?: unknown }) => d?.label)
      .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim());

    // Raw strings for filtering: Firestore distancesOffered + structured distance labels (same as UI chips).
    let distancesOffered: string[] | undefined;
    if (Array.isArray(data?.distancesOffered) && data.distancesOffered.length > 0) {
      distancesOffered = data.distancesOffered.map((d: unknown) =>
        typeof d === 'string' ? d : String(d)
      );
    } else if (data?.distance != null && data?.distance !== '') {
      const distanceValue =
        typeof data.distance === 'number' ? `${data.distance} miles` : String(data.distance);
      distancesOffered = [distanceValue];
    }

    if (labelsFromStructuredDistances.length > 0) {
      const base = distancesOffered ?? [];
      distancesOffered = Array.from(new Set([...base, ...labelsFromStructuredDistances]));
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
    if (distancesArr.length > 1) {
      elevationsByDistance = distancesArr
        .filter((d: any) => d.label)
        .map((d: any) => ({
          label: d.label,
          elevation: d.elevationGain || '',
        }));
    }

    const matchCount = typeof data?.matchCount === 'number' ? data.matchCount : undefined;
    const registrationCount =
      typeof data?.registrationCount === 'number' ? data.registrationCount : undefined;
    let socialTotal: number | undefined;
    if (typeof data?.socialTotal === 'number') {
      socialTotal = data.socialTotal;
    } else if (matchCount !== undefined || registrationCount !== undefined) {
      socialTotal = (matchCount ?? 0) + (registrationCount ?? 0);
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
      matchCount,
      registrationCount,
      socialTotal,
      position: new Animated.ValueXY(),
    };
    return trail;
  }, [formatDate]);

  const onSignOut = async () => {
    try {
      // Wipe data BEFORE signing out to prevent ghost renders
      setAllRaces([]);
      setSocialTotals({});
      socialFetchRequestedRef.current.clear();
      setCurrentIndex(0);
      setUserProfile(null);
      setLastSwipedRace(null);
      setLastSwipeAction(null);
      setLastVisibleDoc(null);
      setHasMoreRaces(true);
      await signOut(auth);
      router.replace('/login');
    } catch (error) {
      console.error("Sign out error", error);
    }
  };

  // --- FETCH REAL DATA FROM FIREBASE ---
  useEffect(() => {
    let isCancelled = false;
    const requestId = filterRequestRef.current;

    const fetchTrails = async () => {
      try {
        if (!uid) {
          setAllRaces([]);
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

        // Fire ALL Firestore queries in parallel — merged user profile + trails batch + exclusion lists
        const [mergedUser, dislikedSnapshot, completedSnapshot, registrationsSnapshot, trailSnapshot] = await Promise.all([
          fetchMergedUserProfile(uid),
          getDocs(collection(db, "users", uid, "dislikedRaces")),
          getDocs(query(collection(db, 'completed_races'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'registrations'), where('userId', '==', uid))),
          getDocs(trailsQuery),
        ]);

        // Bail out if the user logged out or uid changed while queries were in flight
        if (isCancelled) return;

        let matchedTrailIds: string[] = [];
        // Use GPS coordinates (from state) as primary source for distance calc
        let effectLat: number | null = userLatitude;
        let effectLon: number | null = userLongitude;

        if (mergedUser && Object.keys(mergedUser as object).length > 0) {
          const userData = mergedUser as Record<string, unknown>;
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
          const savedDistance =
            typeof userData?.preferredDistance === 'string' ? userData.preferredDistance : null;
          const savedDifficulty =
            typeof userData?.preferredDifficulty === 'string' ? userData.preferredDifficulty : null;

          setFilters(prev => ({
            ...prev,
            ...(savedRadius === 25 || savedRadius === 50 || savedRadius === 100 || savedRadius === 250 || savedRadius === 500
              ? { radius: savedRadius as RaceFilters['radius'] }
              : {}),
            ...(savedDistance && ['5K-25K', '50mi', '50K', '100K', '100M+'].includes(savedDistance)
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
              // ── Fire-and-forget geocoding: do NOT await it so cards load immediately.
              //    Coordinates will be set asynchronously and races re-sorted on next render.
              const locationName = String(
                userData?.locationName || userData?.hometown || userData?.location || ''
              );
              if (locationName) {
                setIsResolvingLocation(true);
                geocodeLocation(locationName)
                  .then(async (coords) => {
                    if (coords && !isCancelled) {
                      setUserLatitude(coords.lat);
                      setUserLongitude(coords.lon);
                      try {
                        await updateDoc(userDocRef, { latitude: coords.lat, longitude: coords.lon });
                      } catch {}
                    }
                  })
                  .catch(() => {})
                  .finally(() => {
                    if (!isCancelled) setIsResolvingLocation(false);
                  });
              }
            }
            // Only set state if GPS hasn't already provided coords (from profile)
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
          setAllRaces([]);
          setLoading(false);
          return;
        }

        const ALLOWED_SOURCES = new Set(['runsignup', 'ultrasignup']);
        let trailsList = trailSnapshot.docs
          .filter(docSnap => {
            const d = docSnap.data();
            return d?.isVisibleOnApp !== false && ALLOWED_SOURCES.has(d?.source) && !isBikeRace(d);
          })
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

        // Store all races; filtered deck is derived via useMemo
        setAllRaces(trailsList);

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
              }
            });
          }
        }
      } catch (error: any) {
        if (isCancelled) return;
        console.error("Error fetching trails: ", error);
        setError(error.message);
      } finally {
        if (!isCancelled && requestId === filterRequestRef.current) setLoading(false);
      }
    };

    fetchTrails();
    return () => { isCancelled = true; };
  }, [buildTrail, uid, fetchKey]);

  // --- LOAD MORE RACES (PAGINATION) ---
  // Fetches the next batch of races when the user is running low on unswiped cards.
  // Uses refs to always access the latest state without stale closures.
  const loadMoreRaces = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRaces || !lastVisibleDoc || !uid) return;

    const requestId = filterRequestRef.current;
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

      // Build new trails, filtering out hidden, non-allowed sources, bike races, and already-seen races
      const excluded = excludedIdsRef.current;
      const ALLOWED_SOURCES = new Set(['runsignup', 'ultrasignup']);
      let newTrails = snapshot.docs
        .filter(docSnap => {
          const d = docSnap.data();
          return d?.isVisibleOnApp !== false && ALLOWED_SOURCES.has(d?.source) && !isBikeRace(d);
        })
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

      const orderedNew = sortTrailsForSwipeDeck(newTrails, socialTotals);

      // Append to the unfiltered pool
      setAllRaces(prev => [...prev, ...orderedNew]);

      if (requestId !== filterRequestRef.current) return;
    } catch (error) {
      console.error("Error loading more races:", error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMoreRaces, lastVisibleDoc, uid, buildTrail, userLatitude, userLongitude, socialTotals]);

  // Auto-load more races when the user is running low on unswiped cards
  useEffect(() => {
    const remainingCards = filteredRaces.length - currentIndex;
    if (remainingCards <= 10 && hasMoreRaces && !loadingMore) {
      loadMoreRaces();
    }
  }, [currentIndex, filteredRaces.length, hasMoreRaces, loadingMore, loadMoreRaces]);

  // Always restart deck at top when filters change.
  useEffect(() => {
    setCurrentIndex(0);
  }, [filters]);

  // End loading once we have source data to derive cards from.
  useEffect(() => {
    if (loading && allRaces.length > 0) {
      setLoading(false);
    }
  }, [loading, allRaces.length, filteredRaces.length]);
  // --- END OF FETCH ---

  // --- SYNC SWIPE DECK ON SCREEN FOCUS ---
  // Removes newly saved/registered races AND restores unfavorited races.
  // Wrapped in InteractionManager so heavy Firestore queries wait until the
  // navigation transition animation finishes — prevents mid-transition jank.
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        const syncDeck = async () => {
          if (!uid) return;
          try {
            const [merged, regSnapshot, completedSnapshot, dislikedSnapshot] = await Promise.all([
              fetchMergedUserProfile(uid),
              getDocs(query(collection(db, 'registrations'), where('userId', '==', uid))),
              getDocs(query(collection(db, 'completed_races'), where('userId', '==', uid))),
              getDocs(collection(db, 'users', uid, 'dislikedRaces')),
            ]);

            const matchedTrails = Array.isArray(merged?.matchedTrails) ? merged.matchedTrails : [];
            const registeredIds = regSnapshot.docs.map(d => d.data().trailId);
            const completedIds = completedSnapshot.docs.map(d => d.data().trailId);
            const dislikedIds = dislikedSnapshot.docs.map(d => d.id);
            const excludedIds = new Set([...matchedTrails, ...registeredIds, ...completedIds, ...dislikedIds]);

            setAllRaces(prev => {
              // Remove races that are now saved/registered/completed
              const filtered = prev.filter(race => !excludedIds.has(race.id));
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
      });

      return () => task.cancel();
    }, [uid])
  );
  // --- END SYNC SWIPE DECK ON FOCUS ---

  const removeRaceFromDeck = useCallback((raceId: string) => {
    setAllRaces(prevRaces => {
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
      if (__DEV__) {
        console.warn("[Home] Save skipped Firestore (no uid — signed out or auth not ready yet).");
      }
      removeRaceFromDeck(raceId);
      prefetchRaceImages(loadedRacesRef.current, currentIndexRef.current, 4);
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
      if (__DEV__) {
        console.warn(
          "[Home] Discard skipped Firestore (no uid — signed out or auth not ready yet)."
        );
      }
      removeRaceFromDeck(raceId);
      prefetchRaceImages(loadedRacesRef.current, currentIndexRef.current, 4);
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

  // PanResponder is created only once (useRef initializer); without refs, swipe callbacks
  // stay stuck on the first render's handlers when uid was still null (auth not ready).
  const handleSaveRaceRef = useRef(handleSaveRace);
  const handleDiscardRaceRef = useRef(handleDiscardRace);
  handleSaveRaceRef.current = handleSaveRace;
  handleDiscardRaceRef.current = handleDiscardRace;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        const { dx } = gesture;
        if (Math.abs(dx) < SWIPE_THRESHOLD * 0.35) {
          swipeHapticCommittedRef.current = null;
        } else if (dx > SWIPE_THRESHOLD) {
          if (swipeHapticCommittedRef.current !== "right") {
            swipeHapticCommittedRef.current = "right";
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        } else if (dx < -SWIPE_THRESHOLD) {
          if (swipeHapticCommittedRef.current !== "left") {
            swipeHapticCommittedRef.current = "left";
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        }
        // READ FROM REFS to avoid stale state
        const currentRace = loadedRacesRef.current[currentIndexRef.current];
        if (currentRace) {
          currentRace.position.setValue({ x: gesture.dx, y: gesture.dy });
        }
      },
      onPanResponderRelease: (_, gesture) => {
        swipeHapticCommittedRef.current = null;
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
            // AFTER animation, call the save logic (always latest handler / uid)
            handleSaveRaceRef.current(currentRace.id);
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
            // AFTER animation, call the discard logic (always latest handler / uid)
            handleDiscardRaceRef.current(currentRace.id);
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

  const currentRace = filteredRaces[currentIndex] ?? null;
  const nextRace = filteredRaces[currentIndex + 1] ?? null;
  const currentSocialTotal = currentRace ? getTrailSocialTotal(currentRace, socialTotals) : 0;
  const nextSocialTotal = nextRace ? getTrailSocialTotal(nextRace, socialTotals) : 0;

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

    setAllRaces(prev => resetRacePositions([restoredRace, ...prev]));
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
      setSocialTotals({});
      socialFetchRequestedRef.current.clear();
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

  // ── Soft gate: if there's no authenticated user, show a brief loading indicator.
  //    The root layout's auth listener will redirect to /login momentarily —
  //    this just prevents a flash of unrelated UI in the meantime.
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A1F25', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#8BC34A" />
      </View>
    );
  }

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

  const hasActiveFilters = 
    filters.radius !== 0 ||
    filters.distance !== 'All' ||
    filters.difficulty !== 'All' ||
    filters.elevation !== 'All' ||
    filters.dateFrom !== null ||
    filters.dateTo !== null;

  const handleApplyFilters = async (newFilters: RaceFilters) => {
    filterRequestRef.current += 1;
    setCurrentIndex(0);
    setLoading(true);
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
    filterRequestRef.current += 1;
    setCurrentIndex(0);
    setLoading(true);
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

  // Loading lock: while loading is true, render only the loading/skeleton state.
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#1A1F25' }} edges={['bottom', 'left', 'right']}>
        <MainHeader
          onSaved={handleNavigateToSaved}
          onChat={handleNavigateToChat}
          onProfile={handleNavigateToProfile}
          onSearch={handleNavigateToSearch}
          hasUnreadMessages={hasUnreadMessages}
          onFilter={() => filterModalRef.current?.present()}
          hasActiveFilters={hasActiveFilters}
        />
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
          {[0, 1].map((idx) => (
            <View
              key={`race-skeleton-${idx}`}
              style={{
                backgroundColor: '#0F172A',
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(71,85,105,0.35)',
                padding: 16,
                marginBottom: 14,
              }}
            >
              <View style={{ height: 170, borderRadius: 14, backgroundColor: '#1E293B' }} />
              <View style={{ height: 18, width: '72%', borderRadius: 6, backgroundColor: '#334155', marginTop: 14 }} />
              <View style={{ height: 14, width: '46%', borderRadius: 6, backgroundColor: '#334155', marginTop: 8 }} />
              <View style={{ height: 14, width: '60%', borderRadius: 6, backgroundColor: '#334155', marginTop: 8 }} />
            </View>
          ))}
          <View style={{ alignItems: 'center', marginTop: 6 }}>
            <ActivityIndicator size="large" color="#8BC34A" />
            <Text style={{ color: '#FFFFFF', marginTop: 14 }}>
              {loadingMore ? 'Loading more races...' : 'Searching for adventures...'}
            </Text>
          </View>
          {(gpsStatus === 'loading' || isResolvingLocation) && (
            <Text style={{ color: '#94A3B8', marginTop: 8, fontSize: 13 }}>
              {isResolvingLocation ? 'Updating your location...' : 'Acquiring GPS...'}
            </Text>
          )}
        </View>
        <FilterModal
          ref={filterModalRef}
          filters={filters}
          onApply={handleApplyFilters}
          onReset={handleResetFilters}
        />
      </SafeAreaView>
    );
  }

  if (filteredRaces.length === 0 || !currentRace) {
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
        onFilter={() => filterModalRef.current?.present()}
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
        onFilter={() => filterModalRef.current?.present()}
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
                        priority="low"
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
                        priority="normal"
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
                      priority="normal"
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
              {nextSocialTotal >= 3 && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    zIndex: 10,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.12)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>🔥 Popular</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 11, marginTop: 2 }}>
                    Join {nextSocialTotal} others
                  </Text>
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

            {currentSocialTotal >= 3 && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  zIndex: 10,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.12)',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>🔥 Popular</Text>
                <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 11, marginTop: 2 }}>
                  Join {currentSocialTotal} others
                </Text>
              </View>
            )}

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
                  {currentRace.distance != null ? ` · ${Math.round(currentRace.distance)} mi` : ''}
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

              {/* Distances & Elevation — compact single-line summary */}
              {(() => {
                const distOffered = currentRace.distancesOffered || [];
                const hasElevation = currentRace.elevation && currentRace.elevation.trim() !== '';

                return (
                  <>
                    {distOffered.length > 0 && (
                      <View className="flex-row items-center mt-1.5">
                        <Route size={16} color="#8BC34A" />
                        <Text
                          className="text-white text-base ml-2"
                          style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                          numberOfLines={1}
                        >
                          {distOffered.length <= 2
                            ? distOffered.join(' · ')
                            : distOffered.slice(0, 2).join(' · ') + ` +${distOffered.length - 2} more`}
                        </Text>
                      </View>
                    )}

                    {hasElevation && (
                      <View className="flex-row items-center mt-1.5">
                        <Mountain size={16} color="#8BC34A" />
                        <Text
                          className="text-white text-base ml-2"
                          style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 }}
                        >
                          {currentRace.elevation} elevation
                        </Text>
                      </View>
                    )}
                  </>
                );
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
        ref={filterModalRef}
        filters={filters}
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

const EmptyScreen = React.memo(({
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
}) => {
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
    <View className="flex-1 justify-center items-center px-6">
      <Text className="text-4xl mb-4">🏔️</Text>
      <Text className="text-white text-xl font-bold mb-2 text-center">
        {hasActiveFilters ? "No matching races found" : "You've seen all the races!"}
      </Text>
      <Text className="text-gray-400 text-base mb-6 text-center leading-6">
        {hasActiveFilters
          ? "No races match your current filters. Try expanding your search radius or adjusting your filter settings."
          : "There are no more races in your search area. Try increasing your search radius or updating your filters to discover more races."}
      </Text>
      <View style={{ gap: 12, width: '100%', alignItems: 'center' }}>
        {onFilter && (
          <TouchableOpacity
            onPress={onFilter}
            className="px-8 py-4 bg-emerald-500 rounded-full"
            style={{ width: '80%', alignItems: 'center' }}
          >
            <Text className="text-white font-bold text-base">Update Filters</Text>
          </TouchableOpacity>
        )}
        {hasActiveFilters && onResetFilters && (
          <TouchableOpacity
            onPress={onResetFilters}
            className="px-8 py-4 bg-slate-700 rounded-full"
            style={{ width: '80%', alignItems: 'center' }}
          >
            <Text className="text-white font-bold text-base">Reset Filters</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={onRefresh}
          disabled={loading}
          className="px-8 py-4 rounded-full"
          style={{ width: '80%', alignItems: 'center', borderWidth: 1, borderColor: '#475569' }}
        >
          <Text className="text-gray-300 font-bold text-base">
            {loading ? 'Refreshing...' : 'Check for New Races'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
    
  </SafeAreaView>
  );
});
EmptyScreen.displayName = "EmptyScreen";

const MainHeader = React.memo(({
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

    <Text className="text-white text-xl font-bold">The Collective</Text>

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
});
MainHeader.displayName = "MainHeader";
