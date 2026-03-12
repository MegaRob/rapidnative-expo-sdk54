import React, { useState } from "react";
import { Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";

type GuideSegment = { label: string; value: string };
type AidStation = { name: string; mile: string; service: string };

type GuideData = {
  essentials?: {
    mandatoryGear?: string;
    checkInInfo?: string;
    startTimeInfo?: string;
  };
  courseProfile?: {
    segments?: GuideSegment[];
    terrainNotes?: string;
  };
  aidStations?: AidStation[];
  rules?: {
    pacerRules?: string;
    crewAccess?: string;
    parkingInfo?: string;
  };
  links?: {
    website?: string;
    contactEmail?: string;
  };
};

type RaceGuideViewProps = {
  race: any;
  guide?: GuideData | null;
};

const fallbackImage =
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&auto=format&fit=crop&q=70";

const normalizeImageUrl = (value?: string) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, "");
  if (!trimmed) return "";
  // Don't encodeURI URLs that are already valid — it double-encodes %2F in Firebase Storage URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  const encoded = encodeURI(trimmed);
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/|$)/.test(encoded)) {
    return `https://${encoded}`;
  }
  return "";
};

const formatDate = (value: any) => {
  if (!value) return "TBD";
  if (typeof value === "string") return value;
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
  if (value?.toDate) return value.toDate().toLocaleDateString();
  return "TBD";
};

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`relative ${className}`}>
      <BlurView intensity={20} tint="dark" className="absolute inset-0 rounded-2xl" />
      <View
        className="rounded-2xl border border-emerald-500/20 shadow-2xl"
        style={{ backgroundColor: "rgba(15, 23, 42, 0.7)" }}
      >
        {children}
      </View>
    </View>
  );
}

