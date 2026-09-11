import React from 'react';

/**
 * A single circular progress ring with a percentage in the center.
 * Pure SVG (no chart library needed for something this simple).
 *
 * Usage: <DonutRing percent={75} label="Electronics" color="#06b6d4" />
 */
export default function DonutRing({ percent, label, size = 120, stroke = 10, color = '#0e7490' }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--c-border-soft)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text
          x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          fontSize={size * 0.18} fontWeight="800" fill="var(--c-ink)"
        >
          {percent}%
        </text>
      </svg>
      {label && <div className="ent-donut-label">{label}</div>}
    </div>
  );
}