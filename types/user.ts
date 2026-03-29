/**
 * User profile split across Firestore:
 * - `users/{uid}` — public / discovery-safe fields
 * - `users/{uid}/private/account` — PII (see `UserPrivateAccount`)
 */

/** Fields stored on the root `users/{uid}` document (visible to other users per rules). */
export interface UserPublicProfile {
  uid?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  displayName?: string;
  bio?: string;
  hometown?: string;
  location?: string;
  locationName?: string;
  latitude?: number | null;
  longitude?: number | null;
  avatarUrl?: string;
  photoURL?: string;
  isPrivate?: boolean;
  openDMs?: boolean;
  primaryDistance?: string;
  preferredTerrain?: string;
  paceRange?: string;
  pace?: string;
  lookingFor?: string[];
  matchedTrails?: string[];
  searchRadius?: number;
  preferredRadius?: number;
  preferredDistance?: string | null;
  preferredDifficulty?: string | null;
  onboardingComplete?: boolean;
  hasUnreadMessages?: boolean;
  savedRegistrationInfo?: {
    phone?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    shirtSize?: string;
  };
  skillLevel?: string;
  preferredTerrainList?: unknown;
  friends?: unknown;
  role?: string;
}

/** Sensitive fields stored under `users/{uid}/private/account`. */
export interface UserPrivateAccount {
  email?: string | null;
  stripeCustomerId?: string | null;
  stripeCustomerID?: string | null;
  expoPushToken?: string | null;
  phoneNumber?: string | null;
  address?: string | null;
}

/** Merged view used in the app (`user.email`, `user.stripeCustomerId`, etc.). */
export type MergedUserProfile = UserPublicProfile & UserPrivateAccount;
