import { DEMO_USER_EMAIL, DEMO_USER_ID } from "@/lib/demo-wallet";

/**
 * The name and public details shown on the Profile page. They belong to the account rather than to
 * the wallet, so they live in their own store until the profile endpoints exist.
 */
export interface Profile {
  displayName: string;
  /** ISO country code, matching the codes used by Geo-Lock. */
  country: string;
  createdAt: string;
}

const state: Profile = {
  displayName: "Hazem",
  country: "EG",
  createdAt: new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString(),
};

export const readProfile = (): Profile => ({ ...state });

export const updateProfile = (changes: Partial<Profile>): void => {
  Object.assign(state, changes);
};

/** Initials for the avatar, falling back to the sign-in email so the avatar is never empty. */
export const profileInitials = (profile: Profile): string => {
  const source = profile.displayName.trim() || DEMO_USER_EMAIL;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
};

/** The account id is stable, so it doubles as the reference shown on support screens. */
export const profileAccountId = (): string => DEMO_USER_ID;
