import { onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { auth } from '../src/firebaseConfig';
import type { MergedUserProfile } from '../types/user';
import {
  mergeUserProfileData,
  syncUserPublicDisplay,
  userPrivateAccountRef,
  userRootRef,
} from '../utils/userProfile';

/**
 * Live-merged profile for the signed-in user (root `users/{uid}` + `private/account`).
 */
export function useCurrentUserProfile() {
  const uid = auth.currentUser?.uid ?? null;
  const [profile, setProfile] = useState<MergedUserProfile | null>(null);
  const [loading, setLoading] = useState(!!uid);
  const [error, setError] = useState<Error | null>(null);
  const syncDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Firebase Auth custom claim `admin` (refreshed when `uid` changes). */
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!uid || !auth.currentUser) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    setIsAdmin(null);
    auth.currentUser
      .getIdTokenResult(true)
      .then((t) => {
        if (!cancelled) setIsAdmin(t.claims.admin === true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    let pubData: Record<string, unknown> = {};
    let privData: Record<string, unknown> | undefined;

    const apply = () => {
      try {
        setProfile(mergeUserProfileData(pubData, privData));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setLoading(false);
      }
    };

    const rootRef = userRootRef(uid);
    const privRef = userPrivateAccountRef(uid);

    const unsubRoot = onSnapshot(
      rootRef,
      (snap) => {
        pubData = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        apply();
        if (syncDisplayTimerRef.current) clearTimeout(syncDisplayTimerRef.current);
        syncDisplayTimerRef.current = setTimeout(() => {
          syncDisplayTimerRef.current = null;
          syncUserPublicDisplay(uid, pubData).catch(() => {
            /* best-effort mirror for peer reads */
          });
        }, 600);
      },
      (e) => setError(e)
    );

    const unsubPriv = onSnapshot(
      privRef,
      (snap) => {
        privData = snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
        apply();
      },
      (e) => setError(e)
    );

    return () => {
      if (syncDisplayTimerRef.current) clearTimeout(syncDisplayTimerRef.current);
      unsubRoot();
      unsubPriv();
    };
  }, [uid]);

  return { profile, loading, error, uid, isAdmin };
}
