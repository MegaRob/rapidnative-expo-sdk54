import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../src/firebaseConfig";

type GuideSegment = { label: string; value: string };
type AidStation = { name: string; mile: string; service: string };

type GuideData = {
  essentials: {
    mandatoryGear: string;
    checkInInfo: string;
    startTimeInfo: string;
  };
  courseProfile: {
    segments: GuideSegment[];
    terrainNotes: string;
  };
  aidStations: AidStation[];
  rules: {
    pacerRules: string;
    crewAccess: string;
    parkingInfo: string;
  };
  links: {
    website: string;
    contactEmail: string;
  };
};

const emptyGuide: GuideData = {
  essentials: {
    mandatoryGear: "",
    checkInInfo: "",
    startTimeInfo: "",
  },
  courseProfile: {
    segments: [{ label: "", value: "" }],
    terrainNotes: "",
  },
  aidStations: [{ name: "", mile: "", service: "" }],
  rules: {
    pacerRules: "",
    crewAccess: "",
    parkingInfo: "",
  },
  links: {
    website: "",
    contactEmail: "",
  },
};

const toSegmentList = (value: any): GuideSegment[] => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((segment) => ({
      label: segment?.label || "",
      value: segment?.value || "",
    }));
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n|;/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, ...rest] = line.split(":");
        const tail = rest.join(":").trim();
        if (tail) {
          return { label: label.trim(), value: tail };
        }
        return { label: "", value: line };
      });
  }
  return [];
};

const toAidStations = (value: any, details?: string): AidStation[] => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((station) => ({
      name: station?.name || "",
      mile: station?.mile || "",
      service: station?.service || "",
    }));
  }
  if (typeof details === "string" && details.trim()) {
    return details
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ name: line, mile: "", service: "" }));
  }
  return [];
};

const normalizeGuide = (guide: any, race: any): GuideData => {
  const segments = toSegmentList(guide?.courseProfile?.segments || race?.elevationProfiles);
  const aidStations = toAidStations(guide?.aidStations || race?.aidStations, race?.aidStationDetails);

  return {
    essentials: {
      mandatoryGear: guide?.essentials?.mandatoryGear || race?.mandatoryGear || "",
      checkInInfo: guide?.essentials?.checkInInfo || race?.checkInDetails || "",
      startTimeInfo: guide?.essentials?.startTimeInfo || race?.startTime || "",
    },
    courseProfile: {
      segments: segments.length ? segments : [{ label: "", value: "" }],
      terrainNotes: guide?.courseProfile?.terrainNotes || race?.terrainNotes || "",
    },
    aidStations: aidStations.length ? aidStations : [{ name: "", mile: "", service: "" }],
    rules: {
      pacerRules: guide?.rules?.pacerRules || race?.pacerPolicy || "",
      crewAccess: guide?.rules?.crewAccess || race?.crewAccess || "",
      parkingInfo: guide?.rules?.parkingInfo || race?.crewParking || "",
    },
    links: {
      website: guide?.links?.website || race?.website || "",
      contactEmail: guide?.links?.contactEmail || race?.contactEmail || "",
    },
  };
};

type GuideBuilderProps = {
  raceId: string;
  race?: any;
};

