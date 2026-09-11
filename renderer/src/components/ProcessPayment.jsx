import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Search, Banknote, Plus, CheckCircle2, AlertCircle, CreditCard, Printer, Download, Upload, X, FileText, ChevronUp, ChevronDown
} from 'lucide-react';
import Toggle from './ui/Toggle.jsx';
import AutocompleteDropdown from './ui/AutocompleteDropdown.jsx';
import { generateThermalReceiptPdf } from './Reports.jsx';
import { extractReceiptFields } from '../utils/receiptOcr.js';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };
const STATUS_COLOR = { 'Chronic Debtors': '#dc2626', Debtors: '#d97706', OK: '#2563eb', Good: '#16a34a', Overpaid: '#7c3aed' };

function money(n) {
  return 'N$ ' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the uploaded file.'));
    reader.readAsDataURL(file);
  });
}

export default function ProcessPayment({ user }) {
  const school = user.section === 'Both' ? 'WENDY' : user.section;

  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchAnchorRef = useRef(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loadingBilling, setLoadingBilling] = useState(false);

  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeMode, setChargeMode] = useState('catalog');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customTier, setCustomTier] = useState(3);
  const [useInstallmentPlan, setUseInstallmentPlan] = useState(false);
  const [installmentCount, setInstallmentCount] = useState(3);
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeError, setChargeError] = useState('');

  const [allocationMode, setAllocationMode] = useState('auto');
  const [manualAmounts, setManualAmounts] = useState({});
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFT');
  const [transactionReference, setTransactionReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankReferenceField, setBankReferenceField] = useState('');
  const [senderAccountRef, setSenderAccountRef] = useState('');
  const [payerName, setPayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successInfo, setSuccessInfo] = useState(null);

  // Receipt upload + OCR-assisted fill. The uploaded file itself is kept
  // (as a File object, converted to base64 at submit time) so it can be
  // saved to disk and linked to the payment once it exists — separate
  // from the OCR suggestions, which only ever pre-fill fields the
  // secretary can still see and correct.
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrSuggestions, setOcrSuggestions] = useState(null);
  const [ocrError, setOcrError] = useState('');

  // Batch mode — queue up several individual payments (each student keeps
  // their own amount/method/reference) and submit them all together, so a
  // secretary processing 10-15 students doesn't repeat the full
  // search-select-capture cycle that many separate times.
  const [batchMode, setBatchMode] = useState(false);
  const [batchQueue, setBatchQueue] = useState([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchResults, setBatchResults] = useState(null);

  useEffect(() => {
    window.electronAPI.listStudents(school).then((result) => {
      if (result.success) setStudents(result.students);
    });
  }, [school]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [students, query]);

  async function loadBilling(studentId) {
    setLoadingBilling(true);
    const result = await window.electronAPI.getStudentBillingSummary(studentId, school);
    setLoadingBilling(false);
    if (result.success) setBilling(result.data);
  }

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery(`${s.firstName} ${s.lastName}`);
    setShowResults(false);
    setSuccessInfo(null);
    setManualAmounts({});
    setPaymentAmount('');
    setTransactionReference('');
    setPayerName('');
    setShowAddCharge(false);
    setReceiptFile(null);
    setReceiptPreviewUrl('');
    setOcrSuggestions(null);
    setOcrError('');
    setBankName(''); setBankReferenceField(''); setSenderAccountRef('');
    loadBilling(s.studentId);
  }

  async function handleReceiptUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setOcrError('');
    setOcrSuggestions(null);
    setReceiptFile(file);
    setReceiptPreviewUrl(URL.createObjectURL(file));

    // OCR only runs on images — a PDF receipt still gets saved and
    // attached to the payment the same way, it just doesn't get
    // auto-suggested fields (rendering a PDF's first page to an image
    // first, to feed it through the same OCR path, is a reasonable next
    // step but out of scope for this pass).
    if (!file.type.startsWith('image/')) return;

    setOcrRunning(true);
    try {
      const { suggestions } = await extractReceiptFields(file);
      const hasAny = Object.values(suggestions).some((v) => v !== null);
      if (!hasAny) {
        setOcrError('Could not confidently read any details from this image — please fill in the fields manually.');
      } else {
        setOcrSuggestions(suggestions);
      }
    } catch (err) {
      setOcrError('OCR failed to run: ' + err.message + ' — please fill in the fields manually.');
    } finally {
      setOcrRunning(false);
    }
  }

  function applySuggestion(field, value) {
    if (value === null || value === undefined) return;
    if (field === 'amount') setPaymentAmount(String(value));
    else if (field === 'reference') setTransactionReference(String(value));
    else if (field === 'bankName') setBankName(String(value));
    else if (field === 'senderAccountRef') setSenderAccountRef(String(value));
    // date deliberately isn't auto-applied to paymentDate — the payment
    // date should be when it's being captured/reconciled, not necessarily
    // whatever date happens to be printed on the slip; shown for the
    // secretary's own reference only.
  }

  async function handleAddCharge(e) {
    e.preventDefault();
    setChargeError('');
    setAddingCharge(true);
    try {
      if (chargeMode === 'catalog') {
        const template = billing.catalog.find((t) => t.templateId === selectedTemplateId);
        if (!template) { setChargeError('Select a fee to charge.'); return; }
        const amount = template.standardCharge;
        if (useInstallmentPlan) {
          const result = await window.electronAPI.createInstallmentPlan({
            studentId: selectedStudent.studentId, school, category: template.category,
            description: template.itemName, totalAmount: amount, numberOfInstallments: Number(installmentCount),
            startDate: new Date().toISOString().slice(0, 10), priorityTier: template.priorityTier, createdBy: user.username
          });
          if (!result.success) { setChargeError(result.message); return; }
        } else {
          const result = await window.electronAPI.createCharge({
            studentId: selectedStudent.studentId, school, templateId: template.templateId,
            category: template.category, description: template.itemName, originalAmount: amount,
            dueDate: new Date().toISOString().slice(0, 10), priorityTier: template.priorityTier,
            frequency: template.frequency, createdBy: user.username
          });
          if (!result.success) { setChargeError(result.message); return; }
        }
      } else {
        if (!customCategory || !customDescription || !(Number(customAmount) > 0)) {
          setChargeError('Category, description, and a positive amount are required.');
          return;
        }
        if (useInstallmentPlan) {
          const result = await window.electronAPI.createInstallmentPlan({
            studentId: selectedStudent.studentId, school, category: customCategory,
            description: customDescription, totalAmount: Number(customAmount), numberOfInstallments: Number(installmentCount),
            startDate: new Date().toISOString().slice(0, 10), priorityTier: Number(customTier), createdBy: user.username
          });
          if (!result.success) { setChargeError(result.message); return; }
        } else {
          const result = await window.electronAPI.createCharge({
            studentId: selectedStudent.studentId, school, category: customCategory, description: customDescription,
            originalAmount: Number(customAmount), dueDate: new Date().toISOString().slice(0, 10),
            priorityTier: Number(customTier), frequency: 'one-time', createdBy: user.username
          });
          if (!result.success) { setChargeError(result.message); return; }
        }
      }
      setShowAddCharge(false);
      setSelectedTemplateId(''); setCustomCategory(''); setCustomDescription(''); setCustomAmount('');
      setUseInstallmentPlan(false); setInstallmentCount(3);
      await loadBilling(selectedStudent.studentId);
    } finally {
      setAddingCharge(false);
    }
  }

  const manualTotal = useMemo(
    () => Object.values(manualAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [manualAmounts]
  );
  const manualSelectedCount = useMemo(
    () => Object.values(manualAmounts).filter((v) => Number(v) > 0).length,
    [manualAmounts]
  );

  function toggleFeeSelection(expectationId, fullAmount) {
    setManualAmounts((m) => {
      const next = { ...m };
      if (Number(next[expectationId]) > 0) {
        delete next[expectationId]; // already selected — uncheck
      } else {
        next[expectationId] = String(fullAmount); // newly checked — default to paying it in full
      }
      return next;
    });
  }

  async function handleSubmitPayment(e) {
    e.preventDefault();
    setSubmitError('');
    const amount = allocationMode === 'auto' ? Number(paymentAmount) : manualTotal;
    if (!(amount > 0)) { setSubmitError('Enter a payment amount greater than 0.'); return; }
    if (!transactionReference.trim()) { setSubmitError('A transaction reference is required — payments cannot be captured without one.'); return; }

    setSubmitting(true);
    try {
      const payload = {
        studentId: selectedStudent.studentId, school, amount,
        paymentMethod, transactionReference: transactionReference.trim(),
        bankName: bankName.trim(), bankReference: bankReferenceField.trim(), senderAccountRef: senderAccountRef.trim(),
        payerName: payerName.trim(), processedBy: user.username,
        paymentDate: new Date().toISOString().slice(0, 10),
        mode: allocationMode
      };
      if (allocationMode === 'manual') {
        payload.directedAllocationSet = Object.entries(manualAmounts)
          .filter(([, v]) => Number(v) > 0)
          .map(([expectationId, v]) => ({ expectationId, amount: Number(v) }));
      }
      const result = await window.electronAPI.capturePayment(payload);
      if (!result.success) { setSubmitError(result.message); return; }

      // Save the uploaded receipt (if any) now that a real paymentId
      // exists to name it by, then link the resulting path back onto
      // the payment record — so it's retrievable later, not just used
      // transiently for OCR.
      if (receiptFile) {
        try {
          const base64 = await fileToBase64(receiptFile);
          const extension = (receiptFile.name.split('.').pop() || 'jpg').toLowerCase();
          const saveRes = await window.electronAPI.savePaymentReceipt(result.payment.paymentId, base64, extension);
          if (saveRes.success) {
            await window.electronAPI.updatePaymentReceiptPath(result.payment.paymentId, saveRes.filePath);
          }
        } catch (err) {
          console.warn('Payment captured successfully, but saving the receipt file failed:', err.message);
        }
      }

      setSuccessInfo({
        amount, method: paymentMethod, reference: transactionReference.trim(), surplus: result.unallocatedSurplus || 0,
        studentName: `${selectedStudent.firstName} ${selectedStudent.lastName}`, studentNumber: selectedStudent.studentNumber,
        payerName: payerName.trim(), processedBy: user.username, paymentDate: payload.paymentDate
      });
      setPaymentAmount(''); setTransactionReference(''); setPayerName(''); setManualAmounts({});
      setBankName(''); setBankReferenceField(''); setSenderAccountRef('');
      setReceiptFile(null); setReceiptPreviewUrl(''); setOcrSuggestions(null); setOcrError('');
      await loadBilling(selectedStudent.studentId);
    } finally {
      setSubmitting(false);
    }
  }

  function handleAddToBatch() {
    setSubmitError('');
    if (!selectedStudent) { setSubmitError('Select a student first.'); return; }
    if (!(Number(paymentAmount) > 0)) { setSubmitError('Enter a payment amount greater than 0.'); return; }
    if (!transactionReference.trim()) { setSubmitError('A transaction reference is required for each payment.'); return; }

    setBatchQueue((q) => [...q, {
      studentId: selectedStudent.studentId,
      studentName: `${selectedStudent.firstName} ${selectedStudent.lastName}`,
      studentNumber: selectedStudent.studentNumber,
      amount: Number(paymentAmount),
      paymentMethod, transactionReference: transactionReference.trim(), payerName: payerName.trim()
    }]);

    // Clear the form and go straight back to searching for the next
    // student — this is the whole point of batch mode.
    setSelectedStudent(null); setBilling(null); setQuery('');
    setPaymentAmount(''); setTransactionReference(''); setPayerName('');
    setBatchResults(null);
  }

  function handleRemoveFromBatch(index) {
    setBatchQueue((q) => q.filter((_, i) => i !== index));
  }

  async function handleSubmitBatch() {
    setBatchSubmitting(true);
    setBatchResults(null);
    // Sequential, not Promise.all — these are real financial transactions,
    // not read-only queries. One at a time means a failure partway through
    // is easy to see and reason about (which ones landed, which didn't),
    // rather than an ambiguous mixed-result race.
    const results = [];
    for (const entry of batchQueue) {
      try {
        const result = await window.electronAPI.capturePayment({
          studentId: entry.studentId, school, amount: entry.amount,
          paymentMethod: entry.paymentMethod, transactionReference: entry.transactionReference,
          payerName: entry.payerName, processedBy: user.username,
          paymentDate: new Date().toISOString().slice(0, 10), mode: 'auto'
        });
        results.push({ ...entry, success: result.success, message: result.success ? null : result.message });
      } catch (err) {
        results.push({ ...entry, success: false, message: err.message });
      }
    }
    setBatchResults(results);
    // Keep only the ones that failed queued — the succeeded ones are done,
    // no reason to leave them sitting there inviting a duplicate resubmit.
    setBatchQueue(results.filter((r) => !r.success).map(({ success, message, ...entry }) => entry));
    setBatchSubmitting(false);
  }

  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [printError, setPrintError] = useState('');

  async function handlePrintReceipt(info) {
    setPrintError('');
    setPrintingReceipt(true);
    try {
      const doc = await generateThermalReceiptPdf({ school, ...info, receiptNo: info.reference });
      const base64 = doc.output('datauristring').split(',')[1];
      const result = await window.electronAPI.printPdf({
        base64, silent: false,
        widthMicrons: 80000, heightMicrons: Math.round(doc.internal.pageSize.getHeight() * 1000)
      });
      if (!result.success) setPrintError(result.message);
    } finally {
      setPrintingReceipt(false);
    }
  }

  async function handleSaveReceiptPdf(info) {
    const doc = await generateThermalReceiptPdf({ school, ...info, receiptNo: info.reference });
    doc.save(`receipt-${info.reference}.pdf`);
  }

  return (
    <div>
      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <div className="ent-card-head">
          <h3 className="ent-card-title"><Search size={16} /> Select Student</h3>
          <Toggle
            checked={batchMode}
            onChange={(val) => { setBatchMode(val); setBatchResults(null); if (!val) setBatchQueue([]); else setAllocationMode('auto'); }}
            label="Batch Mode"
            id="batch-mode-toggle"
          />
        </div>
        {batchMode && (
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            Add each student's payment to the queue below, then submit them all together — for processing several students (e.g. 10-15) in one sitting instead of repeating the full flow each time. Each payment keeps its own amount, method, and reference; only auto-allocation is available in batch mode.
          </p>
        )}
        <div className="ent-autocomplete">
          <div className="ent-autocomplete-input-wrap" ref={searchAnchorRef}>
            <Search size={15} />
            <input
              className="ent-input"
              placeholder="Search by name or student number..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
            />
          </div>
          {showResults && query && (
            <AutocompleteDropdown anchorRef={searchAnchorRef}>
              {filteredStudents.length === 0 ? (
                <div className="ent-autocomplete-empty">No matching students.</div>
              ) : filteredStudents.map((s) => (
                <div key={s.studentId} className="ent-autocomplete-item" onClick={() => selectStudent(s)}>
                  <span>{s.firstName} {s.lastName}</span>
                  <small>{s.studentNumber}</small>
                </div>
              ))}
            </AutocompleteDropdown>
          )}
        </div>
      </div>

      {batchMode && batchQueue.length > 0 && (
        <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
          <div className="ent-card-head">
            <h3 className="ent-card-title"><Banknote size={16} /> Batch Queue ({batchQueue.length})</h3>
            <button type="button" className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleSubmitBatch} disabled={batchSubmitting}>
              {batchSubmitting ? 'Submitting...' : `Submit All Payments (${batchQueue.length})`}
            </button>
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead><tr><th>Student</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead>
              <tbody>
                {batchQueue.map((entry, i) => (
                  <tr key={i}>
                    <td>{entry.studentName} <span style={{ color: 'var(--c-faint)', fontSize: '0.75rem' }}>({entry.studentNumber})</span></td>
                    <td className="ent-td-num">{money(entry.amount)}</td>
                    <td>{entry.paymentMethod}</td>
                    <td className="ent-td-mono">{entry.transactionReference}</td>
                    <td><button type="button" className="ent-icon-btn ent-icon-btn--red" onClick={() => handleRemoveFromBatch(i)} disabled={batchSubmitting}>&times;</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {batchResults && (
        <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
          <h3 className="ent-card-title"><CheckCircle2 size={16} /> Batch Results</h3>
          {batchResults.map((r, i) => (
            <div key={i} className={r.success ? 'ent-success-box' : 'ent-error-box'} style={{ marginBottom: '0.5rem' }}>
              {r.studentName}: {r.success ? `Captured ${money(r.amount)}.` : `Failed — ${r.message}`}
            </div>
          ))}
        </div>
      )}

      {loadingBilling && <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem' }}>Loading student billing...</p>}

      {selectedStudent && billing && !loadingBilling && (
        <>
          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--c-ink)' }}>{selectedStudent.firstName} {selectedStudent.lastName}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--c-faint)' }}>{selectedStudent.studentNumber} &bull; {SCHOOL_LABEL[school]}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="ent-badge" style={{ background: STATUS_COLOR[billing.status] || '#6b7280', marginBottom: '0.3rem', display: 'inline-block' }}>{billing.status}</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: billing.balance > 0 ? 'var(--c-danger)' : billing.balance < 0 ? 'var(--c-success)' : 'var(--c-ink)' }}>
                  {money(billing.balance)}
                </div>
              </div>
            </div>
          </div>

          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <div className="ent-card-head">
              <h3 className="ent-card-title">Outstanding Fees ({billing.outstanding.length})</h3>
              <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowAddCharge((v) => !v)}>
                <Plus size={14} /> Add Charge
              </button>
            </div>

            {showAddCharge && (
              <form onSubmit={handleAddCharge} style={{ background: 'var(--c-surface-flat)', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', padding: '1rem', marginBottom: '1rem' }}>
                {chargeError && <div className="ent-error-box">{chargeError}</div>}
                <div className="ent-tabs" style={{ marginBottom: '0.9rem' }}>
                  <button type="button" className={`ent-tab ${chargeMode === 'catalog' ? 'is-active' : ''}`} onClick={() => setChargeMode('catalog')}>From Fee Catalog</button>
                  <button type="button" className={`ent-tab ${chargeMode === 'custom' ? 'is-active' : ''}`} onClick={() => setChargeMode('custom')}>Custom Charge</button>
                </div>

                {chargeMode === 'catalog' ? (
                  <div className="ent-field">
                    <label>Fee</label>
                    <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} required>
                      <option value="">Select a fee...</option>
                      {billing.catalog.map((t) => (
                        <option key={t.templateId} value={t.templateId}>{t.itemName} — {money(t.standardCharge)}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
                      <div className="ent-field"><label>Category</label><input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Uniform" /></div>
                      <div className="ent-field"><label>Amount</label><input type="number" step="0.01" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} /></div>
                    </div>
                    <div className="ent-field"><label>Description</label><input value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} placeholder="e.g. School Uniform Set" /></div>
                    <div className="ent-field">
                      <label>Priority Tier</label>
                      <select value={customTier} onChange={(e) => setCustomTier(e.target.value)}>
                        <option value={1}>1 — Tuition</option>
                        <option value={2}>2 — Bus / Hostel</option>
                        <option value={3}>3 — Ad-hoc (Uniform, etc.)</option>
                        <option value={4}>4 — Fines</option>
                      </select>
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', margin: '0.9rem 0' }}>
                  <Toggle checked={useInstallmentPlan} onChange={setUseInstallmentPlan} label="Split into a payment plan" id="installment-toggle" />
                </div>
                {useInstallmentPlan && (
                  <div className="ent-field" style={{ maxWidth: '220px' }}>
                    <label>Number of Months</label>
                    <select value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)}>
                      <option value={2}>2 months</option>
                      <option value={3}>3 months</option>
                      <option value={4}>4 months</option>
                      <option value={6}>6 months</option>
                    </select>
                    <p className="ent-hint">Splits the total evenly across monthly installments, starting today.</p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem' }}>
                  <button type="button" className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowAddCharge(false)}>Cancel</button>
                  <button type="submit" className="ent-btn ent-btn--primary ent-btn--sm" disabled={addingCharge}>{addingCharge ? 'Adding...' : 'Add Charge'}</button>
                </div>
              </form>
            )}

            <div className="ent-table-wrap">
              <table className="ent-table">
                <thead>
                  <tr>
                    {allocationMode === 'manual' && <th style={{ width: '32px' }}></th>}
                    <th>Description</th><th>Due Date</th><th>Owed</th>
                    {allocationMode === 'manual' && <th>Paying</th>}
                  </tr>
                </thead>
                <tbody>
                  {billing.outstanding.length === 0 ? (
                    <tr><td colSpan={allocationMode === 'manual' ? 5 : 3} className="ent-table-empty">No outstanding fees — fully paid up.</td></tr>
                  ) : billing.outstanding.map((e) => {
                    const isSelected = Number(manualAmounts[e.expectationId]) > 0;
                    return (
                      <tr key={e.expectationId} style={allocationMode === 'manual' && isSelected ? { background: 'rgba(6,182,212,0.05)' } : undefined}>
                        {allocationMode === 'manual' && (
                          <td>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleFeeSelection(e.expectationId, e.remaining)} />
                          </td>
                        )}
                        <td>{e.description}{e.frequency === 'monthly' && e.installmentPlanId && <span className="ent-badge ent-badge--soft" style={{ marginLeft: '6px' }}>Plan</span>}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{e.dueDate}</td>
                        <td className="ent-td-num">{money(e.remaining)}</td>
                        {allocationMode === 'manual' && (
                          <td>
                            {isSelected ? (
                              <input
                                type="number" step="0.01" min="0" max={e.remaining}
                                value={manualAmounts[e.expectationId]}
                                onChange={(ev) => setManualAmounts((m) => ({ ...m, [e.expectationId]: ev.target.value }))}
                                style={{ width: '90px', padding: '0.3rem 0.4rem', borderRadius: 'var(--r-sm)', border: '1px solid #d1d5db' }}
                              />
                            ) : <span style={{ color: 'var(--c-faint)', fontSize: '0.8rem' }}>—</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ent-card">
            <h3 className="ent-card-title"><Banknote size={16} /> Capture Payment</h3>

            {successInfo && (
              <div className="ent-success-box">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <CheckCircle2 size={16} />
                  Captured {money(successInfo.amount)} via {successInfo.method} (ref: {successInfo.reference}).
                  {successInfo.surplus > 0 && ` ${money(successInfo.surplus)} exceeded what was owed and is now credited ahead against future fees.`}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => handlePrintReceipt(successInfo)} disabled={printingReceipt}>
                    <Printer size={13} /> {printingReceipt ? 'Opening printer...' : 'Print Receipt'}
                  </button>
                  <button type="button" className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => handleSaveReceiptPdf(successInfo)}>
                    <Download size={13} /> Save as PDF
                  </button>
                </div>
                {printError && <p style={{ fontSize: '0.75rem', color: 'var(--c-danger)', marginTop: '0.4rem' }}>{printError}</p>}
              </div>
            )}
            {submitError && <div className="ent-error-box"><AlertCircle size={14} style={{ marginRight: '4px' }} />{submitError}</div>}

            {!batchMode && (
              <div className="ent-tabs" style={{ marginBottom: '1rem' }}>
                <button type="button" className={`ent-tab ${allocationMode === 'auto' ? 'is-active' : ''}`} onClick={() => setAllocationMode('auto')}>Auto-Allocate (FIFO)</button>
                <button type="button" className={`ent-tab ${allocationMode === 'manual' ? 'is-active' : ''}`} onClick={() => setAllocationMode('manual')}>Manual Allocation</button>
              </div>
            )}
            {allocationMode === 'auto' ? (
              <p className="ent-hint" style={{ marginBottom: '0.9rem' }}>Payment is applied automatically: Tuition first, then Bus/Hostel, then ad-hoc fees, then fines — oldest due date first within each tier.</p>
            ) : (
              <p className="ent-hint" style={{ marginBottom: '0.9rem' }}>Enter amounts directly against specific fees in the table above. Total to capture: <strong>{money(manualTotal)}</strong></p>
            )}

            <form onSubmit={batchMode ? (e) => { e.preventDefault(); handleAddToBatch(); } : handleSubmitPayment}>
              {!batchMode && (
                <div className="ent-field">
                  <label>Bank Transfer Receipt (optional)</label>
                  {!receiptFile ? (
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px dashed #d1d5db',
                        borderRadius: 'var(--r-sm)', padding: '0.7rem', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--c-muted)'
                      }}
                    >
                      <Upload size={15} />
                      Upload a photo or PDF of the bank slip — image uploads get scanned for suggested details
                      <input type="file" accept="image/*,application/pdf" onChange={handleReceiptUpload} style={{ display: 'none' }} />
                    </label>
                  ) : (
                    <div style={{ border: '1px solid #eef2f6', borderRadius: 'var(--r-sm)', padding: '0.6rem 0.8rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                          {receiptFile.type.startsWith('image/') ? (
                            <img src={receiptPreviewUrl} alt="Receipt preview" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px' }} />
                          ) : <FileText size={20} color="var(--c-muted)" />}
                          <span>{receiptFile.name}</span>
                        </div>
                        <button
                          type="button" className="ent-icon-btn ent-icon-btn--red"
                          onClick={() => { setReceiptFile(null); setReceiptPreviewUrl(''); setOcrSuggestions(null); setOcrError(''); }}
                        ><X size={13} /></button>
                      </div>

                      {ocrRunning && <p className="ent-hint" style={{ marginTop: '0.5rem' }}>Reading the receipt...</p>}
                      {ocrError && <p style={{ fontSize: '0.76rem', color: 'var(--c-danger)', marginTop: '0.5rem' }}>{ocrError}</p>}

                      {ocrSuggestions && (
                        <div style={{ marginTop: '0.6rem' }}>
                          <p className="ent-hint" style={{ marginBottom: '0.4rem' }}>
                            Best-effort reading of the slip — check each value against the actual document before applying it.
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {ocrSuggestions.amount !== null && (
                              <button type="button" className="ent-badge ent-badge--soft" style={{ cursor: 'pointer', border: 'none' }} onClick={() => applySuggestion('amount', ocrSuggestions.amount)}>
                                Amount: {money(ocrSuggestions.amount)} — use this
                              </button>
                            )}
                            {ocrSuggestions.reference && (
                              <button type="button" className="ent-badge ent-badge--soft" style={{ cursor: 'pointer', border: 'none' }} onClick={() => applySuggestion('reference', ocrSuggestions.reference)}>
                                Ref: {ocrSuggestions.reference} — use this
                              </button>
                            )}
                            {ocrSuggestions.bankName && (
                              <button type="button" className="ent-badge ent-badge--soft" style={{ cursor: 'pointer', border: 'none' }} onClick={() => applySuggestion('bankName', ocrSuggestions.bankName)}>
                                Bank: {ocrSuggestions.bankName} — use this
                              </button>
                            )}
                            {ocrSuggestions.senderAccountRef && (
                              <button type="button" className="ent-badge ent-badge--soft" style={{ cursor: 'pointer', border: 'none' }} onClick={() => applySuggestion('senderAccountRef', ocrSuggestions.senderAccountRef)}>
                                Account: {ocrSuggestions.senderAccountRef} — use this
                              </button>
                            )}
                            {ocrSuggestions.date && (
                              <span className="ent-badge ent-badge--muted">Slip date shown: {ocrSuggestions.date}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: allocationMode === 'auto' ? '1fr 1fr' : '1fr', gap: '0.8rem' }}>
                {allocationMode === 'auto' && (
                  <div className="ent-field">
                    <label>Amount</label>
                    <input type="number" step="0.01" min="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} required />
                  </div>
                )}
                <div className="ent-field">
                  <label>Payment Method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="EFT">EFT</option>
                    <option value="POS">POS (Card Swipe)</option>
                  </select>
                  <p className="ent-hint">Cash is never accepted — cashless enforcement is a hard rule, not a UI preference.</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div className="ent-field">
                  <label>Transaction Reference</label>
                  <input value={transactionReference} onChange={(e) => setTransactionReference(e.target.value)} placeholder="Bank/POS reference #" required />
                </div>
                <div className="ent-field">
                  <label>Payer Name (optional)</label>
                  <input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="If different from guardian on file" />
                </div>
              </div>
              {!batchMode && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem' }}>
                  <div className="ent-field">
                    <label>Bank Name (optional)</label>
                    <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. First National Bank" />
                  </div>
                  <div className="ent-field">
                    <label>Bank's Own Reference (optional)</label>
                    <input value={bankReferenceField} onChange={(e) => setBankReferenceField(e.target.value)} placeholder="If different from above" />
                  </div>
                  <div className="ent-field">
                    <label>Sender Account (last digits, optional)</label>
                    <input value={senderAccountRef} onChange={(e) => setSenderAccountRef(e.target.value)} placeholder="****1234" />
                  </div>
                </div>
              )}
              {!batchMode && (
                <p className="ent-hint" style={{ marginTop: '-0.5rem', marginBottom: '0.8rem' }}>
                  These three help a parent match this payment against their own bank statement later — none are required to capture the payment.
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
                {batchMode ? (
                  <button type="submit" className="ent-btn ent-btn--primary">
                    <Plus size={15} /> Add to Batch
                  </button>
                ) : (
                  <button type="submit" className="ent-btn ent-btn--primary" disabled={submitting}>
                    <CreditCard size={15} /> {submitting ? 'Capturing...' : 'Capture Payment'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </>
      )}

      <CorrectPaymentSection school={school} user={user} />
      <WaiverDiscountSection school={school} user={user} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correcting a payment that was captured with the wrong amount — e.g. the
// secretary typed N$500 but the bank slip actually shows N$700, or the
// reverse. The original payment is never edited (this ledger stays
// append-only, same as everywhere else in the app); a correction is a
// separate, linked record instead, with its own required reason.
// ---------------------------------------------------------------------------
function WaiverDiscountSection({ school, user }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchAnchorRef = useRef(null);

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [adjType, setAdjType] = useState('WAIVER');
  const [targetCategory, setTargetCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [explanation, setExplanation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      window.electronAPI.getStudentsByFilters({ school, search: query.trim() }).then((res) => {
        if (res.success) setResults(res.students.slice(0, 8));
        setSearching(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, school]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery(`${s.firstName} ${s.lastName} (${s.studentNumber})`);
    setShowResults(false);
    setError(''); setSuccess(null);
    setAmount(''); setReasonCode(''); setExplanation(''); setTargetCategory('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(null);
    if (!selectedStudent) { setError('Search for and select the student first.'); return; }
    const numAmount = Number(amount);
    if (!(numAmount > 0)) { setError('Enter the amount as a positive number.'); return; }
    if (!reasonCode.trim()) { setError('A reason is required — this becomes part of the permanent record.'); return; }

    setSubmitting(true);
    try {
      const res = await window.electronAPI.applyAdminAdjustment({
        studentId: selectedStudent.studentId, school,
        type: adjType, targetCategory: targetCategory.trim(), targetExpectationId: '',
        amount: numAmount, reasonCode: reasonCode.trim(), explanation: explanation.trim(),
        approvedByUserId: user.username
      });
      if (!res.success) { setError(res.message); return; }
      setSuccess(`Applied — ${money(numAmount)} ${adjType.toLowerCase()} recorded for ${selectedStudent.firstName} ${selectedStudent.lastName}.`);
      setAmount(''); setReasonCode(''); setExplanation('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ent-card" style={{ marginTop: '1.2rem' }}>
      <button
        type="button" onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <h3 className="ent-card-title" style={{ margin: 0 }}><AlertCircle size={16} /> Apply Waiver, Discount, or Write-Off</h3>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div style={{ marginTop: '1rem' }}>
          <p className="ent-hint" style={{ marginBottom: '0.9rem' }}>
            For reducing what a student owes — a hardship waiver, a sibling discount, or writing off an uncollectable balance. This only ever reduces real, existing debt; it can't create a false credit against a fee that's already settled.
          </p>

          <div className="ent-autocomplete" style={{ marginBottom: '1rem' }}>
            <div className="ent-autocomplete-input-wrap" ref={searchAnchorRef}>
              <Search size={15} />
              <input
                className="ent-input" placeholder="Search by student name..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowResults(true); setSelectedStudent(null); }}
                onFocus={() => setShowResults(true)}
              />
            </div>
            {showResults && query && (
              <AutocompleteDropdown anchorRef={searchAnchorRef}>
                {searching ? (
                  <div className="ent-autocomplete-empty">Searching...</div>
                ) : results.length === 0 ? (
                  <div className="ent-autocomplete-empty">No matching students.</div>
                ) : results.map((s) => (
                  <div key={s.studentId} className="ent-autocomplete-item" onClick={() => selectStudent(s)}>
                    <span>{s.firstName} {s.lastName}</span>
                    <small>{s.studentNumber}</small>
                  </div>
                ))}
              </AutocompleteDropdown>
            )}
          </div>

          {selectedStudent && (
            <form onSubmit={handleSubmit}>
              {error && <div className="ent-error-box">{error}</div>}
              {success && <div className="ent-success-box">{success}</div>}

              <div className="ent-field">
                <label>Type</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {['WAIVER', 'DISCOUNT', 'WRITE_OFF'].map((t) => (
                    <button
                      key={t} type="button" onClick={() => setAdjType(t)}
                      className={`ent-btn ent-btn--sm ${adjType === t ? 'ent-btn--primary' : 'ent-btn--secondary'}`}
                    >
                      {t.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ent-field">
                <label>Fee Category (optional — leave blank to apply against the oldest outstanding debt)</label>
                <input className="ent-input" value={targetCategory} onChange={(e) => setTargetCategory(e.target.value)} placeholder="e.g. Tuition" />
              </div>

              <div className="ent-field">
                <label>Amount (N$)</label>
                <input className="ent-input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>

              <div className="ent-field">
                <label>Reason</label>
                <input className="ent-input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. Financial hardship, sibling discount" />
              </div>

              <div className="ent-field">
                <label>Additional Notes (optional)</label>
                <textarea className="ent-input" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </div>

              <button className="ent-btn ent-btn--primary" type="submit" disabled={submitting}>
                {submitting ? 'Applying...' : `Apply ${adjType.replace('_', ' ')}`}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function CorrectPaymentSection({ school, user }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchAnchorRef = useRef(null);

  const [selectedPayment, setSelectedPayment] = useState(null);
  const [pastCorrections, setPastCorrections] = useState([]);
  const [direction, setDirection] = useState('more'); // 'more' = was under-recorded, 'less' = was over-recorded
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      window.electronAPI.getAllPaymentsDetailed({ school, search: query.trim() }).then((res) => {
        if (res.success) setResults(res.data.rows.slice(0, 8));
        setSearching(false);
      });
    }, 300); // debounced — this searches on every keystroke otherwise, no need to hit the database that often
    return () => clearTimeout(timer);
  }, [query, school]);

  async function selectPayment(p) {
    setSelectedPayment(p);
    setQuery(`${p.studentName} — ${money(p.amount)} (${p.transactionReference})`);
    setShowResults(false);
    setError(''); setSuccess(null);
    setCorrectionAmount(''); setReason('');
    const res = await window.electronAPI.getCorrectionsForPayment(p.paymentId);
    if (res.success) setPastCorrections(res.corrections);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(null);
    if (!selectedPayment) { setError('Search for and select the payment you want to correct.'); return; }
    const rawAmount = Number(correctionAmount);
    if (!(rawAmount > 0)) { setError('Enter the correction amount as a positive number — use the toggle above to say which direction it goes.'); return; }
    if (!reason.trim()) { setError('A reason is required — this becomes part of the permanent record.'); return; }

    setSubmitting(true);
    try {
      const signedAmount = direction === 'more' ? rawAmount : -rawAmount;
      const res = await window.electronAPI.correctPayment({
        originalPaymentId: selectedPayment.paymentId, correctionAmount: signedAmount,
        reason: reason.trim(), correctedByUserId: user.username
      });
      if (!res.success) { setError(res.message); return; }
      setSuccess(direction === 'more'
        ? `Applied — the extra ${money(rawAmount)} has been allocated against what was still owed.`
        : `Applied — a new charge of ${money(rawAmount)} has been added, since less was actually received than originally recorded.`);
      const corrRes = await window.electronAPI.getCorrectionsForPayment(selectedPayment.paymentId);
      if (corrRes.success) setPastCorrections(corrRes.corrections);
      setCorrectionAmount(''); setReason('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ent-card" style={{ marginTop: '1.2rem' }}>
      <button
        type="button" onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <h3 className="ent-card-title" style={{ margin: 0 }}><AlertCircle size={16} /> Correct a Past Payment</h3>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div style={{ marginTop: '1rem' }}>
          <p className="ent-hint" style={{ marginBottom: '0.9rem' }}>
            For when a payment was captured with the wrong amount — the bank slip shows more or less than what was originally typed in. The original payment record is kept exactly as it was; this adds a linked, reasoned correction rather than editing it.
          </p>

          <div className="ent-autocomplete" style={{ marginBottom: '1rem' }}>
            <div className="ent-autocomplete-input-wrap" ref={searchAnchorRef}>
              <Search size={15} />
              <input
                className="ent-input" placeholder="Search by student name or reference number..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowResults(true); setSelectedPayment(null); }}
                onFocus={() => setShowResults(true)}
              />
            </div>
            {showResults && query && (
              <AutocompleteDropdown anchorRef={searchAnchorRef}>
                {searching ? (
                  <div className="ent-autocomplete-empty">Searching...</div>
                ) : results.length === 0 ? (
                  <div className="ent-autocomplete-empty">No matching payments.</div>
                ) : results.map((p) => (
                  <div key={p.paymentId} className="ent-autocomplete-item" onClick={() => selectPayment(p)}>
                    <span>{p.studentName} — {money(p.amount)}</span>
                    <small>{p.transactionReference} · {p.paymentDate}</small>
                  </div>
                ))}
              </AutocompleteDropdown>
            )}
          </div>

          {selectedPayment && (
            <form onSubmit={handleSubmit}>
              <div style={{ background: 'var(--c-surface-flat)', borderRadius: 'var(--r-md)', padding: '0.8rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div><strong>{selectedPayment.studentName}</strong> ({selectedPayment.studentNumber})</div>
                <div>Originally recorded: {money(selectedPayment.amount)} via {selectedPayment.paymentMethod} on {selectedPayment.paymentDate}</div>
                <div>Reference: {selectedPayment.transactionReference}</div>
              </div>

              {pastCorrections.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <p className="ent-hint" style={{ marginBottom: '0.4rem' }}>This payment has already been corrected before:</p>
                  {pastCorrections.map((c) => (
                    <div key={c.correctionId} style={{ fontSize: '0.78rem', color: 'var(--c-ink-soft)', marginBottom: '0.3rem' }}>
                      {c.correctionAmount > 0 ? '+' : ''}{money(c.correctionAmount)} — {c.reason} ({new Date(c.createdAt).toLocaleDateString()})
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="ent-error-box">{error}</div>}
              {success && <div className="ent-success-box">{success}</div>}

              <div className="ent-field">
                <label>What actually happened?</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className={`ent-btn ${direction === 'more' ? 'ent-btn--primary' : 'ent-btn--secondary'} ent-btn--sm`}
                    onClick={() => setDirection('more')}
                  >
                    + The real amount was MORE than recorded
                  </button>
                  <button
                    type="button"
                    className={`ent-btn ${direction === 'less' ? 'ent-btn--primary' : 'ent-btn--secondary'} ent-btn--sm`}
                    onClick={() => setDirection('less')}
                  >
                    − The real amount was LESS than recorded
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.8rem' }}>
                <div className="ent-field">
                  <label>{direction === 'more' ? 'Amount to add' : 'Amount to subtract'}</label>
                  <input type="number" step="0.01" min="0.01" value={correctionAmount} onChange={(e) => setCorrectionAmount(e.target.value)} />
                </div>
                <div className="ent-field">
                  <label>Reason (required)</label>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank slip shows a different amount than originally entered" />
                </div>
              </div>

              <button type="submit" className="ent-btn ent-btn--primary" disabled={submitting}>
                {submitting ? 'Applying...' : 'Apply Correction'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
