// renderer/src/helpContent.js
//
// Single source of truth for both the in-app Help page and the
// downloadable PDF guide — written once here, rendered two ways, so the
// two never drift out of sync with each other.
//
// Each scenario: { question, roles, category, steps: [string, ...] }
// roles: which sidebar this scenario applies to — 'Secretary', 'Admin',
// or both. "Admin" here covers both the Admin and Superadmin roles,
// since they share the same dashboard; anything Superadmin-only is
// noted inline in the relevant step instead of a separate role tag.

export const HELP_SCENARIOS = [
  // ---------------------------------------------------------------- Students
  {
    category: 'Students',
    question: 'How do I register a new student?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub.',
      'Click the "Student Registration" tab (it\'s the one that opens by default).',
      'Work through the 5 steps: Student Details, Guardian/Parent, Sponsor & Financial, Enrollment, Documents.',
      'For the Guardian step, either search for an existing guardian to link, or create a new one — don\'t create a duplicate guardian if the family is already in the system.',
      'On the Enrollment step, pick a Class (Wendy) or Course (Keila) — if no classes exist yet, an Admin needs to create one first in Fee Settings.',
      'Upload any ID/passport photos on the Documents step if required for the student\'s age.',
      'Click "Register Student" — this also auto-generates a registration summary PDF.'
    ]
  },
  {
    category: 'Students',
    question: 'How do I correct a student\'s information after registration?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub.',
      'Click the "Edit Student" tab.',
      'Search for the student by name or admission number.',
      'The form pre-fills with their current details — change whatever needs correcting.',
      'Click "Save Changes".',
      'Note: changing Enrollment Status here is a direct correction, not the approval-tracked deactivation process — for actually deactivating a student, use the Deactivate action in Student Records instead.'
    ]
  },
  {
    category: 'Students',
    question: 'How do I search for a student and see their profile or balance?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Student Records tab.',
      'Type a name, admission number, or parent name into the search box.',
      'Click the eye icon on their row to view their profile and transaction history, or the ledger icon for the same thing.',
      'Use the "Filters" button above the table to narrow by financial status, grade, scholarship, sponsor type, bus/hostel, or amount owed.'
    ]
  },
  {
    category: 'Students',
    question: 'How do I request that a student be deactivated?',
    roles: ['Secretary'],
    steps: [
      'Go to the sidebar → Students Hub → Student Records tab.',
      'Find the student and click the red "Deactivate" icon on their row.',
      'Type a reason (required) — e.g. "Transferred to another school".',
      'Click "Submit Request".',
      'The student stays Active until an Admin/Superadmin approves it — nothing changes immediately. You can also request this for many students at once from Bulk Operations.'
    ]
  },
  {
    category: 'Students',
    question: 'How do I approve or reject a student deactivation request?',
    roles: ['Admin'],
    steps: [
      'You\'ll see a small notification in the top-right corner when you log in if anything is pending — this is just a heads-up, not something you have to act on immediately.',
      'When ready, go to the sidebar → Notifications.',
      'Each pending request shows the student, the reason, and who requested it.',
      'Click "Approve" (marks the student Withdrawn) or "Reject" (nothing changes, student stays Active).'
    ]
  },
  {
    category: 'Students',
    question: 'How do I do the same action (bus, hostel, moving class, deactivation) for many students at once?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Bulk Operations tab.',
      'Check the students you want to apply the action to (or check the header box to select everyone visible).',
      'Click the action you want: Assign Bus, Assign Hostel, Move to Class, or Request Deactivation.',
      'Fill in the details in the popup (e.g. which bus type, which class) and confirm.',
      'Note: fee-related bulk actions (tying a fee, one-time billing) live in Fee Assignment Manager instead, not here.'
    ]
  },

  // ------------------------------------------------------------- Fees & Classes
  {
    category: 'Fees & Classes',
    question: 'How do I create a class or grade?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Fee Settings tab (Wendy only — Keila uses Courses instead, under its own Course Management tab).',
      'Under "Classes & Grades", fill in the class name (e.g. "Grade 8A"), grade level (0 for Pre-Primary through 12), section, and academic year.',
      'Click "Add".',
      'Grade level matters beyond just labeling — it\'s what grade-specific fee pricing uses to know which price applies to a student, so set it accurately.'
    ]
  },
  {
    category: 'Fees & Classes',
    question: 'How do I create a new fee type (e.g. a new activity fee)?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'If it needs a new category first: go to Students Hub → Fee Settings → add the category name there.',
      'Go to the sidebar → Students Hub → Fee Structure Manager tab.',
      'Click "Add Fee Template".',
      'Fill in the item name, pick its category, and (Admin only) choose whether it\'s Wendy-only, Keila-only, or Shared.',
      'On the next step, set the standard charge, priority tier, and frequency (one-time, monthly, termly, yearly).',
      'If this fee should cost different amounts by grade (e.g. Pre-Primary pays less than Grade 12 for the same Tuition item), click "Add Grade Range" and set the grade range and amount for each tier — any grade not covered falls back to the standard charge.'
    ]
  },
  {
    category: 'Fees & Classes',
    question: 'How do I tie a recurring fee (like monthly Tuition) to a student or a group of students?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Fee Assignment Manager tab.',
      'Make sure "Recurring Fee" mode is selected (it\'s the default).',
      'Pick the fee from the "Fee to Tie" dropdown.',
      'Filter by grade and/or search, then check the students — or click "Select All Matching" to grab everyone the filter found, even beyond what\'s on screen.',
      'Click "Tie Fee to N Student(s)".',
      'This only sets up the ongoing tie — it does not bill anyone yet. See the next scenario for actually generating the charges.'
    ]
  },
  {
    category: 'Fees & Classes',
    question: 'How do I actually bill everyone for this month\'s tuition (or any recurring fee)?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Fee Assignment Manager tab.',
      'At the top, under "Generate This Month\'s Invoices", pick the billing month.',
      'Click "Generate Invoices".',
      'Every student currently tied to a monthly fee gets billed in one click. It\'s safe to click this more than once — anyone already invoiced for that month is automatically skipped, never billed twice.'
    ]
  },
  {
    category: 'Fees & Classes',
    question: 'How do I bill a one-time fee (like a uniform or registration fee) to a student or group?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Fee Assignment Manager tab.',
      'Switch to "One-Time Fee" mode.',
      'Type the item name, category, and total amount.',
      'If the student can\'t pay it all at once, turn on "Split into installments" and choose how many.',
      'Select the student(s) the same way as recurring fees (filter, search, or Select All Matching).',
      'Click "Bill N Student(s)".',
      'If someone already has this exact item billed this month, you\'ll see a warning listing them by name before anything is charged — you can still proceed if it\'s a genuinely new instance (e.g. a replacement uniform), or cancel and adjust your selection if it was a mistake.'
    ]
  },
  {
    category: 'Fees & Classes',
    question: 'How do I see what fees a specific student is tied to, or remove one?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Student Records tab.',
      'Find the student and click the amber "Assign Fees" icon on their row.',
      'This shows every recurring fee currently tied to them.',
      'Click the red remove icon next to any fee to untie it — this only stops future monthly invoices, it doesn\'t touch anything already billed.'
    ]
  },

  // ------------------------------------------------------------- Payments
  {
    category: 'Payments',
    question: 'How do I process a payment for a student?',
    roles: ['Secretary'],
    steps: [
      'Go to the sidebar → Process Payment.',
      'Search for the student by name or number and select them.',
      'Optionally upload a photo or PDF of the bank transfer receipt — an image upload gets scanned automatically and suggests the amount, reference, bank, and account details as clickable chips you can apply or ignore.',
      'Enter the amount, payment method (EFT or POS — cash is never accepted), and transaction reference.',
      'Optionally fill in Bank Name, the bank\'s own reference, and the sender\'s account (last digits only) — these help a parent match this payment against their own bank statement later.',
      'Click "Capture Payment".',
      'After it succeeds, you can Print Receipt (sends a thermal-formatted receipt to whatever printer is set up) or Save as PDF.'
    ]
  },
  {
    category: 'Payments',
    question: 'How do I process payments for several students at once (e.g. a collection day)?',
    roles: ['Secretary'],
    steps: [
      'Go to the sidebar → Process Payment.',
      'Turn on "Batch Mode" near the top.',
      'Search for the first student, fill in their amount/method/reference, and click "Add to Batch" instead of Capture — this queues it and clears the form for the next student.',
      'Repeat for each student.',
      'Review the queue, then click "Submit All Payments" — each one processes individually, and you\'ll see exactly which succeeded and which didn\'t. Anything that failed stays in the queue so you can fix and resubmit it without re-entering the ones that already went through.',
      'Note: batch mode only supports auto-allocation (Tuition first, then Bus/Hostel, then ad-hoc, then fines) — manual fee-by-fee splitting isn\'t available in this mode.'
    ]
  },
  {
    category: 'Payments',
    question: 'How do I find a specific payment or see all payments made?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → All Payments.',
      'Use the date range, payment method, or search box to narrow the list.',
      'Click the eye icon on any row to see full details, including bank cross-reference info and a "View Uploaded Receipt" button if a receipt photo was attached at the time of payment.',
      'Payments can\'t be edited or deleted here — this ledger is append-only by design. To correct a mistake, use an Admin Adjustment against the affected student instead.'
    ]
  },
  {
    category: 'Payments',
    question: 'How do I check a student\'s balance and full transaction history?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Students Hub → Financial Ledger tab.',
      'Search for the student by name or number.',
      'You\'ll see their current balance, status, and a full debit/credit transaction history.'
    ]
  },

  // ------------------------------------------------------------- Reports & communication
  {
    category: 'Reports',
    question: 'How do I generate a report?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Reports & Analytics.',
      'Pick a tab (Overview, Collections, Aging, Behaviour, Adjustments, or Student & Category Reports).',
      'Click the report or export button you need — most generate a PDF, some also offer an Excel export.',
      'Once generated, a "Print This Report" bar appears above the tabs — click it to send that report straight to a printer.'
    ]
  },
  {
    category: 'Reports',
    question: 'How do I follow up with a parent about arrears?',
    roles: ['Secretary'],
    steps: [
      'Go to the sidebar → Financial Communication.',
      'Search for or select the student.',
      'Generate an arrears letter or statement, then send or print it as needed.'
    ]
  },
  {
    category: 'Reports',
    question: 'How do I see what a secretary has done, with timestamps?',
    roles: ['Admin'],
    steps: [
      'Go to the sidebar → Audit Logs.',
      'Optionally filter by secretary username or a date range.',
      'This shows every payment captured, adjustment made, student registered, and deletion decision made, chronologically.'
    ]
  },

  // ------------------------------------------------------------- Account & profile
  {
    category: 'Account',
    question: 'How do I change my password?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Profile.',
      'Fill in your current password and new password under "Change Password".',
      'Click Save.'
    ]
  },
  {
    category: 'Account',
    question: 'How do I print my own QR login card?',
    roles: ['Secretary', 'Admin'],
    steps: [
      'Go to the sidebar → Profile.',
      'Click "Print My QR Login Card".',
      'Confirm your current password when prompted — this is what actually gets encoded onto the card, so it\'s required.',
      'Once shown, use the Download button on the card itself to save it.'
    ]
  },
  {
    category: 'Account',
    question: 'A secretary forgot their password — how do I reset it?',
    roles: ['Admin'],
    steps: [
      'Go to the sidebar → User Management (Superadmin only).',
      'Find their account and click Reset Password.',
      'A temporary password is generated and shown as a QR card you can hand to them or print.'
    ]
  },
  {
    category: 'Account',
    question: 'How do I check if sync is working, or see database stats?',
    roles: ['Admin'],
    steps: [
      'Go to the sidebar → System Diagnostics (Superadmin only).',
      'The Sync Status card shows whether it\'s configured, when it last pushed/pulled, and has a "Sync Now" button.',
      'The Database Stats card shows live record counts per collection and this station\'s ID — useful when troubleshooting rather than needing to open a terminal.'
    ]
  }
];

export const HELP_CATEGORIES = [...new Set(HELP_SCENARIOS.map((s) => s.category))];
