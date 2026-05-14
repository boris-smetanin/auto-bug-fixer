import type { Space } from '@abf/shared';
import type { FixLoopStatus } from '@/components/ui/status-pill';

/**
 * Derive the user-facing Fix Loop status from the persistent flag plus the
 * "is anything actually running right now" signal.
 *
 * - `running`  → loop is on, fresh ticks fire
 * - `stopping` → loop has been turned off, but a Fix Attempt from before
 *                the stop is still draining (soft-stop)
 * - `stopped`  → loop is off and idle
 */
export function spaceStatus(space: Space): FixLoopStatus {
  if (space.fixLoopRunning) return 'running';
  return space.busy ? 'stopping' : 'stopped';
}
