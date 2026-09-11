import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, AlertTriangle, Users, FileDown, FileSpreadsheet,
  AlertCircle, CheckCircle2, Clock, Award, CreditCard, Banknote, ClipboardList, X, Printer, Edit2
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import Pagination from './ui/Pagination.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };
const PAGE_SIZE = 10;

const CATEGORY_META = {
  all: { label: 'All Students', icon: Users, color: '#0e7490' },
  'Chronic Debtors': { label: 'Chronic Debtors', icon: AlertCircle, color: '#dc2626' },
  Debtors: { label: 'Debtors', icon: AlertTriangle, color: '#d97706' },
  OK: { label: 'OK', icon: Clock, color: '#2563eb' },
  Good: { label: 'Good Standing', icon: CheckCircle2, color: '#16a34a' },
  Overpaid: { label: 'Paying Ahead', icon: Award, color: '#7c3aed' }
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'collections', label: 'Collection Reports' },
  { key: 'aging', label: 'Outstanding / Aging' },
  { key: 'behaviour', label: 'Payment Behaviour' },
  { key: 'adjustments', label: 'Adjustment Reports' },
  { key: 'studentReports', label: 'Student & Category Reports' }
];

export function money(n) {
  return 'N$ ' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function downloadExcel(rows, sheetName, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ---------------------------------------------------------------------------
// Shared PDF letterhead — the single canonical version. This used to be
// duplicated between Reports.jsx (a simpler version) and StudentHub.jsx (a
// fuller, reports.php-matched version); StudentHub.jsx now imports these
// from here instead of keeping its own copy.
// ---------------------------------------------------------------------------
export const SCHOOL_LETTERHEAD = {
  WENDY: {
    name: 'WENDY PRIVATE SCHOOL', tagline: 'Knowledge with integrity',
    address: 'Onesi, Oshana region \u2022 P.O BOX 2958 Ondangwa',
    phone: 'Phone: 065 245 823 | 081 263 1558 | 081 665 4551',
    contact: 'Email: info@wendyprivateschool.com \u2022 Website: www.wendyprivateschool.com'
  },
  KEILA: {
    name: 'KEILA ACADEMY', tagline: 'Excellence in every subject',
    address: 'Windhoek, Khomas region',
    phone: 'Phone: 061 000 0000',
    contact: 'Email: info@keilaacademy.com'
  }
};

// Loaded once and cached — every report reuses the same base64 string
// instead of re-loading the logo file per PDF. Uses an Image element
// rather than fetch(), since fetch() does not support the file:// scheme
// at all (confirmed by testing — it throws immediately), while <img> /
// Image() loading file:// paths is the same mechanism already working
// throughout the rest of this app (login screen, dashboard headers).
let cachedLogoBase64 = null;
function getLogoBase64() {
  if (cachedLogoBase64) return Promise.resolve(cachedLogoBase64);
  return window.electronAPI.getLogoBase64().then((result) => {
    if (!result.success) {
      console.warn('Could not load logo for PDF letterhead:', result.message);
      return null;
    }
    // The IPC call already sidesteps the file:// canvas-tainting issue by
    // reading via fs in the main process — but the source PNG can be a
    // few hundred KB, which would bloat every generated PDF. Downscaling
    // via canvas here is safe now (data: URLs don't taint canvases, only
    // file:// sources do), and keeps every report's letterhead small.
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 200;
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth * scale;
          canvas.height = img.naturalHeight * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          cachedLogoBase64 = canvas.toDataURL('image/png');
          resolve(cachedLogoBase64);
        } catch (err) {
          console.warn('Could not downscale logo for PDF letterhead:', err.message);
          resolve(result.dataUrl); // fall back to the full-size version rather than no logo at all
        }
      };
      img.onerror = () => resolve(result.dataUrl);
      img.src = result.dataUrl;
    });
  });
}

// ---------------------------------------------------------------------------
// Thermal receipt — for the parent, right after a payment is captured.
// A real thermal printer's fixed roll width, not a scaled-down A4 page:
// 80mm wide, height computed from actual content rather than fixed, since
// receipt length varies (a plain payment vs. one with a surplus note).
// Works two ways: window.electronAPI.printPdf() to send it straight to a
// printer (thermal or otherwise, whatever Windows has configured), or
// doc.save() as a normal PDF download — both use this exact same layout.
// ---------------------------------------------------------------------------
export async function generateThermalReceiptPdf({ school, studentName, studentNumber, amount, paymentMethod, transactionReference, payerName, processedBy, paymentDate, surplus, receiptNo }) {
  const info = SCHOOL_LETTERHEAD[school] || SCHOOL_LETTERHEAD.WENDY;
  const widthMm = 80;
  const marginMm = 4;
  const contentWidth = widthMm - marginMm * 2;

  // Estimate height from content so the page isn't a fixed, wrong length —
  // a rough per-line budget in mm, generous enough to never clip.
  let estimatedLines = 20;
  if (surplus > 0) estimatedLines += 3;
  if (payerName) estimatedLines += 1;
  const heightMm = Math.max(90, estimatedLines * 5.2);

  const doc = new jsPDF({ unit: 'mm', format: [widthMm, heightMm] });

  let y = marginMm;
  const centerX = widthMm / 2;

  const logo = await getLogoBase64();
  if (logo) {
    const logoSize = 14;
    try {
      doc.addImage(logo, 'PNG', centerX - logoSize / 2, y, logoSize, logoSize);
      y += logoSize + 2;
    } catch { /* logo failed to embed — continue without it rather than fail the whole receipt */ }
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(info.name, centerX, y, { align: 'center' }); y += 4.2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
  doc.text(doc.splitTextToSize(info.address, contentWidth), centerX, y, { align: 'center' }); y += 3.4;
  doc.text(info.phone, centerX, y, { align: 'center' }); y += 4.5;

  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.line(marginMm, y, widthMm - marginMm, y); y += 3.5;
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('PAYMENT RECEIPT', centerX, y, { align: 'center' }); y += 5;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
  const row = (label, value) => {
    doc.text(label, marginMm, y);
    doc.text(String(value ?? '\u2014'), widthMm - marginMm, y, { align: 'right' });
    y += 4.3;
  };
  row('Receipt No.', receiptNo || transactionReference);
  row('Date', paymentDate);
  row('Student', studentName);
  row('Admission No.', studentNumber);
  if (payerName) row('Paid By', payerName);
  row('Method', paymentMethod);
  row('Reference', transactionReference);

  y += 1;
  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.line(marginMm, y, widthMm - marginMm, y); y += 4;
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('AMOUNT PAID', marginMm, y);
  doc.text(money(amount), widthMm - marginMm, y, { align: 'right' });
  y += 5;

  if (surplus > 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6);
    const note = `${money(surplus)} exceeded what was owed and is now credited ahead against future fees.`;
    const lines = doc.splitTextToSize(note, contentWidth);
    doc.text(lines, marginMm, y); y += lines.length * 3.2 + 2;
  }

  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.line(marginMm, y, widthMm - marginMm, y); y += 4;
  doc.setLineDashPattern([], 0);

  doc.setFontSize(6.6);
  doc.text(`Processed by: ${processedBy}`, marginMm, y); y += 4.5;
  doc.setFont('helvetica', 'italic');
  doc.text('Thank you for your payment.', centerX, y, { align: 'center' }); y += 3.6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.text('This is a computer-generated receipt.', centerX, y, { align: 'center' });

  return doc;
}

export async function drawLetterheadHeader(doc, school, title, subtitle) {
  const l = SCHOOL_LETTERHEAD[school] || SCHOOL_LETTERHEAD.WENDY;
  let y = 15;

  const logo = await getLogoBase64();
  if (logo) {
    // Top-right corner — enlarged slightly from the original 22x22,
    // right-aligned to the same 196mm margin the rest of the page uses.
    try { doc.addImage(logo, 'PNG', 170, 9, 26, 26); } catch (_) { /* non-fatal if the format trips up jsPDF */ }
  }

  doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.setTextColor(0);
  doc.text(l.name, 14, y); y += 5;
  doc.setFont(undefined, 'italic'); doc.setFontSize(8);
  doc.text(l.tagline, 14, y); y += 5;
  doc.setFont(undefined, 'normal'); doc.setFontSize(7); doc.setTextColor(90);
  doc.text(l.address, 14, y); y += 4;
  doc.text(l.phone, 14, y); y += 4;
  doc.text(l.contact, 14, y); y += 6;

  doc.setDrawColor(200); doc.line(14, y, 196, y); y += 8;

  doc.setTextColor(0); doc.setFont(undefined, 'bold'); doc.setFontSize(14);
  doc.text(title, 105, y, { align: 'center' }); y += 6;
  if (subtitle) {
    doc.setFont(undefined, 'italic'); doc.setFontSize(9);
    doc.text(subtitle, 105, y, { align: 'center' }); y += 5;
  }
  doc.setFont(undefined, 'normal'); doc.setTextColor(0);
  return y + 4;
}

