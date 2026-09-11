# Fee Management System (FMS)

A local-first, offline-first desktop application for managing student fee collection across two schools — **Wendy Private School** (K–12) and **Keila Academy** (subject/package-based tutorial college) — sharing one CEO and some shared operations (bus, hostel).

Built with **Electron + React + RxDB**, syncing peer-to-peer across three physical stations via **Firebase Firestore** whenever a connection is available. The app is fully functional offline — login, data entry, and the entire fee ledger work with zero internet connection; sync is a background convenience, never a requirement.

> This README documents the actual current state of the project as of the last build in this conversation. Several sections (Process Payment, Reports & Analytics, All Payments, CEO-side reporting) are intentionally not yet built — see [Known Gaps & Roadmap](#known-gaps--roadmap) for an honest accounting of what's real versus what's still ahead.

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Core Architecture Decisions](#core-architecture-decisions)
3. [Roles](#roles)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [File-by-File Reference](#file-by-file-reference)
7. [The Ledger Engine — How the Money Math Works](#the-ledger-engine--how-the-money-math-works)
8. [Getting Started](#getting-started)
9. [Default Accounts](#default-accounts)
10. [Build & Distribution](#build--distribution)
11. [Known Gaps & Roadmap](#known-gaps--roadmap)

---

## What This Is

Two schools — Wendy Private School (grade-based K–12) and Keila Academy (subject/package-based tutorial college) — are run by the same CEO and share some operational costs (bus, hostel). Each school has its own on-site Secretary who captures fee payments at a dedicated station. The CEO and a technical Superadmin (the developer) need visibility across both schools from any station.

Because school offices don't have reliable internet, the app had to work **fully offline first**: local login, local data entry, local business logic — with cloud sync as an enhancement, not a dependency. Firebase Firestore acts purely as a relay so the three stations' local databases stay in agreement when they do have a connection.

## Core Architecture Decisions

**1. The ledger is append-only, by design — not just convention.**
A fee expectation's remaining balance is never stored as a mutable field. It's *derived* every time it's read, from the sum of `allocations` recorded against it. Every ledger collection (`fee_expectations`, `payments`, `allocations`, `admin_adjustments`, `adjustment_allocations`) is insert-only — nothing is ever edited or deleted. This is what makes multi-station sync trivial and correct *by construction*: two offline stations can both write records and merge with zero conflicts, the same way real double-entry accounting ledgers work. Only reference/catalog data (`users`, `students`, `guardians`, `classes`, `fee_catalog_templates`) is mutable, and only that data needs last-write-wins conflict resolution.

**2. Cashless enforcement is a hard rule, not a UI suggestion.**
`capturePayment()` in `db.js` rejects any `paymentMethod` other than `'EFT'` or `'POS'` at the data layer — not just hidden from a dropdown. No cash, ever, matching the Master Spec's Cashless Enforcement requirement.

**3. Every write is attributable to a station, and increasingly to a person.**
Records carry a `stationId` (derived from the machine's hostname) so sync conflict resolution has a deterministic tiebreaker. Where it matters for real accountability (who registered this student, who processed this payment), a `registeredBy`/`processedBy` username is also stored — not just the station.

**4. Auto-generated IDs never depend on central coordination.**
Student numbers, temporary passwords, and record IDs are all generated locally (UUID or `stationId + timestamp + random`) specifically because two stations could be creating records at the same offline moment with no way to ask each other "what's the next number."

**5. One shared design system, not per-page CSS.**
`renderer/styles/theme.css` is loaded once, globally, via `index.html`. Every card, button, badge, table, toggle, and modal across the whole app reads from this one file. Component files should only ever contain layout and genuinely one-off styling — anything reusable belongs in `theme.css`, not copy-pasted into another component.

## Roles

| Role | Who | Scope |
|---|---|---|
| **Superadmin** | You, the developer | Full system access — user management (all roles), system/sync visibility. Not tied to one school (`section: 'Both'`). |
| **Admin** | The CEO | Business/financial oversight across both schools. Can manage Secretary accounts only (not other Admins or Superadmin). |
| **Secretary** | One per school | Scoped to their own school (`WENDY` or `KEILA`). Handles day-to-day data entry: payments, student registration, financial communication. |

Permission checks for user management live in `db.js` (the Electron **main process**), not just the UI — a renderer-only check is trivially bypassed via DevTools, so the actual enforcement happens in the trusted layer.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron 22.3.27 | Matches the Node 16 pin needed for the dev machine |
| UI | React 18.2.0 (no router — role-based conditional rendering) | Simple enough app that a router added complexity without benefit |
| Local DB | RxDB 14.17.1 + LokiJS storage | RxDB's real SQLite storage is a paid plugin; LokiJS is free, pure-JS, zero native compilation |
| Cloud sync | Firebase Firestore 10.7.1 (`firestore/lite`, REST-based) | Built for offline-first apps; avoids native gRPC networking quirks |
| Bundler | esbuild 0.17.19 | Fast, simple, no config sprawl for a project this size |
| Icons | lucide-react 0.383.0 | Offline-safe (bundled), not a CDN dependency |
| Charts | recharts 2.10.3 | Line charts (collection trends) |
| PDF generation | jsPDF 2.5.1 | Arrears letters, entirely client-side |
| QR codes | qrcode 1.5.3 (generate) + jsqr 1.4.0 (decode/scan) | QR login credential cards, both directions |

## Project Structure

```
fms-desktop/
├── main.js                        Electron main process — window lifecycle, all IPC handlers
├── preload.js                     contextBridge — the only API surface the renderer can see
├── package.json                   Dependencies, build scripts, electron-builder config
│
├── assets/
│   ├── logo.png                   School crest (Wendy Private School)
│   ├── icon.ico                   Windows app icon (multi-resolution)
│   └── icon.png                   App icon, PNG fallback
│
├── splash/
│   ├── splash.html                SVG-based splash screen (pixel-traced from reference art)
│   └── splash-preload.js          Bridges real DB-init progress into the splash UI
│
├── tools/
│   └── dump-db.js                 Standalone debug script — dumps the local LokiJS DB to readable JSON
│
├── db/
│   ├── db.js                      RxDB init + EVERY business-logic function (auth, ledger, users, students...)
│   ├── ledger-engine.js           Pure math only — no I/O. The allocation engine, financial health, etc.
│   ├── preferences.js             Tiny local file for device prefs (currently: remembered username)
│   ├── sync-firebase.js           Active sync engine — Firestore push/pull every 5 minutes
│   ├── sync.js                    Legacy OneDrive-folder sync — kept for reference, not wired up
│   ├── firebase-config.js         Firebase project credentials
│   └── schemas/
│       └── ledger.js              All RxDB collection schemas (students, payments, allocations, etc.)
│
└── renderer/
    ├── index.html                 HTML shell — loads theme.css and the bundled React app
    ├── dist/                      esbuild output (bundle.js) — rebuilt on every `npm start`
    ├── styles/
    │   └── theme.css              THE shared design system — every page reads from this one file
    └── src/
        ├── main.jsx                React entry point (ReactDOM.render)
        ├── App.jsx                 Root component — auth gate, then role-based dashboard routing
        ├── context/
        │   └── AuthContext.jsx     Login/logout, current user state, session chime triggers
        ├── utils/
        │   └── sound.js            Web Audio API chime synthesizer (no audio files)
        └── components/
            ├── LoginScreen.jsx             Split-card login (credentials tab + QR tab)
            ├── QRLoginPanel.jsx            Camera scan + JPG upload QR login logic
            ├── QRCredentialCard.jsx        Canvas-rendered printable QR ID card
            ├── Sidebar.jsx                 Shared nav sidebar (role-specific item lists passed in as props)
            ├── SuperadminDashboard.jsx     Superadmin/Admin dashboard shell + KPI overview
            ├── SecretaryDashboard.jsx      Secretary dashboard shell + KPI overview
            ├── UserManagement.jsx          Create/edit/deactivate users, reset passwords, QR credential cards
            ├── StudentRegistration.jsx     Register students + guardians (new or existing)
            ├── FinancialCommunication.jsx  Top debtors/payers lists + PDF arrears letter generator
            ├── SyncPanel.jsx               Manual "Sync Now" + connection status (Settings page)
            └── ui/
                ├── Toggle.jsx               Real animated toggle switch (not a styled checkbox)
                ├── Pagination.jsx           Reusable page-number pagination control
                └── DonutRing.jsx            SVG circular progress ring
```

## File-by-File Reference

### Root

- **`main.js`** — The Electron main process. Owns the window lifecycle (splash → real DB init → main window), and is the *only* place IPC handlers live. Every `electronAPI.xxx()` call from the renderer terminates in an `ipcMain.handle(...)` here, which calls into `db.js`. Also configures the camera permission handler (needed for QR login) and the userData directory.
- **`preload.js`** — Runs in an isolated bridge context. Defines the *entire* `window.electronAPI` surface the renderer is allowed to touch. If a function isn't listed here, the renderer cannot call it — this is the security boundary between untrusted UI code and the trusted main process.
- **`package.json`** — Pinned to Node 16.20.2 (matches the target dev machine). `build.files` controls exactly what electron-builder packages into the installer.

### `db/` — everything data and business-logic related

- **`db.js`** (the biggest file in the project) — Initializes RxDB with the LokiJS storage adapter, seeds default accounts and the fee catalog on first run, and exports every business-logic function: authentication (`verifyLogin`, password hashing), user management (`listUsers`/`createUser`/`updateUser`/`resetUserPassword` — all with server-side permission checks), the full ledger orchestration (`createStudent`, `createFeeExpectation`, `capturePayment`, `applyAdminAdjustment`, `getStudentLedger`), and dashboard aggregations (`getSecretaryDashboardData`, `getTopListsData`, `getArrearsLetterData`).
- **`ledger-engine.js`** — Deliberately pure (no RxDB, no I/O) so it's testable in isolation. Implements every formula from the Master Spec's Section 2: `computeRollingBalance`, `computeExpectationRemaining`, `computeFinancialHealth` (the 5-state Overpaid/Good/OK/Debtors/Chronic Debtors categorization), `allocatePaymentAutoFIFO` (the Priority-Tiered Allocation Engine), `allocatePaymentDirected` (manual split mode), and `allocateAdjustment` (category-constrained waiver sweeps).
- **`schemas/ledger.js`** — Every RxDB collection schema. Mutable collections (`students`, `guardians`, `classes`, `fee_catalog_templates`) carry `updatedAt`/`updatedBy` for conflict resolution; append-only collections (`fee_expectations`, `payments`, `allocations`, `admin_adjustments`, `adjustment_allocations`) carry only `createdAt`/`createdBy` since they're never edited.
- **`sync-firebase.js`** — The active sync engine. Runs 15 seconds after startup, then every 5 minutes. Pushes local changes newer than the last sync, pulls remote changes, and — for mutable collections only — resolves conflicts by last-write-wins (tiebreak: `stationId` alphabetically), preserving the losing version in `conflict_log` rather than discarding it.
- **`sync.js`** — An earlier OneDrive-folder-based sync approach, superseded by Firebase. Left in the codebase for reference/fallback but not wired into `main.js`.
- **`preferences.js`** — A tiny local JSON file (separate from the RxDB ledger, since it's machine-local UI convenience, not synced business data) currently used for "Remember Me" — stores only the last username, deliberately never a password or session token.
- **`firebase-config.js`** — Firebase project credentials (`finance-management-system-wps`).

### `renderer/` — the React UI

- **`styles/theme.css`** — The single shared stylesheet. Contains CSS custom properties (colors, spacing, radii, shadows) and every reusable component class (`.ent-card`, `.ent-btn`, `.ent-table`, `.ent-toggle-*`, `.ent-badge`, etc.), plus a set of `.mp-*` classes specific to the Secretary dashboard's current visual treatment. Loaded once in `index.html`; no component should be redeclaring its own card/button CSS.
- **`App.jsx`** — After login, branches purely on role: Superadmin/Admin get `SuperadminDashboard`, everyone else gets `SecretaryDashboard`.
- **`context/AuthContext.jsx`** — Wraps `electronAPI.login()`, holds the current user in state, and triggers the login-success chime.

#### Components

| File | What it actually does |
|---|---|
| `LoginScreen.jsx` | Split-card layout (logo panel + form panel). Two tabs: Credentials and QR. Remembers the last username if "Remember Me" was checked. |
| `QRLoginPanel.jsx` | Live camera scanning (via `jsQR`) or JPG file upload. Verifies the decoded QR contains the exact required footer text *before* attempting to extract credentials — rejects anything that isn't a genuine FMS credential card, rather than trying to parse arbitrary QR content. |
| `QRCredentialCard.jsx` | Canvas-drawn (not DOM/CSS) printable ID card: QR code + school name + plain identity text, styled to match a physical ID card reference. The QR itself encodes username/password/role as scannable plain text; the *visible* card face deliberately omits the password. |
| `Sidebar.jsx` | One reusable sidebar for both dashboards. Takes `items` (with optional `section` labels for MENU/GENERAL grouping), `activeKey`, and `onNavigate` as props — all role-specific nav content lives in the parent dashboard, not here. |
| `SuperadminDashboard.jsx` | Shell (sidebar + header) plus the Superadmin/Admin home view: KPI row, a "Collection Overview" card, recent-activity feed, and routes to `UserManagement` when that nav item is active. Several nav items (Reports, Audit Logs, etc.) still show an honest "not built yet" placeholder. |
| `SecretaryDashboard.jsx` | Shell plus the Secretary home view, all built on **real data** from `getSecretaryDashboardData()`: today's/monthly collection, a genuine month-progress bar (day X of Y), a Collection Trend + Outcome Statistics card computing real percentages (month progress, today's share of the month, pace vs. last month — none of it fabricated), Quick Actions, and a High-Alert (top debtors) table. Routes to `StudentRegistration` and `FinancialCommunication` when those nav items are active. |
| `UserManagement.jsx` | Full CRUD for users: stat cards, role distribution, a searchable/sortable/paginated table, create/edit modals, password reset, CSV export, and QR credential card generation per user. Permission-gated so an Admin only ever sees/touches Secretary accounts. |
| `StudentRegistration.jsx` | Registration form (student demographics, bus/hostel toggles, guardian — existing search or create-new) plus a live table of already-registered students. Auto-generates collision-safe student numbers without any central counter. |
| `FinancialCommunication.jsx` | Two tabs: **Top Lists** (real top-10 debtors and top-10 overpayers, computed via the same `ledger-engine.js` used everywhere else) and **Generate Fee Letter** (student search → real outstanding-fee breakdown → downloadable PDF arrears letter via jsPDF). |
| `SyncPanel.jsx` | Shows current Firebase connection status and a manual "Sync Now" button, for the Settings page. |
| `ui/Toggle.jsx` | A real `<input type="checkbox">` under the hood (so it's keyboard/screen-reader accessible for free), styled as an animated switch via `theme.css`. |
| `ui/Pagination.jsx` | Purely presentational page-number control; the parent component owns the actual array slicing. |
| `ui/DonutRing.jsx` | Plain SVG circular progress ring — no charting library needed for something this simple. |

## The Ledger Engine — How the Money Math Works

This is the part of the app the Master Spec cares most about, so it's worth explaining directly rather than just pointing at file names.

**A fee expectation's balance is never stored — it's always derived.** When a `fee_expectations` record is created (e.g. "January Tuition, N$780, due Jan 5"), that record never changes again. What *does* get recorded, separately, are `allocations` — immutable "N$500 of payment #123 went toward expectation #456" facts. The remaining balance on any expectation is just `originalAmount` minus the sum of every allocation against it, computed fresh every time it's asked for.

**Payments are allocated tier-by-tier.** `fee_catalog_templates` assign every fee type a Priority Tier (1 = Tuition, 2 = Bus/Hostel, 3 = Ad-hoc like uniforms, 4 = Fines). When a payment comes in, `allocatePaymentAutoFIFO()` sweeps through the student's outstanding expectations tier 1 first, then 2, then 3, then 4 — chronologically within each tier — so a partial payment always protects core tuition revenue before touching a library fine.

**Financial health is a real 5-state classification**, not a guess: `Overpaid` (balance < 0), `Good` (balance = 0), `OK` (outstanding, but under 30 days), `Debtors` (30–90 days), `Chronic Debtors` (90+ days) — driven by the oldest unpaid expectation's due date, computed the same way everywhere it's displayed (dashboards, top lists, arrears letters).

**Admin adjustments (waivers/discounts/write-offs) are category-constrained.** A "Tuition Waiver" can only ever sweep against Tuition-category expectations — it's structurally impossible for a waiver targeted at one fee category to leak into another.

## Getting Started

```cmd
npm install
npm start
```

`npm start` runs `build:renderer` (esbuild bundles the React app into `renderer/dist/bundle.js`) and then launches Electron. There is no separate dev server — the bundle is rebuilt fresh on every start.

First launch will:
1. Create the local database at `%APPDATA%\Fee Management System\fms-data`
2. Seed the fee catalog (24 starting templates — bus/hostel marked `SHARED` between schools, WENDY-specific extracurriculars/fines, KEILA subject fees)
3. Seed the four default accounts below

If you change any RxDB schema, the dev-mode auto-recovery will detect the mismatch and wipe+recreate the local database automatically (safe in development; would need a real migration path before this ships with actual student data in it).

## Default Accounts

Seeded identically — deterministically, not randomly — on every station's first launch, so all four accounts work on all three machines from day one with no dependency on sync having run.

| Username | Password | Role | Section |
|---|---|---|---|
| `admin` | `password123` | Superadmin | Both |
| `ceo` | `ChangeMe2026!` | Admin | Both |
| `secretary_wendy` | `ChangeMe2026!` | Secretary | WENDY |
| `secretary_keila` | `ChangeMe2026!` | Secretary | KEILA |

These are development defaults — change them via User Management before any real deployment.

## Build & Distribution

```cmd
npm run build:win
```

Produces a Windows installer via `electron-builder` (NSIS target), using `assets/icon.ico` for the installer/taskbar icon.

## Known Gaps & Roadmap

Being direct about what's real versus what isn't, rather than letting a polished UI imply more than what's built:

**Not yet built:**
- **Process Payment** — the actual cart-billing/payment-capture screen. The *engine* behind it (`capturePayment()`) is fully built and tested; there's no UI screen calling it yet.
- **Reports & Analytics**, **All Payments**, **Audit Logs**, **Classes & Sections** — placeholder screens.
- **Fee Expectations aren't generated automatically** — nothing currently creates "next month's tuition is due" records on a schedule; that needs a recurring job.
- **No payment receipts** (the arrears letter generator exists; a receipt-for-a-captured-payment does not).

**Security/production-readiness gaps**, worth addressing before real student and payment data goes in:
- Firestore security rules are currently permissive (any authenticated request can read/write) — fine for early testing, not for production.
- No encryption at rest for the local database file.
- No automated test suite — everything has been verified via one-off manual test scripts during development, not a regression-protected suite.
- No real schema migration path — currently relies on dev-mode wipe-and-recreate, which is only safe because there's no real data yet.
