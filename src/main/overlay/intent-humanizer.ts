/**
 * Intent Humanizer (Main Process)
 *
 * Converts intent IDs into human-readable labels for the overlay system.
 * This is a main-process copy of src/renderer/lib/intent-utils.ts/humanizeIntent.
 *
 * Example transformations:
 *   "obs.switchScene"          → "Switch Scene"
 *   "broadcast.muteDrivers"    → "Mute Drivers"
 *   "communication.talkToChat" → "Talk To Chat"
 *   "system.wait"              → "Wait"
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.2
 */

/** Extract the action name from a fully-qualified intent ID. */
function getIntentAction(intent: string): string {
  const parts = intent.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : intent;
}

/**
 * Convert a camelCase intent action into a human-readable label.
 *
 * Used by the overlay system to display broadcast-friendly text
 * when step.metadata.label is not provided.
 */
export function humanizeIntent(intent: string): string {
  const action = getIntentAction(intent);
  return action
    .replace(/([A-Z])/g, ' $1')  // camelCase → spaced
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
