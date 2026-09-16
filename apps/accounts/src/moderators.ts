import type { Pool } from "pg";
import type { User } from "./users.js";

function configuredModeratorEmails(): Set<string> {
  const raw = process.env.MODERATOR_EMAILS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/**
 * Promotes `user` to the "moderator" role if their email is listed in the
 * `MODERATOR_EMAILS` env var and they aren't already a moderator - checked on
 * every signup/login/session-check, so an operator can grant moderator
 * access by adding an email to config, with no admin UI or role-management
 * API needed yet. Never demotes: removing an email from the list doesn't
 * revoke access already granted, that's a manual DB edit for now.
 */
export async function syncModeratorRole(pool: Pool, user: User): Promise<User> {
  if (user.role === "moderator" || !configuredModeratorEmails().has(user.email)) {
    return user;
  }
  await pool.query("UPDATE users SET role = 'moderator' WHERE id = $1", [user.id]);
  return { ...user, role: "moderator" };
}
