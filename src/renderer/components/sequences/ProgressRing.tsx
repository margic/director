/**
 * ProgressRing — Shared SVG progress ring component.
 *
 * Renders a circular progress indicator using stroke-dasharray/offset.
 * Reusable across dashboard widget, execution header, and future overlay templates.
 *
 * Decision Q4: Shared component used in multiple contexts.
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.3
 */

import React from 'react';

export interface ProgressRingProps {
  /** Progress value 0–100 */
  progress: number;
  /** Outer diameter in pixels (default 48) */
  size?: number;
  /** Ring thickness in pixels (default 4) */
  strokeWidth?: number;
  /** Center label — shows this string or falls back to percentage */
  label?: string;
  /** Override color class for the progress arc (default: primary / green when complete) */
  colorClass?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  progress,
  size = 48,
  strokeWidth = 4,
  label,
  colorClass,
}) => {
  const clamped = Math.max(0, Math.min(100, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const isComplete = clamped >= 100;

  // Determine stroke color
  let strokeColor: string;
  if (colorClass) {
    strokeColor = colorClass;
  } else if (isComplete) {
    strokeColor = 'stroke-green-500';
  } else {
    strokeColor = 'stroke-primary';
  }

  const displayText = label ?? `${Math.round(clamped)}%`;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 500ms ease' }}
        />
      </svg>
      {/* Center label */}
      <span className="absolute text-[10px] font-jetbrains font-bold text-foreground leading-none">
        {displayText}
      </span>
    </div>
  );
};
