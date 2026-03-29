import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db, onAuthStateChanged } from "../../src/firebaseConfig";
import GuideBuilder from "./guide-builder";

type TabId = "overview" | "editor" | "guide" | "roster" | "race-day" | "results";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "editor", label: "App Content" },
  { id: "guide", label: "Race Guide" },
  { id: "roster", label: "Roster" },
  { id: "race-day", label: "Race Day" },
  { id: "results", label: "Results" },
];

const formatMoney = (value: number) => `$${value.toLocaleString()}`;

const formatPercent = (value: number) => `${Math.round(value)}%`;

const formatDate = (value: any) => {
  if (!value) return "TBD";
  if (typeof value === "string") return value;
  if (value?.seconds) {
    return new Date(value.seconds * 1000).toLocaleDateString();
  }
  if (value?.toDate) {
    return value.toDate().toLocaleDateString();
  }
  return "TBD";
};

const downloadCsv = (rows: string[][], filename: string) => {
  if (typeof window === "undefined") return;
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
};

export default function DirectorDashboard() {
  const [user, setUser] = useState(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [races, setRaces] = useState<any[]>([]);
  const [activeRaceId, setActiveRaceId] = useState<string>("");
  const [activeRace, setActiveRace] = useState<any | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [resultsMap, setResultsMap] = useState<Record<string, any>>({});
  const [userMap, setUserMap] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState({
    slogan: "",
    featuredImageUrl: "",
    logoUrl: "",
    difficulty: "",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const raceQuery = query(
      collection(db, "trails"),
      where("directorId", "==", user.uid)
    );
    const unsubscribe = onSnapshot(raceQuery, (snapshot) => {
      const list = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setRaces(list);
      if (!activeRaceId && list.length > 0) {
        setActiveRaceId(list[0].id);
      }
    });
    return () => unsubscribe();
  }, [user, activeRaceId]);

  useEffect(() => {
    if (!activeRaceId) return;
    const unsubscribe = onSnapshot(doc(db, "trails", activeRaceId), (snap) => {
      setActiveRace(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return () => unsubscribe();
  }, [activeRaceId]);

  useEffect(() => {
    if (!activeRaceId) return;
    const registrationQuery = query(
      collection(db, "registrations"),
      where("trailId", "==", activeRaceId)
    );
    const unsubscribe = onSnapshot(registrationQuery, (snapshot) => {
      setRegistrations(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
    return () => unsubscribe();
  }, [activeRaceId]);

  useEffect(() => {
    if (!activeRaceId) return;
    const resultsQuery = query(
      collection(db, "completed_races"),
      where("trailId", "==", activeRaceId)
    );
    const unsubscribe = onSnapshot(resultsQuery, (snapshot) => {
      const map: Record<string, any> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.userId) {
          map[data.userId] = { id: docSnap.id, ...data };
        }
      });
      setResultsMap(map);
    });
    return () => unsubscribe();
  }, [activeRaceId]);

  useEffect(() => {
    if (registrations.length === 0) return;
    const missing = registrations
      .map((reg) => reg.userId)
      .filter((uid) => uid && !userMap[uid]);
    if (missing.length === 0) return;
    missing.forEach(async (uid) => {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        setUserMap((prev) => ({ ...prev, [uid]: { id: uid, ...snap.data() } }));
      }
    });
  }, [registrations, userMap]);

  useEffect(() => {
    if (!activeRace) return;
    setEditor({
      slogan: activeRace.slogan || "",
      featuredImageUrl: activeRace.image || activeRace.imageUrl || "",
      logoUrl: activeRace.logoUrl || "",
      difficulty: activeRace.difficulty || "",
    });
  }, [activeRace]);

  const isAuthorized = user && activeRace && activeRace.directorId === user.uid;

  const priceValue = parseFloat(activeRace?.price) || 0;
  const capacityValue = parseInt(activeRace?.capacity, 10) || 0;
  const revenue = priceValue * registrations.length;
  const fillPercent = capacityValue ? (registrations.length / capacityValue) * 100 : 0;
  const checkIns = registrations.filter((reg) => reg.checkedIn).length;
  const checkInPercent = registrations.length ? (checkIns / registrations.length) * 100 : 0;
  const finisherCount = Object.values(resultsMap).filter((r: any) => r.official).length;

  const filteredRegistrations = useMemo(() => {
    const term = search.toLowerCase();
    return registrations.filter((reg) => {
      const userInfo = userMap[reg.userId] || {};
      const regName = reg.fullName || [reg.firstName, reg.lastName].filter(Boolean).join(" ");
      const name = `${regName || userInfo.name || userInfo.username || ""}`.toLowerCase();
      const bib = `${reg.bibNumber || ""}`.toLowerCase();
      return name.includes(term) || bib.includes(term);
    });
  }, [registrations, search, userMap]);

  const handleEditorSave = async () => {
    if (!activeRaceId) return;
    await updateDoc(doc(db, "trails", activeRaceId), {
      slogan: editor.slogan,
      image: editor.featuredImageUrl,
      imageUrl: editor.featuredImageUrl,
      featuredImageUrl: editor.featuredImageUrl,
      logoUrl: editor.logoUrl,
      difficulty: editor.difficulty,
    });
  };

  const handleBibSave = async (registrationId: string, bibNumber: string) => {
    await setDoc(
      doc(db, "registrations", registrationId),
      { bibNumber: bibNumber || "", bibUpdatedAt: new Date() },
      { merge: true }
    );
  };

  const handleCheckIn = async (registrationId: string, nextValue: boolean) => {
    await setDoc(
      doc(db, "registrations", registrationId),
      { checkedIn: nextValue, checkedInAt: nextValue ? new Date() : null },
      { merge: true }
    );
  };

  const handleResultSave = async (userId: string, finishTime: string, isOfficial: boolean) => {
    if (!activeRaceId) return;
    await setDoc(
      doc(db, "completed_races", `${activeRaceId}_${userId}`),
      {
        userId,
        trailId: activeRaceId,
        finishTime: finishTime || "",
        official: !!isOfficial,
        updatedAt: new Date(),
      },
      { merge: true }
    );
  };

  const handlePushOfficial = async () => {
    if (!activeRaceId) return;
    const batch = writeBatch(db);
    registrations.forEach((reg) => {
      const result = resultsMap[reg.userId];
      if (result?.official) {
        batch.set(doc(db, "completed_races", `${activeRaceId}_${reg.userId}`), {
          userId: reg.userId,
          trailId: activeRaceId,
          finishTime: result.finishTime || "",
          official: true,
          updatedAt: new Date(),
        }, { merge: true });
      }
    });
    await batch.commit();
  };

  const rosterCsv = useMemo(() => {
    const rows = [
      ["Name", "Email", "Bib", "Checked In", "Privacy"],
      ...registrations.map((reg) => {
        const info = userMap[reg.userId] || {};
        const isPrivate = info.isPrivate === true;
        const regName = reg.fullName || [reg.firstName, reg.lastName].filter(Boolean).join(" ");
        return [
          regName || info.name || info.username || "Runner",
          isPrivate ? "Privacy Protected" : info.email || "",
          reg.bibNumber || "",
          reg.checkedIn ? "Yes" : "No",
          isPrivate ? "Protected" : "Public",
        ];
      }),
    ];
    return rows;
  }, [registrations, userMap]);

  if (!authReady) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <Text className="text-slate-300">Loading dashboard...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <Text className="text-slate-300">Please sign in to access the dashboard.</Text>
      </View>
    );
  }

  if (!isAuthorized) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <Text className="text-slate-300">Access restricted to assigned directors.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950 flex-row">
      <View className="w-[280px] border-r border-emerald-500/10 bg-slate-900/80 px-6 py-8">
        <Text className="text-emerald-400 text-xl font-semibold">The Collective Director</Text>
        <Text className="text-xs text-slate-400">Race Command Center</Text>
        <View className="mt-8 space-y-2">
          {TABS.map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => setTab(item.id)}
              className={`px-4 py-3 rounded-[2rem] ${
                tab === item.id ? "bg-emerald-500 text-white" : "bg-slate-900 text-slate-300"
              }`}
            >
              <Text className={tab === item.id ? "text-white" : "text-slate-300"}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="mt-8">
          <Text className="text-xs text-slate-500 uppercase tracking-widest mb-2">My Races</Text>
          <View className="space-y-2">
            {races.map((race) => (
              <TouchableOpacity
                key={race.id}
                onPress={() => setActiveRaceId(race.id)}
                className={`px-3 py-2 rounded-[2rem] ${
                  activeRaceId === race.id ? "bg-emerald-500/20" : "bg-slate-900"
                }`}
              >
                <Text className="text-slate-200">{race.name || "Unnamed Race"}</Text>
                <Text className="text-xs text-slate-500">{race.location || "Location TBD"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <ScrollView className="flex-1 px-10 py-8" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={true}>
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-2xl text-emerald-400 font-semibold">{activeRace?.name}</Text>
            <Text className="text-slate-400">{formatDate(activeRace?.date)}</Text>
          </View>
          <View className="bg-slate-900/70 px-4 py-2 rounded-[2rem]">
            <Text className="text-slate-300 text-xs">Registrations: {registrations.length}</Text>
          </View>
        </View>

        {tab === "overview" && (
          <View className="grid grid-cols-4 gap-6">
            {[
              { label: "Total Revenue", value: formatMoney(revenue) },
              { label: "Registration Fill", value: `${registrations.length}/${capacityValue || "∞"} (${formatPercent(fillPercent)})` },
              { label: "Check-in Progress", value: `${checkIns}/${registrations.length} (${formatPercent(checkInPercent)})` },
              { label: "Finishers", value: finisherCount.toString() },
            ].map((card) => (
              <View key={card.label} className="bg-slate-900/70 rounded-[2rem] p-6">
                <Text className="text-slate-400 text-xs">{card.label}</Text>
                <Text className="text-emerald-400 text-2xl font-semibold mt-2">{card.value}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "editor" && (
          <View className="flex-row gap-8">
            <View className="flex-1 bg-slate-900/70 rounded-[2rem] p-6">
              <Text className="text-emerald-400 text-lg font-semibold mb-4">Race Editor</Text>
              <View className="space-y-4">
                {[
                  { key: "slogan", label: "Slogan / Tagline" },
                  { key: "featuredImageUrl", label: "Featured Image URL" },
                  { key: "logoUrl", label: "Logo URL" },
                  { key: "difficulty", label: "Difficulty" },
                ].map((field) => (
                  <View key={field.key}>
                    <Text className="text-xs text-slate-400 mb-1">{field.label}</Text>
                    <TextInput
                      value={(editor as any)[field.key]}
                      onChangeText={(value) => setEditor((prev) => ({ ...prev, [field.key]: value }))}
                      className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-3 text-slate-100"
                      placeholder={field.label}
                      placeholderTextColor="#64748b"
                    />
                  </View>
                ))}
              </View>
              <TouchableOpacity
                onPress={handleEditorSave}
                className="mt-6 bg-emerald-500 rounded-[2rem] py-3 items-center"
              >
                <Text className="text-white font-semibold">Save Updates</Text>
              </TouchableOpacity>
            </View>

            <View className="w-[320px] bg-slate-900/70 rounded-[2rem] p-4">
              <Text className="text-xs text-slate-400 mb-3">Mobile Preview</Text>
              <View className="bg-slate-950 rounded-[2rem] overflow-hidden">
                <View className="h-40 bg-slate-800">
                  {editor.featuredImageUrl ? (
                    <img
                      src={editor.featuredImageUrl}
                      alt="preview"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </View>
                <View className="p-4 space-y-2">
                  <Text className="text-slate-100 text-lg font-semibold">{activeRace?.name || "Race Name"}</Text>
                  <Text className="text-slate-400 text-xs">{editor.slogan || "Race tagline"}</Text>
                  <Text className="text-emerald-400 font-semibold">{formatMoney(parseFloat(activeRace?.price) || 0)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {tab === "guide" && (
          <GuideBuilder raceId={activeRaceId} race={activeRace} />
        )}

        {tab === "roster" && (
          <View className="bg-slate-900/70 rounded-[2rem] p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-emerald-400 text-lg font-semibold">Roster</Text>
              <TouchableOpacity
                onPress={() => downloadCsv(rosterCsv, "roster.csv")}
                className="bg-emerald-500 rounded-[2rem] px-4 py-2"
              >
                <Text className="text-white text-xs font-semibold">Export Roster</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal>
              <View className="min-w-[900px]">
                <View className="flex-row border-b border-slate-800 pb-2">
                  {["Runner", "Email", "Bib", "Check-in", "Privacy"].map((label) => (
                    <Text key={label} className="flex-1 text-slate-400 text-xs">
                      {label}
                    </Text>
                  ))}
                </View>
                {registrations.map((reg) => {
                  const info = userMap[reg.userId] || {};
                  const isPrivate = info.isPrivate === true;
                  const regName = reg.fullName || [reg.firstName, reg.lastName].filter(Boolean).join(" ");
                  return (
                    <View key={reg.id} className="flex-row border-b border-slate-900 py-3">
                      <Text className="flex-1 text-slate-100">
                        {regName || info.name || info.username || "Runner"}
                      </Text>
                      <Text className="flex-1 text-slate-400">
                        {isPrivate ? "Privacy Protected" : info.email || ""}
                      </Text>
                      <Text className="flex-1 text-slate-300">{reg.bibNumber || "-"}</Text>
                      <Text className="flex-1 text-slate-300">{reg.checkedIn ? "Yes" : "No"}</Text>
                      <Text className="flex-1 text-emerald-400">{isPrivate ? "Protected" : "Public"}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {tab === "race-day" && (
          <View className="bg-slate-900/70 rounded-[2rem] p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-emerald-400 text-lg font-semibold">Race Day Check-in</Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search by name or bib"
                placeholderTextColor="#64748b"
                className="bg-slate-950 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100 w-[260px]"
              />
            </View>
            <View className="space-y-3">
              {filteredRegistrations.map((reg) => {
                  const info = userMap[reg.userId] || {};
                  const regName = reg.fullName || [reg.firstName, reg.lastName].filter(Boolean).join(" ");
                return (
                  <View key={reg.id} className="flex-row items-center justify-between bg-slate-950 rounded-[2rem] px-4 py-3">
                    <View>
                      <Text className="text-slate-100">
                        {regName || info.name || info.username || "Runner"}
                      </Text>
                      <Text className="text-xs text-slate-400">Bib: {reg.bibNumber || "--"}</Text>
                    </View>
                    <TextInput
                      defaultValue={reg.bibNumber || ""}
                      onBlur={(e) => handleBibSave(reg.id, e.nativeEvent.text)}
                      onSubmitEditing={(e) => handleBibSave(reg.id, e.nativeEvent.text)}
                      placeholder="Bib #"
                      placeholderTextColor="#64748b"
                      className="bg-slate-900 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100 w-[120px] mr-3"
                    />
                    <TouchableOpacity
                      onPress={() => handleCheckIn(reg.id, !reg.checkedIn)}
                      className={`px-4 py-2 rounded-[2rem] ${
                        reg.checkedIn ? "bg-emerald-500" : "bg-slate-900"
                      }`}
                    >
                      <Text className={reg.checkedIn ? "text-white" : "text-slate-300"}>
                        {reg.checkedIn ? "At Start Line" : "Check In"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {tab === "results" && (
          <View className="bg-slate-900/70 rounded-[2rem] p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-emerald-400 text-lg font-semibold">Results</Text>
              <TouchableOpacity
                onPress={handlePushOfficial}
                className="bg-emerald-500 rounded-[2rem] px-4 py-2"
              >
                <Text className="text-white text-xs font-semibold">Push Official Results</Text>
              </TouchableOpacity>
            </View>
            <View className="space-y-3">
              {filteredRegistrations
                .filter((reg) => reg.checkedIn)
                .map((reg) => {
                  const info = userMap[reg.userId] || {};
                  const regName = reg.fullName || [reg.firstName, reg.lastName].filter(Boolean).join(" ");
                  const result = resultsMap[reg.userId] || {};
                  return (
                    <View key={reg.id} className="flex-row items-center justify-between bg-slate-950 rounded-[2rem] px-4 py-3">
                      <View>
                        <Text className="text-slate-100">
                          {regName || info.name || info.username || "Runner"}
                        </Text>
                        <Text className="text-xs text-slate-400">Bib: {reg.bibNumber || "--"}</Text>
                      </View>
                      <TextInput
                        defaultValue={result.finishTime || ""}
                        onBlur={(e) => handleResultSave(reg.userId, e.nativeEvent.text, result.official)}
                        onSubmitEditing={(e) => handleResultSave(reg.userId, e.nativeEvent.text, result.official)}
                        placeholder="HH:MM:SS"
                        placeholderTextColor="#64748b"
                        className="bg-slate-900 border border-slate-800 rounded-[2rem] px-4 py-2 text-slate-100 w-[160px]"
                      />
                      <TouchableOpacity
                        onPress={() => handleResultSave(reg.userId, result.finishTime || "", !result.official)}
                        className={`px-4 py-2 rounded-[2rem] ${
                          result.official ? "bg-emerald-500" : "bg-slate-900"
                        }`}
                      >
                        <Text className={result.official ? "text-white" : "text-slate-300"}>
                          {result.official ? "Official" : "Mark Official"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
