import { BulkJobOptions } from "bullmq";
import { randomUUID } from "crypto";
import Redis from "ioredis";
import Redlock from "redlock";

import { config } from "@/config/index";

// TODO: Research using a connection pool rather than
// creating a new connection every time, as we do now.

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const redisSubscriber = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// https://redis.io/topics/distlock
export const redlock = new Redlock([redis.duplicate()], { retryCount: 0 });

// Common types

export type BullMQBulkJob = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  opts?: BulkJobOptions;
};

export const acquireLock = async (name: string, expirationInSeconds: number) => {
  const id = randomUUID();
  const acquired = await redis.set(name, id, "EX", expirationInSeconds, "NX");
  return acquired === "OK";
};

export const extendLock = async (name: string, expirationInSeconds: number) => {
  const id = randomUUID();
  const extended = await redis.set(name, id, "EX", expirationInSeconds, "XX");
  return extended === "OK";
};

export const releaseLock = async (name: string) => {
  await redis.del(name);
};
