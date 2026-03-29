import { formatDistanceToNow } from "date-fns";
import { useRouter } from "expo-router";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Pencil, Plus, RotateCcw, ShieldOff, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
} from "../../components/ui/toast";
import { app, db } from "../../src/firebaseConfig";
import { useCurrentUserProfile } from "../../hooks/useCurrentUserProfile";

const MONO =
  Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }) ?? "monospace";

type ChangeEntry = { old?: unknown; new?: unknown };

type AuditLogEntry = {
  id: string;
  source: "audit" | "tombstone";
  action: string;
  adminName: string | null;
  adminUid: string | null;
  targetId: string;
  collectionName?: string;
  changes?: Record<string, ChangeEntry>;
  at: Date | null;
  /** Present for tombstone rows — sent to restoreDeletedTrail when restoring. */
  tombstone?: Record<string, unknown>;
};

function formatAuditScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object" && v !== null && "__type" in (v as object)) {
    const o = v as { __type?: string; iso?: string; latitude?: number; longitude?: number };
    if (o.__type === "timestamp" && typeof o.iso === "string") return o.iso;
    if (o.__type === "geoPoint" && typeof o.latitude === "number" && typeof o.longitude === "number") {
      return `${o.latitude.toFixed(4)}, ${o.longitude.toFixed(4)}`;
    }
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function humanizeField(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function getActionKind(action: string): "delete" | "create" | "update" {
  const a = (action || "").toUpperCase();
  if (a.includes("DELETE") || a.includes("REFUND") || a === "REFUND_ISSUED") return "delete";
  if (
    a.includes("CREATE") ||
    a.includes("NEW_RACE") ||
    a === "PUBLISH_TRAIL" ||
    a === "RESTORED_TRAIL"
  ) {
    return "create";
  }
  return "update";
}

function cardBorderClass(kind: "delete" | "create" | "update"): string {
  if (kind === "delete") return "border-red-600/70 bg-[#120808]";
  if (kind === "create") return "border-emerald-600/50 bg-[#07120c]";
  return "border-amber-500/60 bg-[#121008]";
}

function LogActionIcon({ action }: { action: string }) {
  const a = (action || "").toUpperCase();
  if (a === "RESTORED_TRAIL") {
    return <RotateCcw size={20} color="#4ade80" strokeWidth={2} />;
  }
  const kind = getActionKind(action);
  if (kind === "delete") {
    return <Trash2 size={20} color="#f87171" strokeWidth={2} />;
  }
  if (kind === "create") {
    return <Plus size={20} color="#4ade80" strokeWidth={2} />;
  }
  return <Pencil size={20} color="#facc15" strokeWidth={2} />;
}

function firestoreTimeToDate(t: unknown): Date | null {
  if (!t) return null;
  if (t instanceof Timestamp) return t.toDate();
  if (typeof (t as Timestamp).toDate === "function") return (t as Timestamp).toDate();
  if (typeof (t as { seconds?: number }).seconds === "number") {
    return new Date((t as { seconds: number }).seconds * 1000);
  }
  return null;
}

export default function AdminAuditLogsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { loading: profileLoading, uid, isAdmin } = useCurrentUserProfile();
  const [mainEntries, setMainEntries] = useState<AuditLogEntry[]>([]);
  const [tombEntries, setTombEntries] = useState<AuditLogEntry[]>([]);
  const [restoringTrailId, setRestoringTrailId] = useState<string | null>(null);

  useEffect(() => {
    if (profileLoading || isAdmin === null || !isAdmin) return;

    const q = query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AuditLogEntry[] = [];
        snap.forEach((docSnap) => {
          if (docSnap.id === "deletions") return;
          const d = docSnap.data();
          const ts = d.timestamp;
          const at = firestoreTimeToDate(ts);
          rows.push({
            id: docSnap.id,
            source: "audit",
            action: typeof d.action === "string" ? d.action : "UNKNOWN",
            adminName: typeof d.adminName === "string" ? d.adminName : null,
            adminUid: typeof d.adminUid === "string" ? d.adminUid : null,
            targetId: typeof d.targetId === "string" ? d.targetId : docSnap.id,
            collectionName: typeof d.collection === "string" ? d.collection : undefined,
            changes: d.changes as Record<string, ChangeEntry> | undefined,
            at,
          });
        });
        setMainEntries(rows);
      },
      (err) => console.error("audit_logs snapshot:", err)
    );

    const qTombs = query(
      collection(db, "audit_logs", "deletions", "trails"),
      orderBy("deletedAt", "desc"),
      limit(40)
    );

    const unsubTombs = onSnapshot(
      qTombs,
      (snap) => {
        const rows: AuditLogEntry[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const at = firestoreTimeToDate(d.deletedAt);
          const tid = typeof d.trailId === "string" ? d.trailId : docSnap.id;
          rows.push({
            id: `tomb-${docSnap.id}`,
            source: "tombstone",
            action: typeof d.action === "string" ? d.action : "DELETE_TRAIL",
            adminName: typeof d.deletedByName === "string" ? d.deletedByName : null,
            adminUid: typeof d.deletedByUid === "string" ? d.deletedByUid : null,
            targetId: tid,
            collectionName: "trails",
            at,
            tombstone:
              d.tombstone && typeof d.tombstone === "object"
                ? (d.tombstone as Record<string, unknown>)
                : undefined,
          });
        });
        setTombEntries(rows);
      },
      (err) => console.error("audit tombstones snapshot:", err)
    );

    return () => {
      unsub();
      unsubTombs();
    };
  }, [profileLoading, isAdmin]);

  const entries = useMemo(() => {
    const merged = [...mainEntries, ...tombEntries];
    merged.sort((a, b) => {
      const ta = a.at?.getTime() ?? 0;
      const tb = b.at?.getTime() ?? 0;
      return tb - ta;
    });
    return merged;
  }, [mainEntries, tombEntries]);

  const runRestore = useCallback(
    async (item: AuditLogEntry) => {
      if (!app) {
        Alert.alert("Unavailable", "Firebase is not configured.");
        return;
      }
      setRestoringTrailId(item.targetId);
      try {
        const fn = httpsCallable(getFunctions(app), "restoreDeletedTrail");
        const payload: { trailId: string; tombstone?: Record<string, unknown> } = {
          trailId: item.targetId,
        };
        if (item.tombstone && typeof item.tombstone === "object") {
          payload.tombstone = item.tombstone;
        }
        await fn(payload);
        toast.show({
          placement: "top",
          render: ({ id }) => (
            <Toast nativeID={`toast-${id}`} action="success" variant="solid">
              <ToastTitle>Race restored</ToastTitle>
              <ToastDescription>The trail is back online.</ToastDescription>
            </Toast>
          ),
        });
      } catch (e: unknown) {
        const err = e as { message?: string };
        const msg = typeof err?.message === "string" ? err.message : "Restore failed.";
        Alert.alert("Restore failed", msg);
      } finally {
        setRestoringTrailId(null);
      }
    },
    [toast]
  );

  const confirmRestore = useCallback(
    (item: AuditLogEntry) => {
      Alert.alert(
        "Restore this race?",
        `Re-create trails/${item.targetId} from the saved tombstone? This overwrites any existing document at that ID.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Restore Race", onPress: () => void runRestore(item) },
        ]
      );
    },
    [runRestore]
  );

  const waitingForGate = profileLoading || (uid !== null && isAdmin === null);

  if (waitingForGate) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0e14]" edges={["top", "left", "right"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text className="text-slate-500 text-xs mt-4" style={{ fontFamily: MONO }}>
            verifying clearance…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!uid) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0e14]" edges={["top", "left", "right"]}>
        <AccessDenied reason="sign_in" onGoHome={() => router.replace("/(tabs)")} />
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0e14]" edges={["top", "left", "right"]}>
        <AccessDenied reason="role" onGoHome={() => router.replace("/(tabs)")} />
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const kind = getActionKind(item.action);
    const borderClass = cardBorderClass(kind);
    const who = item.adminName || item.adminUid || "Unknown";
    const relative =
      item.at != null
        ? formatDistanceToNow(item.at, { addSuffix: true })
        : "—";
    const showDiff =
      kind === "update" && item.changes && Object.keys(item.changes).length > 0;
    const showRestore = item.action === "DELETE_TRAIL";
    const isRestoring = restoringTrailId === item.targetId;

    return (
      <View className={`mb-3 rounded-xl border px-4 py-3 ${borderClass}`} style={{ borderWidth: 1 }}>
        <View className="flex-row items-start gap-3">
          <View className="mt-0.5 opacity-90">
            <LogActionIcon action={item.action} />
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-slate-100 text-[15px] font-semibold leading-5">
              {item.action}{" "}
              <Text className="text-slate-500 font-normal">by</Text>{" "}
              <Text className="text-cyan-400/90">{who}</Text>
            </Text>
            <Text style={{ fontFamily: MONO }} className="text-emerald-400/90 text-xs mt-2" selectable>
              {item.targetId}
            </Text>
            {item.collectionName ? (
              <Text style={{ fontFamily: MONO }} className="text-slate-600 text-[10px] mt-1">
                {item.collectionName}
              </Text>
            ) : null}
            <Text className="text-slate-500 text-xs mt-2">{relative}</Text>

            {showDiff ? (
              <View className="mt-3 pt-3 border-t border-slate-800/80">
                <Text className="text-amber-500/90 text-xs font-bold mb-2 tracking-wide" style={{ fontFamily: MONO }}>
                  CHANGES
                </Text>
                {Object.entries(item.changes!).map(([field, pair]) => {
                  if (!pair || typeof pair !== "object") return null;
                  const oldV = formatAuditScalar(pair.old);
                  const newV = formatAuditScalar(pair.new);
                  return (
                    <Text
                      key={field}
                      className="text-slate-300 text-xs leading-5 mb-1.5"
                      style={{ fontFamily: MONO }}
                    >
                      {humanizeField(field)}: {oldV} ➔ {newV}
                    </Text>
                  );
                })}
              </View>
            ) : null}

            {showRestore ? (
              <View className="mt-3 pt-3 border-t border-slate-800/80">
                <Pressable
                  onPress={() => confirmRestore(item)}
                  disabled={isRestoring}
                  className={`self-start px-4 py-2.5 rounded-lg border ${
                    isRestoring
                      ? "bg-slate-800 border-slate-600"
                      : "bg-emerald-600/25 border-emerald-500/60"
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${isRestoring ? "text-slate-500" : "text-emerald-300"}`}
                    style={{ fontFamily: MONO }}
                  >
                    {isRestoring ? "Restoring…" : "Restore Race"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0e14]" edges={["top", "left", "right"]}>
      <View className="px-4 pb-3 pt-1 border-b border-cyan-900/40 bg-[#060a10]">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} hitSlop={10} className="py-2 pr-3">
            <Text className="text-cyan-400 text-sm" style={{ fontFamily: MONO }}>
              ← back
            </Text>
          </Pressable>
        </View>
        <Text className="text-cyan-300 text-2xl font-black tracking-tight mt-1" style={{ fontFamily: MONO }}>
          COMMAND CENTER
        </Text>
        <Text className="text-slate-500 text-xs mt-1" style={{ fontFamily: MONO }}>
          audit_stream · last 50 + deletion tombstones
        </Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <Text className="text-slate-600 text-center mt-16 text-sm" style={{ fontFamily: MONO }}>
            No audit entries yet.
          </Text>
        }
      />

      <Modal visible={restoringTrailId !== null} transparent animationType="fade">
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="bg-[#0f172a] border border-cyan-500/40 rounded-2xl px-8 py-6 items-center">
            <ActivityIndicator size="large" color="#22d3ee" />
            <Text className="text-cyan-200 mt-4 text-center" style={{ fontFamily: MONO }}>
              Restoring trail…
            </Text>
            <Text className="text-slate-500 text-xs mt-2 text-center" style={{ fontFamily: MONO }}>
              {restoringTrailId}
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AccessDenied({
  reason,
  onGoHome,
}: {
  reason: "sign_in" | "role";
  onGoHome: () => void;
}) {
  return (
    <View className="flex-1 px-6 justify-center items-center">
      <ShieldOff size={48} color="#64748b" />
      <Text className="text-red-400 text-xl font-bold mt-6 text-center" style={{ fontFamily: MONO }}>
        ACCESS DENIED
      </Text>
      <Text className="text-slate-500 text-sm mt-3 text-center leading-5">
        {reason === "sign_in"
          ? "You must be signed in to view this command center."
          : "Administrator privileges are required. This incident will be reported."}
      </Text>
      <Pressable
        onPress={onGoHome}
        className="mt-8 px-8 py-3 rounded-lg border border-cyan-800 bg-cyan-950/40"
      >
        <Text className="text-cyan-300 font-semibold" style={{ fontFamily: MONO }}>
          Return to home
        </Text>
      </Pressable>
    </View>
  );
}
