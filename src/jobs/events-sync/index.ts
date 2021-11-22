import { Job, Queue, QueueScheduler, Worker } from "bullmq";

import { logger } from "@common/logger";
import { redis } from "@common/redis";
import { config } from "@config/index";
import { EventType, getEventInfo, sync } from "@events/index";

// For syncing events we have two separate job queues. One is for
// handling backfilling while the other one handles realtime
// syncing. The reason for this is that we don't want any ongoing
// backfilling processes to delay the realtime syncing (which tries
// to catch up to the head of the blockchain).

// Backfill

const BACKFILL_JOB_NAME = "events_sync_backfill";

const backfillQueue = new Queue(BACKFILL_JOB_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
});
new QueueScheduler(BACKFILL_JOB_NAME, { connection: redis });

export const addToEventsSyncBackfillQueue = async (
  eventType: EventType,
  contracts: string[],
  fromBlock: number,
  toBlock: number,
  // Syncing is done in batches since the requested block range
  // might include lots of events that cannot fit within a single
  // provider response
  maxBlocksPerBatch = 512
) => {
  const jobs: any[] = [];

  // Sync in reverse in order to handle more recent events first
  for (let to = toBlock; to >= fromBlock; to -= maxBlocksPerBatch) {
    const from = Math.max(fromBlock, to - maxBlocksPerBatch + 1);
    jobs.push({
      name: eventType,
      data: {
        eventType,
        contracts,
        fromBlock: from,
        toBlock: to,
      },
    });
  }

  await backfillQueue.addBulk(jobs);
};

// Actual work is to be handled by background worker processes
if (config.doBackgroundWork) {
  const worker = new Worker(
    BACKFILL_JOB_NAME,
    async (job: Job) => {
      const { eventType, contracts, fromBlock, toBlock } = job.data;

      if (contracts.length) {
        try {
          logger.info(
            eventType,
            `Backfill syncing block range [${fromBlock}, ${toBlock}]`
          );

          await sync(fromBlock, toBlock, getEventInfo(eventType, contracts));
        } catch (error) {
          logger.error(BACKFILL_JOB_NAME, `Job failed: ${error}`);
          throw error;
        }
      }
    },
    { connection: redis }
  );
  worker.on("error", (error) => {
    logger.error(BACKFILL_JOB_NAME, `Worker errored: ${error}`);
  });
}

// Catchup

const CATCHUP_JOB_NAME = "events_sync_catchup";

const catchupQueue = new Queue(CATCHUP_JOB_NAME, {
  connection: redis,
  defaultJobOptions: {
    // No retries here, we should be as lean as possible and
    // retrying will be done on any subsequent jobs
    removeOnComplete: true,
    removeOnFail: true,
  },
});
new QueueScheduler(CATCHUP_JOB_NAME, { connection: redis });

export const addToEventsSyncCatchupQueue = async (eventType: EventType) => {
  await catchupQueue.add(eventType, { eventType });
};

// Actual work is to be handled by background worker processes
if (config.doBackgroundWork) {
  const worker = new Worker(
    CATCHUP_JOB_NAME,
    async (job: Job) => {
      const { eventType } = job.data;

      // Sync all contracts of the given event type
      const contracts =
        require(`@config/data/${config.chainId}/contracts.json`)[eventType];
      const eventInfo = getEventInfo(eventType, contracts);

      // We allow syncing of up to `maxBlocks` blocks behind the
      // head of the blockchain. If the indexer lagged behind more
      // than that, then all blocks before that will be sent to the
      // backfill queue.
      const maxBlocks = 256;

      let headBlock = await eventInfo.provider.getBlockNumber();
      // Try avoiding missing events by lagging behind 1 block
      // https://ethereum.stackexchange.com/questions/109660/eth-getlogs-and-some-missing-logs
      headBlock--;

      // Fetch the last synced blocked for the current event type
      let localBlock = Number(
        await redis.get(`${eventType}_last_synced_block`)
      );
      if (!localBlock) {
        localBlock = headBlock;
      }

      const fromBlock = Math.max(localBlock, headBlock - maxBlocks + 1);
      if (contracts.length) {
        try {
          logger.info(
            eventType,
            `Catchup syncing block range [${fromBlock}, ${headBlock}]`
          );

          await sync(fromBlock, headBlock, getEventInfo(eventType, contracts));
        } catch (error) {
          logger.error(CATCHUP_JOB_NAME, `Job failed: ${error}`);
          throw error;
        }

        // Queue any remaining blocks for backfilling
        if (localBlock < fromBlock) {
          await addToEventsSyncBackfillQueue(
            eventType,
            contracts,
            localBlock,
            fromBlock - 1
          );
        }

        // Update the last synced block
        await redis.set(`${eventType}_last_synced_block`, headBlock);
      }
    },
    { connection: redis }
  );
  worker.on("error", (error) => {
    logger.error(CATCHUP_JOB_NAME, `Worker errored: ${error}`);
  });
}
