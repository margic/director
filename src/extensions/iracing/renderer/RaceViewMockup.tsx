/**
 * RaceView Mockup — Hybrid race tower with inline top-down car icons.
 *
 * A vertical scrollable race tower where each row features a prominent
 * top-down car icon, position, driver info, gap data, and a track-position
 * bar. Clicking a row expands it to reveal camera controls inline.
 *
 * This is a static mockup — no IPC / telemetry wiring yet.
 */

import React, { useState, useMemo } from 'react';
import {
  Camera,
  Eye,
  Video,
  Flag,
  ArrowUp,
  ArrowDown,
  Crosshair,
  Gauge,
  CircleDot,
  ChevronDown,
  Radio,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Props interface                                                    */
/* ------------------------------------------------------------------ */

interface RaceViewProps {
  raceState?: {
    cars: Array<{
      carIdx: number;
      carNumber: string;
      driverName: string;
      carClass: string;
      position: number;
      classPosition: number;
      lapDistPct: number;
      gapToLeader: number;
      gapToCarAhead: number;
      onPitRoad: boolean;
      lapsCompleted: number;
      lastLapTime: number;
      bestLapTime: number;
    }>;
    focusedCarIdx: number;
    sessionFlags: number;
    sessionLapsRemain: number;
    sessionTimeRemain: number;
    leaderLap: number;
    totalSessionLaps: number;
    trackName: string;
  } | null;
  cameraGroups?: Array<{ groupNum: number; groupName: string; isScenic?: boolean }>;
  onSwitchCamera?: (carNumber: string, cameraGroupName: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

interface RaceEntry {
  carIdx: number;
  carNumber: string;
  driverName: string;
  position: number;
  lapsCompleted: number;
  lapDistPct: number;
  gapToLeader: number;
  gapToCarAhead: number;
  lastLapTime: number;
  bestLapTime: number;
  onPitRoad: boolean;
  isFocused: boolean;
  carClass: string;
}

const MOCK_ENTRIES: RaceEntry[] = [
  { carIdx: 5,  carNumber: '14', driverName: 'Kevin Bobbitt',    position: 1,  lapsCompleted: 26, lapDistPct: 0.912, gapToLeader: 0,      gapToCarAhead: 0,      lastLapTime: 97.946, bestLapTime: 97.946, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 6,  carNumber: '6',  driverName: 'Jimmy Van Veen',   position: 2,  lapsCompleted: 26, lapDistPct: 0.910, gapToLeader: 0.247,  gapToCarAhead: 0.247,  lastLapTime: 97.932, bestLapTime: 95.405, onPitRoad: false, isFocused: true,  carClass: 'GT3' },
  { carIdx: 8,  carNumber: '8',  driverName: 'Grant Reeve',      position: 3,  lapsCompleted: 26, lapDistPct: 0.683, gapToLeader: 22.56,  gapToCarAhead: 22.313, lastLapTime: 99.941, bestLapTime: 97.480, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 0,  carNumber: '1',  driverName: 'Doug Hunt',        position: 4,  lapsCompleted: 26, lapDistPct: 0.239, gapToLeader: 65.54,  gapToCarAhead: 42.977, lastLapTime: 97.049, bestLapTime: 95.448, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 10, carNumber: '10', driverName: 'Dano Garrison',    position: 5,  lapsCompleted: 26, lapDistPct: 0.134, gapToLeader: 74.83,  gapToCarAhead: 9.298,  lastLapTime: 99.227, bestLapTime: 96.530, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 7,  carNumber: '7',  driverName: 'Otto Szebeni',     position: 6,  lapsCompleted: 26, lapDistPct: 0.074, gapToLeader: 80.57,  gapToCarAhead: 5.737,  lastLapTime: 99.729, bestLapTime: 97.466, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 9,  carNumber: '9',  driverName: 'Ian Sudol',        position: 7,  lapsCompleted: 26, lapDistPct: 0.058, gapToLeader: 81.74,  gapToCarAhead: 1.171,  lastLapTime: 100.768, bestLapTime: 97.779, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 17, carNumber: '17', driverName: 'Tom Brown',        position: 8,  lapsCompleted: 25, lapDistPct: 0.687, gapToLeader: 141.25, gapToCarAhead: 59.515, lastLapTime: 99.917, bestLapTime: 97.658, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 11, carNumber: '11', driverName: 'Baldur Karlsson',  position: 9,  lapsCompleted: 25, lapDistPct: 0.513, gapToLeader: 159.91, gapToCarAhead: 18.660, lastLapTime: 96.096, bestLapTime: 94.649, onPitRoad: false, isFocused: false, carClass: 'GT3' },
  { carIdx: 4,  carNumber: '5',  driverName: 'Jaime Baker',      position: 10, lapsCompleted: 24, lapDistPct: 0.712, gapToLeader: 181.64, gapToCarAhead: 21.732, lastLapTime: 98.980, bestLapTime: 96.785, onPitRoad: true,  isFocused: false, carClass: 'GT3' },
  { carIdx: 2,  carNumber: '3',  driverName: 'Kim Berry',        position: 11, lapsCompleted: 22, lapDistPct: 0.892, gapToLeader: 198.46, gapToCarAhead: 16.817, lastLapTime: 95.484, bestLapTime: 94.365, onPitRoad: false, isFocused: false, carClass: 'GT3' },
];

/* Camera options */
interface CameraOption {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  direction: 'forward' | 'backward';
}

const CAMERA_OPTIONS: CameraOption[] = [
  { id: 'nose',       label: 'Nose Cam',   description: 'Front of car, looking forward',      icon: ArrowUp,   direction: 'forward' },
  { id: 'cockpit',    label: 'Cockpit',     description: 'Driver POV, looking forward',        icon: Crosshair, direction: 'forward' },
  { id: 'tv1',        label: 'TV1 Chase',   description: 'Behind and above, looking forward',  icon: Video,     direction: 'forward' },
  { id: 'gearbox',    label: 'Gearbox',     description: 'Rear of car, looking backward',      icon: ArrowDown, direction: 'backward' },
  { id: 'rear-chase', label: 'Rear Chase',  description: 'Behind car looking back at it',      icon: Eye,       direction: 'backward' },
  { id: 'far-chase',  label: 'Far Chase',   description: 'Far behind, dramatic angle',         icon: Camera,    direction: 'backward' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatGap(seconds: number): string {
  if (seconds === 0) return 'LEADER';
  if (seconds < 1) return `+${seconds.toFixed(3)}`;
  if (seconds < 60) return `+${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `+${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatLapTime(seconds: number): string {
  if (seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function positionBadgeColor(pos: number): string {
  if (pos === 1) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';
  if (pos === 2) return 'bg-gray-400/15 text-gray-300 border-gray-400/30';
  if (pos === 3) return 'bg-amber-700/20 text-amber-500 border-amber-600/30';
  return 'bg-muted/30 text-muted-foreground border-border';
}

function carAccentColor(entry: RaceEntry, isSelected: boolean): string {
  if (isSelected) return '#FF5F1F';
  if (entry.isFocused) return '#00A3E0';
  if (entry.onPitRoad) return '#FFBF00';
  if (entry.position === 1) return '#FFD700';
  return '#6B7280';
}

function gapColor(gap: number): string {
  if (gap === 0) return 'text-yellow-400';
  if (gap < 1.0) return 'text-destructive font-bold';
  if (gap < 3.0) return 'text-primary';
  return 'text-muted-foreground';
}

/* ------------------------------------------------------------------ */
/*  Top-down car icon (inline SVG)                                     */
/* ------------------------------------------------------------------ */

const CarIcon = ({ color, glow }: { color: string; glow?: boolean }) => (
  <svg
    width={44}
    height={72}
    viewBox='-11 -18 22 36'
    className='flex-none drop-shadow-md'
  >
    {glow && (
      <ellipse cx={0} cy={0} rx={10} ry={14} fill={color} opacity={0.2} />
    )}
    {/* Main body */}
    <rect x={-4.5} y={-12} width={9} height={24} rx={3.5} ry={3.5} fill={color} />
    {/* Front wing */}
    <rect x={-7} y={-13} width={14} height={3.5} rx={1.2} fill={color} opacity={0.85} />
    {/* Rear wing */}
    <rect x={-7.5} y={8.5} width={15} height={3.5} rx={1.2} fill={color} opacity={0.9} />
    {/* Front wheels */}
    <rect x={-8.5} y={-9} width={3} height={6} rx={0.8} fill='#1a1a1a' stroke='#333' strokeWidth={0.4} />
    <rect x={5.5} y={-9} width={3} height={6} rx={0.8} fill='#1a1a1a' stroke='#333' strokeWidth={0.4} />
    {/* Rear wheels */}
    <rect x={-9} y={3.5} width={3.5} height={6} rx={0.8} fill='#1a1a1a' stroke='#333' strokeWidth={0.4} />
    <rect x={5.5} y={3.5} width={3.5} height={6} rx={0.8} fill='#1a1a1a' stroke='#333' strokeWidth={0.4} />
    {/* Cockpit */}
    <ellipse cx={0} cy={-3} rx={3} ry={3.5} fill='#0a0a0a' opacity={0.7} />
    {/* Centre stripe */}
    <line x1={0} y1={-10} x2={0} y2={10} stroke='#fff' strokeWidth={0.6} opacity={0.15} />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Track position bar                                                 */
/* ------------------------------------------------------------------ */

const TrackPositionBar = ({ pct, color }: { pct: number; color: string }) => (
  <div className='relative w-full h-1 bg-background rounded-full overflow-hidden'>
    <div
      className='absolute top-0 left-0 h-full rounded-full opacity-30'
      style={{ width: `${pct * 100}%`, background: color }}
    />
    <div
      className='absolute top-[-2px] w-2 h-2 rounded-full shadow-sm'
      style={{
        left: `calc(${pct * 100}% - 4px)`,
        background: color,
        boxShadow: `0 0 6px ${color}60`,
      }}
    />
  </div>
);

/* ------------------------------------------------------------------ */
/*  Inline camera picker                                               */
/* ------------------------------------------------------------------ */

const InlineCameraPicker = ({
  selectedCam,
  onSelect,
  onFocus,
}: {
  selectedCam: string | null;
  onSelect: (id: string) => void;
  onFocus: () => void;
}) => {
  const fwd = CAMERA_OPTIONS.filter((c) => c.direction === 'forward');
  const back = CAMERA_OPTIONS.filter((c) => c.direction === 'backward');

  return (
    <div className='pt-3 space-y-3 border-t border-border/30 mt-3'>
      <div>
        <span className='text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground/70 font-bold'>
          Looking Forward
        </span>
        <div className='flex flex-wrap gap-1.5 mt-1.5'>
          {fwd.map((cam) => {
            const Icon = cam.icon;
            const active = selectedCam === cam.id;
            return (
              <button
                key={cam.id}
                onClick={(e) => { e.stopPropagation(); onSelect(cam.id); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-rajdhani uppercase tracking-wider font-bold transition-all ${
                  active
                    ? 'bg-primary text-white shadow-[0_0_12px_rgba(255,95,31,0.35)]'
                    : 'bg-[#1e2028] text-muted-foreground hover:bg-primary/20 hover:text-primary border border-border/30'
                }`}
                title={cam.description}
              >
                <Icon className='w-3.5 h-3.5' />
                {cam.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <span className='text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground/70 font-bold'>
          Looking Back
        </span>
        <div className='flex flex-wrap gap-1.5 mt-1.5'>
          {back.map((cam) => {
            const Icon = cam.icon;
            const active = selectedCam === cam.id;
            return (
              <button
                key={cam.id}
                onClick={(e) => { e.stopPropagation(); onSelect(cam.id); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-rajdhani uppercase tracking-wider font-bold transition-all ${
                  active
                    ? 'bg-primary text-white shadow-[0_0_12px_rgba(255,95,31,0.35)]'
                    : 'bg-[#1e2028] text-muted-foreground hover:bg-primary/20 hover:text-primary border border-border/30'
                }`}
                title={cam.description}
              >
                <Icon className='w-3.5 h-3.5' />
                {cam.label}
              </button>
            );
          })}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        className={`w-full py-2.5 rounded-md font-rajdhani uppercase tracking-wider font-bold text-sm transition-all ${
          selectedCam
            ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_0_16px_rgba(255,95,31,0.3)]'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
        }`}
        disabled={!selectedCam}
      >
        <Gauge className='w-4 h-4 inline mr-1.5 -mt-0.5' />
        Focus Camera
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tower row                                                          */
/* ------------------------------------------------------------------ */

const TowerRow = ({
  entry,
  isSelected,
  selectedCam,
  onSelect,
  onCamSelect,
  onFocus,
  leaderLaps,
}: {
  entry: RaceEntry;
  isSelected: boolean;
  selectedCam: string | null;
  onSelect: () => void;
  onCamSelect: (id: string) => void;
  onFocus: () => void;
  leaderLaps: number;
}) => {
  const accent = carAccentColor(entry, isSelected);
  const lapsDown = leaderLaps - entry.lapsCompleted;

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border transition-all duration-200 cursor-pointer ${
        isSelected
          ? 'bg-card border-primary/50 shadow-[0_0_24px_rgba(255,95,31,0.12)] ring-1 ring-primary/20'
          : entry.isFocused
          ? 'bg-card/80 border-secondary/30 shadow-[0_0_12px_rgba(0,163,224,0.08)]'
          : 'bg-card/40 border-border/40 hover:bg-card/70 hover:border-border'
      }`}
    >
      <div className='flex items-center gap-3 p-3'>
        {/* Position badge */}
        <div
          className={`flex-none w-11 h-11 rounded-lg border flex items-center justify-center font-jetbrains font-bold text-base ${positionBadgeColor(
            entry.position
          )}`}
        >
          {entry.position > 0 ? entry.position : '-'}
        </div>

        {/* Top-down car icon */}
        <div className='flex-none'>
          <CarIcon color={accent} glow={isSelected || entry.isFocused} />
        </div>

        {/* Driver info */}
        <div className='flex-1 min-w-0 space-y-1'>
          <div className='flex items-center gap-2'>
            <span className='font-jetbrains text-sm font-bold' style={{ color: accent }}>
              #{entry.carNumber}
            </span>
            <span className='font-rajdhani text-sm uppercase tracking-wider font-semibold text-foreground truncate'>
              {entry.driverName}
            </span>
            {entry.isFocused && (
              <span className='flex-none flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-widest text-secondary bg-secondary/10 px-1.5 py-0.5 rounded'>
                <Eye className='w-3 h-3' /> LIVE
              </span>
            )}
            {entry.onPitRoad && (
              <span className='flex-none text-[10px] font-rajdhani uppercase tracking-widest font-bold text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded'>
                PIT
              </span>
            )}
            {lapsDown > 0 && (
              <span className='flex-none text-[10px] font-rajdhani uppercase tracking-widest text-destructive/60'>
                -{lapsDown}L
              </span>
            )}
          </div>
          <div className='flex items-center gap-4 text-[11px]'>
            <span className={`font-jetbrains ${gapColor(entry.gapToCarAhead)}`}>
              {entry.position === 1 ? 'LEADER' : formatGap(entry.gapToCarAhead)}
            </span>
            <span className='text-muted-foreground/50'>|</span>
            <span className='font-jetbrains text-muted-foreground'>
              Last {formatLapTime(entry.lastLapTime)}
            </span>
            <span className='font-jetbrains text-secondary/70'>
              Best {formatLapTime(entry.bestLapTime)}
            </span>
          </div>
          <TrackPositionBar pct={entry.lapDistPct} color={accent} />
        </div>

        {/* Gap to leader */}
        <div className='flex-none text-right w-20'>
          <span className='block font-jetbrains text-xs text-muted-foreground/50'>
            {entry.position === 1 ? '' : formatGap(entry.gapToLeader)}
          </span>
          <span className='block font-rajdhani text-[10px] uppercase tracking-wider text-muted-foreground/30'>
            {entry.carClass}
          </span>
        </div>

        {/* Expand chevron */}
        <ChevronDown
          className={`flex-none w-4 h-4 transition-transform duration-200 ${
            isSelected ? 'rotate-180 text-primary' : 'text-muted-foreground/30'
          }`}
        />
      </div>

      {/* Expanded detail + camera controls */}
      {isSelected && (
        <div className='px-3 pb-3'>
          <div className='grid grid-cols-4 gap-2 mb-0'>
            <div className='bg-background/50 rounded px-2.5 py-1.5 border border-border/20'>
              <span className='text-[9px] text-muted-foreground uppercase font-rajdhani tracking-widest block'>
                Gap Ahead
              </span>
              <span className={`font-jetbrains text-sm font-bold ${gapColor(entry.gapToCarAhead)}`}>
                {entry.position === 1 ? 'LEADER' : formatGap(entry.gapToCarAhead)}
              </span>
            </div>
            <div className='bg-background/50 rounded px-2.5 py-1.5 border border-border/20'>
              <span className='text-[9px] text-muted-foreground uppercase font-rajdhani tracking-widest block'>
                To Leader
              </span>
              <span className='font-jetbrains text-sm font-bold text-muted-foreground'>
                {formatGap(entry.gapToLeader)}
              </span>
            </div>
            <div className='bg-background/50 rounded px-2.5 py-1.5 border border-border/20'>
              <span className='text-[9px] text-muted-foreground uppercase font-rajdhani tracking-widest block'>
                Last Lap
              </span>
              <span className='font-jetbrains text-sm font-bold text-foreground'>
                {formatLapTime(entry.lastLapTime)}
              </span>
            </div>
            <div className='bg-background/50 rounded px-2.5 py-1.5 border border-border/20'>
              <span className='text-[9px] text-muted-foreground uppercase font-rajdhani tracking-widest block'>
                Best Lap
              </span>
              <span className='font-jetbrains text-sm font-bold text-secondary'>
                {formatLapTime(entry.bestLapTime)}
              </span>
            </div>
          </div>
          <InlineCameraPicker
            selectedCam={selectedCam}
            onSelect={onCamSelect}
            onFocus={onFocus}
          />
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export const RaceViewMockup = ({ raceState, cameraGroups, onSwitchCamera }: RaceViewProps) => {
  const [selectedCarIdx, setSelectedCarIdx] = useState<number | null>(null);
  const [selectedCam, setSelectedCam] = useState<string | null>(null);

  // Derive entries from live data or fall back to mock
  const isLive = !!raceState && raceState.cars.length > 0;

  const entries: RaceEntry[] = useMemo(() => {
    if (!raceState || raceState.cars.length === 0) return MOCK_ENTRIES;
    return raceState.cars.map(car => ({
      carIdx: car.carIdx,
      carNumber: car.carNumber,
      driverName: car.driverName,
      position: car.position,
      lapsCompleted: car.lapsCompleted,
      lapDistPct: car.lapDistPct,
      gapToLeader: car.gapToLeader,
      gapToCarAhead: car.gapToCarAhead,
      lastLapTime: car.lastLapTime,
      bestLapTime: car.bestLapTime,
      onPitRoad: car.onPitRoad,
      isFocused: car.carIdx === raceState.focusedCarIdx,
      carClass: car.carClass || 'GT3',
    }));
  }, [raceState]);

  const leaderLaps = isLive ? raceState!.leaderLap : MOCK_ENTRIES[0].lapsCompleted;
  const totalLaps = isLive ? raceState!.totalSessionLaps : 40;
  const sessionFlags = isLive ? raceState!.sessionFlags : 0;

  // Derive flag status from session flags bitfield
  const flagStatus = useMemo(() => {
    if (!isLive) return { label: 'MOCK', color: 'text-muted-foreground/50' };
    if (sessionFlags & 0x00000001) return { label: 'CHECKERED', color: 'text-white' };
    if (sessionFlags & 0x00000010) return { label: 'RED', color: 'text-destructive' };
    if (sessionFlags & 0x00000008) return { label: 'YELLOW', color: 'text-yellow-400' };
    if (sessionFlags & 0x00000002) return { label: 'WHITE', color: 'text-white' };
    if (sessionFlags & 0x00000004) return { label: 'GREEN', color: 'text-green-400' };
    return { label: 'GREEN', color: 'text-green-400' };
  }, [isLive, sessionFlags]);

  // Camera name → iRacing group name mapping
  const camNameMap: Record<string, string> = {
    'nose': 'Nose',
    'cockpit': 'Cockpit',
    'tv1': 'TV1',
    'gearbox': 'Gearbox',
    'rear-chase': 'Rear Chase',
    'far-chase': 'Far Chase',
  };

  const handleSelectCar = (carIdx: number) => {
    setSelectedCarIdx((prev) => (prev === carIdx ? null : carIdx));
    setSelectedCam(null);
  };

  const handleFocus = () => {
    if (!selectedCam || selectedCarIdx === null) return;
    const entry = entries.find((e) => e.carIdx === selectedCarIdx);
    if (!entry) return;

    if (onSwitchCamera) {
      const groupName = camNameMap[selectedCam] || selectedCam;
      onSwitchCamera(entry.carNumber, groupName);
    } else {
      console.log(`[RaceView] Focus camera: car #${entry.carNumber}, cam=${selectedCam}`);
    }
  };

  return (
    <div className='h-full flex flex-col'>
      {/* Header */}
      <div className='flex items-center justify-between mb-3 px-1'>
        <div className='flex items-center gap-2'>
          <Flag className='w-4 h-4 text-primary' />
          <h2 className='text-xs text-muted-foreground uppercase font-rajdhani tracking-widest font-bold'>
            Race Tower
          </h2>
          {isLive && (
            <span className='flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-widest text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded'>
              <Radio className='w-3 h-3' /> LIVE
            </span>
          )}
          <span className='text-[10px] font-jetbrains text-muted-foreground/50'>
            {entries.length} cars · Lap {leaderLaps}{totalLaps > 0 ? ` / ${totalLaps}` : ''}
          </span>
        </div>
        <div className='flex items-center gap-3'>
          <div className='hidden sm:flex items-center gap-3 text-[9px] text-muted-foreground/40 font-rajdhani uppercase tracking-wider'>
            <span className='flex items-center gap-1'>
              <span className='w-2 h-2 rounded-sm' style={{ background: '#FFD700' }} /> Leader
            </span>
            <span className='flex items-center gap-1'>
              <span className='w-2 h-2 rounded-sm' style={{ background: '#00A3E0' }} /> Live
            </span>
            <span className='flex items-center gap-1'>
              <span className='w-2 h-2 rounded-sm' style={{ background: '#FF5F1F' }} /> Selected
            </span>
            <span className='flex items-center gap-1'>
              <span className='w-2 h-2 rounded-sm' style={{ background: '#FFBF00' }} /> Pit
            </span>
          </div>
          <div className='flex items-center gap-1.5 text-[10px] text-muted-foreground/50 font-rajdhani uppercase tracking-wider'>
            <CircleDot className={`w-3 h-3 ${flagStatus.color}`} />
            {flagStatus.label}
          </div>
        </div>
      </div>

      {/* Scrollable tower */}
      <div className='flex-1 overflow-y-auto space-y-1.5 pr-1'>
        {entries.map((entry) => (
          <TowerRow
            key={entry.carIdx}
            entry={entry}
            isSelected={selectedCarIdx === entry.carIdx}
            selectedCam={selectedCarIdx === entry.carIdx ? selectedCam : null}
            onSelect={() => handleSelectCar(entry.carIdx)}
            onCamSelect={setSelectedCam}
            onFocus={handleFocus}
            leaderLaps={leaderLaps}
          />
        ))}
      </div>
    </div>
  );
};