export default function RaceGuideView({ race, guide }: RaceGuideViewProps) {
  const name = race?.name || "Race";
  const location = race?.location || "Location TBD";
  const date = formatDate(race?.date);
  const image =
    normalizeImageUrl(race?.imageUrl) ||
    normalizeImageUrl(race?.image) ||
    normalizeImageUrl(race?.featuredImageUrl) ||
    fallbackImage;

  // Per-distance array (new) with legacy fallback
  // Filter out junk labels and deduplicate
  const JUNK_LABELS = new Set(['ignore', 'volunteer', 'donation', 'spectator', 'crew', 'virtual', 'n/a', 'none', 'test', 'placeholder', 'other', 'misc']);
  const rawDistancesArr: any[] = Array.isArray(race?.distances) ? race.distances : [];
  const distancesArr: any[] = [];
  const seenDistLabels = new Set<string>();
  for (const d of rawDistancesArr) {
    const key = (d.label || d.raceTitle || '').toLowerCase().trim();
    if (!key || JUNK_LABELS.has(key)) continue;
    if (seenDistLabels.has(key)) continue;
    seenDistLabels.add(key);
    distancesArr.push(d);
  }
  const hasMultipleDistances = distancesArr.length > 1;

  // Distance tab state
  const [selectedDistIndex, setSelectedDistIndex] = useState(0);
  const selectedDist = distancesArr[selectedDistIndex] || distancesArr[0] || null;

  // Legacy distance labels
  const distanceLabels = distancesArr.length
    ? distancesArr.map((d: any) => d.label).filter(Boolean)
    : Array.isArray(race?.distancesOffered)
      ? race.distancesOffered
      : race?.distance
        ? [race.distance]
        : [];

  // Per-distance values with event-level + guide fallbacks (empty string if not available)
  const elevation = selectedDist?.elevationGain || race?.elevationGain || race?.elevation || "";
  const cutoff = selectedDist?.cutoffTime || race?.cutoffTime || "";
  const startTime = selectedDist?.startTime || race?.startTime || guide?.essentials?.startTimeInfo || "";
  const capacity = selectedDist?.capacity ? String(selectedDist.capacity) : race?.capacity ? String(race.capacity) : "";
  const aidCount = selectedDist?.aidStations ?? race?.aidStations ?? guide?.aidStations?.length ?? "";

  // Per-distance guide fields with guide-object and race-level fallbacks
  const mandatoryGear = selectedDist?.mandatoryGear || guide?.essentials?.mandatoryGear || race?.mandatoryGear || "";
  const checkInDetails = guide?.essentials?.checkInInfo || race?.checkInDetails || "";
  const terrainNotes = selectedDist?.terrainNotes || guide?.courseProfile?.terrainNotes || race?.terrainNotes || "";
  const aidStationDetails = selectedDist?.aidStationDetails || race?.aidStationDetails || "";
  const pacerPolicy = selectedDist?.pacerPolicy || guide?.rules?.pacerRules || race?.pacerPolicy || "";
  const crewAccess = selectedDist?.crewAccess || guide?.rules?.crewAccess || race?.crewAccess || "";
  const crewParking = selectedDist?.crewParking || guide?.rules?.parkingInfo || race?.crewParking || "";
  const description = selectedDist?.description || race?.description || "";

  const courseProfile = guide?.courseProfile || {};
  const segments = Array.isArray(courseProfile.segments) ? courseProfile.segments : [];
  const aidStations = Array.isArray(guide?.aidStations) ? guide?.aidStations : [];
  const links = guide?.links || {};

  return (
    <ScrollView className="flex-1 bg-slate-950">
      <View className="px-6 pt-10 pb-16 space-y-6">
        {/* Header Card */}
        <GlassCard className="p-5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-emerald-400 text-xs uppercase tracking-widest">
                Race Guide
              </Text>
              <Text className="text-2xl text-emerald-400 font-semibold mt-1">{name}</Text>
              <Text className="text-slate-300 text-sm mt-1">{date} · {location}</Text>
            </View>
            <Image
              source={{ uri: image }}
              className="w-24 h-20 rounded-xl border border-emerald-500/20"
              resizeMode="cover"
            />
          </View>
        </GlassCard>

        {/* Distance Tabs */}
        {hasMultipleDistances && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row">
              {distancesArr.map((d: any, i: number) => {
                const isSelected = i === selectedDistIndex;
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setSelectedDistIndex(i)}
                    className={`mr-2 px-5 py-3 rounded-full ${isSelected ? 'bg-emerald-500' : 'bg-slate-800 border border-slate-700'}`}
                    activeOpacity={0.7}
                  >
                    <Text className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-400'}`}>
                      {d.raceTitle || d.label || `Distance ${i + 1}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* Quick Stats */}
        <GlassCard className="p-5">
          <Text className="text-emerald-400 text-lg font-semibold mb-4">
            Quick Stats{selectedDist?.label ? ` — ${selectedDist.label}` : ''}
          </Text>
          <View className="flex-row flex-wrap">
            {[
              { label: "Distance", value: selectedDist?.label || distanceLabels.join(", ") || "" },
              { label: "Elevation", value: String(elevation) },
              { label: "Start Time", value: String(startTime) },
              { label: "Cutoff", value: String(cutoff) },
              { label: "Capacity", value: String(capacity) },
              { label: "Aid Stations", value: String(aidCount) },
            ].filter((item) => item.value && item.value.trim() !== "" && item.value !== "0").map((item) => (
              <View key={item.label} className="w-1/2 p-2">
                <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20">
                  <Text className="text-slate-400 text-xs uppercase tracking-wider">{item.label}</Text>
                  <Text className="text-slate-100 text-base font-semibold mt-2">{item.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* Essentials */}
        <GlassCard className="p-5">
          <Text className="text-emerald-400 text-lg font-semibold mb-4">Race Day Essentials</Text>
          <View className="flex-row flex-wrap">
            {[
              { label: "Mandatory Gear", value: mandatoryGear },
              { label: "Check-In", value: checkInDetails },
              { label: "Start Time", value: startTime },
            ].map((item) => (
              <View key={item.label} className="w-1/2 p-2">
                <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20">
                  <Text className="text-slate-400 text-xs uppercase tracking-wider">{item.label}</Text>
                  <Text className="text-slate-100 text-sm mt-2">{item.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* Course Profile — only show if there's real data */}
        {(segments.length > 0 || terrainNotes) ? (
          <GlassCard className="p-5">
            <Text className="text-emerald-400 text-lg font-semibold mb-4">Course Profile</Text>
            <View className="flex-row flex-wrap">
              {segments.length > 0 && (
                <View className="w-full md:w-1/2 p-2">
                  <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                      Elevation by Segment
                    </Text>
                    {segments.map((segment, index) => (
                      <Text key={`segment-${index}`} className="text-slate-100 text-sm">
                        {segment.label}: {segment.value}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              {terrainNotes ? (
                <View className="w-full md:w-1/2 p-2">
                  <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                      Terrain Notes
                    </Text>
                    <Text className="text-slate-100 text-sm">
                      {terrainNotes}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </GlassCard>
        ) : null}

        {/* Logistics — Aid Stations + Rules — only show if there's real data */}
        {(aidStations.length > 0 || aidStationDetails || pacerPolicy || crewAccess || crewParking) ? (
          <GlassCard className="p-5">
            <Text className="text-emerald-400 text-lg font-semibold mb-4">Logistics</Text>
            <View className="flex-row flex-wrap">
              {(aidStations.length > 0 || aidStationDetails) ? (
                <View className="w-full md:w-1/2 p-2">
                  <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20 space-y-2">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider">Aid Stations</Text>
                    {aidStations.length ? (
                      aidStations.map((station, index) => (
                        <View key={`aid-${index}`}>
                          <Text className="text-slate-100 text-sm font-semibold">
                            {station.mile ? `Mile ${station.mile}` : "Mile"} · {station.name || "Aid Station"}
                          </Text>
                          <Text className="text-slate-300 text-xs">{station.service || "Service TBD"}</Text>
                        </View>
                      ))
                    ) : (
                      <Text className="text-slate-100 text-sm">{aidStationDetails}</Text>
                    )}
                  </View>
                </View>
              ) : null}
              {(pacerPolicy || crewAccess || crewParking) ? (
                <View className="w-full md:w-1/2 p-2">
                  <View className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/20 space-y-3">
                    {pacerPolicy ? (
                      <View>
                        <Text className="text-slate-400 text-xs uppercase tracking-wider">Pacer Rules</Text>
                        <Text className="text-slate-100 text-sm">{pacerPolicy}</Text>
                      </View>
                    ) : null}
                    {crewAccess ? (
                      <View>
                        <Text className="text-slate-400 text-xs uppercase tracking-wider">Crew Access</Text>
                        <Text className="text-slate-100 text-sm">{crewAccess}</Text>
                      </View>
                    ) : null}
                    {crewParking ? (
                      <View>
                        <Text className="text-slate-400 text-xs uppercase tracking-wider">Parking</Text>
                        <Text className="text-slate-100 text-sm">{crewParking}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          </GlassCard>
        ) : null}

        {/* Race Notes — only show if there's real data */}
        {(description || links.website || links.contactEmail) ? (
          <GlassCard className="p-5">
            <Text className="text-emerald-400 text-lg font-semibold mb-4">Race Notes</Text>
            {description ? <Text className="text-slate-200 text-sm">{description}</Text> : null}
            <View className="mt-4 space-y-1">
              {links.website ? (
                <Text className="text-emerald-400 text-sm">Website: {links.website}</Text>
              ) : null}
              {links.contactEmail ? (
                <Text className="text-emerald-400 text-sm">Contact: {links.contactEmail}</Text>
              ) : null}
            </View>
          </GlassCard>
        ) : null}
      </View>
    </ScrollView>
  );
}