export function drawLetterheadFooter(doc, school) {
  const l = SCHOOL_LETTERHEAD[school] || SCHOOL_LETTERHEAD.WENDY;
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont(undefined, 'italic'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Page ${i}/${pageCount}`, 105, 285, { align: 'center' });
    doc.setFontSize(7);
    doc.text(`Official Communication - ${l.name} \u2022 Generated on ${new Date().toLocaleString()}`, 105, 290, { align: 'center' });
  }
}

export function drawSectionHeading(doc, y, text, size = 12) {
  doc.setFont(undefined, 'bold'); doc.setFontSize(size); doc.setTextColor(0);
  doc.text(text, 14, y);
  doc.setDrawColor(180); doc.line(14, y + 2, 196, y + 2);
  doc.setFont(undefined, 'normal');
  return y + 9;
}

export async function generateStudentStatementPdf(data, school, mode = 'student') {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const s = data.student;
  const g = data.guardian;

  let y = await drawLetterheadHeader(doc, school, 'STATEMENT OF ACCOUNT', new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));

  doc.setFont(undefined, 'normal'); doc.setFontSize(10);
  if (g) {
    doc.text(`${g.firstName} ${g.lastName}`, marginX, y); y += 5;
    if (g.addressLine1) { doc.text(g.addressLine1, marginX, y); y += 5; }
    if (g.city) { doc.text(`${g.city}${g.country ? ', ' + g.country : ''}`, marginX, y); y += 5; }
    y += 7;
  }

  doc.setFont(undefined, 'bold');
  doc.text(`Re: ${s.firstName} ${s.lastName} (${s.studentNumber})`, marginX, y);
  doc.setFont(undefined, 'normal');
  y += 9;

  doc.text(`Dear ${g?.relationship || 'Guardian'} ${g?.lastName || ''},`.trim(), marginX, y);
  y += 9;

  const opening = data.ledger.balance > 0
    ? `This letter is to remind you that ${s.firstName}'s account currently shows an outstanding balance. A statement of the account is set out below so you can see exactly how this figure was reached, and we would appreciate settlement at your earliest convenience.`
    : `Please find below a statement of account for ${s.firstName}, covering recent activity to date.`;
  const openingLines = doc.splitTextToSize(opening, pageWidth - marginX * 2);
  doc.text(openingLines, marginX, y);
  y += openingLines.length * 5.2 + 8;

  function ensureSpace(need) { if (y > pageHeight - need) { doc.addPage(); y = 20; } }

  y = drawSectionHeading(doc, y, 'Transaction History (Last 3 Months)');
  const col = { date: marginX, desc: marginX + 22, descWidth: 58, chargedEnd: marginX + 108, paidEnd: marginX + 135, balanceEnd: marginX + 165 };
  const tableRight = marginX + 165;
  const rowHeight = 6.4;

  function drawTableHeader() {
    doc.setFillColor(15, 23, 42);
    doc.rect(marginX, y - 5, tableRight - marginX, 7, 'F');
    doc.setFont(undefined, 'bold'); doc.setFontSize(8.8);
    doc.setTextColor(255, 255, 255);
    doc.text('Date', col.date + 1, y);
    doc.text('Description', col.desc, y);
    doc.text('Charged', col.chargedEnd, y, { align: 'right' });
    doc.text('Paid', col.paidEnd, y, { align: 'right' });
    doc.text('Balance', col.balanceEnd, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.8);
    y += 7;
  }

  drawTableHeader();
  let rowIndex = 0;
  data.transactions.forEach((t) => {
    const descLines = doc.splitTextToSize(String(t.description || ''), col.descWidth);
    const thisRowHeight = Math.max(rowHeight, descLines.length * 4.3 + 2);
    if (y > pageHeight - 26) { doc.addPage(); y = 22; drawTableHeader(); rowIndex = 0; }
    if (rowIndex % 2 === 1) {
      doc.setFillColor(246, 248, 250);
      doc.rect(marginX, y - 4.2, tableRight - marginX, thisRowHeight, 'F');
    }
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.8);
    doc.text(String(t.date || ''), col.date + 1, y);
    doc.text(descLines, col.desc, y);
    doc.text(t.debit ? money(t.debit) : '\u2014', col.chargedEnd, y, { align: 'right' });
    doc.text(t.credit ? money(t.credit) : '\u2014', col.paidEnd, y, { align: 'right' });
    doc.setFont(undefined, 'bold');
    doc.text(money(t.balance), col.balanceEnd, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    y += thisRowHeight;
    rowIndex += 1;
  });
  doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.4);
  doc.line(marginX, y - 2, tableRight, y - 2);
  doc.setLineWidth(0.2);
  y += 8;

  doc.setFont(undefined, 'bold'); doc.setFontSize(12);
  doc.text('Current Balance:', marginX, y);
  doc.setTextColor(data.ledger.balance > 0 ? 200 : 20, data.ledger.balance > 0 ? 40 : 130, data.ledger.balance > 0 ? 40 : 60);
  doc.text(money(data.ledger.balance), marginX + 55, y);
  doc.setTextColor(0, 0, 0);
  y += 14;

  doc.setFont(undefined, 'normal'); doc.setFontSize(10);
  const closing = data.ledger.balance > 0
    ? 'We would appreciate settlement of this balance at your earliest convenience, by EFT or card payment. If you have any questions about any item on this statement, or would like to discuss a payment plan, please don\u2019t hesitate to contact the finance office \u2014 we\u2019re glad to help.'
    : 'Thank you for keeping this account up to date. If anything on this statement looks incorrect, please don\u2019t hesitate to contact the finance office.';
  ensureSpace(30);
  const closingLines = doc.splitTextToSize(closing, pageWidth - marginX * 2);
  doc.text(closingLines, marginX, y);
  y += closingLines.length * 5.2 + 12;

  if (mode === 'parent') {
    ensureSpace(20);
    y = drawSectionHeading(doc, y, 'Self-Audit');
    doc.setFontSize(9);
    const auditLines = doc.splitTextToSize('Please compare each line above against your own receipts. Contact the finance office directly about any discrepancy.', pageWidth - marginX * 2);
    doc.text(auditLines, marginX, y);
    y += auditLines.length * 4.8 + 10;
  }

  ensureSpace(25);
  doc.text('Kind regards,', marginX, y); y += 12;
  doc.setFont(undefined, 'bold');
  doc.text('Finance Office', marginX, y);
  doc.setFont(undefined, 'normal');

  drawLetterheadFooter(doc, school);
  return doc;
}

export async function generateClassGradeStatementPdf(data, school, label) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightEdge = pageWidth - 14;
  let y = await drawLetterheadHeader(doc, school, label.toUpperCase(), `${data.students.length} student(s)`);
  y = drawSectionHeading(doc, y, 'Summary');
  doc.setFontSize(10);
  doc.text(`Total Expected: ${money(data.totalExpected)}`, 14, y);
  doc.text(`Total Collected: ${money(data.totalCollected)}`, 90, y);
  doc.text(`Outstanding: ${money(data.totalOutstanding)}`, 150, y);
  y += 10;
  y = drawSectionHeading(doc, y, 'Students');
  doc.setFontSize(9); doc.setFont(undefined, 'bold');
  doc.text('Name', 14, y); doc.text('Admission No', 90, y); doc.text('Status', 130, y); doc.text('Balance', rightEdge, y, { align: 'right' });
  y += 3; doc.setDrawColor(220); doc.line(14, y, rightEdge, y); y += 6; doc.setFont(undefined, 'normal');
  let totalBalance = 0;
  data.students.forEach((s) => {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.text(s.name.slice(0, 32), 14, y); doc.text(s.studentNumber, 90, y); doc.text(s.status, 130, y); doc.text(money(s.balance), rightEdge, y, { align: 'right' });
    totalBalance += s.balance;
    y += 6;
  });
  y += 2; doc.setDrawColor(0); doc.line(14, y, rightEdge, y); y += 6;
  doc.setFont(undefined, 'bold');
  doc.text('Total', 14, y); doc.text(money(totalBalance), rightEdge, y, { align: 'right' });
  drawLetterheadFooter(doc, school);
  return doc;
}

export async function generateFeeCategoryReportPdf(data, school) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightEdge = pageWidth - 14;
  let y = await drawLetterheadHeader(doc, school, `${data.category.toUpperCase()} FEES REPORT`, `${data.rows.length} charge(s)`);
  y = drawSectionHeading(doc, y, 'Summary');
  doc.setFontSize(10);
  doc.text(`Total Expected: ${money(data.totalExpected)}`, 14, y);
  doc.text(`Total Collected: ${money(data.totalCollected)}`, 90, y);
  doc.text(`Outstanding: ${money(data.totalOutstanding)}`, 150, y);
  y += 10;
  y = drawSectionHeading(doc, y, 'Charges');
  doc.setFontSize(9); doc.setFont(undefined, 'bold');
  doc.text('Student', 14, y); doc.text('Description', 80, y); doc.text('Amount', 145, y); doc.text('Outstanding', rightEdge, y, { align: 'right' });
  y += 3; doc.setDrawColor(220); doc.line(14, y, rightEdge, y); y += 6; doc.setFont(undefined, 'normal');
  let totalAmount = 0, totalOutstanding = 0;
  data.rows.forEach((r) => {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.text(r.studentName.slice(0, 28), 14, y); doc.text((r.description || '').slice(0, 28), 80, y);
    doc.text(money(r.amount), 145, y); doc.text(money(r.remaining), rightEdge, y, { align: 'right' });
    totalAmount += r.amount; totalOutstanding += r.remaining;
    y += 6;
  });
  y += 2; doc.setDrawColor(0); doc.line(14, y, rightEdge, y); y += 6;
  doc.setFont(undefined, 'bold');
  doc.text('Total', 14, y); doc.text(money(totalAmount), 145, y); doc.text(money(totalOutstanding), rightEdge, y, { align: 'right' });
  drawLetterheadFooter(doc, school);
  return doc;
}

