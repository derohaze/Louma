import type { ApiUser } from "@/shared/api";

export function profileInitials(user: ApiUser | null): string {
  const source = user?.displayName.trim() || user?.email || "Louma";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
