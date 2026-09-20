import { vi } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { ObjectStore } from "../src/objectStorage.js";

/**
 * putProjectData()/getProjectData()/etc. call a real S3-compatible API,
 * which needs a bucket and credentials this sandbox doesn't have (and
 * can't reach - egress to object-storage hosts like MinIO's download
 * server is blocked here). These tests instead fake the AWS SDK client's
 * `.send()` transport - using the real Command classes, so only the
 * network call itself is faked - to verify this service's own logic
 * without a live bucket, the same approach apps/billing takes for the
 * paid Stripe API.
 */
export function createFakeObjectStore(): ObjectStore {
  const objects = new Map<string, { body: Buffer; contentType: string | undefined }>();
  const client = {
    objects,
    send: vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const input = command.input.Body;
        const body = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf-8");
        objects.set(command.input.Key!, { body, contentType: command.input.ContentType });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const object = objects.get(command.input.Key!);
        if (object === undefined) {
          const err = new Error(`NoSuchKey: ${command.input.Key}`);
          err.name = "NoSuchKey";
          throw err;
        }
        return {
          ContentType: object.contentType,
          Body: {
            transformToString: async () => object.body.toString("utf-8"),
            transformToByteArray: async () => new Uint8Array(object.body),
          },
        };
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key!);
        return {};
      }
      throw new Error(`Unhandled fake S3 command: ${command?.constructor?.name}`);
    }),
  };
  return { client, bucket: "test-bucket" } as unknown as ObjectStore;
}
