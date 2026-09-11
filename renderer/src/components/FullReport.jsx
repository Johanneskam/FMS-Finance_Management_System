import React, { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, RefreshCw, Users, ClipboardList, BookOpen } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { jsPDF } from 'jspdf';
import { money, downloadExcel, drawLetterheadHeader, drawLetterheadFooter, drawSectionHeading } from './Reports.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy' };
const SECTIONS = [
  { id: 'glance', label: 'At a Glance' },
  { id: 'trend', label: 'Trend' },
  { id: 'comparison', label: 'School Comparison' },
  { id: 'categories', label: 'Fee Category Performance' },
  { id: 'grades', label: 'Grade Performance' },
  { id: 'classes', label: 'Class Performance' },
  { id: 'transport', label: 'Transport & Hostel' },
  { id: 'methods', label: 'Payment Methods' },
  { id: 'secretaries', label: 'Finance Secretaries' },
  { id: 'transactions', label: 'Transaction History' },
  { id: 'corrections', label: 'Payment Corrections' },
  { id: 'audit', label: 'Audit Trail' },
  { id: 'debtors', label: 'Highest Debtors' },
  { id: 'alerts', label: 'Alerts' }
];

/**
 * The single, consolidated financial report — every section a school's
 * finance office actually needs in one document, rather than scattered
 * across separate pages. Daily / Monthly / Weekly / Yearly as tabs
 * drilling upward: days within the month, weeks within the month,
 * months across the full calendar year (all twelve, with any month
 * that hasn't happened yet marked as such rather than silently shown
 * as zero). A real transaction table and a real audit trail section
 * are included directly — not just summary figures with no way to see
 * the underlying activity.
 */
