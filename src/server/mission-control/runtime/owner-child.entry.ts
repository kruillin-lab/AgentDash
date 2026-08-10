// Child-process entry for the two-process owner-lock proof.
// Bundled by the test with esbuild, then run by two real OS processes against a
// shared AGENTDASH_STATE_DIR. Prints one JSON line reporting whether this
// process acquired the controller-owner lease.
import { ControllerOwner } from "./owner-lock";

async function main(): Promise<void> {
  const stateDir = process.argv[2];
  const pid = Number(process.argv[3]);
  const token = process.argv[4];
  const holdMs = Number(process.argv[5] ?? "0");
  const owner = new ControllerOwner({ stateDir, pid, processStartToken: token });
  const lease = await owner.acquire();
  if (lease === null) {
    process.stdout.write(`${JSON.stringify({ pid, acquired: false })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ pid, acquired: true, leaseId: lease.leaseId })}\n`);
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  await lease.release();
}

void main();
