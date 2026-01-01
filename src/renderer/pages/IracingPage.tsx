import React, { useState, useEffect } from 'react';
import { Activity, Camera, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { CameraConfig } from '../types';

interface IracingPageProps {
  cameras?: CameraConfig[];
}

export const IracingPage = ({ cameras = [] }: IracingPageProps) => {
  const [connected, setConnected] = useState(false);
  const [carNumber, setCarNumber] = useState('66');
  const [groupNumber, setGroupNumber] = useState('1');

  useEffect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.iracingGetStatus) {
        const status = await window.electronAPI.iracingGetStatus();
        setConnected(status.connected);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const sendCommand = async (cmd: number, var1: number, var2: number, var3: number = 0) => {
    if (window.electronAPI?.iracingSendCommand) {
      await window.electronAPI.iracingSendCommand(cmd, var1, var2, var3);
    }
  };

  const handleSwitchCamera = (targetCar: string, targetGroup: string) => {
    const car = parseInt(targetCar);
    const group = parseInt(targetGroup);
    if (!isNaN(car) && !isNaN(group)) {
      // cmd=1 (Switch Num), var1=Car, var2=Group
      sendCommand(1, car, group);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-rajdhani font-bold uppercase tracking-wider text-white">
          iRacing Control
        </h1>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${connected ? 'bg-green-900/20 border-green-500/50 text-green-500' : 'bg-red-900/20 border-red-500/50 text-red-500'}`}>
          <Activity className="w-4 h-4" />
          <span className="font-jetbrains text-sm font-bold uppercase">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Camera Control Card */}
        <div className="bg-[#111317] border border-[#282A30] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Camera className="w-5 h-5 text-[#FF5F1F]" />
            <h2 className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
              Camera Control
            </h2>
          </div>
          
          <div className="space-y-6">
            {/* Configured Cameras */}
            {cameras && cameras.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {cameras.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => handleSwitchCamera(carNumber, cam.groupNumber.toString())}
                    className="bg-[#282A30] hover:bg-[#FF5F1F] hover:text-white text-muted-foreground p-3 rounded transition-colors text-sm font-bold uppercase font-rajdhani tracking-wider"
                  >
                    {cam.name}
                  </button>
                ))}
              </div>
            )}

            {/* Manual Override */}
            <div className="pt-4 border-t border-[#282A30]">
              <h3 className="text-xs text-muted-foreground uppercase mb-4 font-rajdhani tracking-widest">Manual Override</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-muted-foreground uppercase mb-2 font-rajdhani">Car Number</label>
                  <input 
                    type="text" 
                    value={carNumber}
                    onChange={(e) => setCarNumber(e.target.value)}
                    className="w-full bg-[#090B10] border border-[#282A30] rounded p-2 text-white font-jetbrains focus:border-[#FF5F1F] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground uppercase mb-2 font-rajdhani">Camera Group</label>
                  <input 
                    type="text" 
                    value={groupNumber}
                    onChange={(e) => setGroupNumber(e.target.value)}
                    className="w-full bg-[#090B10] border border-[#282A30] rounded p-2 text-white font-jetbrains focus:border-[#FF5F1F] outline-none"
                  />
                </div>
              </div>
              
              <button 
                onClick={() => handleSwitchCamera(carNumber, groupNumber)}
                className="w-full bg-[#282A30] hover:bg-[#FF5F1F] text-white font-rajdhani uppercase tracking-wider font-bold py-3 rounded transition-colors"
              >
                Switch Camera
              </button>
            </div>
          </div>
        </div>

        {/* Replay Control Card */}
        <div className="bg-[#111317] border border-[#282A30] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Play className="w-5 h-5 text-[#00A3E0]" />
            <h2 className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
              Replay Control
            </h2>
          </div>
          
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => sendCommand(3, 0, 0)} className="bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center">
              <Pause className="w-5 h-5" />
            </button>
            <button onClick={() => sendCommand(3, 1, 0)} className="bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center">
              <Play className="w-5 h-5" />
            </button>
            <button onClick={() => sendCommand(4, 0, 0)} className="bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center">
              <SkipBack className="w-5 h-5" />
            </button>
            <button onClick={() => sendCommand(4, 1, 0)} className="bg-[#282A30] hover:bg-[#383A40] text-white p-3 rounded flex justify-center">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

