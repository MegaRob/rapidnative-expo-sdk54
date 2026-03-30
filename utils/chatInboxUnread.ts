/**
 * Inbox unread: chat docs store `lastViewedAt[userId]` (see `markChatAsViewed` in chat.tsx)
 * and `lastMessageAt` + `lastMessageSenderId`. Unread when the latest message is from the
 * peer and is newer than this user's last viewed cursor.
 */
export function firestoreTimestampToMs(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    const t = value as { toMillis?: () => number };
    if (typeof t.toMillis === "function") return t.toMillis();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function computeInboxUnread(params: {
  chatData: Record<string, unknown>;
  myUid: string;
  /** From subcollection fallback when `lastMessageSenderId` not on chat doc yet */
  lastMessageSenderIdFallback?: string | null;
}): boolean {
  const { chatData, myUid, lastMessageSenderIdFallback } = params;

  const senderFromDoc =
    typeof chatData.lastMessageSenderId === "string" ? chatData.lastMessageSenderId : null;
  const lastSender = senderFromDoc || lastMessageSenderIdFallback || null;
  if (!lastSender || lastSender === myUid) return false;

  const lastMsgMs = firestoreTimestampToMs(chatData.lastMessageAt);
  if (lastMsgMs <= 0) return false;

  const lastViewed = chatData.lastViewedAt as Record<string, unknown> | undefined;
  const viewedMs = firestoreTimestampToMs(lastViewed?.[myUid]);

  return lastMsgMs > viewedMs;
}
