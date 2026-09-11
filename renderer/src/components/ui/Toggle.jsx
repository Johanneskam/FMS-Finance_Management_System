import React from 'react';

/**
 * A real animated toggle switch (not a checkbox styled to look like one —
 * an actual <input type="checkbox"> underneath for accessibility/keyboard
 * support, visually replaced by theme.css's .ent-toggle-track).
 *
 * Usage:
 *   <Toggle checked={isActive} onChange={setIsActive} label="User is active" />
 */
export default function Toggle({ checked, onChange, label, disabled = false, id }) {
  return (
    <label className="ent-toggle-wrap" htmlFor={id}>
      <input
        type="checkbox"
        id={id}
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
      />
      <span className="ent-toggle-track" />
      {label ? <span className="ent-toggle-label">{label}</span> : null}
    </label>
  );
}