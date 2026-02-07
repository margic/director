import React, { useState, useEffect } from 'react';
import { Activity, Camera, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { CameraConfig } from '../../../renderer/types';

interface IracingPanelProps {
  cameras?: CameraConfig[];
}

export const IracingPanel = ({ cameras = [] }: IracingPanelProps) => {
  const [extActive, setExtActive] = useState(false);
  const [carNumber, setCarNumber] = useState('66');
  const [groupNumber, setGroupNumber] = useState('1');

  useEffect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.extensions) {
        const statuses = await window.electronAPI.extensions.getStatus();
        const iracing = statuses['director-iracing'];
        setExtActive(iracing?.active || false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const intent = async (name: string, payload: any) => {
      if (window.electronAPI?.extensions) {
          try {
              await window.electronAPI.extensions.executeIntent(name, payload);
          } catch (e) {
              console.error('Intent failed', e);
          }
      }
  };

  const handleSwitchCamera = (targetCar: string, targetGroup: string) => {
      // Intent: broadcast.showLiveCam
      intent('broadcast.showLiveCam', { 
          carNum: targetCar, 
          camGroup: targetGroup 
      });
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
             // Legacy behavior for 'SkipForward' was cmd=4, var1=1. 
             // That map to setReplayPosition frame=1
             // If the intention is 'Live', we might need a different command, but let's stick to legacy mapping via intents
              intent('broadcast.setReplayPosition', { frame: -1 }); // -1 often implies 'End' in some APIs, or just try to replicate existing behavior.
              // Actually legacy was sendCommand(4, 1, 0) => SETPOS(1).
              // I will use frame: 1 to be safe.
              intent('broadcast.setReplayPosition', { frame: 1 });
              break;
      }
  };

  return (
    <div className='space-y-6 h-full'>
      <div className='flex items-center justify-between'>
        <h1 className='text-3xl font-rajdhani font-bold uppercase tracking-wider text-white'>
           iRacing Extension
        </h1>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${extActive ? 'bg-green-900/20 border-green-500/50 text-green-500' : 'bg-red-900/20 border-red-500/50 text-red-500'}`}>
          <Activity className='w-4 h-4' />
          <span className='font-jetbrains text-sm font-bold uppercase'>
            {extActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
        {/* Camera Control Card */}
        <div className='bg-[#111317] border border-[#282A30] rounded-lg p-6'>
          <div className='flex items-center gap-2 mb-6'>
            <Camera className='w-5 h-5 text-[#FF5F1F]' />
            <h2 className='text-muted-foreground text-sm uppercase font-rajdhani tracking-widest'>
               Camera Control
            </h2>
          </div>
          
          <div className='space-y-6'>
            {/* Configured Cameras */}
            {cameras && cameras.length > 0 && (
              <div className='grid grid-cols-2 gap-3'>
                {cameras.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => handleSwitchCamera(carNumber, cam.groupNumber.toString())}
                    className='bg-[#282A30] hover:bg-[#FF5F1F] hover:text-white text-muted-foreground p-3 rounded transition-colors text-sm font-bold uppercase font-rajdhani tracking-wider'
                  >
                    {cam.name}
                  </button>
                ))}
              </div>
            )}

            {/* Manual Override */}
            <div className='pt-4 border-t border-[#282A30]'>
              <h3 className='text-xs text-muted-foreground uppercase mb-4 font-rajdhani tracking-widest'>Manual Override</h3>
              <div className='grid grid-cols-2 gap-4 mb-4'>
                <div>
                  <label className='block text-xs text-muted-foreground uppercase mb-2 font-rajdhani'>Car Number</label>
                  <input 
                    type='text' 
                    value={carNumber}
                    onChange={(e) => setCarNumber(e.target.value)}
                    className='w-full bg-[#090B10] border border-[#282A30] rounded p-2 text-white font-jetbrains focus:border-[#FF5F1F] outline-none'
                  />
                </div>
                <div>
                  <label className='block text-xs text-muted-foreground uppercase mb-2 font-rajdhani'>Camera Group</label>
                  <input 
                    type='text' 
                    value={groupNumber}
                    onChange={(e) => setGroupNumber(e.target.value)}
                    className='w-full bg-[#090B10] border border-[#282A30] rounded p-2 text-white font-jetbrains focus:border-[#FF5F1F] outline-none'
                  />
                </div>
              </div>
              
              <button 
                onClick={() => handleSwitchCamera(carNumber, groupNumber)}
                className='w-full bg-[#282A30] hover:bg-[#FF5F1F] text-white font-rajdhani uppercase tracking-wider font-bold py-3 rounded transition-colors'
              >
                Switch Camera
              </button>
            </div>
          </div>
        </div>

        {/* Replay Control Card */}
        <div className='bg-[#111317] border border-[#282A30] rounded-lg p-6'>
          <div className='flex items-center gap-2 mb-6'>
            <Play className='w-5 h-5 text-[#00A3E0]' />
            <h2 className='text-muted-foreground text-sm uppercase font-rajdhani tracking-widest'>
               Replay Control (Ext)
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
  );
};
