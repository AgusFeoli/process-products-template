import type { BatchEngine } from "@/lib/batch-engine";

/**
 * Shared registry for active BatchEngine instances.
 * Separated from route files because Next.js does not allow
 * non-route exports (GET, POST, etc.) from route modules.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeEngines = new Map<string, BatchEngine<any, any>>();

export function getActiveEngine(jobId: string) {
  return activeEngines.get(jobId);
}

export function setActiveEngine(
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: BatchEngine<any, any>
) {
  activeEngines.set(jobId, engine);
}

export function deleteActiveEngine(jobId: string) {
  activeEngines.delete(jobId);
}