/**
 * A plain-language "how this app works" guide — deliberately different
 * from generateHelpGuidePdf below. That one is a technical click-path
 * reference ("click this, then that") for someone who already knows
 * roughly what they're doing. This one is for someone brand new to the
 * app: what each part is for, written the way you'd explain it out loud
 * to a person, not a list of button names. No jargon — "the system,"
 * not "the backend"; "gets matched to what's owed," not "allocation."
 */
/**
 * A pitch document for school leadership — not a user manual, not a
 * technical reference. This is for someone deciding whether to adopt
 * the system at all: what problem it solves, what it actually looks
 * like day to day, and why it can be trusted with the school's money
 * and records. Written the way you'd pitch it out loud to a principal
 * who has never used software like this before — no technical terms,
 * no feature lists for their own sake, just what changes for the school.
 */
export async function generateSchoolPitchPdf(school) {
  const info = SCHOOL_LETTERHEAD[school] || SCHOOL_LETTERHEAD.WENDY;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const contentWidth = pageWidth - marginX * 2;
  let y = 20;

  function ensureSpace(need) {
    if (y > pageHeight - need) { doc.addPage(); y = 20; }
  }
  function heading(text) {
    ensureSpace(20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.setTextColor(6, 120, 140);
    doc.text(text, marginX, y);
    doc.setTextColor(0, 0, 0);
    y += 3;
    doc.setDrawColor(6, 182, 212);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 9;
  }
  function paragraph(text, opts = {}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 10.5);
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(10);
      doc.text(line, marginX, y);
      y += 5.6;
    }
    y += 3;
  }
  function bulletPair(title, body) {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('\u2022 ' + title, marginX, y);
    y += 5.2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.8);
    const lines = doc.splitTextToSize(body, contentWidth - 10);
    for (const line of lines) {
      ensureSpace(10);
      doc.text(line, marginX + 8, y);
      y += 5;
    }
    y += 3;
  }

  // ---- Cover ----
  const logo = await getLogoBase64();
  if (logo) {
    try { doc.addImage(logo, 'PNG', pageWidth / 2 - 14, y, 28, 28); y += 34; } catch { /* continue without logo */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
  doc.text(info.name, pageWidth / 2, y, { align: 'center' }); y += 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13);
  doc.setTextColor(100);
  doc.text('A Simpler Way to Manage School Fees', pageWidth / 2, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 18;

  // ---- The problem, in plain terms ----
  heading('The Problem This Solves');
  paragraph('Right now, tracking who has paid, who still owes, and how much the school has actually collected usually means spreadsheets, paper receipt books, or a mix of both. Every one of those breaks down the same way: files get out of date, numbers get typed wrong, receipts get lost, and by the time anyone notices a mistake, it can take hours to figure out where it happened.');
  paragraph('None of that is anyone\u2019s fault \u2014 it\u2019s just what happens when a school\u2019s finances outgrow a spreadsheet. This system was built to replace that with something that keeps itself accurate, automatically.');

  // ---- What changes ----
  heading('What Actually Changes for the School');
  bulletPair(
    'Every student\u2019s balance is always correct, automatically.',
    'When a fee is due, it\u2019s recorded. When a payment comes in, it\u2019s matched against what\u2019s owed on its own \u2014 tuition first, always, before anything else like bus fees or fines. No one has to manually work out who owes what.'
  );
  bulletPair(
    'Every payment gets a real receipt, instantly.',
    'A parent pays, and a receipt prints or downloads on the spot \u2014 the same day, not "come back next week." Bank transfer slips can even be photographed and read automatically to help fill in the details.'
  );
  bulletPair(
    'Reports that used to take an afternoon now take a click.',
    'Who\u2019s behind on payments, how much came in this month, which students are on scholarship \u2014 all of it is a button press away, formatted and ready to print or hand to a board member.'
  );
  bulletPair(
    'Nothing important is ever silently lost.',
    'Every payment, every correction, every change is kept as a permanent record \u2014 who did it and when. If a mistake happens, it gets corrected openly, not erased.'
  );
  bulletPair(
    'It keeps working even without internet.',
    'The school doesn\u2019t stop functioning because the WiFi is down. Everything works locally on the computer, and quietly catches up and backs up online whenever a connection is available.'
  );

  // ---- Trust / safety, plainly ----
  heading('Why It Can Be Trusted With the School\u2019s Money');
  paragraph('This isn\u2019t a spreadsheet with a nicer look \u2014 it was built with the same care a bank would put into handling money:');
  bulletPair('Nothing gets deleted by accident.', 'Records can be corrected, but the original is always kept \u2014 there\u2019s always a clear trail of exactly what happened.');
  bulletPair('The school\u2019s data is backed up automatically.', 'Copies are saved automatically \u2014 daily, and every time the program starts \u2014 with an easy way to recover if anything ever goes wrong.');
  bulletPair('Different staff see only what they need to.', 'A secretary processing payments doesn\u2019t have the same access as an administrator approving changes \u2014 responsibilities stay separated, the way they should be.');

  // ---- A day in the life ----
  heading('What a Normal Day Looks Like');
  paragraph('A parent arrives to pay this month\u2019s tuition. The secretary looks up their child, enters the amount and how it was paid, and the system works out on its own what it should be applied to. A receipt is ready in seconds. That\u2019s the whole process \u2014 no separate ledger to update, no spreadsheet to reconcile later.');
  paragraph('At the end of the month, an administrator opens the reports screen and sees, at a glance, exactly how much came in, what\u2019s still outstanding, and which students need a reminder \u2014 all without asking anyone to pull numbers together by hand.');

  // ---- Closing ----
  heading('In Short');
  paragraph('This system takes the parts of managing school fees that are slow, repetitive, and easy to get wrong \u2014 and makes them automatic, accurate, and easy to check at any moment. The result: less time spent on paperwork, fewer mistakes, and a clearer picture of the school\u2019s finances than a spreadsheet could ever give.', { bold: true, size: 11 });

  drawLetterheadFooter(doc, school);
  return doc;
}

export async function generateSimpleUserGuidePdf(school, role) {
  const info = SCHOOL_LETTERHEAD[school] || SCHOOL_LETTERHEAD.WENDY;
  const isSecretary = role === 'Secretary';
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const contentWidth = pageWidth - marginX * 2;
  let y = 20;

  function ensureSpace(need) {
    if (y > pageHeight - need) { doc.addPage(); y = 20; }
  }
  function heading(text) {
    ensureSpace(20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.setTextColor(6, 120, 140);
    doc.text(text, marginX, y);
    doc.setTextColor(0, 0, 0);
    y += 3;
    doc.setDrawColor(6, 182, 212);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 8;
  }
  function paragraph(text) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(10);
      doc.text(line, marginX, y);
      y += 5.2;
    }
    y += 3;
  }
  function bullet(text) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(text, contentWidth - 8);
    ensureSpace(10);
    doc.text('\u2022', marginX + 2, y);
    doc.text(lines, marginX + 8, y);
    y += lines.length * 5.2 + 1.5;
  }

  // ---- Cover / welcome ----
  const logo = await getLogoBase64();
  if (logo) {
    try { doc.addImage(logo, 'PNG', pageWidth / 2 - 15, y, 30, 30); y += 36; } catch { /* continue without logo */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(info.name, pageWidth / 2, y, { align: 'center' }); y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13);
  doc.setTextColor(100);
  doc.text('A Simple Guide to the Fee Management System', pageWidth / 2, y, { align: 'center' }); y += 7;
  doc.setFontSize(10);
  doc.text(`For: ${isSecretary ? 'Secretaries' : 'Admin & Superadmin Users'}`, pageWidth / 2, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 20;

  paragraph('This guide explains what the system does and how to find your way around it. You don\u2019t need any technical background to use it \u2014 everything here is written the way you\u2019d explain it to a new staff member on their first day.');

  // ---- What this app actually does ----
  heading('What This App Actually Does');
  paragraph('At its heart, this app keeps track of two simple things for every student: what they owe, and what they\u2019ve paid. Everything else \u2014 registration, reports, receipts \u2014 is built around keeping those two numbers accurate and easy to check at any moment.');
  paragraph('When a fee is created for a student, it\u2019s recorded as something owed. When a payment comes in, it\u2019s matched against what\u2019s owed, oldest and most important first \u2014 tuition always gets settled before things like bus fees or fines, no matter which one happened to come up first.');
  paragraph('Nothing in this system is ever secretly deleted. If a mistake happens, it gets corrected with a new entry that explains what changed and why \u2014 so there\u2019s always a clear, honest paper trail of exactly what happened and when.');

  // ---- The sidebar ----
  heading('Finding Your Way Around \u2014 The Sidebar');
  paragraph('Everything in the app is reached from the menu on the left (tap the menu icon to open it if it\u2019s hidden). Here\u2019s what the main sections are for:');
  bullet('Dashboard \u2014 a quick snapshot of how things are going: money collected, what\u2019s still owed, and recent activity.');
  bullet('Students Hub \u2014 where you register new students, look up existing ones, edit their details, and set up their fees.');
  if (isSecretary) {
    bullet('Process Payment \u2014 where you record money coming in from a parent, one payment or several at once.');
    bullet('Financial Communication \u2014 for sending reminders or letters to parents about what\u2019s owed.');
  } else {
    bullet('User Management \u2014 create staff accounts and reset forgotten passwords.');
    bullet('Notifications \u2014 anything waiting on your approval, like a request to deactivate a student.');
    bullet('System Diagnostics \u2014 a technical health check, only relevant if something seems off.');
  }
  bullet('Reports & Analytics \u2014 generate summaries of collections, outstanding balances, and more, as printable documents.');
  bullet('All Payments \u2014 a full list of every payment ever recorded, searchable.');
  bullet('Profile \u2014 your own account details, and where you can print a QR card to log in by scanning instead of typing your password.');
  bullet('Help \u2014 step-by-step instructions for specific tasks, searchable by keyword.');

  // ---- Students Hub in plain language ----
  heading('Students Hub, Explained Simply');
  paragraph('This is where most of the day-to-day work happens. It\u2019s organized into tabs across the top:');
  bullet('Student Registration \u2014 add a brand new student, step by step (their details, a parent/guardian, who\u2019s paying, which class, and any documents).');
  bullet('Student Records \u2014 search for any student and see everything about them: balance, contact details, and quick actions.');
  bullet('Edit Student \u2014 fix a typo or update a phone number without redoing the whole registration.');
  bullet('Fee Structure Manager \u2014 the list of every type of fee the school charges (tuition, bus, uniforms, etc.) and how much each one costs.');
  bullet('Fee Assignment Manager \u2014 tie a fee to a student (or many students at once) and generate the actual monthly bills.');
  bullet('Financial Ledger \u2014 a full transaction history for one student, everything they\u2019ve been charged and everything they\u2019ve paid.');
  if (isSecretary) {
    bullet('Bulk Operations \u2014 do the same thing to many students at once, like assigning a bus route or moving a class up a grade.');
  }
  bullet('Fee Settings \u2014 set up classes and grade levels, and the categories fees are grouped into.');

  // ---- A typical scenario ----
  heading(isSecretary ? 'A Typical Payment, From Start to Finish' : 'A Typical Approval, From Start to Finish');
  if (isSecretary) {
    paragraph('A parent comes in to pay this month\u2019s tuition. Here\u2019s what that looks like in practice:');
    bullet('You search for their child in Process Payment and select them \u2014 their outstanding balance shows immediately.');
    bullet('You type in the amount paid, how it was paid (bank transfer or card \u2014 cash isn\u2019t accepted through this system), and a reference number.');
    bullet('If they brought a printed bank slip, you can photograph or upload it \u2014 the system will try to read the amount and reference off it automatically, though you should always double check what it suggests against the real slip.');
    bullet('You confirm, and the payment is recorded. The amount is automatically matched against what they owe \u2014 tuition first, then anything else.');
    bullet('You can print a receipt for them right there, or save it as a PDF.');
  } else {
    paragraph('A secretary submits a request \u2014 for example, to deactivate a student who has left the school. Here\u2019s what happens next:');
    bullet('You\u2019ll see a small notice pop up the next time you log in if anything needs your attention.');
    bullet('Go to Notifications to see the full details \u2014 who requested it, and why.');
    bullet('You can approve it (the change goes through) or reject it (nothing changes, and the student stays as they were).');
    bullet('Either way, the decision is recorded \u2014 you can always look back later and see who approved what, and when, in Audit Logs.');
  }

  // ---- Reassurance / closing ----
  heading('A Few Things Worth Knowing');
  bullet('The system keeps working even without internet \u2014 it syncs data in the background whenever a connection is available, but you\u2019re never blocked from doing your job because of a bad connection.');
  bullet('Mistakes are never a disaster. Every action leaves a record, and most things (like a wrong fee or a wrong payment amount) can be corrected by an admin rather than needing to be hidden or deleted.');
  bullet('If you\u2019re ever unsure how to do something specific, the Help section in the sidebar has searchable, step-by-step instructions for almost everything covered in this guide, and more.');

  drawLetterheadFooter(doc, school);
  return doc;
}

/** Renders the same HELP_SCENARIOS content shown in the in-app Help page
 * into a downloadable PDF, filtered to the given role — a printable
 * take-home reference rather than requiring the app to be open. */
export async function generateHelpGuidePdf(school, role) {
  const { HELP_SCENARIOS } = await import('../utils/helpContent.js');
  const scenarios = HELP_SCENARIOS.filter((s) => s.roles.includes(role));

  const doc = new jsPDF();
  let y = await drawLetterheadHeader(doc, school, 'HELP GUIDE', `${role === 'Secretary' ? 'Secretary' : 'Admin'} Reference`);
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentCategory = null;

  for (const scenario of scenarios) {
    // Rough space check before each scenario — a question plus a few
    // steps rarely exceeds ~40pt, so this is a reasonable per-item
    // budget rather than measuring exact text height up front.
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }
    if (scenario.category !== currentCategory) {
      currentCategory = scenario.category;
      y = drawSectionHeading(doc, y, currentCategory);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    const qLines = doc.splitTextToSize(scenario.question, 170);
    doc.text(qLines, 20, y);
    y += qLines.length * 4.5 + 2;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    scenario.steps.forEach((step, i) => {
      if (y > pageHeight - 15) { doc.addPage(); y = 20; }
      const stepLines = doc.splitTextToSize(`${i + 1}. ${step}`, 165);
      doc.text(stepLines, 24, y);
      y += stepLines.length * 3.8 + 1;
    });
    y += 4;
  }

  drawLetterheadFooter(doc, school);
  return doc;
}

export async function generateFinancialOverviewPdf(reportData, extras, school, mode) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageRightEdge = pageWidth - 14;
  const titles = {
    outstanding: 'OUTSTANDING FEES REPORT', debtors: 'DEBTORS REPORT', revenue: 'REVENUE REPORT',
    collection: 'COLLECTION REPORT', monthly: 'MONTHLY COLLECTION REPORT', yearly: 'YEARLY REPORT'
  };
  let y = await drawLetterheadHeader(doc, school, titles[mode] || 'FINANCIAL REPORT', new Date().toLocaleDateString());

  y = drawSectionHeading(doc, y, 'Summary');
  doc.setFontSize(10);
  doc.text(`Total Collected: ${money(reportData.totalCollected)}`, 14, y);
  doc.text(`Total Outstanding: ${money(reportData.totalOutstanding)}`, 105, y); y += 6;
  doc.text(`Collection Rate: ${reportData.collectionRatePct}%`, 14, y);
  doc.text(`Total Students: ${reportData.totalStudents}`, 105, y); y += 4;
  // Figures above are already net of any payment corrections — this is
  // the true, final amount actually collected, not a raw total that
  // would need a separate adjustment applied on top of it.
  doc.setFontSize(7.5); doc.setTextColor(130);
  doc.text('Figures reflect corrected amounts where a payment was later adjusted \u2014 not the original recorded amount.', 14, y);
  doc.setTextColor(0); y += 8;

  if (mode === 'debtors' || mode === 'outstanding') {
    y = drawSectionHeading(doc, y, mode === 'debtors' ? 'Debtors' : 'Aging Report');
    if (mode === 'debtors') {
      const debtorRows = reportData.rows.filter((r) => r.status === 'Debtors' || r.status === 'Chronic Debtors');
      doc.setFontSize(9); doc.setFont(undefined, 'bold');
      doc.text('Student', 14, y); doc.text('Status', 100, y); doc.text('Balance', pageRightEdge, y, { align: 'right' });
      y += 3; doc.setDrawColor(220); doc.line(14, y, pageRightEdge, y); y += 6; doc.setFont(undefined, 'normal');
      let debtorsTotal = 0;
      debtorRows.forEach((r) => {
        if (y > 265) { doc.addPage(); y = 20; }
        doc.text(r.name.slice(0, 34), 14, y); doc.text(r.status, 100, y); doc.text(money(r.balance), pageRightEdge, y, { align: 'right' });
        debtorsTotal += r.balance;
        y += 6;
      });
      y += 2; doc.setDrawColor(0); doc.line(14, y, pageRightEdge, y); y += 6;
      doc.setFont(undefined, 'bold');
      doc.text('Total', 14, y); doc.text(money(debtorsTotal), pageRightEdge, y, { align: 'right' });
      doc.setFont(undefined, 'normal'); y += 4;
    } else {
      // A real per-student aging table, not just bucket subtotals — a
      // name column at the top is what makes an aging report usable
      // for actually following up with someone, not just a summary
      // count.
      doc.setFontSize(9); doc.setFont(undefined, 'bold');
      doc.text('Name', 14, y); doc.text('Days Overdue', 110, y); doc.text('Amount Owed', pageRightEdge, y, { align: 'right' });
      y += 3; doc.setDrawColor(220); doc.line(14, y, pageRightEdge, y); y += 6; doc.setFont(undefined, 'normal');
      let agingTotal = 0;
      (extras.aging.topDebtors || []).forEach((d) => {
        if (y > 265) { doc.addPage(); y = 20; }
        doc.text(String(d.name || '').slice(0, 40), 14, y);
        doc.text(String(d.oldestAgeDays ?? ''), 110, y);
        doc.text(money(d.owed), pageRightEdge, y, { align: 'right' });
        agingTotal += d.owed || 0;
        y += 6;
      });
      y += 2; doc.setDrawColor(0); doc.line(14, y, pageRightEdge, y); y += 6;
      doc.setFont(undefined, 'bold');
      doc.text('Total', 14, y); doc.text(money(agingTotal), pageRightEdge, y, { align: 'right' });
      doc.setFont(undefined, 'normal'); y += 10;

      y = drawSectionHeading(doc, y, 'Aging Buckets (Summary)');
      Object.entries(extras.aging.buckets).forEach(([bucket, v]) => {
        doc.setFontSize(10);
        doc.text(`${bucket} days: ${v.count} students`, 14, y); doc.text(money(v.amount), pageRightEdge, y, { align: 'right' });
        y += 6;
      });
    }
  }

  if (mode === 'revenue' || mode === 'collection' || mode === 'yearly') {
    y = drawSectionHeading(doc, y, 'Collections');
    doc.setFontSize(10);
    doc.text(`Today: ${money(extras.collections.todayTotal)}`, 14, y); y += 6;
    doc.text(`This Month: ${money(extras.collections.monthTotal)}`, 14, y); y += 6;
    doc.text(`This Year: ${money(extras.collections.yearTotal)}`, 14, y); y += 10;
  }

  if (mode === 'monthly' || mode === 'yearly') {
    // "Yearly" means the current calendar year specifically — January
    // through whichever month it is now — not a trailing 12-month
    // window that can span into a year before the school had any data
    // in the system at all. "Monthly" keeps the rolling window, which
    // is the right lens for a short-term collection trend.
    const breakdown = mode === 'yearly' ? extras.collections.yearlyMonthlyBreakdown : extras.collections.monthlyBreakdown;
    y = drawSectionHeading(doc, y, mode === 'yearly' ? `Monthly Breakdown (${new Date().getFullYear()})` : 'Monthly Breakdown');
    doc.setFontSize(9); doc.setFont(undefined, 'bold');
    doc.text('Month', 14, y); doc.text('Total', pageRightEdge, y, { align: 'right' });
    y += 3; doc.setDrawColor(220); doc.line(14, y, pageRightEdge, y); y += 6; doc.setFont(undefined, 'normal');
    let breakdownTotal = 0;
    breakdown.forEach((m) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(m.month, 14, y);
      if (m.isFuture) {
        doc.setTextColor(150);
        doc.text('Not yet reached', pageRightEdge, y, { align: 'right' });
        doc.setTextColor(0);
      } else {
        doc.text(money(m.total), pageRightEdge, y, { align: 'right' });
        breakdownTotal += m.total;
      }
      y += 6;
    });
    y += 2; doc.setDrawColor(0); doc.line(14, y, pageRightEdge, y); y += 6;
    doc.setFont(undefined, 'bold');
    doc.text('Total', 14, y); doc.text(money(breakdownTotal), pageRightEdge, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
  }

  drawLetterheadFooter(doc, school);
  return doc;
}

