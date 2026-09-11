import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useAuth } from '../context/AuthContext.jsx';

// Must match exactly what QRCredentialCard.jsx encodes as the QR's footer
// line. Any QR that doesn't contain this is rejected before credentials
// are even looked at — a basic authenticity check against random/foreign
// QR codes, not just "is this readable text."
const REQUIRED_FOOTER = '© 2025 J & L Technologies. All rights reserved';

export default function QRLoginPanel() {
  const { login, loading } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [qrError, setQrError] = useState('');
  const videoRef = useRef(null);
  const scanCanvasRef = useRef(null);
  const scanningRef = useRef(false);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!scanCanvasRef.current) scanCanvasRef.current = document.createElement('canvas');
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function decodeAndLogin(text) {
    setQrError('');
    if (!text || !text.includes(REQUIRED_FOOTER)) {
      setQrError('This QR code is not a valid FMS credential card.');
      return;
    }
    const usernameMatch = text.match(/^username:\s*(.+)$/m);
    const passwordMatch = text.match(/^password:\s*(.+)$/m);
    if (!usernameMatch || !passwordMatch) {
      setQrError('The footer matched, but no credentials could be read from this QR code.');
      return;
    }
    login(usernameMatch[1].trim(), passwordMatch[1].trim());
  }

  async function startCamera() {
    setQrError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      scanningRef.current = true;
      setScanning(true);
      requestAnimationFrame(scanLoop);
    } catch (err) {
      setQrError('Could not access the camera: ' + err.message);
    }
  }

  function stopCamera() {
    scanningRef.current = false;
    setScanning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function scanLoop() {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = scanCanvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        stopCamera();
        decodeAndLogin(code.data);
        return;
      }
    }
    requestAnimationFrame(scanLoop);
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file again later
    if (!file) return;
    setQrError('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = scanCanvasRef.current;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          decodeAndLogin(code.data);
        } else {
          setQrError('No QR code could be found in that image.');
        }
      };
      img.onerror = () => setQrError('Could not read that image file.');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="qr-login">
      {!scanning ? (
        <>
          <p className="qr-login-hint">Scan an FMS QR credential card, or upload a photo/screenshot of one.</p>
          <div className="qr-login-actions">
            <button type="button" className="ent-btn ent-btn--primary" style={{ width: '100%' }} onClick={startCamera} disabled={loading}>
              Scan with Camera
            </button>
            <label className="ent-btn ent-btn--secondary" style={{ width: '100%', cursor: 'pointer' }}>
              Upload QR Image
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={handleFileUpload}
                disabled={loading}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <video ref={videoRef} className="qr-video" muted playsInline />
          <button type="button" className="ent-btn ent-btn--danger" style={{ width: '100%', marginTop: '0.8rem' }} onClick={stopCamera}>Cancel Scan</button>
        </>
      )}

      {qrError && <div className="login-error" style={{ marginTop: '1rem' }}>{qrError}</div>}
      {loading && <div className="login-status" style={{ marginTop: '0.75rem' }}>Signing in...</div>}
    </div>
  );
}