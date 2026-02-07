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
import { IracingDashboardCard } from '../extensions/iracing/renderer/DashboardCard';
import { ObsPanel } from '../extensions/obs/renderer/Panel';
import { ObsDashboardCard } from '../extensions/obs/renderer/DashboardCard';
import { YouTubePanel } from '../extensions/youtube/renderer/Panel';
import { YouTubeDashboardCard } from '../extensions/youtube/renderer/DashboardCard';
import { DiscordPanel } from '../extensions/discord/renderer/Panel';
import { DiscordDashboardCard } from '../extensions/discord/renderer/DashboardCard';

export interface ExtensionView {
  /** Extension ID matching the main-process extension registry (e.g. 'director-iracing') */
  extensionId: string;
  /** Human-readable label for sidebar tooltip */
  label: string;
  /** Lucide icon component for sidebar navigation */
  icon: LucideIcon;
  /** React component rendered as the full-page panel for this extension */
  component: ComponentType<any>;
  /** Optional dashboard widget card. Receives { onClick } prop for navigation. */
  widget?: ComponentType<{ onClick: () => void }>;
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
    widget: IracingDashboardCard,
  },
  {
    extensionId: 'director-obs',
    label: 'OBS',
    icon: Aperture,
    component: ObsPanel,
    widget: ObsDashboardCard,
  },
  {
    extensionId: 'director-youtube',
    label: 'YouTube',
    icon: Play,
    component: YouTubePanel,
    widget: YouTubeDashboardCard,
  },
  {
    extensionId: 'director-discord',
    label: 'Discord / Voice',
    icon: Mic,
    component: DiscordPanel,
    widget: DiscordDashboardCard,
  },
];

/** Look up an extension view by its extension ID. */
export function getExtensionView(extensionId: string): ExtensionView | undefined {
  return extensionViews.find((v) => v.extensionId === extensionId);
}
