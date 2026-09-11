# FMS — User Roles & Credentials

This is a reference for who can log into the Fee Management System, what each role can and can't do, and the actual login details. For how the app is built, see `README.md` instead — this document is about *using* the system, not building it.

---

## A note on how permissions actually work here

Every restriction described below is enforced **server-side**, in `db.js` — running in Electron's main process, which the on-screen UI has no way to bypass. A role that "can't" do something isn't just a hidden button; the underlying function itself checks who's asking and refuses the request if they're not allowed. Opening dev tools or poking at the interface doesn't get around this.

---

## The Three Roles

### 1. Superadmin — technical administrator

**Who this is:** The developer/technical administrator responsible for the system itself, not day-to-day school finances.

**Scope:** Both schools. Not tied to either campus specifically.

**What Superadmin can do:**
- **Full user management** — create, edit, and deactivate *any* account, including other Superadmin and Admin accounts (the only role that can do this)
- Reset any user's password
- Generate printable QR login credential cards for any user
- View system status and Firebase sync configuration/status
- Everything Admin can do (see below), plus manage Admin-level accounts, which Admin itself cannot do

**What Superadmin cannot do:**
- Nothing is restricted for this role within the system — it sits at the top of the permission model.

**Typical use:** Initial setup, account provisioning for the CEO and Secretaries, troubleshooting sync issues, and any account-level administration that a Secretary or the CEO shouldn't be doing themselves.

---

### 2. Admin — the CEO

**Who this is:** The CEO, who owns and oversees both Wendy Private School and Keila Academy.

**Scope:** Both schools (`section: 'Both'`) — dashboards and reports show combined or school-selectable data rather than being locked to one campus.

**What Admin can do:**
- View the financial dashboard: collections, outstanding balances, KPIs, recent activity
- Full access to **Reports & Analytics** — Overview, Collection Reports, Outstanding/Aging, Payment Behaviour, and Adjustment Reports, each with PDF and Excel export
- **Manage Secretary accounts only** — create, edit, deactivate, and reset passwords for Secretary users, and generate their QR credential cards
- View sync/system settings

**What Admin cannot do:**
- Cannot create, edit, or touch Superadmin or other Admin accounts — that's Superadmin-only
- Cannot process payments directly — that's a Secretary's day-to-day operational task, and Process Payment isn't in the Admin navigation
- Cannot register students directly — same reasoning; that's handled at the school level by Secretaries

**Typical use:** Reviewing financial performance across both schools, pulling reports for board/financial review, and managing which Secretaries have accounts — without getting into the transactional, per-payment work at either campus.

---

### 3. Secretary — one per school

**Who this is:** The on-site finance administrator at each school, handling the actual day-to-day fee collection. There are two Secretary accounts — one for each campus — and they are the same *role*, just scoped to different schools.

**Scope:** Their own school only. A Wendy Private School Secretary cannot see or affect Keila Academy's students, payments, or data, and vice versa.

**What Secretary can do:**
- **Process Payment** — the core operational screen: search a student, view their outstanding fees, capture an EFT or POS payment (cash is never accepted, enforced at the data layer), auto-allocate via the priority-tiered ledger engine or manually direct amounts to specific fees, and set up multi-month payment plans for fees like uniforms
- **Student Registration** — register new students and their guardians (either linking to an existing guardian or creating a new one)
- **Financial Communication** — view top debtors and top-paying students, and generate PDF arrears letters for guardians with outstanding balances
- **Reports & Analytics** — the same 5-tab report suite Admin has, scoped to their own school
- View their own school's dashboard: today's and monthly collections, high-alert debtors, recent payment activity

**What Secretary cannot do:**
- No access to User Management at all — cannot create, view, or modify any user accounts, including other Secretaries
- Cannot see or affect the other school's students, payments, or reports
- No access to system/sync settings

**Typical use:** Everything involved in actually running the front desk — taking payments, registering new students, chasing up overdue accounts, and pulling reports for their own school.

---

## Full Credentials

These are the default accounts seeded automatically the first time the app runs on any machine — deterministically, not randomly, so all four work identically across every station without needing sync to have run first.

| Username | Password | Role | School / Section |
|---|---|---|---|
| `admin` | `password123` | Superadmin | Both |
| `ceo` | `ChangeMe2026!` | Admin | Both |
| `secretary_wendy` | `ChangeMe2026!` | Secretary | Wendy Private School |
| `secretary_keila` | `ChangeMe2026!` | Secretary | Keila Academy |

### Two ways to log in

1. **Username and password**, directly on the login screen.
2. **QR code** — a printable ID-card-style credential (generated from User Management by a Superadmin or Admin) can be scanned via camera or uploaded as a photo/screenshot on the login screen's QR tab. The QR encodes the same username and password; scanning it logs in exactly as if they'd been typed.

There's also a **"Remember Me"** option on the login screen — it remembers the *username* only for next time, never the password, so re-logging in is faster without weakening the actual login step.

### Before this goes anywhere near real use

These are development defaults, meant to get every station working identically out of the box — not production-ready credentials. Before real students, guardians, or payments go into the system:

- Change every one of these passwords via User Management (each role can reset its own scope — Superadmin can reset anyone, Admin can reset Secretaries)
- Consider deactivating or renaming the `admin` Superadmin account if it won't be used ongoing, since it's the most powerful account in the system
