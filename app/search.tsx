import { Image as ExpoImage } from 'expo-image';
import { useNavigation, useRouter } from 'expo-router';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Search as SearchIcon,
  Star,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardScreen from './components/KeyboardScreen';
import { db } from '../src/firebaseConfig';

interface SearchResult {
  id: string;
  name: string;
  location?: string;
  date?: string;
  imageUrl?: string;
  avgRating?: number;
  reviewCount?: number;
  distancesOffered?: string[];
  distance?: string;
  source?: string;
  runsignupUrl?: string;
  ultrasignupUrl?: string;
  runsignupRaceId?: string | number;
  ultrasignupEventId?: string | number;
  ultrasignupDateId?: string | number;
  website?: string;
}

const normalizeImageUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const cleaned = trimmed.replace(/^['"]+|['"]+$/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
  if (cleaned.startsWith('//')) return `https:${cleaned}`;
  if (cleaned.startsWith('www.')) return `https://${cleaned}`;
  return '';
};

const formatDate = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    if (!value.includes('T') || !value.includes('Z')) return value;
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch { }
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      if (typeof value.toDate === 'function') {
        return value.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      if ('seconds' in value && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch { }
  }
  return '';
};

export default function SearchScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [allRaces, setAllRaces] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Auto-focus the search input
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // Load all races once for client-side search (fast for thousands of races)
  useEffect(() => {
    const loadRaces = async () => {
      try {
        const racesQuery = query(collection(db, 'trails'), orderBy('name'), limit(5000));
        const snap = await getDocs(racesQuery);

        const ALLOWED_SOURCES = new Set(['runsignup', 'ultrasignup']);
        const BIKE_KEYWORDS = [
          "bike", "biking", "cycling", "cyclist", "bicycle",
          "mtb", "mountain bike", "gravel ride", "gravel grind",
          "pedal", "criterium", "crit race", "velodrome",
          "cyclocross", "cx race", "tour de", "gran fondo",
          "fondo", "century ride", "fat tire",
        ];
        const isBike = (d: any) => {
          const name = (d?.name || "").toLowerCase();
          const desc = (d?.description || "").toLowerCase();
          return BIKE_KEYWORDS.some(kw => name.includes(kw) || desc.includes(kw));
        };

        const races: SearchResult[] = snap.docs
          .filter((doc) => {
            const d = doc.data();
            return ALLOWED_SOURCES.has(d?.source) && !isBike(d);
          })
          .map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              name: d.name || 'Unnamed Race',
              location: d.location || '',
              date: formatDate(d.date),
              imageUrl:
                normalizeImageUrl(d.imageUrl) ||
                normalizeImageUrl(d.image) ||
                normalizeImageUrl(d.featuredImageUrl) ||
                normalizeImageUrl(d.logoUrl) ||
                '',
              avgRating: typeof d.avgRating === 'number' ? d.avgRating : undefined,
              reviewCount: typeof d.reviewCount === 'number' ? d.reviewCount : undefined,
              distancesOffered: Array.isArray(d.distancesOffered) ? d.distancesOffered : [],
              distance: d.distance || '',
              source: d.source || '',
              runsignupUrl: d.runsignupUrl || '',
              ultrasignupUrl: d.ultrasignupUrl || '',
              runsignupRaceId: d.runsignupRaceId,
              ultrasignupEventId: d.ultrasignupEventId,
              ultrasignupDateId: d.ultrasignupDateId,
              website: d.website || '',
            };
          });

        setAllRaces(races);
      } catch (error) {
        console.error('Error loading races for search:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRaces();
  }, []);

  // Filter races when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const tokens = query.split(/\s+/);

    const filtered = allRaces.filter((race) => {
      const searchableText = `${race.name} ${race.location} ${race.distancesOffered?.join(' ') || ''} ${race.distance || ''}`.toLowerCase();
      return tokens.every((token) => searchableText.includes(token));
    });

    // Sort: exact name matches first, then by rating, then alphabetically
    filtered.sort((a, b) => {
      const aNameMatch = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bNameMatch = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch;
      if ((b.avgRating || 0) !== (a.avgRating || 0)) return (b.avgRating || 0) - (a.avgRating || 0);
      return a.name.localeCompare(b.name);
    });

    setResults(filtered.slice(0, 50)); // Cap results for performance
  }, [searchQuery, allRaces]);

  const handleSelectRace = useCallback(
    (raceId: string) => {
      // Save to recent searches
      const trimmed = searchQuery.trim();
      if (trimmed) {
        setRecentSearches((prev) => {
          const updated = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 5);
          return updated;
        });
      }
      Keyboard.dismiss();
      // Find the race object to pass source/URL data for registration buttons
      const race = allRaces.find((r) => r.id === raceId);
      router.push({
        pathname: '/race-details',
        params: {
          id: raceId,
          source: race?.source || '',
          runsignupUrl: race?.runsignupUrl || '',
          ultrasignupUrl: race?.ultrasignupUrl || '',
          runsignupRaceId: race?.runsignupRaceId ? String(race.runsignupRaceId) : '',
          ultrasignupEventId: race?.ultrasignupEventId ? String(race.ultrasignupEventId) : '',
          ultrasignupDateId: race?.ultrasignupDateId ? String(race.ultrasignupDateId) : '',
        },
      });
    },
    [searchQuery, router, allRaces]
  );

  const renderResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      onPress={() => handleSelectRace(item.id)}
      style={{
        flexDirection: 'row',
        padding: 12,
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: 'rgba(30, 41, 59, 0.6)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(71, 85, 105, 0.3)',
      }}
      activeOpacity={0.7}
    >
      {/* Thumbnail */}
      {item.imageUrl ? (
        <ExpoImage
          source={{ uri: item.imageUrl }}
          style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: '#1E293B' }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 12,
            backgroundColor: '#1E293B',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MapPin size={24} color="#475569" />
        </View>
      )}

      {/* Info */}
      <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
        <Text
          style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '700' }}
          numberOfLines={1}
        >
          {item.name}
        </Text>

        {/* Rating */}
        {item.avgRating && item.avgRating > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                size={10}
                color={s <= Math.round(item.avgRating!) ? '#FBBF24' : '#475569'}
                fill={s <= Math.round(item.avgRating!) ? '#FBBF24' : 'transparent'}
              />
            ))}
            <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '600', marginLeft: 2 }}>
              {item.avgRating.toFixed(1)}
            </Text>
            {item.reviewCount ? (
              <Text style={{ color: '#64748B', fontSize: 10 }}>({item.reviewCount})</Text>
            ) : null}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 4 }}>
          {item.location ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <MapPin size={12} color="#64748B" />
              <Text style={{ color: '#94A3B8', fontSize: 12, marginLeft: 3 }} numberOfLines={1}>
                {item.location}
              </Text>
            </View>
          ) : null}
          {item.date ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={12} color="#64748B" />
              <Text style={{ color: '#94A3B8', fontSize: 12, marginLeft: 3 }}>
                {item.date}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0F172A' }} edges={['top', 'left', 'right']}>
      {/* Search Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
        }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>

        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(30, 41, 59, 0.8)',
            borderRadius: 14,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: 'rgba(71, 85, 105, 0.5)',
          }}
        >
          <SearchIcon size={18} color="#64748B" />
          <TextInput
            ref={inputRef}
            style={{
              flex: 1,
              color: '#FFFFFF',
              fontSize: 16,
              paddingVertical: 12,
              marginLeft: 10,
            }}
            placeholder="Search races by name or location..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardScreen isList>
        {/* Loading */}
        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={{ color: '#94A3B8', marginTop: 12 }}>Loading races...</Text>
          </View>
        ) : searchQuery.trim().length === 0 ? (
          /* Empty state / suggestions */
          <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32 }}>
            {recentSearches.length > 0 && (
              <View style={{ marginBottom: 32 }}>
                <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Recent Searches
                </Text>
                {recentSearches.map((term, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setSearchQuery(term)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      gap: 10,
                    }}
                  >
                    <SearchIcon size={14} color="#475569" />
                    <Text style={{ color: '#CBD5E1', fontSize: 15 }}>{term}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Try Searching
            </Text>
            {['Bear 100', 'Wasatch', 'Western States', '50K Utah', 'UTMB'].map((suggestion) => (
              <TouchableOpacity
                key={suggestion}
                onPress={() => setSearchQuery(suggestion)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  gap: 10,
                }}
              >
                <SearchIcon size={14} color="#475569" />
                <Text style={{ color: '#94A3B8', fontSize: 15 }}>{suggestion}</Text>
              </TouchableOpacity>
            ))}

            <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              Search {allRaces.length.toLocaleString()} races by name, location, or distance
            </Text>
          </View>
        ) : results.length === 0 ? (
          /* No results */
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
            <SearchIcon size={48} color="#334155" />
            <Text style={{ color: '#CBD5E1', fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
              No races found
            </Text>
            <Text style={{ color: '#64748B', fontSize: 14, marginTop: 8, textAlign: 'center' }}>
              Try a different name, location, or distance.
            </Text>
          </View>
        ) : (
          /* Results list */
          <FlashList
            data={results}
            renderItem={renderResult}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              <Text style={{ color: '#64748B', fontSize: 13, marginLeft: 16, marginBottom: 8 }}>
                {results.length} result{results.length !== 1 ? 's' : ''}
              </Text>
            }
          />
        )}
      </KeyboardScreen>
    </SafeAreaView>
  );
}
