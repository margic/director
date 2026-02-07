/**
 * Renderer-side Extension View Registry
 *
 * Maps installed extension IDs to their sidebar metadata and panel components.
 * App.tsx consumes this registry to generate sidebar navigation and render
 * extension views — eliminating the need for per-extension page wrappers.
 */

import { ComponentType } from 'react';
import { Car, Aperture, Play, Mic, LucideIcon } from 'lucide-react';
import { IracingPanel } from '../extensions/iracing/renderer/Panel';
import { ObsPanel } from '../extensions/obs/renderer/Panel';
import { YouTubePanel } from '../extensions/youtube/renderer/Panel';
import { DiscordPanel } from '../extensions/discord/renderer/Panel';

export interface ExtensionView {
  /** Extension ID matching the main-process extension registry (e.g. 'director-iracing') */
  extensionId: string;
  /** Human-readable label for sidebar tooltip */
  label: string;
  /** Lucide icon component for sidebar navigation */
  icon: LucideIcon;
  /** React component rendered as the full-page panel for this extension */
  component: ComponentType<any>;
}

/**
 * Registered extension views in display order.
 * To add a new extension view, append an entry here — no other routing
 * changes are needed in App.tsx.
 */
export const extensionViews: ExtensionView[] = [
  {
    extensionId: 'director-iracing',
    label: 'iRacing',
    icon: Car,
    component: IracingPanel,
  },
  {
    extensionId: 'director-obs',
    label: 'OBS',
    icon: Aperture,
    component: ObsPanel,
  },
  {
    extensionId: 'director-youtube',
    label: 'YouTube',
    icon: Play,
    component: YouTubePanel,
  },
  {
    extensionId: 'director-discord',
    label: 'Discord / Voice',
    icon: Mic,
    component: DiscordPanel,
  },
];

/** Look up an extension view by its extension ID. */
export function getExtensionView(extensionId: string): ExtensionView | undefined {
  return extensionViews.find((v) => v.extensionId === extensionId);
}