export async function buildRegistrationSummaryPdf(school, schoolLabel, studentData, guardianData, sponsorInfo) {
  const doc = new jsPDF();
  let y = await drawLetterheadHeader(doc, school, 'STUDENT REGISTRATION SUMMARY', new Date().toLocaleDateString());

  function row(label, value) {
    if (!value) return;
    doc.text(String(label), 20, y);
    doc.text(String(value), 90, y);
    y += 6;
  }

  y = drawSectionHeading(doc, y, 'Student');
  row('Name:', `${studentData.firstName} ${studentData.lastName}`);
  row('Date of Birth:', studentData.dateOfBirth);
  row('Gender:', studentData.gender);
  row('National ID:', studentData.nationalId);
  row('Passport:', studentData.passport);
  row('Phone:', studentData.phone);
  row('Email:', studentData.email);
  row('Address:', studentData.address);
  row('Emergency Contact:', studentData.emergencyContact);
  row('Previous School:', studentData.previousSchool);
  y += 4;

  y = drawSectionHeading(doc, y, 'Guardian / Parent');
  row('Name:', `${guardianData.firstName || ''} ${guardianData.lastName || ''}`.trim());
  row('Relationship:', guardianData.relationship);
  row('Phone:', guardianData.phonePrimary);
  row('Email:', guardianData.email);
  row('Address:', guardianData.addressLine1);
  if (guardianData.employerName) {
    row('Employer:', guardianData.employerName);
    row('Job Title:', guardianData.jobTitle);
  }
  y += 4;

  if (sponsorInfo) {
    y = drawSectionHeading(doc, y, 'Sponsor');
    row('Type:', studentData.sponsorType);
    row('Organization:', sponsorInfo.name);
    row('Contact Person:', sponsorInfo.contactPerson);
    row('Phone:', sponsorInfo.phone);
    y += 4;
  }

  y = drawSectionHeading(doc, y, 'Enrollment');
  row('School:', schoolLabel);
  row('Academic Year:', studentData.academicYear);
  row('Enrollment Date:', studentData.enrollmentDate);

  drawLetterheadFooter(doc, school);
  return doc.output('datauristring').split(',')[1];
}

