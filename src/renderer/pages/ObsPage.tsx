import React, { useState, useEffect } from 'react';
import { Activity, Aperture, AlertTriangle } from 'lucide-react';

export const ObsPage = () => {
  const [connected, setConnected] = useState(false);
  const [missingScenes, setMissingScenes] = useState<string[]>([]);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);

  useEffect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.obsGetStatus) {
        const status = await window.electronAPI.obsGetStatus();
        setConnected(status.connected);
        setMissingScenes(status.missingScenes);
        setAvailableScenes(status.availableScenes);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSwitchScene = async (sceneName: string) => {
    if (window.electronAPI?.obsSetScene) {
      await window.electronAPI.obsSetScene(sceneName);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-rajdhani font-bold uppercase tracking-wider text-white">
          OBS Control
        </h1>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${connected ? 'bg-green-900/20 border-green-500/50 text-green-500' : 'bg-red-900/20 border-red-500/50 text-red-500'}`}>
          <Activity className="w-4 h-4" />
          <span className="font-jetbrains text-sm font-bold uppercase">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Missing Scenes Warning */}
      {missingScenes.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
          <div>
            <h3 className="text-yellow-500 font-bold uppercase font-rajdhani tracking-wider mb-1">Configuration Warning</h3>
            <p className="text-sm text-yellow-200/80 mb-2">The following scenes are required by the session but missing in OBS:</p>
            <ul className="list-disc list-inside text-sm text-yellow-200/80 font-jetbrains">
              {missingScenes.map(scene => (
                <li key={scene}>{scene}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* Scene Control Card */}
        <div className="bg-[#111317] border border-[#282A30] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Aperture className="w-5 h-5 text-[#FF5F1F]" />
            <h2 className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
              Scene Control
            </h2>
          </div>
          
          <div className="space-y-6">
            {availableScenes.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {availableScenes.map((scene) => (
                  <button
                    key={scene}
                    onClick={() => handleSwitchScene(scene)}
                    className="bg-[#282A30] hover:bg-[#FF5F1F] hover:text-white text-muted-foreground p-3 rounded transition-colors text-sm font-bold uppercase font-rajdhani tracking-wider truncate"
                    title={scene}
                  >
                    {scene}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm italic">
                {connected ? 'No scenes available' : 'Connect to OBS to see scenes'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
