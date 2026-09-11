import { createPortal } from 'react-dom';

/**
 * Renders its children directly into document.body, bypassing whatever
 * DOM ancestor they'd otherwise be nested inside.
 *
 * Why this exists: .ent-card uses backdrop-filter (for the frosted-glass
 * look) and overflow: hidden. backdrop-filter — like transform and
 * filter — creates a new "containing block" for any position: fixed
 * descendant, per the CSS spec. A modal overlay nested inside a card
 * inherits that card as its positioning reference instead of the actual
 * viewport, so instead of covering the whole app, it only ever covers
 * that one card. Wrapping a modal in <Portal> sidesteps the problem
 * entirely by never nesting it inside the card's DOM subtree in the
 * first place.
 */
export default function Portal({ children }) {
  return createPortal(children, document.body);
}
