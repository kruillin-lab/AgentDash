import "server-only";

import { parseDispatchMode } from "./server/mission-control/runtime/dispatch-mode";

// ---------------------------------------------------------------------------
// Next.js server instrumentation
//
// Runs once at server startup. Mission control production dispatch is gated by
// MISSION_CONTROL_DISPATCH=disabled|qualification|candidate|enabled and must
// fail closed: any missing or unrecognized value is normalized to `disabled`
// before any server code can read it.
//
// On the Node.js runtime this also starts the dormant controller runtime
// (acquiring the single controller-owner lease) via the Node-only composition
// root. This module is bundled for every Next.js runtime graph, so the
// Node-only composition module is loaded with a runtime dynamic import() that
// the edge/client graphs stub out (see next.config.mjs); nothing Node-only is
// statically linked here.
// ---------------------------------------------------------------------------

export async function register(): Promise<void> {
  // Normalize the dispatch mode to an exact, fail-closed value.
  process.env.MISSION_CONTROL_DISPATCH = parseDispatchMode(process.env.MISSION_CONTROL_DISPATCH);

  // Only the Node.js runtime owns local state and the controller lease.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Start the dormant runtime: build the controller from machine-local env and
  // acquire the single scheduler lease for this process. A second live server
  // process contends the same lease and stays a non-owner.
  const { getMissionControlController } = await import("./server/mission-control/runtime/composition");
  await getMissionControlController();
}
