/**
 * Temporal worker for city-markets audit workflows.
 *
 * Run on the host where this repo lives. Connects to the local
 * Temporal cluster at 127.0.0.1:7233 and registers on the
 * "citymarkets-audit-task-queue" task queue.
 *
 * Usage:
 *   npx tsx scripts/temporal-audits/worker.ts
 *
 * Then in another shell:
 *   npx tsx scripts/temporal-audits/client.ts
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import * as path from "node:path";
import * as activities from "./activities";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "citymarkets-audit-task-queue";
  const workflowsPath = path.resolve(__dirname, "workflows.ts");

  console.log(`[audit-worker] connecting to ${address}, task queue ${taskQueue}`);
  console.log(`[audit-worker] workflowsPath: ${workflowsPath}`);

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: 4,
  });

  console.log("[audit-worker] registered 5 workflows via workflowsPath; polling…");
  await worker.run();
}

main().catch((err) => {
  console.error("[audit-worker] fatal:", err);
  process.exit(1);
});