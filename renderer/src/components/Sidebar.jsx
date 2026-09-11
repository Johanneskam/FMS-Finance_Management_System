import React from 'react';

const css = `
/* ---- sidebar container ---- */
.fms-sidebar {
  position: fixed;
  left: -320px;
  top: 0;
  width: 320px;
  height: 100vh;
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: left 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
  z-index: 1000;
  overflow-y: auto;
  box-shadow: 8px 0 30px rgba(0, 0, 0, 0.15);
  border-right: 1px solid rgba(6, 182, 212, 0.2);
  display: flex;
  flex-direction: column;
}
.fms-sidebar.open { left: 0; }

/* ---- header (logo + title side‑by‑side) ---- */
.fms-sidebar-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 20px;
  border-bottom: 1px solid rgba(6, 182, 212, 0.2);
}
.ent-sidebar-logo-img {
  width: 64px;
  height: 64px;
  object-fit: contain;
  flex-shrink: 0;
}
.ent-sidebar-title-group {
  display: flex;
  flex-direction: column;
  text-align: left;
}
.fms-sidebar-logo {
  font-size: 1.25rem;
  font-weight: 800;
  line-height: 1.2;
  background: linear-gradient(135deg, #06b6d4, #f59e0b);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.fms-sidebar-subtitle {
  color: #06b6d4;
  font-size: 0.75rem;
  font-weight: 500;
  margin-top: 2px;
}

/* ---- navigation ---- */
.fms-nav { padding: 12px 0; }

/* section label (kept from new version) */
.fms-nav-section-label {
  padding: 16px 24px 6px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ca3af;
}

.fms-nav-item { margin: 7px 18px; }  /* restored original margin */

/* ---- nav link — restored to original gradient style ---- */
.fms-nav-link {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  text-align: left;
  padding: 12px 18px;
  color: #1a202c;
  text-decoration: none;
  border: none;
  border-radius: 12px;
  font-weight: 500;
  font-size: 0.9rem;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
}
.fms-nav-link:hover,
.fms-nav-link.active {
  background: linear-gradient(135deg, #06b6d4, #f59e0b);
  color: #fff;
  transform: translateX(6px);
  box-shadow: 0 6px 16px rgba(6, 182, 212, 0.3);
}

/* ---- icon — restored original colors ---- */
.fms-nav-icon {
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #06b6d4;
  flex-shrink: 0;
}
.fms-nav-link.active .fms-nav-icon,
.fms-nav-link:hover .fms-nav-icon {
  color: #fff;
}

.fms-nav-text { flex: 1; }

/* badge — unchanged (gold gradient) */
.fms-nav-badge {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #1a202c;
  font-size: 0.68rem;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 700;
  min-width: 18px;
  text-align: center;
}

/* ---- overlay ---- */
.fms-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  z-index: 999;
  opacity: 0;
  visibility: hidden;
  transition: all 0.35s ease;
}
.fms-overlay.show {
  opacity: 1;
  visibility: visible;
}
`;

export default function Sidebar({
  title,
  subtitle,
  items,
  activeKey,
  onNavigate,
  open,
  onClose,
}) {
  return (
    <>
      <style>{css}</style>
      <nav className={`fms-sidebar ${open ? 'open' : ''}`}>
        <div className="fms-sidebar-header">
          <img
            className="ent-sidebar-logo-img"
            src="../assets/logo.png"
            alt="School logo"
          />
          <div className="ent-sidebar-title-group">
            <div className="fms-sidebar-logo">{title}</div>
            <div className="fms-sidebar-subtitle">{subtitle}</div>
          </div>
        </div>

        <div className="fms-nav">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <React.Fragment key={item.key}>
                {item.section && (
                  <div className="fms-nav-section-label">{item.section}</div>
                )}
                <div className="fms-nav-item">
                  <button
                    className={`fms-nav-link ${
                      activeKey === item.key ? 'active' : ''
                    }`}
                    onClick={() => onNavigate(item.key)}
                  >
                    <span className="fms-nav-icon">
                      <Icon size={18} />
                    </span>
                    <span className="fms-nav-text">{item.label}</span>
                    {item.badge && (
                      <span className="fms-nav-badge">{item.badge}</span>
                    )}
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </nav>
      <div
        className={`fms-overlay ${open ? 'show' : ''}`}
        onClick={onClose}
      />
    </>
  );
}