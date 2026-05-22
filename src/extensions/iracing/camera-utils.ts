/**
 * Utility to resolve camera group names to iRacing numeric group IDs.
 */

export interface CameraGroup {
  groupNum: number;
  groupName: string;
  isScenic?: boolean;
  description?: string;
}

/**
 * Resolves a camera group identifier (numeric ID, name, or numeric string) to
 * an iRacing numeric group ID using the cached camera groups list.
 *
 * - If `name` is undefined or empty string, returns 0 (default group).
 * - If `name` is already a number, returns it directly (0 is a valid group ID).
 * - If `name` is a numeric string (e.g. "3"), returns the parsed number.
 * - Otherwise performs a case-insensitive substring match against known group
 *   names (e.g. "TV1" → groupNum 11).
 * - Falls back to 0 when no match is found.
 */
export function resolveCameraGroup(
  name: number | string | undefined,
  cameraGroups: CameraGroup[],
): number {
  if (name === undefined || name === '') return 0;
  if (typeof name === 'number') return name;
  const num = parseInt(name, 10);
  if (!isNaN(num)) return num;
  const match = cameraGroups.find(
    (g) => g.groupName.toLowerCase().includes(name.toLowerCase()),
  );
  return match?.groupNum ?? 0;
}
