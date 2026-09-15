import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
/** scrypt cost parameter N (must be a power of 2). 16384 is Node's own documented default. */
const COST = 16384;

/**
 * Hashes a password with scrypt (Node's built-in `node:crypto`, no extra
 * dependency or native compile step) and a random salt, encoded as
 * `scrypt:<cost>:<saltHex>:<hashHex>` so the cost parameter can change later
 * without breaking verification of passwords hashed under the old one.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, { N: COST });
  return `scrypt:${COST}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a password against a hash produced by `hashPassword`. Returns
 * `false` (rather than throwing) for a malformed stored hash, since that
 * should never happen but must never be treated as "password accepted".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const salt = parts[2];
  const expectedHex = parts[3];
  if (!Number.isInteger(cost) || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const derivedKey = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length, {
    N: cost,
  });
  return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected);
}