export default function GuideBuilder({ raceId, race }: GuideBuilderProps) {
  const [guide, setGuide] = useState<GuideData>(emptyGuide);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGuide(normalizeGuide(race?.guide, race));
  }, [race?.guide, race, raceId]);

  const canSave = useMemo(() => !!raceId, [raceId]);

  const updateSegment = (index: number, key: keyof GuideSegment, value: string) => {
    setGuide((prev) => {
      const nextSegments = [...prev.courseProfile.segments];
      nextSegments[index] = { ...nextSegments[index], [key]: value };
      return { ...prev, courseProfile: { ...prev.courseProfile, segments: nextSegments } };
    });
  };

  const updateAidStation = (index: number, key: keyof AidStation, value: string) => {
    setGuide((prev) => {
      const nextStations = [...prev.aidStations];
      nextStations[index] = { ...nextStations[index], [key]: value };
      return { ...prev, aidStations: nextStations };
    });
  };

  const handleSave = async () => {
    if (!raceId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "trails", raceId), { guide });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="bg-slate-900/70 rounded-[2rem] p-6">
      <Text className="text-emerald-400 text-lg font-semibold mb-4">
        Race Guide
      </Text>

      <View className="space-y-3">
        <Text className="text-emerald-300 text-sm font-semibold">Quick Overview</Text>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Mandatory Gear</Text>
          <TextInput
            value={guide.essentials.mandatoryGear}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                essentials: { ...prev.essentials, mandatoryGear: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="List required gear"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Check-In Info</Text>
          <TextInput
            value={guide.essentials.checkInInfo}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                essentials: { ...prev.essentials, checkInInfo: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Packet pickup, check-in windows, etc."
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Start Time Info</Text>
          <TextInput
            value={guide.essentials.startTimeInfo}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                essentials: { ...prev.essentials, startTimeInfo: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Wave times or start instructions"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
      </View>

      <View className="mt-6 space-y-3">
        <Text className="text-emerald-300 text-sm font-semibold">Course Profile</Text>
        <Text className="text-xs text-slate-400">Elevation by Segment</Text>
        {guide.courseProfile.segments.map((segment, index) => (
          <View key={`segment-${index}`} className="flex-row items-center gap-2">
            <TextInput
              value={segment.label}
              onChangeText={(value) => updateSegment(index, "label", value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100"
              placeholder="Mile 0-22"
              placeholderTextColor="#64748b"
            />
            <TextInput
              value={segment.value}
              onChangeText={(value) => updateSegment(index, "value", value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100"
              placeholder="6,000ft gain"
              placeholderTextColor="#64748b"
            />
            <TouchableOpacity
              onPress={() =>
                setGuide((prev) => ({
                  ...prev,
                  courseProfile: {
                    ...prev.courseProfile,
                    segments: prev.courseProfile.segments.filter((_, i) => i !== index),
                  },
                }))
              }
              className="px-3 py-2 bg-slate-800 rounded-[2rem]"
            >
              <Text className="text-xs text-slate-200">Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() =>
            setGuide((prev) => ({
              ...prev,
              courseProfile: {
                ...prev.courseProfile,
                segments: [...prev.courseProfile.segments, { label: "", value: "" }],
              },
            }))
          }
          className="bg-slate-800 rounded-[2rem] px-4 py-2 self-start"
        >
          <Text className="text-slate-200 text-xs">Add Segment</Text>
        </TouchableOpacity>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Terrain Notes</Text>
          <TextInput
            value={guide.courseProfile.terrainNotes}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                courseProfile: { ...prev.courseProfile, terrainNotes: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Describe terrain, footing, exposure"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
      </View>

      <View className="mt-6 space-y-3">
        <Text className="text-emerald-300 text-sm font-semibold">Aid Stations</Text>
        {guide.aidStations.map((station, index) => (
          <View key={`station-${index}`} className="flex-row items-center gap-2">
            <TextInput
              value={station.mile}
              onChangeText={(value) => updateAidStation(index, "mile", value)}
              className="w-20 bg-slate-950 border border-slate-800 rounded-[2rem] px-3 py-2 text-slate-100"
              placeholder="Mile"
              placeholderTextColor="#64748b"
            />
            <TextInput
              value={station.name}
              onChangeText={(value) => updateAidStation(index, "name", value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100"
              placeholder="Aid Station Name"
              placeholderTextColor="#64748b"
            />
            <TextInput
              value={station.service}
              onChangeText={(value) => updateAidStation(index, "service", value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100"
              placeholder="Service Type"
              placeholderTextColor="#64748b"
            />
            <TouchableOpacity
              onPress={() =>
                setGuide((prev) => ({
                  ...prev,
                  aidStations: prev.aidStations.filter((_, i) => i !== index),
                }))
              }
              className="px-3 py-2 bg-slate-800 rounded-[2rem]"
            >
              <Text className="text-xs text-slate-200">Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() =>
            setGuide((prev) => ({
              ...prev,
              aidStations: [...prev.aidStations, { name: "", mile: "", service: "" }],
            }))
          }
          className="bg-slate-800 rounded-[2rem] px-4 py-2 self-start"
        >
          <Text className="text-slate-200 text-xs">Add Aid Station</Text>
        </TouchableOpacity>
      </View>

      <View className="mt-6 space-y-3">
        <Text className="text-emerald-300 text-sm font-semibold">Pacer + Crew Rules</Text>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Pacer Rules</Text>
          <TextInput
            value={guide.rules.pacerRules}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                rules: { ...prev.rules, pacerRules: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Pacer guidelines"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Crew Access</Text>
          <TextInput
            value={guide.rules.crewAccess}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                rules: { ...prev.rules, crewAccess: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Crew access rules"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Parking Info</Text>
          <TextInput
            value={guide.rules.parkingInfo}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                rules: { ...prev.rules, parkingInfo: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="Parking instructions"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
      </View>

      <View className="mt-6 space-y-3">
        <Text className="text-emerald-300 text-sm font-semibold">Links</Text>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Website</Text>
          <TextInput
            value={guide.links.website}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                links: { ...prev.links, website: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="https://"
            placeholderTextColor="#64748b"
          />
        </View>
        <View>
          <Text className="text-xs text-slate-400 mb-1">Contact Email</Text>
          <TextInput
            value={guide.links.contactEmail}
            onChangeText={(value) =>
              setGuide((prev) => ({
                ...prev,
                links: { ...prev.links, contactEmail: value },
              }))
            }
            className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
            placeholder="race@trailmatch.com"
            placeholderTextColor="#64748b"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
      </View>

      <TouchableOpacity
        onPress={handleSave}
        className={`mt-8 rounded-[2rem] py-3 items-center ${
          canSave ? "bg-emerald-500" : "bg-slate-800"
        }`}
        disabled={!canSave || saving}
      >
        <Text className="text-white font-semibold">
          {saving ? "Saving..." : "Save Race Guide"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