export default function Reports({ user, school: schoolOverride }) {
  const school = schoolOverride || user.section;
  const schoolLabel = SCHOOL_LABEL[school] || school;
  const dateStamp = new Date().toISOString().slice(0, 10);

  const [tab, setTab] = useState('overview');
  const [report, setReport] = useState(null);
  const [extras, setExtras] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [page, setPage] = useState(1);

  // Whatever report PDF was most recently generated — lets one "Print"
  // button work for every report type below rather than needing a
  // separate print button wired into each of the 9 report generators.
  const [lastGeneratedDoc, setLastGeneratedDoc] = useState(null);
  const [lastGeneratedName, setLastGeneratedName] = useState('');
  const [printingReport, setPrintingReport] = useState(false);
  const [reportPrintError, setReportPrintError] = useState('');

  async function printLastReport() {
    if (!lastGeneratedDoc) return;
    setReportPrintError('');
    setPrintingReport(true);
    try {
      const base64 = lastGeneratedDoc.output('datauristring').split(',')[1];
      const result = await window.electronAPI.printPdf({ base64, silent: false });
      if (!result.success) setReportPrintError(result.message);
    } finally {
      setPrintingReport(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      window.electronAPI.getFinancialReportData(school),
      window.electronAPI.getReportsCenterExtras(school)
    ]).then(([r1, r2]) => {
      if (r1.success) setReport(r1.data);
      if (r2.success) setExtras(r2.data);
      setLoading(false);
    });
  }, [school]);

  useEffect(() => { setPage(1); }, [activeCategory, tab]);

  // ---- Student & Category Reports tab ----
  const REPORT_DIRECT = { 'Outstanding Fees': 'outstanding', 'Debtors': 'debtors', 'Revenue': 'revenue', 'Collection Report': 'collection', 'Monthly Collection Report': 'monthly', 'Yearly Report': 'yearly' };
  const REPORT_CATEGORY_PRESET = { 'Sports Fees': 'Sports', 'Hostel Fees': 'Hostel', 'Transport Fees': 'Transport' };
  const reportTypes = ['Student Statement', 'Class Statement', 'Grade Statement', 'Fee Category Report',
    'Sports Fees', 'Hostel Fees', 'Transport Fees', 'Outstanding Fees', 'Debtors', 'Revenue',
    'Collection Report', 'Yearly Report', 'Parent Audit Report', 'Monthly Collection Report'];

  const [reportPrompt, setReportPrompt] = useState(null);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    if (tab !== 'studentReports') return;
    window.electronAPI.listStudents(school).then(res => { if (res.success) setStudents(res.students); });
    window.electronAPI.listClasses(school).then(res => { if (res.success) setClasses(res.classes); });
    window.electronAPI.listFeeCategories(school).then(res => { if (res.success) setCategories(res.categories); });
  }, [school, tab]);

  const matchingStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return [];
    return students.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q)).slice(0, 8);
  }, [students, studentSearch]);

  function openReportPrompt(type) {
    setReportError('');
    if (REPORT_DIRECT[type]) { generateDirectReport(REPORT_DIRECT[type]); return; }
    setStudentSearch(''); setSelectedId(''); setGradeInput(''); setCategoryInput(REPORT_CATEGORY_PRESET[type] || '');
    setReportPrompt({ type });
  }

  async function generateDirectReport(mode) {
    setGenerating(true); setReportError('');
    try {
      const [reportRes, extrasRes] = await Promise.all([
        window.electronAPI.getFinancialReportData(school),
        window.electronAPI.getReportsCenterExtras(school)
      ]);
      if (!reportRes.success) { setReportError(reportRes.message); return; }
      const doc = await generateFinancialOverviewPdf(reportRes.data, extrasRes.data, school, mode);
      setLastGeneratedDoc(doc); setLastGeneratedName(`${mode}-report-${school}.pdf`);
      doc.save(`${mode}-report-${school}.pdf`);
    } finally {
      setGenerating(false);
    }
  }

  async function generateStudentReport(mode) {
    if (!selectedId) { setReportError('Select a student first.'); return; }
    setGenerating(true); setReportError('');
    try {
      const res = await window.electronAPI.getStudentStatementDataForLetter(selectedId);
      if (!res.success) { setReportError(res.message); return; }
      const doc = await generateStudentStatementPdf(res.data, school, mode);
      setLastGeneratedDoc(doc); setLastGeneratedName(`${mode === 'parent' ? 'parent-audit' : 'statement'}-${res.data.student.studentNumber}.pdf`);
      doc.save(`${mode === 'parent' ? 'parent-audit' : 'statement'}-${res.data.student.studentNumber}.pdf`);
      setReportPrompt(null);
    } finally {
      setGenerating(false);
    }
  }

  async function generateClassOrGradeReport(kind) {
    if (kind === 'class' && !selectedId) { setReportError('Select a class first.'); return; }
    if (kind === 'grade' && !gradeInput) { setReportError('Enter a grade level first.'); return; }
    setGenerating(true); setReportError('');
    try {
      const payload = kind === 'class' ? { school, classId: selectedId } : { school, gradeLevel: gradeInput };
      const res = await window.electronAPI.getClassOrGradeStatement(payload);
      if (!res.success) { setReportError(res.message); return; }
      const label = kind === 'class' ? `Class ${classes.find(c => c.classId === selectedId)?.className || ''} Statement` : `Grade ${gradeInput} Statement`;
      const doc = await generateClassGradeStatementPdf(res.data, school, label);
      setLastGeneratedDoc(doc); setLastGeneratedName(`${kind}-statement-${school}.pdf`);
      doc.save(`${kind}-statement-${school}.pdf`);
      setReportPrompt(null);
    } finally {
      setGenerating(false);
    }
  }

  async function generateCategoryReport() {
    if (!categoryInput) { setReportError('Enter or select a fee category first.'); return; }
    setGenerating(true); setReportError('');
    try {
      const res = await window.electronAPI.getFeeCategoryReport({ school, category: categoryInput });
      if (!res.success) { setReportError(res.message); return; }
      const doc = await generateFeeCategoryReportPdf(res.data, school);
      setLastGeneratedDoc(doc); setLastGeneratedName(`${categoryInput.toLowerCase()}-fees-report-${school}.pdf`);
      doc.save(`${categoryInput.toLowerCase()}-fees-report-${school}.pdf`);
      setReportPrompt(null);
    } finally {
      setGenerating(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!report) return [];
    if (activeCategory === 'all') return report.rows;
    return report.rows.filter((r) => r.status === activeCategory);
  }, [report, activeCategory]);

  const pagedRows = useMemo(() => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredRows, page]);
  const pagedDebtors = useMemo(() => (extras ? extras.aging.topDebtors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []), [extras, page]);
  const pagedAdjustments = useMemo(() => (extras ? extras.adjustments.records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []), [extras, page]);

  function detailForRow(r) {
    if (r.status === 'Overpaid') return r.monthsAhead != null ? `${r.monthsAhead} mo. ahead` : '—';
    if (r.status === 'Chronic Debtors' || r.status === 'Debtors') return `${r.maxAgeDays}d overdue · ${r.unpaidCount} unpaid`;
    if (r.status === 'OK') return `${r.maxAgeDays}d overdue`;
    return '—';
  }

  async function exportOverviewPdf() {
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school, 'FINANCIAL HEALTH REPORT', 'Overview');
    y = drawSectionHeading(doc, y, 'Summary');
    [
      ['Total Collected:', money(report.totalCollected)],
      ['Total Outstanding:', money(report.totalOutstanding)],
      ['Collection Rate (all-time):', `${report.collectionRatePct}%`],
      ['CPR (this month):', report.cprPct === null ? 'N/A' : `${report.cprPct}%`],
      ['Total Students:', `${report.totalStudents}`]
    ].forEach(([l, v]) => { doc.text(l, 20, y); doc.text(v, 130, y); y += 6; });
    y += 6;
    y = drawSectionHeading(doc, y, 'Category Breakdown');
    Object.entries(report.categoryCounts).forEach(([cat, count]) => { doc.text(cat, 20, y); doc.text(String(count), 130, y); y += 6; });
    y += 6;
    y = drawSectionHeading(doc, y, `Students — ${CATEGORY_META[activeCategory].label} (${filteredRows.length})`);
    doc.setFontSize(9); doc.text('Name', 20, y); doc.text('Status', 90, y); doc.text('Balance', 140, y); doc.text('Detail', 165, y); y += 6;
    filteredRows.forEach((r) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(r.name.slice(0, 28), 20, y); doc.text(r.status, 90, y); doc.text(money(r.balance), 140, y); doc.text(detailForRow(r), 165, y); y += 6;
    });
    drawLetterheadFooter(doc, school);
    setLastGeneratedDoc(doc); setLastGeneratedName(`overview-report-${school}-${dateStamp}.pdf`);
    doc.save(`overview-report-${school}-${dateStamp}.pdf`);
  }
  function exportOverviewExcel() {
    downloadExcel(filteredRows.map((r) => ({
      Name: r.name, 'Student #': r.studentNumber, School: SCHOOL_LABEL[r.school] || r.school,
      Status: r.status, Balance: r.balance, Detail: detailForRow(r)
    })), 'Overview', `overview-report-${school}-${dateStamp}.xlsx`);
  }

  async function exportCollectionsPdf() {
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school, 'COLLECTION REPORT', new Date().toLocaleDateString());
    y = drawSectionHeading(doc, y, 'Summary');
    [
      ['Today:', money(extras.collections.todayTotal)],
      ['This Month:', money(extras.collections.monthTotal)],
      ['This Year:', money(extras.collections.yearTotal)],
      [`EFT Total (${extras.collections.eftCount} txns):`, money(extras.collections.eftTotal)],
      [`POS Total (${extras.collections.posCount} txns):`, money(extras.collections.posTotal)]
    ].forEach(([l, v]) => { doc.text(l, 20, y); doc.text(v, 130, y); y += 6; });
    y += 6;
    y = drawSectionHeading(doc, y, 'Last 14 Days');
    extras.collections.dailyBreakdown.forEach((d) => { if (y > 275) { doc.addPage(); y = 20; } doc.text(d.date, 20, y); doc.text(money(d.total), 130, y); y += 6; });
    drawLetterheadFooter(doc, school);
    setLastGeneratedDoc(doc); setLastGeneratedName(`collections-report-${school}-${dateStamp}.pdf`);
    doc.save(`collections-report-${school}-${dateStamp}.pdf`);
  }
  function exportCollectionsExcel() {
    downloadExcel(extras.collections.dailyBreakdown.map((d) => ({ Date: d.date, Amount: d.total })), 'Daily Collections', `collections-report-${school}-${dateStamp}.xlsx`);
  }

  async function exportAgingPdf() {
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school, 'OUTSTANDING / AGING REPORT', new Date().toLocaleDateString());
    y = drawSectionHeading(doc, y, 'Aging Buckets');
    Object.entries(extras.aging.buckets).forEach(([bucket, v]) => { doc.text(`${bucket} days:`, 20, y); doc.text(`${v.count} students — ${money(v.amount)}`, 90, y); y += 6; });
    y += 6;
    y = drawSectionHeading(doc, y, 'Top 20 Debtors');
    doc.setFontSize(9);
    extras.aging.topDebtors.forEach((d) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(d.name.slice(0, 30), 20, y); doc.text(money(d.owed), 120, y); doc.text(`${d.oldestAgeDays}d`, 165, y); y += 6;
    });
    drawLetterheadFooter(doc, school);
    setLastGeneratedDoc(doc); setLastGeneratedName(`aging-report-${school}-${dateStamp}.pdf`);
    doc.save(`aging-report-${school}-${dateStamp}.pdf`);
  }
  function exportAgingExcel() {
    downloadExcel(extras.aging.topDebtors.map((d) => ({
      Name: d.name, 'Student #': d.studentNumber, 'Amount Owed': d.owed, 'Oldest (days)': d.oldestAgeDays
    })), 'Top Debtors', `aging-report-${school}-${dateStamp}.xlsx`);
  }

  async function exportBehaviourPdf() {
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school, 'PAYMENT BEHAVIOUR REPORT', new Date().toLocaleDateString());
    y = drawSectionHeading(doc, y, 'Categories');
    doc.setFont(undefined, 'bold');
    doc.text('Category', 20, y); doc.text('Students', 90, y); doc.text('Collected', 125, y); doc.text('Outstanding', 160, y); y += 6;
    doc.setFont(undefined, 'normal');
    Object.entries(extras.behaviour.categories).forEach(([cat, v]) => {
      doc.text(cat, 20, y); doc.text(String(v.count), 90, y); doc.text(money(v.collected), 125, y); doc.text(money(v.outstanding), 160, y); y += 6;
    });
    drawLetterheadFooter(doc, school);
    setLastGeneratedDoc(doc); setLastGeneratedName(`behaviour-report-${school}-${dateStamp}.pdf`);
    doc.save(`behaviour-report-${school}-${dateStamp}.pdf`);
  }
  function exportBehaviourExcel() {
    downloadExcel(Object.entries(extras.behaviour.categories).map(([cat, v]) => ({
      Category: cat, Students: v.count, Collected: v.collected, Outstanding: v.outstanding
    })), 'Payment Behaviour', `behaviour-report-${school}-${dateStamp}.xlsx`);
  }

  async function exportAdjustmentsPdf() {
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school, 'ADJUSTMENT REPORT', new Date().toLocaleDateString());
    y = drawSectionHeading(doc, y, 'Summary');
    doc.text('Total Adjustments:', 20, y); doc.text(`${extras.adjustments.total}`, 130, y); y += 6;
    doc.text('Total Amount:', 20, y); doc.text(money(extras.adjustments.totalAmount), 130, y); y += 10;
    y = drawSectionHeading(doc, y, 'Records');
    doc.setFontSize(9);
    extras.adjustments.records.forEach((a) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(new Date(a.date).toLocaleDateString(), 20, y);
      doc.text(a.studentName.slice(0, 22), 55, y);
      doc.text(a.type, 110, y);
      doc.text(money(a.amount), 140, y);
      doc.text(a.approvedBy, 170, y);
      y += 6;
      doc.setFontSize(7); doc.setTextColor(120);
      doc.text(`Reason: ${a.reasonCode}`, 20, y); y += 5;
      doc.setFontSize(9); doc.setTextColor(0);
    });
    drawLetterheadFooter(doc, school);
    setLastGeneratedDoc(doc); setLastGeneratedName(`adjustments-report-${school}-${dateStamp}.pdf`);
    doc.save(`adjustments-report-${school}-${dateStamp}.pdf`);
  }
  function exportAdjustmentsExcel() {
    downloadExcel(extras.adjustments.records.map((a) => ({
      Date: new Date(a.date).toLocaleDateString(), Student: a.studentName, Type: a.type,
      Amount: a.amount, Reason: a.reasonCode, Explanation: a.explanation, 'Approved By': a.approvedBy
    })), 'Adjustments', `adjustments-report-${school}-${dateStamp}.xlsx`);
  }

  if (loading || !report || !extras) {
    return <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem' }}>Loading report data...</p>;
  }

  return (
    <div>
      {lastGeneratedDoc && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem',
          background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)',
          borderRadius: 'var(--r-md)', padding: '0.6rem 0.9rem', marginBottom: '1rem', flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--c-ink-soft)' }}>
            Last generated: <strong>{lastGeneratedName}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {reportPrintError && <span style={{ fontSize: '0.74rem', color: 'var(--c-danger)' }}>{reportPrintError}</span>}
            <button type="button" className="ent-btn ent-btn--primary ent-btn--sm" onClick={printLastReport} disabled={printingReport}>
              <Printer size={13} /> {printingReport ? 'Opening printer...' : 'Print This Report'}
            </button>
          </div>
        </div>
      )}
      <div className="ent-tabs" style={{ marginBottom: '1.3rem' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`ent-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
            <div className="ent-kpi-card ent-kpi-card--highlight">
              <div className="ent-kpi-icon"><Wallet size={20} /></div>
              <div><div className="ent-kpi-label">Total Collected</div><div className="ent-kpi-value">{money(report.totalCollected)}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><AlertTriangle size={20} /></div>
              <div><div className="ent-kpi-label">Total Outstanding</div><div className="ent-kpi-value">{money(report.totalOutstanding)}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><TrendingUp size={20} /></div>
              <div><div className="ent-kpi-label">Collection Rate</div><div className="ent-kpi-value">{report.collectionRatePct}%</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><TrendingUp size={20} /></div>
              <div><div className="ent-kpi-label">CPR (This Month)</div><div className="ent-kpi-value">{report.cprPct === null ? '—' : `${report.cprPct}%`}</div></div>
            </div>
          </div>

          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <h3 className="ent-card-title"><Users size={16} /> Filter by Payment Category</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.8rem' }}>
              {Object.entries(CATEGORY_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const count = key === 'all' ? report.totalStudents : (report.categoryCounts[key] || 0);
                return (
                  <div key={key} className={`ent-category-tile ent-category-tile--clickable ${activeCategory === key ? 'ent-category-tile--active' : ''}`} onClick={() => setActiveCategory(key)}>
                    <div className="ent-category-icon" style={{ color: meta.color }}><Icon size={16} /></div>
                    <div className="ent-category-amount">{count}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--c-ink-soft)', fontWeight: 600, marginTop: '0.2rem' }}>{meta.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ent-card">
            <div className="ent-card-head">
              <h3 className="ent-card-title">{CATEGORY_META[activeCategory].label} ({filteredRows.length})</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportOverviewExcel}><FileSpreadsheet size={14} /> Excel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportOverviewPdf}><FileDown size={14} /> PDF</button>
              </div>
            </div>
            <div className="ent-table-wrap" style={{ maxHeight: '480px' }}>
              <table className="ent-table ent-table--zebra">
                <thead><tr><th>Student</th><th>School</th><th>Status</th><th>Balance</th><th>Detail</th></tr></thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr><td colSpan={5} className="ent-table-empty">No students in this category.</td></tr>
                  ) : pagedRows.map((r) => (
                    <tr key={r.studentId}>
                      <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="ent-td-mono">{r.studentNumber}</div></td>
                      <td style={{ fontSize: '0.78rem' }}>{SCHOOL_LABEL[r.school] || r.school}</td>
                      <td><span className="ent-badge" style={{ background: CATEGORY_META[r.status]?.color || '#6b7280' }}>{r.status}</span></td>
                      <td className="ent-td-num" style={{ color: r.balance > 0 ? 'var(--c-danger)' : r.balance < 0 ? 'var(--c-success)' : 'var(--c-ink)' }}>{money(r.balance)}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{detailForRow(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filteredRows.length} onChange={setPage} />
          </div>
        </>
      )}

      {tab === 'collections' && (
        <>
          <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
            <div className="ent-kpi-card ent-kpi-card--highlight">
              <div className="ent-kpi-icon"><Wallet size={20} /></div>
              <div><div className="ent-kpi-label">Today</div><div className="ent-kpi-value">{money(extras.collections.todayTotal)}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><TrendingUp size={20} /></div>
              <div><div className="ent-kpi-label">This Month</div><div className="ent-kpi-value">{money(extras.collections.monthTotal)}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><Banknote size={20} /></div>
              <div><div className="ent-kpi-label">EFT Total ({extras.collections.eftCount})</div><div className="ent-kpi-value">{money(extras.collections.eftTotal)}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><CreditCard size={20} /></div>
              <div><div className="ent-kpi-label">POS Total ({extras.collections.posCount})</div><div className="ent-kpi-value">{money(extras.collections.posTotal)}</div></div>
            </div>
          </div>

          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <h3 className="ent-card-title"><TrendingUp size={16} /> Monthly Collection Trend (12 Months)</h3>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={extras.collections.monthlyBreakdown}>
                  <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Line type="monotone" dataKey="total" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="ent-card">
            <div className="ent-card-head">
              <h3 className="ent-card-title">Last 14 Days</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportCollectionsExcel}><FileSpreadsheet size={14} /> Excel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportCollectionsPdf}><FileDown size={14} /> PDF</button>
              </div>
            </div>
            <div className="ent-table-wrap">
              <table className="ent-table">
                <thead><tr><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {extras.collections.dailyBreakdown.map((d) => (
                    <tr key={d.date}><td>{d.date}</td><td className="ent-td-num">{money(d.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'aging' && (
        <>
          <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
            {Object.entries(extras.aging.buckets).map(([bucket, v], i) => (
              <div key={bucket} className={`ent-kpi-card ${i === 3 ? 'ent-kpi-card--highlight' : ''}`}>
                <div className="ent-kpi-icon"><AlertTriangle size={20} /></div>
                <div><div className="ent-kpi-label">{bucket} days</div><div className="ent-kpi-value">{v.count}</div></div>
              </div>
            ))}
          </div>

          <div className="ent-card">
            <div className="ent-card-head">
              <h3 className="ent-card-title"><AlertCircle size={16} /> Top 20 Debtors</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportAgingExcel}><FileSpreadsheet size={14} /> Excel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportAgingPdf}><FileDown size={14} /> PDF</button>
              </div>
            </div>
            <div className="ent-table-wrap">
              <table className="ent-table ent-table--zebra">
                <thead><tr><th>Student</th><th>Amount Owed</th><th>Oldest</th></tr></thead>
                <tbody>
                  {pagedDebtors.length === 0 ? (
                    <tr><td colSpan={3} className="ent-table-empty">No outstanding debtors.</td></tr>
                  ) : pagedDebtors.map((d) => (
                    <tr key={d.studentId}>
                      <td><div style={{ fontWeight: 600 }}>{d.name}</div><div className="ent-td-mono">{d.studentNumber}</div></td>
                      <td className="ent-td-num" style={{ color: 'var(--c-danger)' }}>{money(d.owed)}</td>
                      <td style={{ color: d.oldestAgeDays > 90 ? 'var(--c-danger)' : 'var(--c-ink-soft)', fontWeight: 700 }}>{d.oldestAgeDays}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={extras.aging.topDebtors.length} onChange={setPage} />
          </div>
        </>
      )}

      {tab === 'behaviour' && (
        <div className="ent-card">
          <div className="ent-card-head">
            <h3 className="ent-card-title"><Award size={16} /> Payment Behaviour Breakdown</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportBehaviourExcel}><FileSpreadsheet size={14} /> Excel</button>
              <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportBehaviourPdf}><FileDown size={14} /> PDF</button>
            </div>
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead><tr><th>Category</th><th>Students</th><th>Collected</th><th>Outstanding</th><th>% of Students</th></tr></thead>
              <tbody>
                {Object.entries(extras.behaviour.categories).map(([cat, v]) => (
                  <tr key={cat}>
                    <td><span className="ent-badge" style={{ background: CATEGORY_META[cat]?.color || '#6b7280' }}>{cat}</span></td>
                    <td>{v.count}</td>
                    <td className="ent-td-num" style={{ color: 'var(--c-success)' }}>{money(v.collected)}</td>
                    <td className="ent-td-num" style={{ color: 'var(--c-danger)' }}>{money(v.outstanding)}</td>
                    <td>{report.totalStudents > 0 ? Math.round((v.count / report.totalStudents) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'adjustments' && (
        <>
          <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
            <div className="ent-kpi-card ent-kpi-card--highlight">
              <div className="ent-kpi-icon"><ClipboardList size={20} /></div>
              <div><div className="ent-kpi-label">Total Adjustments</div><div className="ent-kpi-value">{extras.adjustments.total}</div></div>
            </div>
            <div className="ent-kpi-card">
              <div className="ent-kpi-icon"><Wallet size={20} /></div>
              <div><div className="ent-kpi-label">Total Amount</div><div className="ent-kpi-value">{money(extras.adjustments.totalAmount)}</div></div>
            </div>
            {Object.entries(extras.adjustments.byType).slice(0, 2).map(([type, v]) => (
              <div className="ent-kpi-card" key={type}>
                <div className="ent-kpi-icon"><ClipboardList size={20} /></div>
                <div><div className="ent-kpi-label">{type} ({v.count})</div><div className="ent-kpi-value">{money(v.amount)}</div></div>
              </div>
            ))}
          </div>

          <div className="ent-card">
            <div className="ent-card-head">
              <h3 className="ent-card-title"><ClipboardList size={16} /> Adjustment Records</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportAdjustmentsExcel}><FileSpreadsheet size={14} /> Excel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportAdjustmentsPdf}><FileDown size={14} /> PDF</button>
              </div>
            </div>
            <div className="ent-table-wrap">
              <table className="ent-table ent-table--zebra">
                <thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Amount</th><th>Reason</th><th>Approved By</th></tr></thead>
                <tbody>
                  {pagedAdjustments.length === 0 ? (
                    <tr><td colSpan={6} className="ent-table-empty">No adjustments recorded yet.</td></tr>
                  ) : pagedAdjustments.map((a) => (
                    <tr key={a.adjustmentId}>
                      <td style={{ fontSize: '0.78rem' }}>{new Date(a.date).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600 }}>{a.studentName}</td>
                      <td><span className="ent-badge ent-badge--purple">{a.type}</span></td>
                      <td className="ent-td-num">{money(a.amount)}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{a.reasonCode}</td>
                      <td style={{ fontSize: '0.78rem' }}>{a.approvedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={extras.adjustments.records.length} onChange={setPage} />
          </div>

          <div style={{ marginTop: '1.6rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.8rem' }}>Payment Corrections</h3>
            <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
              <div className="ent-kpi-card ent-kpi-card--highlight">
                <div className="ent-kpi-icon"><Edit2 size={20} /></div>
                <div><div className="ent-kpi-label">Total Corrections</div><div className="ent-kpi-value">{extras.corrections?.total || 0}</div></div>
              </div>
              <div className="ent-kpi-card">
                <div className="ent-kpi-icon"><Wallet size={20} /></div>
                <div><div className="ent-kpi-label">Total Amount</div><div className="ent-kpi-value">{money((extras.corrections?.records || []).reduce((s, c) => s + c.correctionAmount, 0))}</div></div>
              </div>
            </div>
            <div className="ent-card">
              <h3 className="ent-card-title"><Edit2 size={16} /> Correction Records</h3>
              <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
                Payments that were recorded with the wrong amount and later corrected — shown here for the school's own records. This never appears on a parent-facing letter, which shows only the final corrected figure.
              </p>
              <div className="ent-table-wrap">
                <table className="ent-table ent-table--zebra">
                  <thead><tr><th>Date</th><th>Student</th><th>Adjustment</th><th>Reason</th><th>Corrected By</th></tr></thead>
                  <tbody>
                    {!extras.corrections || extras.corrections.records.length === 0 ? (
                      <tr><td colSpan={5} className="ent-table-empty">No payment corrections recorded.</td></tr>
                    ) : extras.corrections.records.map((c) => (
                      <tr key={c.correctionId}>
                        <td style={{ fontSize: '0.78rem' }}>{new Date(c.date).toLocaleDateString()}</td>
                        <td style={{ fontWeight: 600 }}>{c.studentName}</td>
                        <td className="ent-td-num" style={{ color: c.correctionAmount > 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                          {c.correctionAmount > 0 ? '+' : ''}{money(c.correctionAmount)}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{c.reason}</td>
                        <td style={{ fontSize: '0.78rem' }}>{c.correctedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'studentReports' && (
        <div className="ent-card">
          <h3 className="ent-card-title"><FileDown size={16} /> Student & Category Reports</h3>
          {reportError && !reportPrompt && <div className="ent-error-box">{reportError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
            {reportTypes.map(r => (
              <button key={r} className="ent-btn ent-btn--secondary" onClick={() => openReportPrompt(r)} disabled={generating}>{r}</button>
            ))}
          </div>

          {reportPrompt && (
            <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setReportPrompt(null)}>
              <div className="ent-modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                <div className="ent-modal-head"><h3>{reportPrompt.type}</h3><button className="ent-modal-close" onClick={() => setReportPrompt(null)}><X size={18} /></button></div>
                <div className="ent-modal-body">
                  {reportError && <div className="ent-error-box">{reportError}</div>}

                  {(reportPrompt.type === 'Student Statement' || reportPrompt.type === 'Parent Audit Report') && (
                    <>
                      <div className="ent-field">
                        <label>Search by student ID or name</label>
                        <input value={studentSearch} onChange={e => { setStudentSearch(e.target.value); setSelectedId(''); }} placeholder="Start typing..." autoFocus />
                        {matchingStudents.length > 0 && (
                          <div style={{ marginTop: '0.4rem', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                            {matchingStudents.map(s => (
                              <div key={s.studentId} className="ent-autocomplete-item" style={{ background: selectedId === s.studentId ? 'var(--c-surface-flat)' : undefined }} onClick={() => setSelectedId(s.studentId)}>
                                <span>{s.firstName} {s.lastName}</span><small>{s.studentNumber}</small>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button className="ent-btn ent-btn--primary" disabled={generating || !selectedId} onClick={() => generateStudentReport(reportPrompt.type === 'Parent Audit Report' ? 'parent' : 'student')}>
                        {generating ? 'Generating...' : 'Generate PDF'}
                      </button>
                    </>
                  )}

                  {reportPrompt.type === 'Class Statement' && (
                    <>
                      <div className="ent-field">
                        <label>Class</label>
                        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                          <option value="">Select a class...</option>
                          {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
                        </select>
                      </div>
                      <button className="ent-btn ent-btn--primary" disabled={generating} onClick={() => generateClassOrGradeReport('class')}>{generating ? 'Generating...' : 'Generate PDF'}</button>
                    </>
                  )}

                  {reportPrompt.type === 'Grade Statement' && (
                    <>
                      <div className="ent-field"><label>Grade Level</label><input type="number" value={gradeInput} onChange={e => setGradeInput(e.target.value)} placeholder="e.g. 8" autoFocus /></div>
                      <button className="ent-btn ent-btn--primary" disabled={generating} onClick={() => generateClassOrGradeReport('grade')}>{generating ? 'Generating...' : 'Generate PDF'}</button>
                    </>
                  )}

                  {(reportPrompt.type === 'Fee Category Report' || REPORT_CATEGORY_PRESET[reportPrompt.type]) && (
                    <>
                      <div className="ent-field">
                        <label>Fee Category</label>
                        <input value={categoryInput} onChange={e => setCategoryInput(e.target.value)} list="fee-cat-options-reports" autoFocus />
                        <datalist id="fee-cat-options-reports">{categories.map(c => <option key={c.categoryId} value={c.name} />)}</datalist>
                        <p className="ent-hint">Pre-filled from the report name — adjust if your category is spelled differently in Fee Settings.</p>
                      </div>
                      <button className="ent-btn ent-btn--primary" disabled={generating} onClick={generateCategoryReport}>{generating ? 'Generating...' : 'Generate PDF'}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
