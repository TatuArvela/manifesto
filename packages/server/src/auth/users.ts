import type { AuthUser } from "@manifesto/shared";
import type { User } from "../storage/types.js";

const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function pickAvatarColor(): string {
  return AVATAR_COLORS[
    Math.floor(Math.random() * AVATAR_COLORS.length)
  ] as string;
}

/** The current user as the client is told about them. */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
    email: user.email,
    isAdmin: user.isAdmin,
  };
}
