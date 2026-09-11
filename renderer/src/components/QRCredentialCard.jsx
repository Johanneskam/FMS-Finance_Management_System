import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

const SCHOOL_NAME = {
  WENDY: 'Wendy Private School',
  KEILA: 'Keila Academy',
  Both: 'Wendy Private School & Keila Academy'
};

// Visible ID card — horizontal layout copied from the reference image
// (rounded card, colored border, QR on the left, plain stacked text on the
// right). Colors use this app's own teal/cyan brand instead of the
// reference's green, to stay consistent with the rest of the UI.
const CARD_W = 480;
const CARD_H = 220;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function QRCredentialCard({ username, password, role, section, firstName, lastName }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const schoolLabel = SCHOOL_NAME[section] || section || '';
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || username;

    async function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, CARD_W, CARD_H);

      // The QR's SCANNED CONTENT is the structured text (this is what a
      // phone shows after scanning) — not what's visibly printed on the card.
      const divider = '-'.repeat(25);
      const qrPayload = [
        schoolLabel,
        divider,
        divider,
        `username: ${username}`,
        `password: ${password}`,
        `role: ${role}`,
        divider,
        divider,
        '© 2025 J & L Technologies. All rights reserved',
        divider,
        divider
      ].join('\n');

      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 300,
        margin: 1,
        color: { dark: '#154a4a', light: '#ffffff' }
      });

      const qrImg = new Image();
      qrImg.onload = () => {
        if (cancelled) return;

        // card background + rounded border
        roundRect(ctx, 3, 3, CARD_W - 6, CARD_H - 6, 22);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0e7490';
        ctx.stroke();

        // QR on the left
        const qrSize = 150;
        const qrX = 34;
        const qrY = (CARD_H - qrSize) / 2;
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        // plain stacked text on the right — no labels, matching the
        // reference card's Name / Title / Company / ID style
        const textX = qrX + qrSize + 36;
        let ty = CARD_H / 2 - 34;

        ctx.textAlign = 'left';
        ctx.fillStyle = '#154a4a';
        ctx.font = 'bold 21px ui-sans-serif, Arial, sans-serif';
        ctx.fillText(displayName, textX, ty);
        ty += 30;

        ctx.fillStyle = '#374151';
        ctx.font = '16px ui-sans-serif, Arial, sans-serif';
        ctx.fillText(role, textX, ty);
        ty += 26;

        ctx.fillText(schoolLabel, textX, ty);
        ty += 26;

        ctx.fillStyle = '#6b7280';
        ctx.font = '14px ui-sans-serif, Arial, sans-serif';
        ctx.fillText(username, textX, ty);
      };
      qrImg.src = qrDataUrl;
    }

    draw();
    return () => { cancelled = true; };
  }, [username, password, role, section, firstName, lastName]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/jpeg', 0.95);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${username}-id-card.jpg`;
    a.click();
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', maxWidth: '440px', borderRadius: '1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
      />
      <button
        onClick={download}
        style={{
          marginTop: '1.1rem', padding: '0.6rem 1.3rem', borderRadius: '0.6rem', border: 'none',
          background: 'linear-gradient(135deg, #06b6d4, #0e7490)', color: '#fff',
          fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
        }}
      >
        Download as JPG
      </button>
    </div>
  );
}