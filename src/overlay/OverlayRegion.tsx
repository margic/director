/**
 * OverlayRegion — Container for a single named screen region.
 *
 * Positioned absolutely within the 1920×1080 canvas.
 * Renders overlays assigned to this region with enter/exit animations.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.4
 */

import React, { useEffect, useState } from 'react';
import { OverlaySlot } from './useOverlaySocket';
import { getTemplate } from './templates';

export interface OverlayRegionProps {
  region: string;
  overlays: OverlaySlot[];
}

/**
 * Wrapper around each overlay that handles enter/exit animation.
 * When `visible` goes false, we keep rendering with exit animation
 * and remove after animation completes.
 */
const AnimatedOverlay: React.FC<{ overlay: OverlaySlot }> = ({ overlay }) => {
  const [show, setShow] = useState(overlay.visible);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (overlay.visible) {
      setShow(true);
      setAnimating(true);
    } else if (show) {
      // Start exit animation
      setAnimating(true);
    }
  }, [overlay.visible, show]);

  const handleAnimationEnd = () => {
    setAnimating(false);
    if (!overlay.visible) {
      setShow(false);
    }
  };

  if (!show && !animating) return null;

  const Template = getTemplate(overlay.template);
  if (!Template) {
    console.warn(`[OverlayRegion] No template found for '${overlay.template}'`);
    return null;
  }

  return (
    <div
      className={overlay.visible ? 'overlay-enter' : 'overlay-exit'}
      onAnimationEnd={handleAnimationEnd}
    >
      <Template data={overlay.data ?? {}} />
    </div>
  );
};

export const OverlayRegion: React.FC<OverlayRegionProps> = ({ region, overlays }) => {
  // Only render overlays that are visible or were recently visible (animating out)
  if (overlays.length === 0) return null;

  return (
    <div className={`overlay-region overlay-region-${region}`}>
      {overlays.map((overlay) => (
        <AnimatedOverlay
          key={`${overlay.extensionId}.${overlay.id}`}
          overlay={overlay}
        />
      ))}
    </div>
  );
};
