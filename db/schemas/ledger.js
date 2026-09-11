'use strict';

// db/schemas/ledger.js
// Schema design note: everything here follows the Master Spec's math
// (Section 2) directly. The key architectural decision — and the reason
// this fits our offline-first sync model so cleanly — is that Fee_Expectations,
// Payments, Allocations, and Admin_Adjustments are all APPEND-ONLY. A fee
// expectation's "remaining balance" R(E_k) is never stored as a mutable
// field; it's DERIVED at query time from the sum of Allocation records
// against it (see ledger-engine.js). Nothing here is ever edited in place,
// so none of it needs the last-write-wins conflict machinery `users` needs —
// two stations can both write records offline and merge with zero
// conflicts, by construction, the same way real accounting ledgers work.
//
// Only the reference/catalog collections (students, guardians, classes,
// fee_catalog_templates) are mutable, so only those carry updatedAt/updatedBy.

// ---------- MUTABLE (reference data) ----------

const classSchema = {
  title: 'classes schema',
  version: 0,
  primaryKey: 'classId',
  type: 'object',
  properties: {
    classId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    className: { type: 'string' },
    gradeLevel: { type: 'number' },
    section: { type: 'string' },
    academicYear: { type: 'string' },
    monthlyTuitionFee: { type: 'number' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['classId', 'school', 'className', 'updatedAt', 'updatedBy']
};

const guardianSchema = {
  title: 'guardians schema',
  version: 2, // bumped: added nationalId/passport/isForeignNational — see migrationStrategies in db.js
  primaryKey: 'guardianId',
  type: 'object',
  properties: {
    guardianId: { type: 'string', maxLength: 64 },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    relationship: { type: 'string' },
    email: { type: 'string' },
    phonePrimary: { type: 'string' },
    phoneSecondary: { type: 'string' },
    addressLine1: { type: 'string' },
    city: { type: 'string' },
    country: { type: 'string', default: 'Namibia' },
    isForeignNational: { type: 'boolean', default: false },
    nationalId: { type: 'string' },
    passport: { type: 'string' },
    // Where the parent/guardian works — relevant when they're the one
    // actually funding fees (sponsorType 'Parent'), not needed when the
    // family self-funds or a company/org sponsors directly.
    employerName: { type: 'string' },
    jobTitle: { type: 'string' },
    employerPhone: { type: 'string' },
    employerAddress: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['guardianId', 'firstName', 'lastName', 'phonePrimary', 'updatedAt', 'updatedBy']
};

const studentSchema = {
  title: 'students schema',
  version: 5, // bumped: added emergencyContactName — see migrationStrategies
  primaryKey: 'studentId',
  type: 'object',
  properties: {
    studentId: { type: 'string', maxLength: 64 },
    studentNumber: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    dateOfBirth: { type: 'string' },
    gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    classId: { type: 'string' },   // FK -> classes.classId (nullable/blank for KEILA subject-model students)
    guardianId: { type: 'string' }, // FK -> guardians.guardianId
    enrollmentDate: { type: 'string' },
    enrollmentStatus: {
      type: 'string',
      enum: ['Active', 'Inactive', 'Graduated', 'Transferred', 'Suspended', 'Withdrawn'],
      default: 'Active'
    },
    usesBus: { type: 'boolean', default: false },
    busType: { type: 'string' },
    isHostelite: { type: 'boolean', default: false },
    hostelType: { type: 'string' },
    registeredBy: { type: 'string' }, // username who registered them
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' },
    // ----- NEW fields for Keila (Elite) -----
    courseId: { type: 'string' },          // main course (if enrolled)
    sponsorId: { type: 'string' },         // sponsor (company, government, etc.)
    sponsorType: { type: 'string', enum: ['Self', 'Parent', 'Company', 'Government', 'NGO'] },
    academicYear: { type: 'string' },
    intake: { type: 'string' },            // e.g. "January 2026"
    isRepeating: { type: 'boolean', default: false },
    previousSchool: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    address: { type: 'string' },
    emergencyContactName: { type: 'string' },
    emergencyContact: { type: 'string' },
    nationalId: { type: 'string' },
    passport: { type: 'string' },
    // Paths (not binary content) to PDFs saved on disk — keeps these
    // documents out of the RxDB record entirely, so a multi-photo
    // certificates PDF doesn't bloat the document that gets held in memory
    // and synced. See saveStudentDocumentsPdf() in db.js.
    documentsPdfPath: { type: 'string' },   // combined certificates/ID/other document images
    summaryPdfPath: { type: 'string' },      // auto-generated registration summary
    // Supports the hierarchical report filtering (grade + scholarship +
    // debtor status + specific fee, combined) — a real field rather than
    // inferring it from adjustment reason-code text, which would be
    // fragile to match reliably.
    isOnScholarship: { type: 'boolean', default: false },
    // Secretary requests, Admin/Superadmin approves or rejects — a pending
    // request has deletionRequestedAt set but deletionDecisionAt not yet.
    deletionRequestedAt: { type: 'string' },
    deletionRequestedBy: { type: 'string' },
    deletionReason: { type: 'string' },
    deletionDecisionAt: { type: 'string' },
    deletionDecisionBy: { type: 'string' },
    deletionDecision: { type: 'string', enum: ['Approved', 'Rejected'] }
  },
  required: ['studentId', 'studentNumber', 'firstName', 'lastName', 'school', 'guardianId', 'updatedAt', 'updatedBy']
};

// A real academic year, not just a free-text label typed differently
// in three different forms. Only one year per school is "current" at a
// time — that's what new registrations, new billing, and the class
// picker default to, without anyone needing to remember or retype it.
const academicYearSchema = {
  title: 'academic years schema',
  version: 0,
  primaryKey: 'yearId',
  type: 'object',
  properties: {
    yearId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    label: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    isCurrent: { type: 'boolean', default: false },
    createdAt: { type: 'string' }
  },
  required: ['yearId', 'school', 'label', 'createdAt']
};

// A term within a specific academic year — what "termly" billing
// actually bills against, the same way a calendar month is what
// monthly billing bills against.
const termSchema = {
  title: 'terms schema',
  version: 0,
  primaryKey: 'termId',
  type: 'object',
  properties: {
    termId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    yearId: { type: 'string' },
    label: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['termId', 'school', 'yearId', 'label', 'startDate', 'endDate', 'createdAt']
};

const feeCatalogTemplateSchema = {
  title: 'fee catalog templates schema',
  version: 1, // bumped: added gradePricing for grade-tiered fee amounts — see migrationStrategies
  primaryKey: 'templateId',
  type: 'object',
  properties: {
    templateId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['WENDY', 'KEILA', 'SHARED'] },
    itemName: { type: 'string' },
    category: { type: 'string' },
    standardCharge: { type: 'number' },
    // Optional per-grade-range overrides — e.g. Pre-Primary pays less
    // than Grade 12 for the same "Tuition" item. Each entry is
    // { minGrade, maxGrade, amount }; a grade not covered by any entry
    // falls back to standardCharge. Empty/absent means "one flat price
    // for every grade," the original behavior, unchanged.
    gradePricing: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          minGrade: { type: 'number' },
          maxGrade: { type: 'number' },
          amount: { type: 'number' }
        }
      }
    },
    priorityTier: { type: 'number', minimum: 1, maximum: 4 },
    frequency: { type: 'string', enum: ['one-time', 'monthly', 'termly', 'yearly'], default: 'one-time' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['templateId', 'school', 'itemName', 'category', 'standardCharge', 'priorityTier', 'updatedAt', 'updatedBy']
};

// ---------- APPEND-ONLY (immutable ledger facts) ----------

const feeExpectationSchema = {
  title: 'fee expectations schema',
  version: 2, // bumped: added sourceAssignmentId + billingPeriod for monthly invoice generation — see migrationStrategies
  primaryKey: 'expectationId',
  type: 'object',
  properties: {
    expectationId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    templateId: { type: 'string' },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    category: { type: 'string' },
    description: { type: 'string' },
    originalAmount: { type: 'number' },
    dueDate: { type: 'string' },
    priorityTier: { type: 'number', minimum: 1, maximum: 4 },
    frequency: { type: 'string' },
    installmentPlanId: { type: 'string' },
    createdAt: { type: 'string' },
    createdBy: { type: 'string' },
    // Set only when this expectation was generated by a monthly invoice
    // run (not for one-off ad-hoc charges) — this pair is what makes
    // re-running the generator for the same month a safe no-op instead
    // of a double bill.
    sourceAssignmentId: { type: 'string' },
    billingPeriod: { type: 'string' } // 'YYYY-MM'
  },
  required: ['expectationId', 'studentId', 'school', 'category', 'originalAmount', 'dueDate', 'priorityTier', 'createdAt', 'createdBy']
};

const paymentSchema = {
  title: 'payments schema',
  version: 1, // bumped: added bankName + senderAccountRef for parent bank-statement cross-referencing — see migrationStrategies
  primaryKey: 'paymentId',
  type: 'object',
  properties: {
    paymentId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    amount: { type: 'number' },
    paymentMethod: { type: 'string', enum: ['EFT', 'POS'] },
    transactionReference: { type: 'string' },
    bankReference: { type: 'string' },
    // Which bank the transfer came from (FNB, Standard Bank, Bank Windhoek,
    // Nedbank, etc.) — a parent disputing or verifying a payment usually
    // knows their own bank before they know a transaction ID, so this is
    // often the fastest way to start narrowing down which line on their
    // statement this payment corresponds to.
    bankName: { type: 'string' },
    // Last few digits of the sending account, NOT the full account number
    // — enough to help a parent (or the school) confirm "yes, that's the
    // account I paid from" without the school holding a full account
    // number it has no real need to store.
    senderAccountRef: { type: 'string' },
    payerName: { type: 'string' },
    payerPhone: { type: 'string' },
    proofOfPaymentPath: { type: 'string' },
    paymentDate: { type: 'string' },
    processedBy: { type: 'string' },
    stationId: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['paymentId', 'studentId', 'school', 'amount', 'paymentMethod', 'transactionReference', 'paymentDate', 'processedBy', 'stationId', 'createdAt']
};

const allocationSchema = {
  title: 'allocations schema',
  version: 0,
  primaryKey: 'allocationId',
  type: 'object',
  properties: {
    allocationId: { type: 'string', maxLength: 64 },
    paymentId: { type: 'string' },
    expectationId: { type: 'string' },
    amountAllocated: { type: 'number' },
    appliedDate: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['allocationId', 'paymentId', 'expectationId', 'amountAllocated', 'appliedDate', 'createdAt']
};

const adminAdjustmentSchema = {
  title: 'admin adjustments schema',
  version: 0,
  primaryKey: 'adjustmentId',
  type: 'object',
  properties: {
    adjustmentId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    type: { type: 'string', enum: ['WAIVER', 'DISCOUNT', 'WRITE_OFF', 'CORRECTION'] },
    targetCategory: { type: 'string' },
    targetExpectationId: { type: 'string' },
    amount: { type: 'number' },
    reasonCode: { type: 'string' },
    explanation: { type: 'string' },
    approvedByUserId: { type: 'string' },
    approvalTimestamp: { type: 'string' },
    stationId: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['adjustmentId', 'studentId', 'school', 'type', 'amount', 'reasonCode', 'approvedByUserId', 'approvalTimestamp', 'stationId', 'createdAt']
};

// Links a correction back to the specific original payment it fixes —
// separate from admin_adjustments/fee_expectations (which handle the
// actual money-side effect) so "what corrections has this payment had"
// is a direct, simple lookup rather than reverse-engineering it from
// adjustment reason text.
const paymentCorrectionSchema = {
  title: 'payment corrections schema',
  version: 0,
  primaryKey: 'correctionId',
  type: 'object',
  properties: {
    correctionId: { type: 'string', maxLength: 64 },
    originalPaymentId: { type: 'string' },
    studentId: { type: 'string' },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    // Positive: the original payment was recorded too LOW — more money
    // actually came in than was entered, so this amount gets allocated
    // like a normal payment. Negative: the original payment was recorded
    // too HIGH — less money actually came in, so a new charge for the
    // shortfall is added to what the student owes.
    correctionAmount: { type: 'number' },
    // Which mechanism actually carried the money-side effect — an
    // adjustmentId (positive case, credited via admin_adjustments) or an
    // expectationId (negative case, a new charge for the shortfall).
    relatedAdjustmentId: { type: 'string' },
    relatedExpectationId: { type: 'string' },
    reason: { type: 'string' },
    correctedByUserId: { type: 'string' },
    stationId: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['correctionId', 'originalPaymentId', 'studentId', 'school', 'correctionAmount', 'reason', 'correctedByUserId', 'stationId', 'createdAt']
};

const adjustmentAllocationSchema = {
  title: 'adjustment allocations schema',
  version: 0,
  primaryKey: 'allocationId',
  type: 'object',
  properties: {
    allocationId: { type: 'string', maxLength: 64 },
    adjustmentId: { type: 'string' },
    expectationId: { type: 'string' },
    amountAllocated: { type: 'number' },
    appliedDate: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['allocationId', 'adjustmentId', 'expectationId', 'amountAllocated', 'appliedDate', 'createdAt']
};

// ---------- NEW schemas for Keila (Elite) ----------

const courseSchema = {
  title: 'courses schema',
  version: 0,
  primaryKey: 'courseId',
  type: 'object',
  properties: {
    courseId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['KEILA'] },
    courseName: { type: 'string' },
    duration: { type: 'string' },
    academicYear: { type: 'string' },
    semester: { type: 'string' },
    maxStudents: { type: 'number' },
    coordinator: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['courseId', 'school', 'courseName', 'updatedAt', 'updatedBy']
};

const subjectSchema = {
  title: 'subjects schema',
  version: 0,
  primaryKey: 'subjectId',
  type: 'object',
  properties: {
    subjectId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['KEILA'] },
    courseId: { type: 'string' },
    subjectName: { type: 'string' },
    subjectFee: { type: 'number' },
    teacher: { type: 'string' },
    credits: { type: 'number' },
    duration: { type: 'string' },
    schedule: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['subjectId', 'school', 'subjectName', 'subjectFee', 'updatedAt', 'updatedBy']
};

const studentCourseSchema = {
  title: 'student courses schema',
  version: 0,
  primaryKey: 'enrollmentId',
  type: 'object',
  properties: {
    enrollmentId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    courseId: { type: 'string' },
    subjects: { type: 'array', items: { type: 'string' } },
    enrollmentDate: { type: 'string' },
    status: { type: 'string', enum: ['Enrolled', 'Completed', 'Dropped'], default: 'Enrolled' },
    completedAt: { type: 'string' },
    academicYear: { type: 'string' },
    intake: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['enrollmentId', 'studentId', 'courseId', 'enrollmentDate', 'updatedAt', 'updatedBy']
};

const sponsorSchema = {
  title: 'sponsors schema',
  version: 1, // bumped: school scope opened to WENDY too (was KEILA-only) — see migrationStrategies
  primaryKey: 'sponsorId',
  type: 'object',
  properties: {
    sponsorId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['WENDY', 'KEILA'] },
    name: { type: 'string' },
    type: { type: 'string', enum: ['Company', 'Government', 'NGO', 'Individual'] },
    contactPerson: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    address: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['sponsorId', 'school', 'name', 'updatedAt', 'updatedBy']
};

const installmentPlanSchema = {
  title: 'installment plans schema',
  version: 1, // bumped: added updatedAt/updatedBy — needed for sync conflict resolution now that this collection is being synced (status and installments[].paid are both mutable)
  primaryKey: 'planId',
  type: 'object',
  properties: {
    planId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    name: { type: 'string' },
    totalAmount: { type: 'number' },
    installments: { type: 'array', items: { type: 'object', properties: {
      dueDate: { type: 'string' },
      amount: { type: 'number' },
      paid: { type: 'boolean', default: false }
    } } },
    status: { type: 'string', enum: ['Active', 'Completed', 'Defaulted'] },
    createdAt: { type: 'string' },
    createdBy: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['planId', 'studentId', 'totalAmount', 'installments', 'createdAt', 'createdBy']
};

const feeCategorySchema = {
  title: 'fee categories schema',
  version: 0,
  primaryKey: 'categoryId',
  type: 'object',
  properties: {
    categoryId: { type: 'string', maxLength: 64 },
    school: { type: 'string', enum: ['KEILA', 'WENDY'] },
    name: { type: 'string' },
    description: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['categoryId', 'school', 'name', 'updatedAt', 'updatedBy']
};

const feeAssignmentSchema = {
  title: 'fee assignments schema',
  version: 0,
  primaryKey: 'assignmentId',
  type: 'object',
  properties: {
    assignmentId: { type: 'string', maxLength: 64 },
    studentId: { type: 'string' },
    feeTemplateId: { type: 'string' },
    amount: { type: 'number' },
    frequency: { type: 'string', enum: ['one-time', 'monthly', 'termly', 'yearly'] },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['assignmentId', 'studentId', 'feeTemplateId', 'amount', 'updatedAt', 'updatedBy']
};

module.exports = {
  academicYearSchema,
  termSchema,
  classSchema,
  guardianSchema,
  studentSchema,
  feeCatalogTemplateSchema,
  feeExpectationSchema,
  paymentSchema,
  allocationSchema,
  adminAdjustmentSchema,
  paymentCorrectionSchema,
  adjustmentAllocationSchema,
  courseSchema,
  subjectSchema,
  studentCourseSchema,
  sponsorSchema,
  installmentPlanSchema,
  feeCategorySchema,
  feeAssignmentSchema
};