import React from 'react';
import { X } from 'lucide-react';

const TONE_ICON = { default: '❓', danger: '⚠️', info: 'ℹ️', success: '✅' };

/**
 * One shared component covering Confirmation Dialog / Modal Dialog / Alert
 * Dialog — the same underlying pattern (centered card, title, body,
 * buttons), just varying in button count and tone. Popover and Action
 * Sheet are genuinely different UI patterns (anchored/non-modal, bottom-
 * sheet) — not built here, since nothing in the app currently needs them.
 *
 * Deliberately requires `title` and `confirmLabel` as real props rather
 * than defaulting to "Confirmation"/"Yes" — every call site has to name
 * the actual task and the actual action, which is what keeps this from
 * turning into the generic dialog pattern it's modeled against.
 *
 * Alert mode (single acknowledge button): omit `onCancel`.
 * Confirm mode (two buttons): provide both `onConfirm` and `onCancel`.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={showConfirm}
 *     tone="danger"
 *     title="Delete Student Record"
 *     message="This permanently removes Jane Doe's record and cannot be undone."
 *     confirmLabel="Delete Record"
 *     cancelLabel="Keep Record"
 *     onConfirm={handleDelete}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */
export default function ConfirmDialog({
  open, title, message, detailBlock, icon,
  confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel,
  tone = 'default', confirming = false
}) {
  if (!open) return null;
  const isAlert = !onCancel;
  const resolvedIcon = icon || TONE_ICON[tone] || TONE_ICON.default;

  return (
    <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={isAlert ? onConfirm : onCancel}>
      <div className="ent-modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="ent-modal-head">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.15rem' }}>{resolvedIcon}</span> {title}
          </h3>
          <button className="ent-modal-close" onClick={isAlert ? onConfirm : onCancel}><X size={18} /></button>
        </div>
        <div className="ent-modal-body">
          <p style={{ margin: '0 0 0.9rem', fontSize: '0.87rem', color: 'var(--c-ink-soft)', lineHeight: 1.5 }}>{message}</p>

          {detailBlock && (
            <div style={{
              background: 'var(--c-surface-flat)', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)',
              padding: '0.8rem 1rem', marginBottom: '1rem', fontSize: '0.83rem', color: 'var(--c-ink)', lineHeight: 1.6
            }}>
              {detailBlock}
            </div>
          )}

          <div className="ent-modal-footer">
            {!isAlert && (
              <button type="button" className="ent-btn ent-btn--secondary" onClick={onCancel} disabled={confirming}>
                {cancelLabel}
              </button>
            )}
            <button
              type="button"
              className={`ent-btn ${tone === 'danger' ? 'ent-btn--danger' : 'ent-btn--primary'}`}
              onClick={onConfirm}
              disabled={confirming}
            >
              {confirming ? 'Working...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
