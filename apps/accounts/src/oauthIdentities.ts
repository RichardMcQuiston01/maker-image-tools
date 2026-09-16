import type { Pool } from "pg";
import { createOAuthOnlyUser, findUserByEmail, findUserById, type User } from "./users.js";

export interface OAuthIdentityLookup {
  provider: string;
  providerUserId: string;
  email: string;
}

/**
 * Finds or creates the local user for an OAuth login, in this order:
 * 1. An existing linked identity for (provider, providerUserId) - the
 *    ordinary repeat-login case.
 * 2. An existing user with a matching email, however they originally signed
 *    up (password or a different provider) - links this identity to that
 *    account. The provider is trusted to have verified the email itself.
 * 3. Neither - creates a brand new OAuth-only user (see
 *    `createOAuthOnlyUser`) and links it.
 */
export async function findOrCreateUserForOAuthIdentity(
  pool: Pool,
  { provider, providerUserId, email }: OAuthIdentityLookup,
): Promise<User> {
  const { rows: identityRows } = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM oauth_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId],
  );
  const existingIdentity = identityRows[0];
  if (existingIdentity) {
    const user = await findUserById(pool, existingIdentity.user_id);
    if (!user) {
      throw new Error(
        `oauth_identities row references a missing user (id=${existingIdentity.user_id})`,
      );
    }
    return user;
  }

  const existingByEmail = await findUserByEmail(pool, email);
  const user = existingByEmail ?? (await createOAuthOnlyUser(pool, email));

  await pool.query(
    "INSERT INTO oauth_identities (provider, provider_user_id, user_id) VALUES ($1, $2, $3)",
    [provider, providerUserId, user.id],
  );

  return user;
}
