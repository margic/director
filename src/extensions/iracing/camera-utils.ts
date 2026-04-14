/**
 * Utility to resolve camera group names to iRacing numeric group IDs.
 */

export interface CameraGroup {
  groupNum: number;
  groupName: string;
  isScenic?: boolean;
}

/**
 * Resolves a camera group identifier (name or numeric string) to an iRacing
 * numeric group ID using the cached camera groups list.
 *
 * - If `name` is undefined or empty, returns 0 (default group).
 * - If `name` is a numeric string (e.g. "3"), returns the parsed number.
 * - Otherwise performs a case-insensitive substring match against known group
 *   names (e.g. "TV1" → groupNum 11).
 * - Falls back to 0 when no match is found.
 */
export function resolveCameraGroup(
  name: string | undefined,
  cameraGroups: CameraGroup[],
): number {
  if (!name) return 0;
  const num = parseInt(name, 10);
  if (!isNaN(num)) return num;
  const match = cameraGroups.find(
    (g) => g.groupName.toLowerCase().includes(name.toLowerCase()),
  );
  return match?.groupNum ?? 0;
}
