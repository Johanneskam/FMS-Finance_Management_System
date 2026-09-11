# Fee Management System (FMS)

**A local-first, offline-first desktop financial ledger for schools — built to handle real money, real corrections, and two structurally different institutions on one shared engine.**

Two schools — **The Private School** (K–12, grade-and-class based, term-driven billing) and **The Academy** (tertiary, course-and-subject based, enrollment-driven billing) — share one CEO and some shared operations (bus, hostel). Each has its own on-site Secretary capturing payments at a dedicated station. Because school offices don't have reliable internet, the app had to work **fully offline first** — local login, local data entry, local business logic — with cloud sync as an enhancement, never a dependency.

Built with **Electron + React + RxDB**, syncing peer-to-peer across three physical stations via **Firebase Firestore** whenever a connection is available.

> This README documents the actual current state of the project. Several sections (Process Payment UI, Reports & Analytics, All Payments, CEO-side reporting) are intentionally not yet built — see [Known Gaps & Roadmap](#known-gaps--roadmap) for an honest accounting of what's real versus what's still ahead.

---

## Table of Contents

1. [Screenshots](#screenshots)
2. [What This Is](#what-this-is)
3. [Core Architecture Decisions](#core-architecture-decisions)
4. [Core Features](#core-features)
5. [Roles](#roles)
6. [Tech Stack](#tech-stack)
7. [Project Structure](#project-structure)
8. [File-by-File Reference](#file-by-file-reference)
9. [The Ledger Engine — How the Money Math Works](#the-ledger-engine--how-the-money-math-works)
10. [Backup Architecture](#backup-architecture)
11. [Engineering Notes — What Testing Actually Caught](#engineering-notes--what-testing-actually-caught)
12. [Security-Conscious by Default](#security-conscious-by-default)
13. [Getting Started](#getting-started)
14. [Default Accounts](#default-accounts)
15. [Build & Distribution](#build--distribution)
16. [Known Gaps & Roadmap](#known-gaps--roadmap)
17. [A Note for Anyone Reviewing This as a Portfolio Piece](#a-note-for-anyone-reviewing-this-as-a-portfolio-piece)
18. [Advice for Whoever Picks This Up Next](#advice-for-whoever-picks-this-up-next)

---

## Screenshots

> *Add screenshots here — a few suggestions that show range well: the secretary payment screen, the waiver/discount flow, the Full Financial Report with its charts, and one PDF export (the Student Ledger Statement or the Yearly Report work well).*

<p align="center">
  <img src="/assets/immmmg/setup.PNG" width="800" alt="Dashboard" />
</p>

<p align="center">
  <img src="/assets/immmmg/login.PNG" width="400" alt="Login" />
  <img src="/assets/immmmg/dashboard.PNG" width="400" alt="Secretary dashboard" />
  <img src="/assets/immmmg/adminportalsidebar.PNG" width="400" alt="Admin portal" />
  <img src="/assets/immmmg/usermanagementqr.PNG" width="400" alt="User management + QR credentials" />
  <img src="/assets/immmmg/studentledger.PNG" width="400" alt="Student ledger" />
  <img src="/assets/immmmg/backups.PNG" width="400" alt="Backups panel" />
</p>

---

## What This Is

Most fee-management tutorials handle one school with one fee structure. This one doesn't have that luxury: it runs **two real institutions with genuinely different data models** on a single codebase —

- **The Private School** — K–12, grade-and-class based, term-driven billing
- **The Academy** — tertiary, course-and-subject based, enrollment-driven billing

Both share the same underlying ledger, the same correction and audit system, and the same reporting engine — which meant the financial logic had to be genuinely general, not hardcoded to one school's assumptions. Getting that right, and then proving it was right with real test data on both sides, is most of what this project is actually about.

The CEO and a technical Superadmin (the developer) need visibility across both schools from any station. Firebase Firestore acts purely as a relay so the three stations' local databases stay in agreement when they do have a connection — never as a dependency.

---

## Core Architecture Decisions

**1. The ledger is append-only, by design — not just convention.**
A fee expectation's remaining balance is never stored as a mutable field. It's *derived* every time it's read, from the sum of `allocations` recorded against it. Every ledger collection (`fee_expectations`, `payments`, `allocations`, `admin_adjustments`, `adjustment_allocations`) is insert-only — nothing is ever edited or deleted. This is what makes multi-station sync trivial and correct *by construction*: two offline stations can both write records and merge with zero conflicts, the same way real double-entry accounting ledgers work. Only reference/catalog data (`users`, `students`, `guardians`, `classes`, `fee_catalog_templates`) is mutable, and only that data needs last-write-wins conflict resolution.

**2. One ledger engine, two schools.**
All financial logic — balance calculation, FIFO allocation, adjustment sweeps, correction handling, financial-health categorization — lives in a single `ledger-engine.js`, made of **pure functions with no database dependency**. It's unit-testable in isolation, reusable by reporting without touching the data layer, and parameterized by data rather than by school. The UI layers (grades vs. courses) sit on top of an identical financial core underneath.

**3. Cashless enforcement is a hard rule, not a UI suggestion.**
`capturePayment()` in `db.js` rejects any `paymentMethod` other than `'EFT'` or `'POS'` at the data layer — not just hidden from a dropdown. No cash, ever, matching the Master Spec's Cashless Enforcement requirement.

**4. Every write is attributable to a station, and increasingly to a person.**
Records carry a `stationId` (derived from the machine's hostname) so sync conflict resolution has a deterministic tiebreaker. Where it matters for real accountability (who registered this student, who processed this payment), a `registeredBy`/`processedBy` username is also stored — not just the station.

**5. Auto-generated IDs never depend on central coordination.**
Student numbers, temporary passwords, and record IDs are all generated locally (UUID or `stationId + timestamp + random`) specifically because two stations could be creating records at the same offline moment with no way to ask each other "what's the next number."

**6. Corrections are structural, not cosmetic.**
A correction doesn't create a competing entry that a secretary or parent has to mentally reconcile — it adjusts the original transaction's effective amount everywhere downstream, while the *fact* of the correction (who, when, why, how much) is preserved separately for audit purposes. A correction row links back to the specific original payment it fixes, so "what corrections has this payment had" is a direct lookup, not reverse-engineered from reason text.

**7. Priority-tiered allocation that actually holds.**
Payments distribute FIFO within priority tier (1 → 4), chronologically within each tier, only against charges already due. Surplus sweeps into the next tier before ever touching a later month — tier always outranks month. Waivers and discounts use a category-constrained sweep: a Tuition Waiver can only satisfy Tuition expectations, never leak into boarding or uniforms. Every one of these behaviors is enforced by the engine, not by UI convention.

**8. Timezone correctness is enforced deliberately, not assumed.**
Every "what month/day is this" calculation goes through a shared local-date helper rather than JavaScript's `toISOString()`, which silently converts to UTC and can shift a date into the wrong day (or month) for any timezone ahead of UTC — including the one this system runs in.

**9. One shared design system, not per-page CSS.**
`renderer/styles/theme.css` is loaded once, globally, via `index.html`. Every card, button, badge, table, toggle, and modal across the whole app reads from this one file. Component files should only ever contain layout and genuinely one-off styling — anything reusable belongs in `theme.css`, not copy-pasted into another component.

**10. Permission checks live in the trusted layer.**
User-management and financial-action permission checks run in `db.js` (the Electron **main process**), not just the UI — a renderer-only check is trivially bypassed via DevTools.

---

## Core Features

**Enrollment & records**
- Full registration wizards for both school types, with school-appropriate validation (e.g. adult students at The require their own national ID; minors don't)
- Grade/class management for The; course, subject, and enrollment management for The
- Collision-safe student numbers, generated locally without any central counter

**Money, handled carefully**
- Payment capture with automatic FIFO allocation across outstanding fees, by priority tier
- Payment corrections that flow through invisibly — a corrected amount replaces the original everywhere it's shown, never displayed as a confusing separate line, while still logged in full in the audit trail
- Waivers, discounts, and write-offs, with a real allocation engine (not just a record with no effect)
- Prepayment / "paying ahead" handling that correctly sweeps future credit against bills as they're generated
- Installment plans and bulk-billing with duplicate detection

**Reporting, built for actual finance-office use**
- A consolidated Full Financial Report: school comparison, fee-category and grade breakdowns, transaction history, and audit trail in one document, with a calendar picker to choose any month, year, or day before generating
- Dedicated Daily Transactions and Monthly-by-Week reports for granular, transparent oversight
- Every PDF report reflects corrected amounts automatically — what you see is what was actually paid, not what was first (possibly wrongly) entered
- Excel and PDF export throughout, with charts drawn natively (no fragile screenshot capture)

**Trust & accountability**
- A full audit trail: every payment, correction, waiver, and discount, timestamped and attributed to the person who did it
- Parent-facing statements and formal fee letters, kept intentionally separate from internal audit-style ledgers

**Identity & access**
- Split-card login (credentials tab + QR tab) — QR credential cards are Canvas-drawn, printable, and verified against the required footer text before any credentials are extracted
- Remembered username (never password) as a device-local convenience
- Three roles (Superadmin, Admin, Secretary) with server-side permission enforcement

---

## Roles

| Role | Who | Scope |
|---|---|---|
| **Superadmin** | The developer | Full system access — user management (all roles), system/sync visibility. Not tied to one school (`section: 'Both'`). |
| **Admin** | The CEO | Business/financial oversight across both schools. Can manage Secretary accounts only (not other Admins or Superadmin). |
| **Secretary** | One per school | Scoped to their own school (`The` or `The`). Handles day-to-day data entry: payments, student registration, financial communication. |

Permission checks for user management live in `db.js` (the Electron **main process**), not just the UI — a renderer-only check is trivially bypassed via DevTools, so the actual enforcement happens in the trusted layer.

---

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
| PDF generation | jsPDF 2.5.1 | Arrears letters, entirely client-side — native drawing, no HTML-to-canvas capture |
| Spreadsheet export | SheetJS | Excel export throughout |
| QR codes | qrcode 1.5.3 (generate) + jsqr 1.4.0 (decode/scan) | QR login credential cards, both directions |
| Testing | Playwright (real UI) + deep backend integration harness | Drives the actual UI against a real backend bridge |

---

## Project Structure

<!-- TREE:START -->
**→ [Browse the source tree](https://github.com/Johanneskam/FMS-Finance_Management_System/tree/main)**
<!-- TREE:END -->
//recently changed a few things but did not update the project tree

---

## File-by-File Reference

### Root

- **`main.js`** — The Electron main process. Owns the window lifecycle (splash → real DB init → main window), and is the *only* place IPC handlers live. Every `electronAPI.xxx()` call from the renderer terminates in an `ipcMain.handle(...)` here, which calls into `db.js`. Also configures the camera permission handler (needed for QR login) and the userData directory.
- **`preload.js`** — Runs in an isolated bridge context. Defines the *entire* `window.electronAPI` surface the renderer is allowed to touch. If a function isn't listed here, the renderer cannot call it — this is the security boundary between untrusted UI code and the trusted main process.
- **`package.json`** — Pinned to Node 16.20.2 (matches the target dev machine). `build.files` controls exactly what electron-builder packages into the installer.
- **`deep-integration-test.js`** — The full-workflow integration test at realistic scale (800 students across both schools, grade-tiered fees, monthly invoicing with idempotency checks, bulk billing, installments, batch payments, reports, concurrent-query resilience). See [Engineering Notes](#engineering-notes--what-testing-actually-caught).

### `db/` — everything data and business-logic related

- **`db.js`** (the biggest file in the project) — Initializes RxDB with the LokiJS storage adapter, seeds default accounts and the fee catalog on first run, and exports every business-logic function: authentication (`verifyLogin`, password hashing), user management (`listUsers`/`createUser`/`updateUser`/`resetUserPassword` — all with server-side permission checks), the full ledger orchestration (`createStudent`, `createFeeExpectation`, `capturePayment`, `applyAdminAdjustment`, `getStudentLedger`), and dashboard aggregations (`getSecretaryDashboardData`, `getTopListsData`, `getArrearsLetterData`).
- **`ledger-engine.js`** — Deliberately pure (no RxDB, no I/O) so it's testable in isolation. Implements every formula from the Master Spec's Section 2: `computeRollingBalance`, `computeExpectationRemaining`, `computeFinancialHealth` (the 5-state Overpaid/Good/OK/Debtors/Chronic Debtors categorization), `allocatePaymentAutoFIFO` (the Priority-Tiered Allocation Engine), `allocatePaymentDirected` (manual split mode), and `allocateAdjustment` (category-constrained waiver sweeps).
- **`schemas/ledger.js`** — Every RxDB collection schema. Mutable collections (`students`, `guardians`, `classes`, `fee_catalog_templates`) carry `updatedAt`/`updatedBy` for conflict resolution; append-only collections (`fee_expectations`, `payments`, `allocations`, `admin_adjustments`, `adjustment_allocations`) carry only `createdAt`/`createdBy` since they're never edited.
- **`backup.js`** — Atomic multi-file backup, retention, and restore staging. Runs in the Electron main process only. See [Backup Architecture](#backup-architecture).
- **`usb-backup.js`** — Periodic removable-drive detection and auto-backup. Runs in the main process only. See [Backup Architecture](#backup-architecture).
- **`sync-firebase.js`** — The active sync engine. Runs 15 seconds after startup, then every 5 minutes. Pushes local changes newer than the last sync, pulls remote changes, and — for mutable collections only — resolves conflicts by last-write-wins (tiebreak: `stationId` alphabetically), preserving the losing version in `conflict_log` rather than discarding it.
- **`sync.js`** — An earlier OneDrive-folder-based sync approach, superseded by Firebase. Left in the codebase for reference/fallback but not wired into `main.js`.
- **`preferences.js`** — A tiny local JSON file (separate from the RxDB ledger, since it's machine-local UI convenience, not synced business data) currently used for "Remember Me" — stores only the last username, deliberately never a password or session token.
- **`firebase-config.js`** — Firebase project credentials. These are public identifiers, not secrets; access control lives in Firestore Security Rules, not in this file. `measurementId` is deliberately excluded — see [Security-Conscious by Default](#security-conscious-by-default).

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

---

## The Ledger Engine — How the Money Math Works

This is the part of the app the Master Spec cares most about, so it's worth explaining directly rather than just pointing at file names.

**A fee expectation's balance is never stored — it's always derived.**
When a `fee_expectations` record is created (e.g. "January Tuition, N$780, due Jan 5"), that record never changes again. What *does* get recorded, separately, are `allocations` — immutable "N$500 of payment #123 went toward expectation #456" facts. The remaining balance on any expectation is just `originalAmount` minus the sum of every allocation against it, computed fresh every time it's asked for.

**Payments are allocated tier-by-tier.**
`fee_catalog_templates` assign every fee type a Priority Tier (1 = Tuition, 2 = Bus/Hostel, 3 = Ad-hoc like uniforms, 4 = Fines). When a payment comes in, `allocatePaymentAutoFIFO()` sweeps through the student's outstanding expectations tier 1 first, then 2, then 3, then 4 — chronologically within each tier — so a partial payment always protects core tuition revenue before touching a library fine. Tier always outranks month: a surplus never skips a tier-1 charge to reach an earlier-dated tier-2 charge.

**Financial health is a real 5-state classification**, not a guess:
- `Overpaid` (balance < 0)
- `Good` (balance = 0)
- `OK` (outstanding, but under 30 days)
- `Debtors` (30–90 days)
- `Chronic Debtors` (90+ days)

Driven by the oldest unpaid expectation's due date, computed the same way everywhere it's displayed (dashboards, top lists, arrears letters).

**Admin adjustments (waivers/discounts/write-offs) are category-constrained.**
A "Tuition Waiver" can only ever sweep against Tuition-category expectations — it's structurally impossible for a waiver targeted at one fee category to leak into another.

**Corrections ride on the same engine.**
A positive correction (payment was recorded too low — more money actually came in than was entered) is credited via a normal admin adjustment and allocated like a payment. A negative correction (payment was recorded too high — less money came in) creates a new charge for the shortfall. Either way, the correction is attributed, timestamped, and linked to the original payment.

---

## Backup Architecture

LokiJS doesn't write a single file — it writes `fms-data.db` plus numbered siblings, and a restore that mixes files from different points in time produces a database that's internally inconsistent. Every backup operation here treats **the whole file set as one atomic unit**, never a single file in isolation.

- **Automatic on startup** (before any new writes that session) and **once daily** while the app stays open
- **Retention-bounded** — last 14 local backups, last 5 per USB drive, pruned automatically
- **USB auto-backup** — detects removable drives on Windows and copies a backup on insertion, with a session-tracking set so a stick left plugged in doesn't re-fire every scan cycle
- **Pre-restore safety backup** — restoring is itself undoable if the wrong backup gets picked
- **Restore requires restart** — deliberately never swaps files out from under a live RxDB/LokiJS connection with its own in-memory copy
- **Legacy OneDrive-folder sync** — an earlier approach, still in the codebase for reference but not wired up, since Firebase Firestore replaced it

**Honest limitation:** USB drive detection uses Windows' `wmic` command. The drive-detection logic and the file-copy logic are each tested/provable on their own, but the combination — "does `wmic` actually report the right drive letter on a real machine" — needs confirming on a real Windows PC before this is trusted unsupervised. Treat the first few real-world backups as a verification step: check the drive after plugging it in and confirm a fresh `FMS-Backups` folder with real files actually appears.

---

## Engineering Notes — What Testing Actually Caught

This section exists on purpose. A lot of portfolio projects show the finished feature; fewer show what testing it seriously actually surfaces. These are real issues found by driving the actual UI end-to-end against real data, not just reading the code:

- A **student search box** that silently ignored its search term entirely, returning every student in the school regardless of what was typed — a real risk in a school with hundreds of names, since the wrong student could be selected for a financial action.
- A **waiver/discount allocation gap**: leaving the target fee blank (meant to apply against "whatever's outstanding") silently created a record that affected nothing — the UI would report success while the student's balance never moved.
- A **systemic timezone bug** affecting eleven separate date calculations across the codebase, including invoice due dates and "today's collections" totals — all traced back to the same root cause and fixed with one shared helper instead of eleven separate patches.
- A **silent enrollment failure** with zero user feedback — traced to a UI element-matching bug during testing, which is what led to discovering the underlying component had no error handling at all.

None of these were theoretical — each was found by registering real students, capturing real payments, and checking the numbers actually added up, not by assuming the code was correct because it compiled.

### Testing at realistic scale

`deep-integration-test.js` drives the real backend through the actual sequence a school year produces — **800 students** across 13 grade levels, grade-tiered fee setup, bulk tying, monthly invoicing with idempotency checks, one-time billing with duplicate detection, installment plans, batch payments, reports — and asserts both **correctness** (does the math hold?) and **performance** (does each step stay inside a millisecond budget?) at every stage. It also fires concurrent heavy queries specifically to exercise the LokiJS SNH-bug retry path under the exact load pattern that has triggered it in real usage.

---

## Security-Conscious by Default

- **Username remembered, never password.** The app is financial; multiple roles may log into the same physical station. Skipping the password entirely would be a real regression — so the preference file stores only the username, saving retyping without weakening authentication.
- **Permission enforcement in the trusted layer.** User-management and financial-action checks live in `db.js` (main process), not the renderer — a renderer-only check is trivially bypassed via DevTools.
- **Firestore security rules are currently permissive** (any authenticated request can read/write) — fine for early testing, **not** for production. Locking these down is listed in [Known Gaps & Roadmap](#known-gaps--roadmap).
- **Firebase config carries no analytics.** `measurementId` is deliberately excluded — adding it would ship usage telemetry to Google from what's meant to be a local-first, minimal-external-dependency tool. That's a product decision, not a config value, and it's documented as such in the source.
- **Firebase config values are public identifiers, not secrets.** Access control lives in Firestore Rules, not client config.
- **No encryption at rest for the local database file** — listed in [Known Gaps & Roadmap](#known-gaps--roadmap) as a pre-production gap.

---

## Getting Started

```cmd
npm install
npm start

npm start runs build:renderer (esbuild bundles the React app into renderer/dist/bundle.js) and then launches Electron. There is no separate dev server — the bundle is rebuilt fresh on every start.

First launch will:

Create the local database at %APPDATA%\Fee Management System\fms-data

Seed the fee catalog (24 starting templates — bus/hostel marked SHARED between schools, The-specific extracurriculars/fines, The subject fees)

Seed the four default accounts below

If you change any RxDB schema, the dev-mode auto-recovery will detect the mismatch and wipe+recreate the local database automatically (safe in development; would need a real migration path before this ships with actual student data in it).

Requires Node.js and npm. On first run, the app initializes a local RxDB store; Firebase sync is optional and configured separately.

Default Accounts
Seeded identically — deterministically, not randomly — on every station's first launch, so all four accounts work on all three machines from day one with no dependency on sync having run.

Username	Password	Role	Section
admin	password123	Superadmin	Both
ceo	ChangeMe2026!	Admin	Both
secretary_The	ChangeMe2026!	Secretary	The
secretary_The	ChangeMe2026!	Secretary	The
These are development defaults — change them via User Management before any real deployment.

Build & Distribution
cmd
npm run build:win
Produces a Windows installer via electron-builder (NSIS target), using assets/icon.ico for the installer/taskbar icon.

Known Gaps & Roadmap
Being direct about what's real versus what isn't, rather than letting a polished UI imply more than what's built:

Not yet built:

Process Payment — the actual cart-billing/payment-capture screen. The engine behind it (capturePayment()) is fully built and tested; there's no UI screen calling it yet.

Reports & Analytics, All Payments, Audit Logs, Classes & Sections — placeholder screens.

Fee Expectations aren't generated automatically — nothing currently creates "next month's tuition is due" records on a schedule; that needs a recurring job.

No payment receipts (the arrears letter generator exists; a receipt-for-a-captured-payment does not).

Security / production-readiness gaps, worth addressing before real student and payment data goes in:

Firestore security rules are currently permissive (any authenticated request can read/write) — fine for early testing, not for production.

No encryption at rest for the local database file.

No automated test suite — everything has been verified via one-off manual test scripts during development, not a regression-protected suite. deep-integration-test.js is the closest thing, and is worth wiring into CI.

No real schema migration path — currently relies on dev-mode wipe-and-recreate, which is only safe because there's no real data yet.

A Note for Anyone Reviewing This as a Portfolio Piece
If you're a recruiter or hiring manager looking at this: the interesting part isn't the CRUD — it's the financial correctness under edit-history and multi-tenancy pressure. Ask me about how corrections merge without losing auditability, how the append-only ledger makes offline sync conflict-free by construction, or how the same balance-calculation code serves two schools with completely different billing models. That's where the actual engineering happened.

Advice for Whoever Picks This Up Next
(Including future me.)

Don't trust a feature until you've tried to break it with real data. Several of the bugs above only showed up once actual students, actual payments, and actual edge cases (an overpayment, a correction, an adult student with no guardian financial history) were run through the system — not from reading the code.

Shared logic beats parallel logic, even when it's more work upfront. The temptation with two different schools was to write two ledgers. One ledger, parameterized correctly, is what made every downstream feature (reports, corrections, audits) actually apply to both without duplicated bugs.

Silent failure is worse than a visible error. More than one bug here wasn't "the code is wrong" — it was "the code fails with no signal to the user at all." A slow, honest error message is always better than fast, silent nothing.

Timezones will find you eventually. If your users aren't in UTC, assume every date calculation is wrong until proven otherwise, and centralize the fix once you find it.

Derive, don't store, anything that must stay consistent. Storing a running balance is how ledgers drift.

Treat the whole LokiJS file set as one unit. A backup that copies fms-data.db but not its numbered siblings is worse than no backup at all — it looks like a successful restore right up until the data is internally inconsistent.

A personal project, shared publicly for review — not open for external contributions.