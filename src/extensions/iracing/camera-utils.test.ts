import { describe, it, expect } from 'vitest';
import { resolveCameraGroup, CameraGroup } from './camera-utils';

const sampleGroups: CameraGroup[] = [
  { groupNum: 1, groupName: 'Nose' },
  { groupNum: 2, groupName: 'Gearbox' },
  { groupNum: 9, groupName: 'Cockpit' },
  { groupNum: 10, groupName: 'Scenic', isScenic: true },
  { groupNum: 11, groupName: 'TV1' },
  { groupNum: 12, groupName: 'TV2' },
  { groupNum: 13, groupName: 'TV3' },
  { groupNum: 14, groupName: 'TV Static' },
  { groupNum: 15, groupName: 'TV Mixed' },
  { groupNum: 16, groupName: 'Pit Lane' },
  { groupNum: 18, groupName: 'Blimp' },
  { groupNum: 20, groupName: 'Chase' },
];

describe('resolveCameraGroup', () => {
  it('resolves a camera group name like "TV1" to the correct group number', () => {
    expect(resolveCameraGroup('TV1', sampleGroups)).toBe(11);
  });

  it('resolves a numeric string like "3" directly', () => {
    expect(resolveCameraGroup('3', sampleGroups)).toBe(3);
  });

  it('defaults to 0 when camGroup is undefined', () => {
    expect(resolveCameraGroup(undefined, sampleGroups)).toBe(0);
  });

  it('defaults to 0 when camGroup is an empty string', () => {
    expect(resolveCameraGroup('', sampleGroups)).toBe(0);
  });

  it('performs case-insensitive matching', () => {
    expect(resolveCameraGroup('tv1', sampleGroups)).toBe(11);
    expect(resolveCameraGroup('TV1', sampleGroups)).toBe(11);
    expect(resolveCameraGroup('Tv1', sampleGroups)).toBe(11);
  });

  it('matches partial names via substring (e.g. "Pit Lane" matches "Pit Lane")', () => {
    expect(resolveCameraGroup('Pit Lane', sampleGroups)).toBe(16);
  });

  it('returns 0 for an unknown name when no match is found', () => {
    expect(resolveCameraGroup('NonExistent', sampleGroups)).toBe(0);
  });

  it('returns 0 when cameraGroups list is empty', () => {
    expect(resolveCameraGroup('TV1', [])).toBe(0);
  });

  it('prefers numeric parsing over name matching for numeric strings', () => {
    // "11" should parse as the number 11, not search for a group named "11"
    expect(resolveCameraGroup('11', sampleGroups)).toBe(11);
  });

  it('handles "0" as a valid numeric string', () => {
    expect(resolveCameraGroup('0', sampleGroups)).toBe(0);
  });
});
