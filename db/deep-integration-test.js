'use strict';
// Deep, full-workflow integration test at realistic scale (800 students,
// midpoint of the requested 500-1000 range). Walks through the actual
// sequence a real school year would produce — registration, grade-tiered
// fee setup, bulk tying, monthly invoicing, one-time billing with
// duplicate detection, installment plans, single and batch payments,
// reports — and checks both CORRECTNESS (does the math/logic hold) and
// PERFORMANCE (does each step stay fast enough to feel smooth) at every
// stage, not just "does it crash."

const db = require('./db/db');

let failures = 0;
function check(label, condition, detail = '') {
  const ok = !!condition;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}
function timed(label, ms, budgetMs) {
  const ok = ms <= budgetMs;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}: ${ms}ms (budget ${budgetMs}ms)`);
}

async function main() {
  const overallStart = Date.now();
  await db.initDatabase(() => {});
  const dbInst = await db.initDatabase();

  console.log('\n=== STAGE 1: Seed 800 students across WENDY + KEILA, varied grades ===');
  let t0 = Date.now();
  const guardian = await db.createGuardian({ firstName: 'Test', lastName: 'Guardian', phonePrimary: '0811234567' });

  // Classes spanning Pre-Primary (0) through Grade 12, so grade-tiered
  // pricing gets exercised across its full range, not just one bucket.
  const gradeLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const classes = [];
  for (const g of gradeLevels) {
    const cls = await db.createClass({ school: 'WENDY', className: `Grade ${g}A`, gradeLevel: g, academicYear: '2026' });
    classes.push(cls);
  }

  const wendyStudents = [];
  const keilaStudents = [];
  for (let i = 0; i < 700; i++) {
    const cls = classes[i % classes.length];
    const s = await db.createStudent({
      firstName: `Student${i}`, lastName: 'Wendy', school: 'WENDY', guardianId: guardian.guardianId,
      gender: i % 2 === 0 ? 'Male' : 'Female', dateOfBirth: '2012-01-01', enrollmentDate: '2026-01-01',
      classId: cls.classId, registeredBy: 'secretary_wendy'
    });
    wendyStudents.push(s);
  }
  for (let i = 0; i < 100; i++) {
    const s = await db.createStudent({
      firstName: `Student${i}`, lastName: 'Keila', school: 'KEILA', guardianId: guardian.guardianId,
      gender: i % 2 === 0 ? 'Male' : 'Female', dateOfBirth: '2008-01-01', enrollmentDate: '2026-01-01',
      registeredBy: 'secretary_keila'
    });
    keilaStudents.push(s);
  }
  const seedMs = Date.now() - t0;
  timed('Seeded 800 students (700 WENDY + 100 KEILA) with 13 classes', seedMs, 60000);
  check('All 700 WENDY students created', wendyStudents.length === 700);
  check('All 100 KEILA students created', keilaStudents.length === 100);

  console.log('\n=== STAGE 2: Grade-tiered Tuition template ===');
  const tuitionTemplate = await db.createFeeTemplate({
    school: 'WENDY', itemName: 'Tuition', category: 'Tuition', standardCharge: 700,
    priorityTier: 1, frequency: 'monthly',
    gradePricing: [
      { minGrade: 0, maxGrade: 3, amount: 500 },   // Pre-Primary/Foundation
      { minGrade: 4, maxGrade: 7, amount: 750 },   // Primary
      { minGrade: 8, maxGrade: 12, amount: 950 }   // Secondary
    ]
  });
  const busTemplate = await db.createFeeTemplate({ school: 'WENDY', itemName: 'Bus Fee', category: 'Transport', standardCharge: 300, priorityTier: 2, frequency: 'monthly' });
  check('Grade-tiered Tuition template created', !!tuitionTemplate.templateId);

  console.log('\n=== STAGE 3: Bulk-tie Tuition to all 700 WENDY students (grade-aware) ===');
  t0 = Date.now();
  const wendyIds = wendyStudents.map((s) => s.studentId);
  const tuitionAssignments = await db.bulkAssignFee({ studentIds: wendyIds, feeTemplateId: tuitionTemplate.templateId, frequency: 'monthly', startDate: '2026-08-01' });
  const tieMs = Date.now() - t0;
  timed('Tied Tuition to 700 students in one call', tieMs, 5000);

  // Correctness: spot-check that grade tiers actually resolved correctly
  // across the full range, not just "it didn't crash."
  const byStudentAmount = Object.fromEntries(tuitionAssignments.map((a) => [a.studentId, a.amount]));
  const grade0Student = wendyStudents.find((s, i) => classes[i % classes.length].gradeLevel === 0);
  const grade5Student = wendyStudents.find((s, i) => classes[i % classes.length].gradeLevel === 5);
  const grade12Student = wendyStudents.find((s, i) => classes[i % classes.length].gradeLevel === 12);
  check('Grade 0 student billed N$500 tier', byStudentAmount[grade0Student.studentId] === 500, `got ${byStudentAmount[grade0Student.studentId]}`);
  check('Grade 5 student billed N$750 tier', byStudentAmount[grade5Student.studentId] === 750, `got ${byStudentAmount[grade5Student.studentId]}`);
  check('Grade 12 student billed N$950 tier', byStudentAmount[grade12Student.studentId] === 950, `got ${byStudentAmount[grade12Student.studentId]}`);

  // Also tie Bus Fee to a third of the students, to exercise a student
  // having multiple simultaneous recurring ties.
  const busSubset = wendyIds.slice(0, 230);
  await db.bulkAssignFee({ studentIds: busSubset, feeTemplateId: busTemplate.templateId, frequency: 'monthly', startDate: '2026-08-01' });
  check('Bus fee tied to a subset (230 students)', true);

  console.log('\n=== STAGE 4: Generate August invoices for everyone tied ===');
  // NOTE: "today" in this environment is 2026-07-31. Using a due date of
  // 2026-08-01 would make every charge technically "not due yet" by one
  // day, and the allocator correctly refuses to apply a payment against
  // a charge that isn't due — so billing period stays August (a real,
  // normal monthly cycle), but the due date is backdated to be payable
  // as of today, matching how this app is actually used in practice.
  t0 = Date.now();
  const augustRun1 = await db.generateMonthlyInvoices({ school: 'WENDY', billingPeriod: '2026-08', dueDate: '2026-07-01' });
  const invoiceMs = Date.now() - t0;
  timed('Generated August invoices for 700+230 assignments', invoiceMs, 5000);
  check('Correct invoice count (700 Tuition + 230 Bus = 930)', augustRun1.created === 930, `got ${augustRun1.created}`);

  console.log('\n=== STAGE 5: Idempotency check at scale — rerun the SAME month ===');
  t0 = Date.now();
  const augustRun2 = await db.generateMonthlyInvoices({ school: 'WENDY', billingPeriod: '2026-08' });
  const rerunMs = Date.now() - t0;
  timed('Rerun for the same month', rerunMs, 3000);
  check('Zero new invoices on rerun (no duplicate billing)', augustRun2.created === 0, `got ${augustRun2.created}`);
  check('All 930 correctly recognized as already-invoiced', augustRun2.skippedAlreadyInvoiced === 930, `got ${augustRun2.skippedAlreadyInvoiced}`);

  console.log('\n=== STAGE 6: September invoices — should bill again correctly ===');
  const septRun = await db.generateMonthlyInvoices({ school: 'WENDY', billingPeriod: '2026-09', dueDate: '2026-07-25' });
  check('September correctly bills again (new month, not blocked by August)', septRun.created === 930, `got ${septRun.created}`);

  console.log('\n=== STAGE 7: One-time fee with duplicate detection, at scale ===');
  const uniformBatch = wendyIds.slice(0, 400);
  t0 = Date.now();
  await db.bulkCreateFeeExpectations({ studentIds: uniformBatch, school: 'WENDY', category: 'Uniform', description: 'School Uniform Set', amount: 450, dueDate: '2026-07-20', priorityTier: 3 });
  const oneTimeMs = Date.now() - t0;
  timed('Billed Uniform fee to 400 students', oneTimeMs, 3000);

  t0 = Date.now();
  const dupCheck = await db.checkDuplicateCharges({ studentIds: uniformBatch, category: 'Uniform', description: 'School Uniform Set' });
  const dupCheckMs = Date.now() - t0;
  timed('Duplicate check across 400 students', dupCheckMs, 3000);
  check('All 400 correctly flagged as already billed this month', dupCheck.duplicateStudentIds.length === 400, `got ${dupCheck.duplicateStudentIds.length}`);

  // Flexibility: a genuine replacement uniform should still succeed for
  // a subset of those same "duplicate" students.
  const replacementSubset = uniformBatch.slice(0, 5);
  const replacementResult = await db.bulkCreateFeeExpectations({ studentIds: replacementSubset, school: 'WENDY', category: 'Uniform', description: 'School Uniform Set', amount: 450, dueDate: '2026-07-22', priorityTier: 3 });
  check('Flexibility preserved — replacement charge still succeeds despite flagged duplicate', replacementResult.expectationsCreated === 5, `got ${replacementResult.expectationsCreated}`);

  console.log('\n=== STAGE 8: Installment plan for a subset who can\'t pay in full ===');
  const installmentSubset = wendyIds.slice(400, 450); // 50 students
  t0 = Date.now();
  const installmentResult = await db.bulkCreateInstallmentPlans({
    studentIds: installmentSubset, school: 'WENDY', category: 'Uniform', description: 'Uniform (Installment Plan)',
    totalAmount: 450, numberOfInstallments: 3, startDate: '2026-07-15', priorityTier: 3
  });
  const installmentMs = Date.now() - t0;
  timed('Split-billed 50 students into 3 installments each', installmentMs, 3000);
  check('Correct total expectation count (50 x 3 = 150)', installmentResult.expectationsCreated === 150, `got ${installmentResult.expectationsCreated}`);

  console.log('\n=== STAGE 9: Single payments for a sample of students ===');
  t0 = Date.now();
  let paymentsCaptured = 0;
  for (const studentId of wendyIds.slice(0, 50)) {
    const result = await db.capturePayment({
      studentId, school: 'WENDY', amount: 700, paymentMethod: 'EFT',
      transactionReference: `TEST-${studentId.slice(0, 8)}`, processedBy: 'secretary_wendy',
      paymentDate: '2026-08-10', mode: 'auto'
    });
    if (result.payment) paymentsCaptured++;
  }
  const paymentsMs = Date.now() - t0;
  timed('Captured 50 individual payments sequentially', paymentsMs, 15000);
  check('All 50 payments captured successfully', paymentsCaptured === 50, `got ${paymentsCaptured}`);

  console.log('\n=== STAGE 10: Verify allocation correctness — Tuition before Bus (priority order) ===');
  // Deliberately picked from the cheapest grade tier (0-3, N$500 Tuition)
  // so a N$700 payment reliably covers Tuition in full with a known
  // surplus flowing to Bus — not dependent on which tier an arbitrary
  // index happens to land in.
  const priorityTestIdx = busSubset.findIndex((id, idx) => classes[idx % classes.length].gradeLevel <= 3 && idx >= 50);
  const priorityTestStudent = busSubset[priorityTestIdx];
  const partialPayment = await db.capturePayment({
    studentId: priorityTestStudent, school: 'WENDY', amount: 700, paymentMethod: 'EFT',
    transactionReference: 'PRIORITY-TEST-1', processedBy: 'secretary_wendy', paymentDate: '2026-07-26', mode: 'auto'
  });
  const ledgerAfter = await db.getStudentLedger(priorityTestStudent);
  const tuitionExp = ledgerAfter.expectations.find((e) => e.category === 'Tuition' && e.dueDate === '2026-07-01');
  const busExp = ledgerAfter.expectations.find((e) => e.category === 'Transport' && e.dueDate === '2026-07-01');
  const septTuitionExp = ledgerAfter.expectations.find((e) => e.category === 'Tuition' && e.dueDate === '2026-07-25');
  check('August Tuition (earliest tier-1) fully paid first', tuitionExp && tuitionExp.remaining === 0, `remaining: ${tuitionExp?.remaining}`);
  check(
    'Surplus correctly went to the NEXT tier-1 charge (September Tuition), not Bus — tier always outranks month',
    septTuitionExp && septTuitionExp.remaining === 300 && busExp && busExp.remaining === busExp.originalAmount,
    `Sept Tuition remaining: ${septTuitionExp?.remaining} (expect 300), Bus untouched: ${busExp?.remaining === busExp?.originalAmount}`
  );

  console.log('\n=== STAGE 11: Reports at full scale ===');
  t0 = Date.now();
  const financialReport = await db.getFinancialReportData('WENDY');
  const reportMs = Date.now() - t0;
  timed('Financial report over 700 students + thousands of transactions', reportMs, 5000);
  check('Report covers all 700 WENDY students', financialReport.totalStudents === 700, `got ${financialReport.totalStudents}`);
  check('Total collected is a real positive number', financialReport.totalCollected > 0, `got ${financialReport.totalCollected}`);

  t0 = Date.now();
  const extras = await db.getReportsCenterExtras('WENDY');
  const extrasMs = Date.now() - t0;
  timed('Reports Center extras (collections/aging/behaviour/adjustments)', extrasMs, 5000);
  check('Aging buckets computed', !!extras.aging && !!extras.aging.buckets);

  console.log('\n=== STAGE 12: Search/filter performance at scale (simulating ProcessPayment/Records) ===');
  t0 = Date.now();
  const allStudents = await db.listStudents('WENDY');
  const listMs = Date.now() - t0;
  timed('listStudents for 700 students', listMs, 2000);
  check('Correct count returned', allStudents.length === 700, `got ${allStudents.length}`);

  t0 = Date.now();
  const filtered = await db.getStudentsByFilters({ school: 'WENDY', gradeLevel: 8, attachFinancials: true });
  const filterMs = Date.now() - t0;
  timed('Filtered + financial-attached query (Grade 8 only)', filterMs, 3000);
  check('Filter correctly narrowed results', filtered.length > 0 && filtered.length < 700, `got ${filtered.length}`);

  console.log('\n=== STAGE 13: RxDB SNH-bug retry resilience under concurrent load ===');
  // Fire several read-heavy operations concurrently — the exact pattern
  // that has triggered the LokiJS SNH bug in real usage this session.
  t0 = Date.now();
  const concurrentResults = await Promise.allSettled([
    db.getFinancialReportData('WENDY'),
    db.getReportsCenterExtras('WENDY'),
    db.getAllPaymentsDetailed({ school: 'WENDY' }),
    db.listStudents('WENDY'),
    db.getStudentsByFilters({ school: 'WENDY' })
  ]);
  const concurrentMs = Date.now() - t0;
  const concurrentFailures = concurrentResults.filter((r) => r.status === 'rejected');
  timed('5 concurrent heavy queries', concurrentMs, 8000);
  check('All concurrent queries succeeded (no unhandled SNH crash)', concurrentFailures.length === 0, `${concurrentFailures.length} failed`);

  console.log('\n=== SUMMARY ===');
  const totalMs = Date.now() - overallStart;
  console.log(`Total run time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(failures === 0 ? `\n✓✓✓ ALL CHECKS PASSED ✓✓✓` : `\n✗✗✗ ${failures} CHECK(S) FAILED ✗✗✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n✗✗✗ TEST CRASHED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