export default function FullReport({ user, onNavigate }) {
  const [timeTab, setTimeTab] = useState('weekly');
  const [monthKey] = useState(new Date().toISOString().slice(0, 7));
  const [wendyReport, setWendyReport] = useState(null);
  const [keilaReport, setKeilaReport] = useState(null);
  const [wendyExtras, setWendyExtras] = useState(null);
  const [keilaExtras, setKeilaExtras] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const primarySchool = user.section === 'Both' ? 'WENDY' : user.section;
  const primaryReport = primarySchool === 'WENDY' ? wendyReport : keilaReport;
  const primaryExtras = primarySchool === 'WENDY' ? wendyExtras : keilaExtras;

  function load() {
    setLoading(true);
    Promise.all([
      window.electronAPI.getMonthlyManagementReport('WENDY', monthKey),
      window.electronAPI.getMonthlyManagementReport('KEILA', monthKey),
      window.electronAPI.getReportsCenterExtras('WENDY'),
      window.electronAPI.getReportsCenterExtras('KEILA'),
      window.electronAPI.getAllPaymentsDetailed({ school: primarySchool }),
      window.electronAPI.getSecretaryAuditReport({ school: primarySchool })
    ]).then(([wRes, kRes, wExtrasRes, kExtrasRes, paymentsRes, auditRes]) => {
      if (wRes.success) setWendyReport(wRes.data);
      if (kRes.success) setKeilaReport(kRes.data);
      if (wExtrasRes.success) setWendyExtras(wExtrasRes.data);
      if (kExtrasRes.success) setKeilaExtras(kExtrasRes.data);
      if (paymentsRes.success) setTransactions((paymentsRes.data.rows || []).slice(0, 50));
      if (auditRes.success) setAuditEntries((auditRes.entries || []).slice(0, 30));
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function exportPdf() {
    if (!primaryReport) return;
    const r = primaryReport;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 18;
    const rightEdge = pageWidth - marginX;
    let y = await drawLetterheadHeader(doc, primarySchool, 'FULL FINANCIAL REPORT', r.meta.monthLabel);
    function ensure(need) { if (y > pageHeight - need) { doc.addPage(); y = 20; } }
    function tableRow(cols, widths, bold) {
      doc.setFont(undefined, bold ? 'bold' : 'normal'); doc.setFontSize(9);
      let x = marginX;
      cols.forEach((c, i) => { doc.text(String(c), i === cols.length - 1 ? rightEdge : x, y, i === cols.length - 1 ? { align: 'right' } : undefined); x += widths[i]; });
      y += 6;
    }

    y = drawSectionHeading(doc, y, 'At a Glance');
    doc.setFontSize(10);
    doc.text(`Total Expected: ${money(r.executiveSummary.totalExpected)}`, marginX, y); y += 6;
    doc.text(`Total Collected: ${money(r.executiveSummary.totalCollected)}`, marginX, y); y += 6;
    doc.text(`Total Outstanding: ${money(r.executiveSummary.totalOutstanding)}`, marginX, y); y += 6;
    doc.text(`Collection Rate: ${r.executiveSummary.collectionRatePct}%`, marginX, y); y += 10;

    ensure(60);
    y = drawSectionHeading(doc, y, 'School Comparison');
    tableRow(['School', 'Collected', 'Outstanding', 'Rate'], [55, 45, 45, 30], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    [['WENDY', wendyReport], ['KEILA', keilaReport]].forEach(([key, rep]) => {
      if (!rep) return;
      tableRow([SCHOOL_LABEL[key], money(rep.executiveSummary.totalCollected), money(rep.executiveSummary.totalOutstanding), `${rep.executiveSummary.collectionRatePct}%`], [55, 45, 45, 30]);
    });
    y += 6;

    ensure(60);
    y = drawSectionHeading(doc, y, 'Fee Category Performance');
    tableRow(['Category', 'Students', 'Expected', 'Collected', 'Outstanding'], [50, 30, 35, 35, 30], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    r.feeCategoryPerformance.forEach((c) => {
      ensure(10);
      tableRow([c.category, c.students, money(c.expected), money(c.collected), money(c.outstanding)], [50, 30, 35, 35, 30]);
    });
    y += 6;

    ensure(60);
    y = drawSectionHeading(doc, y, 'Grade Performance');
    tableRow(['Grade', 'Students', 'Paid', 'Partial', 'Unpaid', 'Outstanding'], [40, 25, 25, 25, 25, 30], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    r.gradePerformance.forEach((g) => {
      ensure(10);
      tableRow([g.grade, g.students, g.paid, g.partial, g.unpaid, money(g.outstanding)], [40, 25, 25, 25, 25, 30]);
    });
    y += 6;

    ensure(60);
    y = drawSectionHeading(doc, y, 'Transaction History (Most Recent 50)');
    tableRow(['Date', 'Student', 'Amount', 'Method'], [30, 70, 35, 35], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    transactions.slice(0, 25).forEach((t) => {
      ensure(10);
      tableRow([t.paymentDate, (t.displayPayerName || t.studentName || '').slice(0, 28), money(t.correctedAmount ?? t.amount), t.paymentMethod], [30, 70, 35, 35]);
    });
    y += 6;

    ensure(60);
    y = drawSectionHeading(doc, y, 'Audit Trail (Most Recent 30)');
    tableRow(['Date', 'Actor', 'Action'], [35, 45, 90], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    auditEntries.slice(0, 20).forEach((e) => {
      ensure(10);
      tableRow([new Date(e.timestamp).toLocaleDateString(), (e.actor || '').slice(0, 18), (e.action || '').slice(0, 40)], [35, 45, 90]);
    });
    y += 6;

    ensure(50);
    y = drawSectionHeading(doc, y, 'Highest Debtors');
    tableRow(['Student', 'Owed'], [130, 40], true);
    doc.setDrawColor(220); doc.line(marginX, y - 3, rightEdge, y - 3);
    r.highestDebtors.slice(0, 15).forEach((d) => {
      ensure(10);
      tableRow([`${d.name} (${d.studentNumber})`, money(d.owed)], [130, 40]);
    });

    drawLetterheadFooter(doc, primarySchool);
    doc.save(`full-report-${primarySchool}-${monthKey}.pdf`);
  }

  function exportExcel() {
    if (!primaryReport) return;
    downloadExcel(
      primaryReport.outstandingStudents.map((r) => ({
        Student: r.name, 'Student No': r.studentNumber, Grade: r.grade, Class: r.className,
        'Amount Owed': r.owed, 'Days Overdue': r.daysOverdue
      })),
      'Outstanding Students',
      `full-report-outstanding-${primarySchool}-${monthKey}.xlsx`
    );
  }

  if (loading) return <div className="ent-card"><p className="ent-hint">Loading the full report...</p></div>;
  if (!primaryReport || !primaryExtras) return <div className="ent-card"><p className="ent-hint">Could not load the report.</p></div>;

  const r = primaryReport;

  // Drill-up hierarchy: days within the month -> weeks within the
  // month -> months across the full year. Each tab is genuinely a
  // different lens, not the same data relabeled.
  let trendData, trendXKey, trendYKey, trendLabel, isBarChart;
  if (timeTab === 'daily') {
    trendData = r.dailyTrend; trendXKey = 'date'; trendYKey = 'total'; trendLabel = 'This Month, Day by Day'; isBarChart = false;
  } else if (timeTab === 'weekly') {
    trendData = r.weeklySummary; trendXKey = 'week'; trendYKey = 'collected'; trendLabel = 'This Month, Week by Week'; isBarChart = true;
  } else {
    trendData = primaryExtras.collections.yearlyMonthlyBreakdown; trendXKey = 'month'; trendYKey = 'total'; trendLabel = `Calendar Year ${new Date().getFullYear()}, Month by Month`; isBarChart = true;
  }

  return (
    <div>
      {/* ---- Header ---- */}
      <div className="ent-card" style={{ marginBottom: '1.2rem', borderTop: '4px solid var(--c-primary)' }}>
        <div className="ent-card-head">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--c-ink)' }}>Full Financial Report</h2>
            <p className="ent-hint" style={{ margin: '0.2rem 0 0' }}>{r.meta.monthLabel} &middot; Generated {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
            <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={exportExcel}><FileSpreadsheet size={14} /> Excel</button>
            <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={exportPdf}><FileDown size={14} /> PDF</button>
          </div>
        </div>
        <div className="ent-tabs" style={{ marginTop: '1rem' }}>
          <button className={`ent-tab ${timeTab === 'daily' ? 'is-active' : ''}`} onClick={() => setTimeTab('daily')}>Daily</button>
          <button className={`ent-tab ${timeTab === 'weekly' ? 'is-active' : ''}`} onClick={() => setTimeTab('weekly')}>Weekly (This Month)</button>
          <button className={`ent-tab ${timeTab === 'yearly' ? 'is-active' : ''}`} onClick={() => setTimeTab('yearly')}>Yearly (Jan\u2013Dec)</button>
        </div>
      </div>

      {/* ---- Table of contents ---- */}
      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', fontWeight: 700 }}>On This Page</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {SECTIONS.map((s) => (
            <button key={s.id} className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => scrollTo(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* ---- At a glance ---- */}
      <div id="glance">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>At a Glance — {SCHOOL_LABEL[primarySchool]}</h3>
        <div className="ent-kpi-grid" style={{ marginBottom: '1.4rem' }}>
          <div className="ent-kpi-card ent-kpi-card--highlight">
            <div className="ent-kpi-label">Total Collected</div>
            <div className="ent-kpi-value">{money(r.executiveSummary.totalCollected)}</div>
          </div>
          <div className="ent-kpi-card">
            <div className="ent-kpi-label">Total Outstanding</div>
            <div className="ent-kpi-value">{money(r.executiveSummary.totalOutstanding)}</div>
          </div>
          <div className="ent-kpi-card">
            <div className="ent-kpi-label">Collection Rate</div>
            <div className="ent-kpi-value">{r.executiveSummary.collectionRatePct}%</div>
          </div>
          <div className="ent-kpi-card">
            <div className="ent-kpi-label">Students Paid in Full</div>
            <div className="ent-kpi-value">{r.executiveSummary.studentsPaidFull}</div>
          </div>
        </div>
      </div>

      {/* ---- Trend, scoped to the selected tab ---- */}
      <div id="trend">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Trend — {trendLabel}</h3>
        <div className="ent-card" style={{ marginBottom: '1rem' }}>
          <div style={{ height: '260px' }}>
            <ResponsiveContainer width="100%" height="100%">
              {isBarChart ? (
                <BarChart data={timeTab === 'yearly' ? trendData.map((d) => ({ ...d, chartValue: d.isFuture ? 0 : d.total })) : trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={trendXKey} fontSize={timeTab === 'yearly' ? 10 : 11} />
                  <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, n, p) => (p?.payload?.isFuture ? ['Not yet reached', ''] : [money(v), 'Collected'])} />
                  <Bar dataKey={timeTab === 'yearly' ? 'chartValue' : trendYKey} name="Collected" radius={[4, 4, 0, 0]}>
                    {timeTab === 'yearly' && trendData.map((entry, i) => (
                      <Cell key={i} fill={entry.isFuture ? '#e2e8f0' : 'var(--c-primary, #06b6d4)'} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={trendXKey} fontSize={9} tickFormatter={(d) => d.slice(8)} />
                  <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Line type="monotone" dataKey="total" name="Collected" stroke="var(--c-primary, #06b6d4)" strokeWidth={2} dot={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
        {/* Table view alongside the chart — the chart alone can't show
            "not yet reached" clearly, the table makes it explicit. */}
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>{timeTab === 'daily' ? 'Date' : timeTab === 'weekly' ? 'Week' : 'Month'}</th><th>Collected</th></tr></thead>
            <tbody>
              {trendData.map((row, i) => (
                <tr key={i}>
                  <td>{row[trendXKey]}</td>
                  <td className="ent-td-num">
                    {row.isFuture ? <span style={{ color: 'var(--c-faint)', fontStyle: 'italic' }}>Not yet reached</span> : money(row[trendYKey])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- School comparison ---- */}
      <div id="comparison">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>School Comparison — {r.meta.monthLabel}</h3>
        <div className="ent-card" style={{ marginBottom: '1.4rem' }}>
          {(!wendyReport || !keilaReport) ? (
            <p className="ent-hint">Both schools' data is needed for a comparison — one didn't load.</p>
          ) : (
            <>
              <div style={{ height: '220px', marginBottom: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { metric: 'Collected', WENDY: wendyReport.executiveSummary.totalCollected, KEILA: keilaReport.executiveSummary.totalCollected },
                    { metric: 'Outstanding', WENDY: wendyReport.executiveSummary.totalOutstanding, KEILA: keilaReport.executiveSummary.totalOutstanding }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="metric" fontSize={11} />
                    <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Legend />
                    <Bar dataKey="WENDY" name="Wendy Private School" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="KEILA" name="Keila Academy" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="ent-table-wrap">
                <table className="ent-table ent-table--zebra">
                  <thead><tr><th>School</th><th>Collected</th><th>Outstanding</th><th>Collection Rate</th><th>Students</th></tr></thead>
                  <tbody>
                    {[['WENDY', wendyReport], ['KEILA', keilaReport]].map(([key, rep]) => (
                      <tr key={key}>
                        <td style={{ fontWeight: 600 }}>{SCHOOL_LABEL[key]}</td>
                        <td className="ent-td-num">{money(rep.executiveSummary.totalCollected)}</td>
                        <td className="ent-td-num">{money(rep.executiveSummary.totalOutstanding)}</td>
                        <td className="ent-td-num">{rep.executiveSummary.collectionRatePct}%</td>
                        <td className="ent-td-num">{rep.executiveSummary.registeredStudents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- Fee category performance ---- */}
      <div id="categories">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Fee Category Performance</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Category</th><th>Students</th><th>Expected</th><th>Collected</th><th>Outstanding</th></tr></thead>
            <tbody>
              {r.feeCategoryPerformance.length === 0 ? <tr><td colSpan={5} className="ent-table-empty">No fees billed yet.</td></tr> :
                r.feeCategoryPerformance.map((c) => (
                  <tr key={c.category}>
                    <td style={{ fontWeight: 600 }}>{c.category}</td>
                    <td className="ent-td-num">{c.students}</td>
                    <td className="ent-td-num">{money(c.expected)}</td>
                    <td className="ent-td-num">{money(c.collected)}</td>
                    <td className="ent-td-num">{money(c.outstanding)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Grade performance ---- */}
      <div id="grades">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Grade Performance</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Grade</th><th>Students</th><th>Paid</th><th>Partial</th><th>Unpaid</th><th>Outstanding</th></tr></thead>
            <tbody>
              {r.gradePerformance.length === 0 ? <tr><td colSpan={6} className="ent-table-empty">No graded students yet.</td></tr> :
                r.gradePerformance.map((g) => (
                  <tr key={g.grade}>
                    <td style={{ fontWeight: 600 }}>{g.grade}</td>
                    <td className="ent-td-num">{g.students}</td>
                    <td className="ent-td-num">{g.paid}</td>
                    <td className="ent-td-num">{g.partial}</td>
                    <td className="ent-td-num">{g.unpaid}</td>
                    <td className="ent-td-num">{money(g.outstanding)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Class performance ---- */}
      <div id="classes">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Class Performance</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Class</th><th>Students</th><th>Paid</th><th>Partial</th><th>Unpaid</th><th>Outstanding</th></tr></thead>
            <tbody>
              {(!r.classPerformance || r.classPerformance.length === 0) ? <tr><td colSpan={6} className="ent-table-empty">No classes with billed students yet.</td></tr> :
                r.classPerformance.map((c) => (
                  <tr key={c.className}>
                    <td style={{ fontWeight: 600 }}>{c.className}</td>
                    <td className="ent-td-num">{c.students}</td>
                    <td className="ent-td-num">{c.paid}</td>
                    <td className="ent-td-num">{c.partial}</td>
                    <td className="ent-td-num">{c.unpaid}</td>
                    <td className="ent-td-num">{money(c.outstanding)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Transport & hostel ---- */}
      <div id="transport">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Transport &amp; Hostel</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.4rem' }}>
          <div className="ent-table-wrap">
            <table className="ent-table ent-table--zebra">
              <thead><tr><th>Bus Type</th><th>Students</th><th>Outstanding</th></tr></thead>
              <tbody>
                {(!r.transportReport || r.transportReport.length === 0) ? <tr><td colSpan={3} className="ent-table-empty">No bus users.</td></tr> :
                  r.transportReport.map((t) => (
                    <tr key={t.busType}><td>{t.busType}</td><td className="ent-td-num">{t.students}</td><td className="ent-td-num">{money(t.outstanding)}</td></tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table ent-table--zebra">
              <thead><tr><th>Hostel Type</th><th>Students</th><th>Outstanding</th></tr></thead>
              <tbody>
                {(!r.hostelReport || r.hostelReport.length === 0) ? <tr><td colSpan={3} className="ent-table-empty">No hostelites.</td></tr> :
                  r.hostelReport.map((h) => (
                    <tr key={h.hostelType}><td>{h.hostelType}</td><td className="ent-td-num">{h.students}</td><td className="ent-td-num">{money(h.outstanding)}</td></tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- Payment methods ---- */}
      <div id="methods">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Payment Methods</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Method</th><th>Transactions</th><th>Amount</th><th>Share</th></tr></thead>
            <tbody>
              {r.paymentMethods.length === 0 ? <tr><td colSpan={4} className="ent-table-empty">No payments this month.</td></tr> :
                r.paymentMethods.map((m) => (
                  <tr key={m.method}>
                    <td style={{ fontWeight: 600 }}>{m.method}</td>
                    <td className="ent-td-num">{m.transactions}</td>
                    <td className="ent-td-num">{money(m.amount)}</td>
                    <td className="ent-td-num">{m.pct}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Secretaries ---- */}
      <div id="secretaries">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Finance Secretaries</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Name</th><th>Transactions</th><th>Collected</th></tr></thead>
            <tbody>
              {r.secretaryPerformance.length === 0 ? <tr><td colSpan={3} className="ent-table-empty">No secretary accounts found.</td></tr> :
                r.secretaryPerformance.map((s) => (
                  <tr key={s.username}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="ent-td-num">{s.transactions}</td>
                    <td className="ent-td-num">{money(s.amountCollected)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Transaction history — a real, itemized ledger, not just summary figures ---- */}
      <div id="transactions">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Transaction History (Most Recent 50)</h3>
        <div className="ent-card" style={{ marginBottom: '1.4rem' }}>
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            The full, itemized payment log — every transaction here already reflects any correction applied to it. For the complete history beyond the most recent 50, use Reports &amp; Analytics directly.
          </p>
          <div className="ent-table-wrap">
            <table className="ent-table ent-table--zebra">
              <thead><tr><th>Date</th><th>Student</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
              <tbody>
                {transactions.length === 0 ? <tr><td colSpan={5} className="ent-table-empty">No transactions recorded yet.</td></tr> :
                  transactions.map((t) => (
                    <tr key={t.paymentId}>
                      <td style={{ fontSize: '0.78rem' }}>{t.paymentDate}</td>
                      <td>{t.displayPayerName || t.studentName}</td>
                      <td className="ent-td-num">{money(t.correctedAmount ?? t.amount)}</td>
                      <td>{t.paymentMethod}</td>
                      <td className="ent-td-mono" style={{ fontSize: '0.76rem' }}>{t.transactionReference}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- Corrections — its own section, for transparency; every
           other figure above already has corrections folded in automatically ---- */}
      <div id="corrections">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Payment Corrections</h3>
        <div className="ent-card" style={{ marginBottom: '1.4rem' }}>
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            Every figure elsewhere in this report already has these corrections applied automatically. This section exists purely for transparency, showing exactly what changed and why.
          </p>
          <div className="ent-table-wrap">
            <table className="ent-table ent-table--zebra">
              <thead><tr><th>Student</th><th>Adjustment</th><th>Reason</th><th>Corrected By</th></tr></thead>
              <tbody>
                {!primaryExtras.corrections || primaryExtras.corrections.records.length === 0 ? (
                  <tr><td colSpan={4} className="ent-table-empty">No payment corrections this period.</td></tr>
                ) : primaryExtras.corrections.records.map((c) => (
                  <tr key={c.correctionId}>
                    <td style={{ fontWeight: 600 }}>{c.studentName}</td>
                    <td className="ent-td-num" style={{ color: c.correctionAmount > 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                      {c.correctionAmount > 0 ? '+' : ''}{money(c.correctionAmount)}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--c-muted)' }}>{c.reason}</td>
                    <td style={{ fontSize: '0.82rem' }}>{c.correctedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- Audit trail — who did what, chronologically ---- */}
      <div id="audit">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Audit Trail (Most Recent 30)</h3>
        <div className="ent-card" style={{ marginBottom: '1.4rem' }}>
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            Every payment, correction, waiver, discount, and write-off, with who did it and when. For the full history and filtering by secretary or date, use Audit Logs directly.
          </p>
          <div className="ent-table-wrap">
            <table className="ent-table ent-table--zebra">
              <thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {auditEntries.length === 0 ? <tr><td colSpan={4} className="ent-table-empty">No audit entries found.</td></tr> :
                  auditEntries.map((e, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: '0.78rem' }}>{new Date(e.timestamp).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600 }}>{e.actor}</td>
                      <td>{e.action}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--c-muted)' }}>{e.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- Highest debtors ---- */}
      <div id="debtors">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Highest Debtors</h3>
        <div className="ent-table-wrap" style={{ marginBottom: '1.4rem' }}>
          <table className="ent-table ent-table--zebra">
            <thead><tr><th>Student</th><th>Owed</th><th>Days Overdue</th></tr></thead>
            <tbody>
              {r.highestDebtors.length === 0 ? <tr><td colSpan={3} className="ent-table-empty">No significant debtors.</td></tr> :
                r.highestDebtors.slice(0, 15).map((d) => (
                  <tr key={d.studentId}>
                    <td>{d.name} <span className="ent-hint">({d.studentNumber})</span></td>
                    <td className="ent-td-num">{money(d.owed)}</td>
                    <td className="ent-td-num">{d.daysOverdue}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Alerts ---- */}
      <div id="alerts">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.7rem', borderLeft: '4px solid var(--c-primary)', paddingLeft: '0.6rem' }}>Alerts</h3>
        <div className="ent-card" style={{ marginBottom: '1.4rem' }}>
          {r.alerts.length === 0 ? <p className="ent-hint">No alerts this month — everything looks normal.</p> :
            r.alerts.map((a, i) => (
              <div key={i} style={{ border: '1px solid #fee2e2', background: 'rgba(220,38,38,0.04)', borderRadius: 'var(--r-md)', padding: '0.7rem 0.9rem', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>{a.type}</strong>
                <p style={{ fontSize: '0.82rem', margin: '0.2rem 0 0', color: 'var(--c-muted)' }}>{a.message}</p>
              </div>
            ))}
        </div>
      </div>

      {/* ---- Footer with real navigation ---- */}
      <div className="ent-card" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', padding: '1rem' }}>
        <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => onNavigate?.('secretaries')}><Users size={14} /> Finance Secretaries</button>
        <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => onNavigate?.('audit')}><ClipboardList size={14} /> Audit Logs</button>
        <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => onNavigate?.('reports')}><BookOpen size={14} /> Reports &amp; Analytics</button>
      </div>
    </div>
  );
}
