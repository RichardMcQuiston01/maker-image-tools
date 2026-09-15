import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getObjectStore,
  ObjectStorageConfigError,
  resetObjectStoreForTests,
} from "../src/objectStorage.js";

describe("objectStorage", () => {
  const originalEnv = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };

  beforeEach(() => {
    resetObjectStoreForTests();
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    resetObjectStoreForTests();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("throws ObjectStorageConfigError when any required env var is unset", () => {
    expect(() => getObjectStore()).toThrow(ObjectStorageConfigError);

    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_BUCKET = "maker-cloud-projects";
    process.env.S3_ACCESS_KEY_ID = "test";
    expect(() => getObjectStore()).toThrow(ObjectStorageConfigError);
  });

  it("constructs a store once every env var is set", () => {
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_BUCKET = "maker-cloud-projects";
    process.env.S3_ACCESS_KEY_ID = "test";
    process.env.S3_SECRET_ACCESS_KEY = "test";
    const store = getObjectStore();
    expect(store.bucket).toBe("maker-cloud-projects");
  });
});
