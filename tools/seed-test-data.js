'use strict';

// tools/seed-test-data.js
//
// Adds 5 realistic students (with guardians, fee expectations, and
// payments) so the app has something real to look at — dashboards, reports,
// and PDFs all currently show empty states on a fresh install, since only
// the 4 default accounts and 24 fee catalog templates auto-seed.
//
// Deliberately NOT run automatically on every fresh install — this is test
// data, not production data. A real school's first launch should start
// clean, not with a fake "Grace Kambonde" already in the system.
//
// Run with:  npm run seed:test-data
// (launches the real Electron app in the background just long enough to
// seed through the actual business logic — capturePayment, the ledger
// engine, etc. — then exits without opening a window. Uses the same
// database the app itself uses, so this is real data, not a separate file.)

async function seedTestData(db) {
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const results = [];

  // ---------------------------------------------------------------------
  // 1. Grace Kambonde — Good standing (fully paid)
  // ---------------------------------------------------------------------
  const g1 = await db.createGuardian({
    firstName: 'Paulina', lastName: 'Kambonde', relationship: 'Mother',
    phonePrimary: '0812223333', email: 'p.kambonde@gmail.com',
    addressLine1: '14 Independence Ave', city: 'Windhoek',
    employerName: 'Namibia Breweries Limited', jobTitle: 'Accountant',
    employerPhone: '061123456'
  });
  const s1 = await db.createStudent({
    firstName: 'Grace', lastName: 'Kambonde', school: 'WENDY',
    guardianId: g1.guardianId, gender: 'Female', dateOfBirth: '2013-03-14',
    enrollmentDate: '2025-01-15', sponsorType: 'Parent'
  });
  const e1 = await db.createFeeExpectation({
    studentId: s1.studentId, school: 'WENDY', category: 'Tuition',
    description: 'Grade 8 Tuition — Term 3', originalAmount: 900,
    dueDate: daysAgo(10), priorityTier: 1
  });
  await db.capturePayment({
    studentId: s1.studentId, school: 'WENDY', amount: 900, paymentMethod: 'EFT',
    transactionReference: 'FNB-2026-88213', payerName: 'Paulina Kambonde',
    processedBy: 'secretary_wendy', paymentDate: daysAgo(9)
  });
  results.push('Grace Kambonde — Good standing');

  // ---------------------------------------------------------------------
  // 2. Junior Nangolo — OK (recently overdue, under 30 days)
  // ---------------------------------------------------------------------
  const g2 = await db.createGuardian({
    firstName: 'Erastus', lastName: 'Nangolo', relationship: 'Father',
    phonePrimary: '0855671234', email: 'e.nangolo@yahoo.com',
    addressLine1: '7 Omeya Street', city: 'Ondangwa'
  });
  const s2 = await db.createStudent({
    firstName: 'Junior', lastName: 'Nangolo', school: 'WENDY',
    guardianId: g2.guardianId, gender: 'Male', dateOfBirth: '2016-07-22',
    enrollmentDate: '2025-01-15', usesBus: true, busType: 'Grade 1-12',
    sponsorType: 'Parent'
  });
  await db.createFeeExpectation({
    studentId: s2.studentId, school: 'WENDY', category: 'Tuition',
    description: 'Grade 5 Tuition — Term 3', originalAmount: 850,
    dueDate: daysAgo(15), priorityTier: 1
  });
  await db.createFeeExpectation({
    studentId: s2.studentId, school: 'WENDY', category: 'Transport',
    description: 'School Bus — Term 3', originalAmount: 600,
    dueDate: daysAgo(15), priorityTier: 2
  });
  results.push('Junior Nangolo — OK (15 days overdue, unpaid)');

  // ---------------------------------------------------------------------
  // 3. Selma Shivute — Debtors (30-90 days overdue, partially paid)
  // ---------------------------------------------------------------------
  const g3 = await db.createGuardian({
    firstName: 'Maria', lastName: 'Shivute', relationship: 'Mother',
    phonePrimary: '0817778888', email: 'maria.shivute@gmail.com',
    addressLine1: '22 Sam Nujoma Drive', city: 'Windhoek'
  });
  const s3 = await db.createStudent({
    firstName: 'Selma', lastName: 'Shivute', school: 'WENDY',
    guardianId: g3.guardianId, gender: 'Female', dateOfBirth: '2011-11-02',
    enrollmentDate: '2024-01-15', sponsorType: 'Parent'
  });
  await db.createFeeExpectation({
    studentId: s3.studentId, school: 'WENDY', category: 'Tuition',
    description: 'Grade 10 Tuition — Term 2', originalAmount: 1000,
    dueDate: daysAgo(50), priorityTier: 1
  });
  await db.createFeeExpectation({
    studentId: s3.studentId, school: 'WENDY', category: 'Extracurricular',
    description: 'Netball Club — Term 2', originalAmount: 180,
    dueDate: daysAgo(50), priorityTier: 3
  });
  // Partial payment — auto-FIFO will apply this to Tuition first (tier 1),
  // leaving Netball (tier 3) fully outstanding and Tuition partly reduced.
  await db.capturePayment({
    studentId: s3.studentId, school: 'WENDY', amount: 400, paymentMethod: 'POS',
    transactionReference: 'POS-77241190', payerName: 'Maria Shivute',
    processedBy: 'secretary_wendy', paymentDate: daysAgo(48)
  });
  results.push('Selma Shivute — Debtors (~50 days overdue, partial payment)');

  // ---------------------------------------------------------------------
  // 4. David Kapenda — Chronic Debtors (90+ days), company-sponsored
  // ---------------------------------------------------------------------
  const g4 = await db.createGuardian({
    firstName: 'Johannes', lastName: 'Kapenda', relationship: 'Father',
    phonePrimary: '0813334444', email: 'j.kapenda@outlook.com',
    addressLine1: '5 Mandume Street', city: 'Windhoek'
  });
  const sponsor4 = await db.createSponsor({
    school: 'WENDY', name: 'Namdeb Diamond Corporation', type: 'Company',
    contactPerson: 'Ester Hango', phone: '063210000',
    email: 'community@namdeb.com'
  });
  const s4 = await db.createStudent({
    firstName: 'David', lastName: 'Kapenda', school: 'WENDY',
    guardianId: g4.guardianId, gender: 'Male', dateOfBirth: '2018-05-30',
    enrollmentDate: '2025-01-15', sponsorType: 'Company', sponsorId: sponsor4.sponsorId
  });
  await db.createFeeExpectation({
    studentId: s4.studentId, school: 'WENDY', category: 'Tuition',
    description: 'Grade 3 Tuition — Term 1', originalAmount: 800,
    dueDate: daysAgo(130), priorityTier: 1
  });
  results.push('David Kapenda — Chronic Debtors (~130 days overdue, sponsor: Namdeb, unpaid)');

  // ---------------------------------------------------------------------
  // 5. Ndamona Amutenya — Overpaid (paying ahead), on scholarship
  // ---------------------------------------------------------------------
  const g5 = await db.createGuardian({
    firstName: 'Selma', lastName: 'Amutenya', relationship: 'Mother',
    phonePrimary: '0854445555', email: 'selma.amutenya@gmail.com',
    addressLine1: '31 Nangolo Mbumba Drive', city: 'Windhoek'
  });
  const s5 = await db.createStudent({
    firstName: 'Ndamona', lastName: 'Amutenya', school: 'WENDY',
    guardianId: g5.guardianId, gender: 'Female', dateOfBirth: '2015-09-18',
    enrollmentDate: '2025-01-15', isOnScholarship: true, sponsorType: 'Self'
  });
  await db.createFeeExpectation({
    studentId: s5.studentId, school: 'WENDY', category: 'Tuition',
    description: 'Grade 6 Tuition — Term 3', originalAmount: 870,
    dueDate: daysAgo(5), priorityTier: 1
  });
  // Paid three months' worth against one month's expectation — the
  // surplus becomes genuine "months ahead" credit.
  await db.capturePayment({
    studentId: s5.studentId, school: 'WENDY', amount: 2610, paymentMethod: 'EFT',
    transactionReference: 'FNB-2026-91002', payerName: 'Selma Amutenya',
    processedBy: 'secretary_wendy', paymentDate: daysAgo(4)
  });
  results.push('Ndamona Amutenya — Overpaid (paid 3 months ahead, on scholarship)');

  return results;
}

module.exports = { seedTestData };
