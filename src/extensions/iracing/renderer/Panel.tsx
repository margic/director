import React, { useState, useEffect, useMemo } from 'react';
import { Camera, Play, Pause, SkipBack, SkipForward, Car, Eye, Video, ChevronDown, ChevronUp, Users, Search, Flag, LayoutDashboard } from 'lucide-react';
import { useSetPageHeader } from '../../../renderer/contexts/PageHeaderContext';
import { RaceViewMockup } from './RaceViewMockup';

interface CameraGroup {
  groupNum: number;
  groupName: string;
  isScenic?: boolean;
}

interface DriverEntry {
  carIdx: number;
  carNumber: string;
  userName: string;
  teamName: string;
  carName: string;
}

interface RaceState {
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
}

interface IracingPanelProps {
  cameras?: any[]; // Legacy prop — no longer primary source
}

type PanelView = 'control-desk' | 'race-view';

export const IracingPanel = ({ cameras = [] }: IracingPanelProps) => {
  const [activeView, setActiveView] = useState<PanelView>('control-desk');
  const [connected, setConnected] = useState(false);
  const [cameraGroups, setCameraGroups] = useState<CameraGroup[]>([]);
  const [drivers, setDrivers] = useState<DriverEntry[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [driverFilter, setDriverFilter] = useState('');
  const [activeCamGroup, setActiveCamGroup] = useState<number | null>(null);
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [manualGroupNumber, setManualGroupNumber] = useState('1');
  const [manualCarNumber, setManualCarNumber] = useState('1');
  const [raceState, setRaceState] = useState<RaceState | null>(null);

  // Push header into the global app bar
  useSetPageHeader({
    title: 'iRacing',
    icon: Car,
    subtitle: connected ? 'Connected' : 'Disconnected',
    subtitleVariant: connected ? 'success' : 'danger',
  });

  useEffect(() => {
    const init = async () => {
      if (!window.electronAPI?.extensions) return;
      try {
        // Restore connection state
        const connEvent = await window.electronAPI.extensions.getLastEvent('iracing.connectionStateChanged');
        if (connEvent?.payload?.connected !== undefined) {
          setConnected(connEvent.payload.connected);
        }
        // Restore camera groups
        const camEvent = await window.electronAPI.extensions.getLastEvent('iracing.cameraGroupsChanged');
        if (camEvent?.payload?.groups) {
          setCameraGroups(camEvent.payload.groups);
        }
        // Restore drivers
        const drvEvent = await window.electronAPI.extensions.getLastEvent('iracing.driversChanged');
        if (drvEvent?.payload?.drivers) {
          setDrivers(drvEvent.payload.drivers);
        }
        // Restore race state
        const raceEvent = await window.electronAPI.extensions.getLastEvent('iracing.raceStateChanged');
        if (raceEvent?.payload?.cars) {
          setRaceState(raceEvent.payload as RaceState);
        }
      } catch (e) {
        console.error('Failed to get iracing state', e);
      }
    };
    init();

    // Subscribe to live events
    let unsub: (() => void) | undefined;
    if (window.electronAPI?.extensions) {
      unsub = window.electronAPI.extensions.onExtensionEvent((data) => {
        if (data.eventName === 'iracing.connectionStateChanged') {
          setConnected(!!data.payload?.connected);
          if (!data.payload?.connected) {
            setCameraGroups([]);
            setDrivers([]);
            setActiveCamGroup(null);
            setSelectedDriver('');
            setRaceState(null);
          }
        }
        if (data.eventName === 'iracing.cameraGroupsChanged') {
          setCameraGroups(data.payload?.groups ?? []);
        }
        if (data.eventName === 'iracing.driversChanged') {
          setDrivers(data.payload?.drivers ?? []);
        }
        if (data.eventName === 'iracing.raceStateChanged') {
          setRaceState(data.payload as RaceState);
        }
      });
    }
    return () => unsub?.();
  }, []);

  // Categorize cameras into groups for easier navigation
  const { onCarCams, broadcastCams, specialCams } = useMemo(() => {
    const onCar: CameraGroup[] = [];
    const broadcast: CameraGroup[] = [];
    const special: CameraGroup[] = [];

    for (const g of cameraGroups) {
      const name = g.groupName.toLowerCase();
      if (g.isScenic || name.includes('pit lane') || name.includes('blimp') || name.includes('chopper') || name.includes('scenic')) {
        special.push(g);
      } else if (name.startsWith('tv') || name.includes('chase') || name.includes('rear chase') || name.includes('far chase')) {
        broadcast.push(g);
      } else {
        onCar.push(g);
      }
    }

    return { onCarCams: onCar, broadcastCams: broadcast, specialCams: special };
  }, [cameraGroups]);

  // Filtered driver list for the search box
  const filteredDrivers = useMemo(() => {
    if (!driverFilter.trim()) return drivers;
    const q = driverFilter.toLowerCase();
    return drivers.filter(
      (d) =>
        d.userName.toLowerCase().includes(q) ||
        d.carNumber.includes(q)
    );
  }, [drivers, driverFilter]);

  // The car number to send — selected driver or manual fallback
  const activeCarNumber = selectedDriver || manualCarNumber;

  const intent = async (name: string, payload: any) => {
    if (window.electronAPI?.extensions) {
      try {
        await window.electronAPI.extensions.executeIntent(name, payload);
      } catch (e) {
        console.error('Intent failed', e);
      }
    }
  };

  const handleSwitchCamera = (groupNum: number) => {
    setActiveCamGroup(groupNum);
    intent('broadcast.showLiveCam', {
      carNum: activeCarNumber,
      camGroup: groupNum.toString(),
    });
  };

  const handleSelectDriver = (carNumber: string) => {
    setSelectedDriver(carNumber);
    setDriverFilter('');
    // If a camera is already active, immediately switch to this driver on that camera
    if (activeCamGroup !== null) {
      intent('broadcast.showLiveCam', {
        carNum: carNumber,
        camGroup: activeCamGroup.toString(),
      });
    }
  };

  const handleReplay = (action: 'pause' | 'play' | 'start' | 'end') => {
    switch (action) {
      case 'pause':
        intent('broadcast.setReplaySpeed', { speed: 0 });
        break;
      case 'play':
        intent('broadcast.setReplaySpeed', { speed: 1 });
        break;
      case 'start':
        intent('broadcast.setReplayPosition', { frame: 0 });
        break;
      case 'end':
        intent('broadcast.setReplayPosition', { frame: 1 });
        break;
    }
  };

  const CamButton = ({ group }: { group: CameraGroup }) => (
    <button
      onClick={() => handleSwitchCamera(group.groupNum)}
      className={`p-3 rounded transition-colors text-sm font-bold uppercase font-rajdhani tracking-wider ${
        activeCamGroup === group.groupNum
          ? 'bg-primary text-white ring-1 ring-primary/50'
          : 'bg-[#282A30] hover:bg-[#FF5F1F] hover:text-white text-muted-foreground'
      }`}
      title={`Group ${group.groupNum}`}
    >
      {group.groupName}
    </button>
  );

  const CameraSection = ({ title, icon: Icon, groups }: { title: string; icon: React.ElementType; groups: CameraGroup[] }) => {
    if (groups.length === 0) return null;
    return (
      <div className='space-y-3'>
        <div className='flex items-center gap-2'>
          <Icon className='w-4 h-4 text-muted-foreground' />
          <h3 className='text-xs text-muted-foreground uppercase font-rajdhani tracking-widest'>{title}</h3>
        </div>
        <div className='grid grid-cols-3 sm:grid-cols-4 gap-2'>
          {groups.map((g) => (
            <CamButton key={g.groupNum} group={g} />
          ))}
        </div>
      </div>
    );
  };

  const hasCameraGroups = cameraGroups.length > 0;
  const hasDrivers = drivers.length > 0;

  // Find selected driver info for display
  const selectedDriverInfo = useMemo(
    () => drivers.find((d) => d.carNumber === selectedDriver),
    [drivers, selectedDriver]
  );

  return (
    <div className='space-y-4 h-full flex flex-col'>
      {/* View Switcher Tabs */}
      <div className='flex items-center gap-1 bg-card border border-border rounded-lg p-1'>
        <button
          onClick={() => setActiveView('control-desk')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-rajdhani uppercase tracking-widest font-bold transition-all ${
            activeView === 'control-desk'
              ? 'bg-primary text-white shadow-[0_0_12px_rgba(255,95,31,0.2)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <LayoutDashboard className='w-3.5 h-3.5' />
          Control Desk
        </button>
        <button
          onClick={() => setActiveView('race-view')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-rajdhani uppercase tracking-widest font-bold transition-all ${
            activeView === 'race-view'
              ? 'bg-primary text-white shadow-[0_0_12px_rgba(255,95,31,0.2)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Flag className='w-3.5 h-3.5' />
          Race View
        </button>
      </div>

      {/* Active view content */}
      {activeView === 'race-view' ? (
        <div className='flex-1 min-h-0'>
          <RaceViewMockup
            raceState={raceState}
            cameraGroups={cameraGroups}
            onSwitchCamera={(carNumber, cameraGroupName) => {
              const group = cameraGroups.find(g =>
                g.groupName.toLowerCase().includes(cameraGroupName.toLowerCase())
              );
              if (group) {
                intent('broadcast.showLiveCam', {
                  carNum: carNumber,
                  camGroup: group.groupNum.toString(),
                });
              }
            }}
          />
        </div>
      ) : (
      <div className='space-y-6 flex-1'>
      {/* Driver Selection — spans full width */}
      <div className='bg-card border border-border rounded-lg p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <Users className='w-5 h-5 text-secondary' />
          <h2 className='text-muted-foreground text-sm uppercase font-rajdhani tracking-widest'>
            Target Driver
          </h2>
          {selectedDriverInfo && (
            <span className='ml-auto text-sm font-jetbrains text-primary font-bold'>
              #{selectedDriverInfo.carNumber} {selectedDriverInfo.userName}
            </span>
          )}
          {!selectedDriverInfo && selectedDriver && (
            <span className='ml-auto text-sm font-jetbrains text-primary font-bold'>
              #{selectedDriver}
            </span>
          )}
        </div>

        {hasDrivers ? (
          <div className='space-y-3'>
            {/* Search/filter */}
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
              <input
                type='text'
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                className='w-full bg-background border border-border rounded p-2 pl-9 text-white font-jetbrains focus:border-secondary outline-none text-sm'
                placeholder='Search by name or car number...'
              />
            </div>
            {/* Driver grid */}
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto'>
              {filteredDrivers.map((d) => (
                <button
                  key={d.carIdx}
                  onClick={() => handleSelectDriver(d.carNumber)}
                  className={`p-2.5 rounded transition-colors text-left ${
                    selectedDriver === d.carNumber
                      ? 'bg-secondary/20 border border-secondary text-white'
                      : 'bg-[#282A30] hover:bg-secondary/10 hover:border-secondary/50 border border-transparent text-muted-foreground'
                  }`}
                  title={`${d.userName} — ${d.carName}`}
                >
                  <span className='font-jetbrains text-sm font-bold text-primary block'>#{d.carNumber}</span>
                  <span className='font-rajdhani text-xs uppercase tracking-wider block truncate'>{d.userName}</span>
                </button>
              ))}
              {filteredDrivers.length === 0 && driverFilter && (
                <p className='col-span-full text-xs text-muted-foreground italic py-2'>No drivers match "{driverFilter}"</p>
              )}
            </div>
          </div>
        ) : (
          /* Manual fallback when no driver list available */
          <div className='space-y-3'>
            {!connected && (
              <p className='text-xs text-muted-foreground italic'>
                Driver list will appear when iRacing is connected.
              </p>
            )}
            {connected && (
              <p className='text-xs text-muted-foreground italic'>
                Waiting for session driver data...
              </p>
            )}
            <div className='flex gap-3'>
              <input
                type='text'
                value={manualCarNumber}
                onChange={(e) => { setManualCarNumber(e.target.value); setSelectedDriver(e.target.value); }}
                className='flex-1 bg-background border border-border rounded p-2 text-white font-jetbrains focus:border-secondary outline-none'
                placeholder='Car number e.g. 42'
              />
            </div>
          </div>
        )}
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
        {/* Camera Control Card */}
        <div className='bg-card border border-border rounded-lg p-6'>
          <div className='flex items-center gap-2 mb-6'>
            <Camera className='w-5 h-5 text-primary' />
            <h2 className='text-muted-foreground text-sm uppercase font-rajdhani tracking-widest'>
              Camera Control
            </h2>
            {hasCameraGroups && (
              <span className='ml-auto text-xs text-muted-foreground font-jetbrains'>
                {cameraGroups.length} groups
              </span>
            )}
          </div>

          {hasCameraGroups ? (
            <div className='space-y-5'>
              <CameraSection title='Broadcast' icon={Video} groups={broadcastCams} />
              <CameraSection title='On-Car' icon={Car} groups={onCarCams} />
              <CameraSection title='Scenic / Special' icon={Eye} groups={specialCams} />

              {/* Collapsible Manual Override */}
              <div className='pt-4 border-t border-border'>
                <button
                  onClick={() => setShowManualOverride(!showManualOverride)}
                  className='flex items-center gap-2 text-xs text-muted-foreground uppercase font-rajdhani tracking-widest hover:text-foreground transition-colors w-full'
                >
                  Manual Override
                  {showManualOverride ? <ChevronUp className='w-3 h-3 ml-auto' /> : <ChevronDown className='w-3 h-3 ml-auto' />}
                </button>
                {showManualOverride && (
                  <div className='mt-3 flex gap-3'>
                    <input
                      type='text'
                      value={manualGroupNumber}
                      onChange={(e) => setManualGroupNumber(e.target.value)}
                      className='flex-1 bg-background border border-border rounded p-2 text-white font-jetbrains focus:border-primary outline-none'
                      placeholder='Group #'
                    />
                    <button
                      onClick={() => handleSwitchCamera(parseInt(manualGroupNumber) || 1)}
                      className='bg-[#282A30] hover:bg-primary text-white font-rajdhani uppercase tracking-wider font-bold px-4 rounded transition-colors'
                    >
                      Switch
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Fallback when no camera groups available */
            <div className='space-y-4'>
              {!connected && (
                <p className='text-xs text-muted-foreground italic'>
                  Camera groups will appear when iRacing is connected.
                </p>
              )}
              {connected && (
                <p className='text-xs text-muted-foreground italic'>
                  Waiting for session camera data...
                </p>
              )}
              <div className='flex gap-3'>
                <input
                  type='text'
                  value={manualGroupNumber}
                  onChange={(e) => setManualGroupNumber(e.target.value)}
                  className='flex-1 bg-background border border-border rounded p-2 text-white font-jetbrains focus:border-primary outline-none'
                  placeholder='Group #'
                />
                <button
                  onClick={() => handleSwitchCamera(parseInt(manualGroupNumber) || 1)}
                  className='bg-[#282A30] hover:bg-primary text-white font-rajdhani uppercase tracking-wider font-bold px-4 rounded transition-colors'
                >
                  Switch
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Replay Control Card */}
        <div className='bg-card border border-border rounded-lg p-6'>
          <div className='flex items-center gap-2 mb-6'>
            <Play className='w-5 h-5 text-secondary' />
            <h2 className='text-muted-foreground text-sm uppercase font-rajdhani tracking-widest'>
              Replay Control
            </h2>
          </div>

          <div className='grid grid-cols-4 gap-2'>
            <button onClick={() => handleReplay('pause')} className='bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center'>
              <Pause className='w-5 h-5' />
            </button>
            <button onClick={() => handleReplay('play')} className='bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center'>
              <Play className='w-5 h-5' />
            </button>
            <button onClick={() => handleReplay('start')} className='bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center'>
              <SkipBack className='w-5 h-5' />
            </button>
            <button onClick={() => handleReplay('end')} className='bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center'>
              <SkipForward className='w-5 h-5' />
            </button>
          </div>
        </div>
      </div>
    </div>
      )}
    </div>
  );
};
