import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Thrown when the S3 env vars are missing/blank - a deployment misconfiguration, not a bad request. */
export class ObjectStorageConfigError extends Error {}

export interface ObjectStore {
  client: S3Client;
  bucket: string;
}

let cachedStore: ObjectStore | undefined;

/**
 * Lazily constructs an S3-compatible object store from env vars. Works
 * against any S3-compatible endpoint (AWS S3, Cloudflare R2, a local
 * MinIO) - matching @maker/ai-inference's GEMINI_API_KEY handling: no
 * silent fallback that could be mistaken for a working configuration. A
 * production deployment would front this bucket with a real CDN (per
 * ROADMAP.md's stack line for this workstream); that's out of scope here,
 * same as @maker/cloud-projects' bucket having no CDN in front of it either.
 */
export function getObjectStore(): ObjectStore {
  if (cachedStore) return cachedStore;
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new ObjectStorageConfigError(
      "Missing S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY environment variables. " +
        "Point them at any S3-compatible bucket (AWS S3, Cloudflare R2, a local MinIO) to enable this service.",
    );
  }
  cachedStore = {
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "auto",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
  return cachedStore;
}

/** Test-only hook to force the next getObjectStore() call to reconstruct the client. */
export function resetObjectStoreForTests(): void {
  cachedStore = undefined;
}

export function listingStorageKey(listingId: string): string {
  return `listings/${listingId}.json`;
}

export async function putListingData(
  store: ObjectStore,
  key: string,
  data: unknown,
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    }),
  );
}

export async function getListingData(store: ObjectStore, key: string): Promise<unknown> {
  const response = await store.client.send(
    new GetObjectCommand({ Bucket: store.bucket, Key: key }),
  );
  const text = await response.Body?.transformToString();
  if (text === undefined) {
    throw new Error(`Object storage returned an empty body for key "${key}"`);
  }
  return JSON.parse(text);
}

export async function deleteListingData(store: ObjectStore, key: string): Promise<void> {
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
}
