'use strict';

// db/ledger-engine.js
//
// Pure functions only — no RxDB, no I/O. Every formula here is a direct
// implementation of Master Spec Section 2 ("Core Accounting & Business
// Logic"). Keeping this pure and separate from db.js means it can be unit
// tested in isolation and reused for reporting (invoices, statements)
// without touching the database layer.

function daysBetween(earlier, later) {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------- R(E_k): remaining balance on one expectation ----------
// R(E_k) = V(E_k) - sum of Allocations against it - sum of Adjustment
// Allocations against it. Never stored — always derived.
function computeExpectationRemaining(expectation, allocations, adjustmentAllocations) {
  const allocated = allocations
    .filter((a) => a.expectationId === expectation.expectationId)
    .reduce((sum, a) => sum + a.amountAllocated, 0);
  const adjusted = adjustmentAllocations
    .filter((a) => a.expectationId === expectation.expectationId)
    .reduce((sum, a) => sum + a.amountAllocated, 0);
  const remaining = expectation.originalAmount - allocated - adjusted;
  return Math.max(0, round2(remaining));
}

// ---------- B(t): rolling account balance for a student ----------
// B(t) = sum(debits) - sum(cashless credits received) - sum(admin adjustments)
// Uses total payments received (not just what's been allocated) — an
// unallocated surplus still reduces the balance; it just sits in the
// prepayment pool until swept against a future/ad-hoc expectation.
function computeRollingBalance(studentExpectations, studentPayments, studentAdjustmentAllocations) {
  const totalDebits = studentExpectations.reduce((sum, e) => sum + e.originalAmount, 0);
  const totalPayments = studentPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalAdjustments = studentAdjustmentAllocations.reduce((sum, a) => sum + a.amountAllocated, 0);
  return round2(totalDebits - totalPayments - totalAdjustments);
}

// ---------- S(s): Real-Time Financial Health Categorization (Spec 2.E) ----------
function computeFinancialHealth({ expectations, payments, allocations, adjustmentAllocations, now = new Date() }) {
  const balance = computeRollingBalance(expectations, payments, adjustmentAllocations);

  if (balance < 0) return { status: 'Overpaid', balance };
  if (balance === 0) return { status: 'Good', balance };

  const outstanding = expectations.filter(
    (e) => computeExpectationRemaining(e, allocations, adjustmentAllocations) > 0
  );
  const maxAgeDays = outstanding.length
    ? Math.max(...outstanding.map((e) => daysBetween(new Date(e.dueDate), now)))
    : 0;

  if (maxAgeDays < 30) return { status: 'OK', balance, maxAgeDays };
  if (maxAgeDays < 90) return { status: 'Debtors', balance, maxAgeDays };
  return { status: 'Chronic Debtors', balance, maxAgeDays };
}

// ---------- Priority-Tiered Allocation Engine (Spec 2.C) ----------
// Given a payment and the student's outstanding expectations (each needs
// {expectationId, priorityTier, dueDate, remaining}), resolves allocations
// tier-by-tier (1 -> 4), chronologically within each tier, only considering
// expectations already due. Leftover money becomes the unallocated surplus
// (prepayment pool).
function allocatePaymentAutoFIFO(paymentAmount, outstandingExpectations, now = new Date()) {
  let remaining = round2(paymentAmount);
  const allocations = [];

  const due = outstandingExpectations.filter((e) => new Date(e.dueDate) <= now && e.remaining > 0);
  const sorted = [...due].sort(
    (a, b) => a.priorityTier - b.priorityTier || new Date(a.dueDate) - new Date(b.dueDate)
  );

  for (const exp of sorted) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(remaining, exp.remaining));
    if (amount > 0) {
      allocations.push({ expectationId: exp.expectationId, amountAllocated: amount });
      remaining = round2(remaining - amount);
    }
  }

  return { allocations, unallocatedSurplus: round2(remaining) };
}

// ---------- Manual Split Mode / Directed Partial Allocation (Spec 4 & 9) ----------
// The secretary hand-picks exactly which expectations get how much.
// Validates sum(directed amounts) <= payment amount before returning.
function allocatePaymentDirected(paymentAmount, directedAllocationSet, outstandingExpectationsById) {
  const totalDirected = directedAllocationSet.reduce((sum, d) => sum + d.amount, 0);
  if (round2(totalDirected) > round2(paymentAmount)) {
    throw new Error('Directed allocation total exceeds the payment amount.');
  }

  const allocations = [];
  for (const { expectationId, amount } of directedAllocationSet) {
    const exp = outstandingExpectationsById[expectationId];
    if (!exp) throw new Error(`Unknown expectation: ${expectationId}`);
    if (round2(amount) > round2(exp.remaining)) {
      throw new Error(`Directed amount for ${expectationId} exceeds its remaining balance.`);
    }
    if (amount > 0) allocations.push({ expectationId, amountAllocated: round2(amount) });
  }

  const unallocatedSurplus = round2(paymentAmount - totalDirected);
  return { allocations, unallocatedSurplus };
}

// ---------- Admin Adjustment allocation (Spec 8.2) ----------
// A: direct offset to one expectation. B: category-constrained chronological
// sweep — a "Tuition Waiver" can only ever satisfy Tuition expectations,
// never sweep into boarding/uniform/etc.
function allocateAdjustment(adjustment, candidateExpectations, now = new Date()) {
  let remaining = round2(adjustment.amount);
  const allocations = [];

  if (adjustment.targetExpectationId) {
    const exp = candidateExpectations.find((e) => e.expectationId === adjustment.targetExpectationId);
    if (exp && exp.remaining > 0) {
      const amount = round2(Math.min(remaining, exp.remaining));
      if (amount > 0) {
        allocations.push({ expectationId: exp.expectationId, amountAllocated: amount });
        remaining = round2(remaining - amount);
      }
    }
  } else if (adjustment.targetCategory) {
    const sorted = candidateExpectations
      .filter((e) => e.category === adjustment.targetCategory && e.remaining > 0)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    for (const exp of sorted) {
      if (remaining <= 0) break;
      const amount = round2(Math.min(remaining, exp.remaining));
      if (amount > 0) {
        allocations.push({ expectationId: exp.expectationId, amountAllocated: amount });
        remaining = round2(remaining - amount);
      }
    }
  }

  return { allocations, unusedAmount: round2(remaining) };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  computeExpectationRemaining,
  computeRollingBalance,
  computeFinancialHealth,
  allocatePaymentAutoFIFO,
  allocatePaymentDirected,
  allocateAdjustment,
  daysBetween,
  round2
};
