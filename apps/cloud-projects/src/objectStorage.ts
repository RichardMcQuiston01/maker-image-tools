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
 * silent fallback that could be mistaken for a working configuration.
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

export function projectStorageKey(userId: string, projectId: string): string {
  return `projects/${userId}/${projectId}.json`;
}

/** Writes `data` to `key` and returns the serialized byte size written - callers (`projects.ts`)
 * use this to track each project's storage footprint for quota enforcement, without needing to
 * JSON.stringify `data` a second time themselves just to measure it. */
export async function putProjectData(
  store: ObjectStore,
  key: string,
  data: unknown,
): Promise<number> {
  const body = JSON.stringify(data);
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );
  return Buffer.byteLength(body, "utf-8");
}

export async function getProjectData(store: ObjectStore, key: string): Promise<unknown> {
  const response = await store.client.send(
    new GetObjectCommand({ Bucket: store.bucket, Key: key }),
  );
  const text = await response.Body?.transformToString();
  if (text === undefined) {
    throw new Error(`Object storage returned an empty body for key "${key}"`);
  }
  return JSON.parse(text);
}

export async function deleteProjectData(store: ObjectStore, key: string): Promise<void> {
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
}
