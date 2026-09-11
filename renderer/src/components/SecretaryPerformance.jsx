import React, { useEffect, useState } from 'react';
import { Users, TrendingUp, AlertTriangle, CheckCircle2, FileDown, FileSpreadsheet, RefreshCw, Wallet, CalendarCheck, CreditCard } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { money, downloadExcel, drawLetterheadHeader, drawLetterheadFooter, drawSectionHeading } from './Reports.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };

/**
 * Per-secretary performance for an admin — daily/monthly/yearly/all-time
 * totals, transaction counts, and a real reconciliation check: the sum
 * of every individual secretary's total is compared against the actual
 * school-wide total for the same records. These should always match
 * exactly, since every payment has exactly one processedBy — if they
 * don't, it's flagged plainly rather than silently absorbed into a
 * total, because that gap means a real payment record with a
 * processedBy that doesn't match any known account.
 */
export default function SecretaryPerformance({ user }) {
  const school = user.section === 'Both' ? 'Both' : user.section;
  const schoolLabel = SCHOOL_LABEL[school] || school;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [thresholdInput, setThresholdInput] = useState('');
  const [thresholdPeriod, setThresholdPeriod] = useState('monthTotal');

  function load() {
    setLoading(true);
    window.electronAPI.getSecretaryPerformanceData(school).then((res) => {
      if (res.success) setData(res.data);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [school]);

  const threshold = thresholdInput === '' ? null : Number(thresholdInput);

  async function exportPdf() {
    if (!data) return;
    const doc = new jsPDF();
    let y = await drawLetterheadHeader(doc, school === 'Both' ? 'WENDY' : school, 'SECRETARY PERFORMANCE REPORT', new Date().toLocaleDateString());

    y = drawSectionHeading(doc, y, 'Reconciliation Check');
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    doc.text(
      data.reconciliation.reconciled
        ? 'Numbers reconcile correctly — every recorded payment is accounted for under a known secretary.'
        : `Discrepancy found — ${data.reconciliation.orphanedPaymentCount} payment(s) recorded under an unrecognized account. Difference: ${money(data.reconciliation.difference)}.`,
      20, y
    );
    y += 12;

    y = drawSectionHeading(doc, y, 'By Secretary');
    doc.setFont(undefined, 'bold'); doc.setFontSize(9);
    doc.text('Name', 20, y); doc.text('Today', 90, y); doc.text('This Month', 120, y); doc.text('This Year', 155, y); doc.text('All-Time', 180, y);
    doc.setFont(undefined, 'normal');
    y += 3; doc.setDrawColor(180); doc.line(20, y, 196, y); y += 6;
    data.secretaries.forEach((s) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(s.name, 20, y);
      doc.text(money(s.todayTotal), 90, y);
      doc.text(money(s.monthTotal), 120, y);
      doc.text(money(s.yearTotal), 155, y);
      doc.text(money(s.allTimeTotal), 180, y);
      y += 7;
    });

    drawLetterheadFooter(doc, school === 'Both' ? 'WENDY' : school);
    doc.save(`secretary-performance-${school}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function exportExcel() {
    if (!data) return;
    downloadExcel(
      data.secretaries.map((s) => ({
        Name: s.name, Role: s.role, Today: s.todayTotal, 'Today Count': s.todayCount,
        'This Month': s.monthTotal, 'Month Count': s.monthCount,
        'This Year': s.yearTotal, 'Year Count': s.yearCount,
        'All-Time': s.allTimeTotal, 'All-Time Count': s.allTimeCount,
        EFT: s.eftTotal, POS: s.posTotal
      })),
      'Secretary Performance',
      `secretary-performance-${school}-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  if (loading) return <div className="ent-card"><p className="ent-hint">Loading...</p></div>;
  if (!data) return <div className="ent-card"><p className="ent-hint">Could not load secretary performance data.</p></div>;

  const totalToday = data.secretaries.reduce((s, r) => s + r.todayTotal, 0);
  const totalMonth = data.secretaries.reduce((s, r) => s + r.monthTotal, 0);
  const activeCount = data.secretaries.filter((s) => s.allTimeCount > 0).length;

  return (
    <div>
      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <div className="ent-card-head">
          <h3 className="ent-card-title"><Users size={16} /> Finance Secretaries — {schoolLabel}</h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
            <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportExcel}><FileSpreadsheet size={14} /> Excel</button>
            <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportPdf}><FileDown size={14} /> PDF</button>
          </div>
        </div>
        <p className="ent-hint">
          What each secretary has actually processed — daily, monthly, yearly, and all-time — so you can see individual activity at a glance and confirm the totals genuinely add up.
        </p>
      </div>

      {/* Summary KPI cards, same style as the main dashboard overview */}
      <div className="ent-kpi-grid" style={{ marginBottom: '1.2rem' }}>
        <div className="ent-kpi-card ent-kpi-card--highlight">
          <div className="ent-kpi-icon"><Wallet size={26} /></div>
          <div className="ent-kpi-label">Collected Today (All Secretaries)</div>
          <div className="ent-kpi-value">{money(totalToday)}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon"><CalendarCheck size={26} /></div>
          <div className="ent-kpi-label">Collected This Month</div>
          <div className="ent-kpi-value">{money(totalMonth)}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon"><Users size={26} /></div>
          <div className="ent-kpi-label">Active Secretaries</div>
          <div className="ent-kpi-value">{activeCount} of {data.secretaries.length}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon">{data.reconciliation.reconciled ? <CheckCircle2 size={26} /> : <AlertTriangle size={26} />}</div>
          <div className="ent-kpi-label">Reconciliation</div>
          <div className="ent-kpi-value" style={{ color: data.reconciliation.reconciled ? 'var(--c-success)' : 'var(--c-danger)' }}>
            {data.reconciliation.reconciled ? 'Matches' : 'Discrepancy'}
          </div>
        </div>
      </div>

      {!data.reconciliation.reconciled && (
        <div className="ent-card ent-error-box" style={{ marginBottom: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertTriangle size={20} color="var(--c-danger)" />
            <div>
              <strong>Discrepancy found — worth investigating.</strong>
              <p style={{ fontSize: '0.82rem', margin: '0.2rem 0 0', color: 'var(--c-muted)' }}>
                {data.reconciliation.orphanedPaymentCount} payment(s) totaling {money(data.reconciliation.difference)} are recorded under an account that no longer matches a known user — real money collected, but not showing up under any secretary below.
              </p>
            </div>
          </div>
          {data.reconciliation.orphanedPayments.length > 0 && (
            <div className="ent-table-wrap" style={{ marginTop: '0.8rem' }}>
              <table className="ent-table">
                <thead><tr><th>Reference</th><th>Recorded Under</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {data.reconciliation.orphanedPayments.map((p) => (
                    <tr key={p.paymentId}>
                      <td>{p.transactionReference}</td>
                      <td style={{ color: 'var(--c-danger)' }}>{p.processedBy}</td>
                      <td className="ent-td-num">{money(p.amount)}</td>
                      <td>{p.paymentDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <h3 className="ent-card-title" style={{ marginBottom: '0.6rem' }}><TrendingUp size={16} /> Flag by Threshold (optional)</h3>
        <p className="ent-hint" style={{ marginBottom: '0.6rem' }}>
          Type an amount to highlight secretaries below it for a chosen period — a quick way to spot a slow day or an unusually quiet month, not a fixed quota.
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'end' }}>
          <div className="ent-field" style={{ marginBottom: 0 }}>
            <label>Minimum expected (N$)</label>
            <input type="number" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} placeholder="e.g. 1000" />
          </div>
          <div className="ent-field" style={{ marginBottom: 0 }}>
            <label>Period</label>
            <select value={thresholdPeriod} onChange={(e) => setThresholdPeriod(e.target.value)}>
              <option value="todayTotal">Today</option>
              <option value="monthTotal">This Month</option>
              <option value="yearTotal">This Year</option>
            </select>
          </div>
        </div>
      </div>

      {/* Individual secretary cards, dashboard-style, one per secretary */}
      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--c-ink)', marginBottom: '0.8rem' }}>By Secretary</h3>
      {data.secretaries.length === 0 ? (
        <div className="ent-card"><p className="ent-hint">No secretary or admin accounts found for this school.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {data.secretaries.map((s) => {
            const flagged = threshold !== null && s[thresholdPeriod] < threshold;
            return (
              <div
                key={s.username}
                className="ent-card"
                style={flagged ? { border: '1px solid var(--c-danger)', boxShadow: '0 0 0 1px rgba(220,38,38,0.15)' } : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {s.name}
                      {flagged && <AlertTriangle size={14} color="var(--c-danger)" />}
                    </div>
                    <span className="ent-badge ent-badge--muted" style={{ marginTop: '0.3rem' }}>{s.role}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.7rem' }}>
                  <div>
                    <div className="ent-hint" style={{ margin: 0 }}>Today</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(s.todayTotal)}</div>
                    <div className="ent-hint" style={{ margin: 0 }}>{s.todayCount} transaction{s.todayCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div className="ent-hint" style={{ margin: 0 }}>This Month</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(s.monthTotal)}</div>
                    <div className="ent-hint" style={{ margin: 0 }}>{s.monthCount} transaction{s.monthCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div className="ent-hint" style={{ margin: 0 }}>This Year</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{money(s.yearTotal)}</div>
                    <div className="ent-hint" style={{ margin: 0 }}>{s.yearCount} transaction{s.yearCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div className="ent-hint" style={{ margin: 0 }}>All-Time</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{money(s.allTimeTotal)}</div>
                    <div className="ent-hint" style={{ margin: 0 }}>{s.allTimeCount} transaction{s.allTimeCount !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--c-border-soft)', paddingTop: '0.6rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--c-muted)' }}>
                  <span><CreditCard size={12} style={{ verticalAlign: '-1px', marginRight: '3px' }} />EFT {money(s.eftTotal)} &middot; POS {money(s.posTotal)}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--c-faint)', marginTop: '0.3rem' }}>
                  Last payment: {s.lastPaymentAt ? new Date(s.lastPaymentAt).toLocaleString() : 'None yet'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}