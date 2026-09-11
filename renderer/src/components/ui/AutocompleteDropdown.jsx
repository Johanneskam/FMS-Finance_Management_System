import React, { useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown that visually sits right below a search input, but is
 * rendered into document.body rather than nested inside whatever card
 * contains the input.
 *
 * Why this exists: .ent-card uses overflow: hidden (for its rounded
 * corners/frosted-glass edges). A plain position: absolute dropdown
 * anchored inside that card gets clipped the moment it would extend
 * past the card's bottom edge — exactly the "search results hidden
 * under the card" symptom. Moving the dropdown into a portal escapes
 * the clipping, but then it's no longer near the input in the DOM, so
 * this component tracks the input wrapper's real on-screen position
 * (via getBoundingClientRect) and positions the portaled dropdown to
 * match, recalculating on scroll/resize so it stays correctly anchored.
 *
 * Usage: wrap the input in a ref'd container, pass that ref as
 * anchorRef, and put the dropdown's contents as children — same as
 * before, just swap the plain <div className="ent-autocomplete-list">
 * for <AutocompleteDropdown anchorRef={wrapRef}>.
 */
export default function AutocompleteDropdown({ anchorRef, children }) {
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    function updatePosition() {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef]);

  if (!coords) return null;

  return createPortal(
    <div
      className="ent-autocomplete-list"
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, right: 'auto', zIndex: 3000 }}
    >
      {children}
    </div>,
    document.body
  );
}