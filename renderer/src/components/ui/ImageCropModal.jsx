import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Check, X } from 'lucide-react';

const VIEWPORT = 280; // px, matches .ent-crop-viewport in theme.css

/**
 * A reusable "pick and crop an image" modal — not specific to avatars,
 * usable anywhere a cropped square image is needed.
 *
 * Usage:
 *   <ImageCropModal
 *     imageSrc={rawUploadedDataUrl}   // the untouched image the user picked
 *     open={showCropModal}
 *     onCancel={() => setShowCropModal(false)}
 *     onConfirm={(croppedDataUrl) => { ...use it...; setShowCropModal(false); }}
 *     outputSize={256}                 // optional, defaults to 256
 *     title="Adjust Your Photo"        // optional
 *   />
 *
 * The parent owns getting a raw image in (file input, drag-drop, etc.) —
 * this component only handles the position/zoom/crop/export step.
 */
export default function ImageCropModal({ imageSrc, open, onCancel, onConfirm, outputSize = 256, title = 'Adjust Your Photo' }) {
  const imgRef = useRef(null);
  const viewportRef = useRef(null);

  const [naturalSize, setNaturalSize] = useState(null); // { w, h }
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1); // multiplier on top of baseScale, 1..3
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef(null); // { startX, startY, startOffsetX, startOffsetY }

  // Reset to a fresh centered/fitted state whenever a new image comes in.
  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNaturalSize(null);
  }, [imageSrc, open]);

  function handleImageLoad(e) {
    setDimensions(e.target.naturalWidth, e.target.naturalHeight);
  }

  function setDimensions(w, h) {
    setNaturalSize({ w, h });
    setBaseScale(Math.max(VIEWPORT / w, VIEWPORT / h));
  }

  // Fallback for the case where the browser already had this image decoded
  // (e.g. re-opening the modal with the same imageSrc) — onLoad doesn't
  // reliably refire for an already-complete image once a ref attaches to
  // it, so check directly rather than relying on the event alone.
  useEffect(() => {
    if (open && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0 && !naturalSize) {
      setDimensions(imgRef.current.naturalWidth, imgRef.current.naturalHeight);
    }
  }, [open, imageSrc, naturalSize]);

  const effectiveScale = baseScale * zoom;

  function clampOffset(rawOffset, scale) {
    if (!naturalSize) return { x: 0, y: 0 };
    const displayedW = naturalSize.w * scale;
    const displayedH = naturalSize.h * scale;
    const maxX = Math.max(0, (displayedW - VIEWPORT) / 2);
    const maxY = Math.max(0, (displayedH - VIEWPORT) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, rawOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, rawOffset.y))
    };
  }

  // Re-clamp whenever zoom changes, so zooming out never leaves a gap.
  useEffect(() => {
    setOffset((prev) => clampOffset(prev, effectiveScale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, naturalSize]);

  const handlePointerDown = useCallback((e) => {
    const point = e.touches ? e.touches[0] : e;
    dragState.current = { startX: point.clientX, startY: point.clientY, startOffsetX: offset.x, startOffsetY: offset.y };
  }, [offset]);

  const handlePointerMove = useCallback((e) => {
    if (!dragState.current) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragState.current.startX;
    const dy = point.clientY - dragState.current.startY;
    const next = { x: dragState.current.startOffsetX + dx, y: dragState.current.startOffsetY + dy };
    setOffset(clampOffset(next, effectiveScale));
  }, [effectiveScale, naturalSize]);

  const handlePointerUp = useCallback(() => { dragState.current = null; }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [open, handlePointerMove, handlePointerUp]);

  function handleConfirm() {
    if (!naturalSize) return;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');

    // Same transform as the on-screen viewport, just scaled up (or down)
    // from VIEWPORT px to outputSize px so the exported crop matches
    // exactly what was visible on screen.
    const canvasScale = outputSize / VIEWPORT;
    const drawScale = effectiveScale * canvasScale;
    const drawW = naturalSize.w * drawScale;
    const drawH = naturalSize.h * drawScale;
    const drawX = (outputSize / 2 - drawW / 2) + offset.x * canvasScale;
    const drawY = (outputSize / 2 - drawH / 2) + offset.y * canvasScale;

    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    onConfirm(dataUrl);
  }

  if (!open) return null;

  return (
    <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={onCancel}>
      <div className="ent-modal" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
        <div className="ent-modal-head">
          <h3>{title}</h3>
          <button className="ent-modal-close" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="ent-modal-body">
          <div
            ref={viewportRef}
            className="ent-crop-viewport"
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
          >
            {imageSrc && (
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                onLoad={handleImageLoad}
                style={{
                  opacity: naturalSize ? 1 : 0,
                  width: naturalSize ? naturalSize.w * effectiveScale : undefined,
                  height: naturalSize ? naturalSize.h * effectiveScale : undefined,
                  transform: naturalSize
                    ? `translate(${VIEWPORT / 2 - (naturalSize.w * effectiveScale) / 2 + offset.x}px, ${VIEWPORT / 2 - (naturalSize.h * effectiveScale) / 2 + offset.y}px)`
                    : undefined
                }}
                draggable={false}
              />
            )}
          </div>

          <div className="ent-crop-controls">
            <ZoomOut size={16} color="var(--c-faint)" />
            <input
              type="range" className="ent-crop-slider"
              min="1" max="3" step="0.01"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <ZoomIn size={16} color="var(--c-faint)" />
          </div>
          <p className="ent-crop-hint">Drag to reposition, use the slider to zoom.</p>

          <div className="ent-modal-footer">
            <button type="button" className="ent-btn ent-btn--secondary" onClick={onCancel}>Cancel</button>
            <button type="button" className="ent-btn ent-btn--primary" onClick={handleConfirm} disabled={!naturalSize}>
              <Check size={15} /> Proceed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
