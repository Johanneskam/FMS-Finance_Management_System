import React, { useState, useEffect, useMemo } from 'react';
import { Wallet, TrendingUp, Hash, Search, FileSpreadsheet, Eye, X, FileText } from 'lucide-react';
import Pagination from './ui/Pagination.jsx';
import { money, downloadExcel } from './Reports.jsx';

const PAYMENT_METHODS = ['EFT', 'POS']; // the only methods capturePayment actually accepts — this app enforces a cashless policy

export default function AllPayments({ user, school: schoolOverride }) {
  const school = schoolOverride || user.section;

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [methodFilter, setMethodFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ totalTransactions: 0, totalAmount: 0, averagePayment: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [viewTarget, setViewTarget] = useState(null);

  // Debounce search so every keystroke doesn't refetch
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    setError('');
    window.electronAPI.getAllPaymentsDetailed({
      school, startDate, endDate,
      paymentMethod: methodFilter || undefined,
      search: debouncedSearch || undefined
    }).then((res) => {
      if (res.success) {
        setRows(res.data.rows);
        setStats(res.data.stats);
      } else {
        setError(res.message);
      }
      setLoading(false);
    });
  }, [school, startDate, endDate, methodFilter, debouncedSearch]);

  useEffect(() => { setPage(1); }, [startDate, endDate, methodFilter, debouncedSearch]);

  const paged = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page]);

  function handleExport() {
    downloadExcel(
      rows.map((r) => ({
        Date: r.paymentDate, Reference: r.transactionReference, Student: r.studentName,
        'Admission No': r.studentNumber, Class: r.className || '', 'Paid For': r.paidFor,
        Amount: r.amount, Method: r.paymentMethod, 'Processed By': r.processedBy
      })),
      'Payments',
      `all-payments-${school}-${startDate}-to-${endDate}.xlsx`
    );
  }

  return (
    <div>
      <div className="ent-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '1.2rem' }}>
        <div className="ent-kpi-card ent-kpi-card--highlight">
          <div className="ent-kpi-icon"><Hash size={20} /></div>
          <div><div className="ent-kpi-label">Total Transactions</div><div className="ent-kpi-value">{stats.totalTransactions}</div></div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon"><Wallet size={20} /></div>
          <div><div className="ent-kpi-label">Total Amount Collected</div><div className="ent-kpi-value">{money(stats.totalAmount)}</div></div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon"><TrendingUp size={20} /></div>
          <div><div className="ent-kpi-label">Average Payment</div><div className="ent-kpi-value">{money(stats.averagePayment)}</div></div>
        </div>
      </div>

      <div className="ent-card">
        <div className="ent-card-head">
          <h3 className="ent-card-title"><Wallet size={16} /> All Payments</h3>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={handleExport} disabled={rows.length === 0}>
            <FileSpreadsheet size={14} /> Export Excel
          </button>
        </div>

        {error && <div className="ent-error-box">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: '0.7rem', marginBottom: '1rem' }}>
          <div className="ent-field"><label>From</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="ent-field"><label>To</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          <div className="ent-field"><label>Method</label>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="">All Methods</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="ent-field">
            <label>Search</label>
            <div className="ent-autocomplete-input-wrap">
              <Search size={13} />
              <input className="ent-input" placeholder="Student name, admission no, or reference..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="ent-table-wrap">
          <table className="ent-table">
            <thead>
              <tr><th>Date</th><th>Ref #</th><th>Student</th><th>Class</th><th>Paid For</th><th>Amount</th><th>Method</th><th>Processed By</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="ent-table-empty">Loading...</td></tr> :
                paged.length === 0 ? <tr><td colSpan={9} className="ent-table-empty">No payments match these filters.</td></tr> :
                paged.map((r) => (
                  <tr key={r.paymentId}>
                    <td>{r.paymentDate}</td>
                    <td className="ent-td-mono" style={{ fontSize: '0.78rem' }}>{r.transactionReference}</td>
                    <td><strong>{r.studentName}</strong></td>
                    <td>{r.className || '—'}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.paidFor || '—'}</td>
                    <td className="ent-td-num">
                      {money(r.correctedAmount)}
                      {r.corrections?.length > 0 && (
                        <span className="ent-badge ent-badge--info" style={{ marginLeft: '6px', fontSize: '0.62rem' }} title={`Originally recorded as ${money(r.amount)}`}>
                          Corrected
                        </span>
                      )}
                    </td>
                    <td><span className="ent-badge ent-badge--info">{r.paymentMethod}</span></td>
                    <td style={{ fontSize: '0.82rem' }}>{r.processedBy}</td>
                    <td>
                      <button className="ent-icon-btn ent-icon-btn--blue" title="View Details" onClick={() => setViewTarget(r)}><Eye size={14} /></button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} />
      </div>

      {viewTarget && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setViewTarget(null)}>
          <div className="ent-modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Payment Details</h3><button className="ent-modal-close" onClick={() => setViewTarget(null)}><X size={18} /></button></div>
            <div className="ent-modal-body" style={{ fontSize: '0.86rem', display: 'grid', gap: '0.55rem' }}>
              <div><strong>Reference:</strong> {viewTarget.transactionReference}</div>
              <div><strong>Student:</strong> {viewTarget.studentName} ({viewTarget.studentNumber})</div>
              <div>
                <strong>Amount:</strong> {money(viewTarget.correctedAmount)}
                {viewTarget.corrections?.length > 0 && (
                  <span style={{ fontSize: '0.76rem', color: 'var(--c-muted)' }}> (originally recorded as {money(viewTarget.amount)})</span>
                )}
              </div>
              <div><strong>Method:</strong> {viewTarget.paymentMethod}</div>
              <div><strong>Date:</strong> {viewTarget.paymentDate}</div>
              <div><strong>Paid For:</strong> {viewTarget.paidFor || '—'}</div>
              <div><strong>Payer Name:</strong> {viewTarget.payerName || (viewTarget.displayPayerName ? `${viewTarget.displayPayerName} (guardian, not separately recorded)` : '—')}</div>
              {viewTarget.corrections?.length > 0 && (
                <div style={{ borderTop: '1px solid var(--c-border-soft)', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
                  <p className="ent-hint" style={{ marginBottom: '0.4rem' }}>Correction history:</p>
                  {viewTarget.corrections.map((c) => (
                    <div key={c.correctionId} style={{ fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                      {c.correctionAmount > 0 ? '+' : ''}{money(c.correctionAmount)} — {c.reason}
                      <span style={{ color: 'var(--c-faint)' }}> ({new Date(c.createdAt).toLocaleDateString()}, by {c.correctedByUserId})</span>
                    </div>
                  ))}
                </div>
              )}
              {(viewTarget.bankName || viewTarget.bankReference || viewTarget.senderAccountRef) && (
                <div style={{ borderTop: '1px solid var(--c-border-soft)', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
                  <p className="ent-hint" style={{ marginBottom: '0.4rem' }}>For matching against the parent's own bank statement:</p>
                  {viewTarget.bankName && <div><strong>Bank:</strong> {viewTarget.bankName}</div>}
                  {viewTarget.bankReference && <div><strong>Bank's Reference:</strong> {viewTarget.bankReference}</div>}
                  {viewTarget.senderAccountRef && <div><strong>Sender Account:</strong> {viewTarget.senderAccountRef}</div>}
                </div>
              )}
              <div><strong>Processed By:</strong> {viewTarget.processedBy}</div>
              <div><strong>Station:</strong> {viewTarget.stationId}</div>
              {viewTarget.proofOfPaymentPath && (
                <button
                  type="button" className="ent-btn ent-btn--secondary ent-btn--sm"
                  onClick={async () => {
                    const res = await window.electronAPI.openPaymentReceipt(viewTarget.proofOfPaymentPath);
                    if (!res.success) alert(res.message);
                  }}
                >
                  <FileText size={13} /> View Uploaded Receipt
                </button>
              )}
              <p className="ent-hint" style={{ marginTop: '0.4rem' }}>
                Payments can't be edited or deleted here — this ledger is append-only by design, so the record stays a reliable audit trail. If an amount was recorded wrong, use "Correct a Past Payment" in Process Payment instead.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}