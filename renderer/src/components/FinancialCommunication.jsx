import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Star, Mail, FileDown, Search, BarChart2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { drawLetterheadHeader, drawLetterheadFooter, drawSectionHeading, money } from './Reports.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };

export default function FinancialCommunication({ user }) {
  const school = user.section === 'Both' ? 'WENDY' : user.section;
  const schoolLabel = SCHOOL_LABEL[school] || school;

  const [tab, setTab] = useState(1);
  const [topLists, setTopLists] = useState(null);
  const [loadingLists, setLoadingLists] = useState(true);
  const [categoryLeaderboards, setCategoryLeaderboards] = useState(null);
  const [expandedCategory, setExpandedCategory] = useState(null);

  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [letterData, setLetterData] = useState(null);
  const [loadingLetter, setLoadingLetter] = useState(false);

  useEffect(() => {
    setLoadingLists(true);
    window.electronAPI.getTopLists(school).then((result) => {
      if (result.success) setTopLists(result.data);
      setLoadingLists(false);
    });
    window.electronAPI.getFeeCategoryLeaderboards(school).then((result) => {
      if (result.success) setCategoryLeaderboards(result.data);
    });
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

  async function selectStudent(s) {
    setQuery(`${s.firstName} ${s.lastName}`);
    setShowResults(false);
    setLoadingLetter(true);
    const result = await window.electronAPI.getStudentStatementDataForLetter(s.studentId);
    setLoadingLetter(false);
    if (result.success) setLetterData(result.data);
  }

  async function generatePDF() {
    if (!letterData) return;
    const { student, guardian, ledger, transactions } = letterData;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 20;

    let y = await drawLetterheadHeader(doc, school, 'STATEMENT OF ACCOUNT', new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));

    function ensureSpace(need) {
      if (y > pageHeight - need) { doc.addPage(); y = 20; }
    }

    // ---- Recipient block ----
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    doc.text(`${guardian.firstName} ${guardian.lastName}`, marginX, y); y += 5;
    if (guardian.addressLine1) { doc.text(guardian.addressLine1, marginX, y); y += 5; }
    if (guardian.city) { doc.text(`${guardian.city}${guardian.country ? ', ' + guardian.country : ''}`, marginX, y); y += 5; }
    y += 7;

    // ---- Reference line ----
    doc.setFont(undefined, 'bold');
    doc.text(`Re: ${student.firstName} ${student.lastName} (${student.studentNumber})`, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 9;

    doc.text(`Dear ${guardian.relationship || 'Guardian'} ${guardian.lastName},`, marginX, y);
    y += 9;

    // ---- Opening — tone adapts to how overdue the account actually is,
    // rather than one generic paragraph for every situation. ----
    let opening;
    if (ledger.status === 'Chronic Debtors') {
      opening = `We are writing regarding the account for ${student.firstName}, which now carries a significant outstanding balance. We understand that financial circumstances can be difficult, and we would welcome the opportunity to discuss a payment arrangement if that would help. A full statement of the account is set out below for your reference.`;
    } else if (ledger.status === 'Debtors') {
      opening = `This letter is a routine reminder regarding the account for ${student.firstName}, which currently shows an outstanding balance. A full statement of the account is set out below so you can see exactly how this figure was reached.`;
    } else {
      opening = `Please find below a full statement of account for ${student.firstName}, covering 3 months of every fee charged and every payment received to date.`;
    }
    const openingLines = doc.splitTextToSize(opening, pageWidth - marginX * 2);
    doc.text(openingLines, marginX, y);
    y += openingLines.length * 5.2 + 8;

    // ---- The ledger itself — the actual body of the letter, not just a
    // final total. Every charge and every payment, in order, with a
    // running balance, so nothing about the figure at the bottom is
    // opaque to the parent reading it. ----
    y = drawSectionHeading(doc, y, 'Transaction History');

    // Fixed column layout — text columns left-aligned from their start
    // x, numeric columns right-aligned to their end x, so amounts of any
    // length line up on their decimal point the way a real statement
    // should, not just however wide the text happens to be.
    const col = {
      date: marginX, desc: marginX + 22, descWidth: 58,
      chargedEnd: marginX + 108, paidEnd: marginX + 135, balanceEnd: marginX + 165
    };
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
    transactions.forEach((t) => {
      const descLines = doc.splitTextToSize(t.description, col.descWidth);
      const thisRowHeight = Math.max(rowHeight, descLines.length * 4.3 + 2);

      // A new page needs the header redrawn, not just left off — a
      // continuation page with no column labels reads as broken, not
      // professional, on a document meant for a parent to actually read.
      if (y > pageHeight - 26) {
        doc.addPage(); y = 22;
        drawTableHeader();
        rowIndex = 0;
      }

      if (rowIndex % 2 === 1) {
        doc.setFillColor(246, 248, 250);
        doc.rect(marginX, y - 4.2, tableRight - marginX, thisRowHeight, 'F');
      }

      doc.setFont(undefined, 'normal'); doc.setFontSize(8.8);
      doc.text(t.date || '', col.date + 1, y);
      doc.text(descLines, col.desc, y);
      doc.text(t.debit ? money(t.debit) : '\u2014', col.chargedEnd, y, { align: 'right' });
      doc.text(t.credit ? money(t.credit) : '\u2014', col.paidEnd, y, { align: 'right' });
      doc.setFont(undefined, 'bold');
      doc.text(money(t.balance), col.balanceEnd, y, { align: 'right' });
      doc.setFont(undefined, 'normal');
      y += thisRowHeight;
      rowIndex += 1;
    });

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.4);
    doc.line(marginX, y - 2, tableRight, y - 2);
    doc.setLineWidth(0.2);

    ensureSpace(24);
    y += 8;

    // ---- Balance summary ----
    doc.setFont(undefined, 'bold'); doc.setFontSize(12);
    doc.text('Current Balance:', marginX, y);
    doc.setTextColor(ledger.balance > 0 ? 200 : 20, ledger.balance > 0 ? 40 : 130, ledger.balance > 0 ? 40 : 60);
    doc.text(money(ledger.balance), marginX + 55, y);
    doc.setTextColor(0, 0, 0);
    y += 14;

    // ---- Closing ----
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    const closingText = ledger.balance > 0
      ? 'We would appreciate settlement of this balance at your earliest convenience. If you have any questions about any item on this statement, or would like to discuss a payment plan, please don\u2019t hesitate to contact the finance office \u2014 we\u2019re glad to help.'
      : 'Thank you for your cooparation. If you have any queries on this statement, please don\u2019t hesitate to contact the finance office.';
    ensureSpace(30);
    const closingLines = doc.splitTextToSize(closingText, pageWidth - marginX * 2);
    doc.text(closingLines, marginX, y);
    y += closingLines.length * 5.2 + 12;

    ensureSpace(25);
    doc.text('Kind regards,', marginX, y); y += 12;
    doc.setFont(undefined, 'bold');
    doc.text('Finance Office', marginX, y); y += 5;
    doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    doc.text(`Processed by: ${user.username}`, marginX, y);

    drawLetterheadFooter(doc, school);

    doc.save(`${student.studentNumber}-statement-of-account.pdf`);
  }

  return (
    <div>
      <div className="ent-tabs" style={{ marginBottom: '1.3rem' }}>
        <button className={`ent-tab ${tab === 1 ? 'is-active' : ''}`} onClick={() => setTab(1)}><BarChart2 size={14} style={{ marginRight: '5px', verticalAlign: '-2px' }} />Top Lists (Debtors &amp; Best Payers)</button>
        <button className={`ent-tab ${tab === 3 ? 'is-active' : ''}`} onClick={() => setTab(3)}><Star size={14} style={{ marginRight: '5px', verticalAlign: '-2px' }} />Best &amp; Worst Payers, By Fee</button>
        <button className={`ent-tab ${tab === 2 ? 'is-active' : ''}`} onClick={() => setTab(2)}><Mail size={14} style={{ marginRight: '5px', verticalAlign: '-2px' }} />Generate Fee Letter</button>
      </div>

      {tab === 1 ? (
        <>
          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <h3 className="ent-card-title"><AlertTriangle size={16} color="var(--c-danger)" /> Top 10 Debtors (Highest Outstanding)</h3>
            {loadingLists ? <p style={{ color: 'var(--c-faint)', fontSize: '0.82rem' }}>Loading...</p> : (
              <div className="ent-table-wrap">
                <table className="ent-table">
                  <thead><tr><th>Student #</th><th>Name</th><th>Status</th><th>Outstanding</th></tr></thead>
                  <tbody>
                    {!topLists || topLists.topDebtors.length === 0 ? (
                      <tr><td colSpan={4} className="ent-table-empty">No debtors found.</td></tr>
                    ) : topLists.topDebtors.map((d) => (
                      <tr key={d.studentId}>
                        <td className="ent-td-mono">{d.studentNumber}</td>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        <td><span className={`ent-badge ${d.status === 'Chronic Debtors' ? 'ent-badge--danger' : 'ent-badge--warning'}`}>{d.status}</span></td>
                        <td className="ent-td-num" style={{ color: 'var(--c-danger)' }}>{money(d.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="ent-card">
            <h3 className="ent-card-title"><Star size={16} color="var(--c-gold)" /> Top 10 Best Payers (Highest Total Paid)</h3>
            {loadingLists ? <p style={{ color: 'var(--c-faint)', fontSize: '0.82rem' }}>Loading...</p> : (
              <div className="ent-table-wrap">
                <table className="ent-table">
                  <thead><tr><th>Student #</th><th>Name</th><th>Total Paid</th></tr></thead>
                  <tbody>
                    {!topLists || topLists.topPayers.length === 0 ? (
                      <tr><td colSpan={3} className="ent-table-empty">No payments recorded yet.</td></tr>
                    ) : topLists.topPayers.map((p) => (
                      <tr key={p.studentId}>
                        <td className="ent-td-mono">{p.studentNumber}</td>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td className="ent-td-num" style={{ color: 'var(--c-success)' }}>{money(p.totalPaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : tab === 3 ? (
        <div>
          <div className="ent-card" style={{ marginBottom: '1rem' }}>
            <h3 className="ent-card-title"><BarChart2 size={16} /> Best &amp; Worst Payers, By Fee</h3>
            <p className="ent-hint">
              A student can look fine overall while still lagging on one specific fee — this breaks it down per category: who's paid the most toward each individual fee, and who owes the most on it specifically.
            </p>
          </div>
          {!categoryLeaderboards ? (
            <div className="ent-card"><p className="ent-hint">Loading...</p></div>
          ) : categoryLeaderboards.length === 0 ? (
            <div className="ent-card"><p className="ent-hint">No fees billed yet.</p></div>
          ) : categoryLeaderboards.map((board) => (
            <div className="ent-card" key={board.category} style={{ marginBottom: '1rem' }}>
              <button
                type="button" onClick={() => setExpandedCategory(expandedCategory === board.category ? null : board.category)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <h3 className="ent-card-title" style={{ margin: 0 }}>{board.category} <span className="ent-hint">({board.studentsInvolved} student{board.studentsInvolved !== 1 ? 's' : ''})</span></h3>
                <span className="ent-hint">{expandedCategory === board.category ? 'Hide' : 'Show'}</span>
              </button>
              {expandedCategory === board.category && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>Paid the Most</p>
                    <div className="ent-table-wrap">
                      <table className="ent-table">
                        <thead><tr><th>Student #</th><th>Name</th><th>Paid</th></tr></thead>
                        <tbody>
                          {board.topPayers.length === 0 ? (
                            <tr><td colSpan={3} className="ent-table-empty">No payments yet.</td></tr>
                          ) : board.topPayers.map((r) => (
                            <tr key={r.studentId}>
                              <td className="ent-td-mono">{r.studentNumber}</td>
                              <td style={{ fontWeight: 600 }}>{r.name}</td>
                              <td className="ent-td-num" style={{ color: 'var(--c-success)' }}>{money(r.paid)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>Owes the Most</p>
                    <div className="ent-table-wrap">
                      <table className="ent-table">
                        <thead><tr><th>Student #</th><th>Name</th><th>Owing</th></tr></thead>
                        <tbody>
                          {board.mostOwing.length === 0 ? (
                            <tr><td colSpan={3} className="ent-table-empty">No one owes on this fee.</td></tr>
                          ) : board.mostOwing.map((r) => (
                            <tr key={r.studentId}>
                              <td className="ent-td-mono">{r.studentNumber}</td>
                              <td style={{ fontWeight: 600 }}>{r.name}</td>
                              <td className="ent-td-num" style={{ color: 'var(--c-danger)' }}>{money(r.outstanding)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="ent-card">
          <h3 className="ent-card-title"><Mail size={16} /> Generate Fee Arrears Letter</h3>

          <div className="ent-autocomplete" style={{ marginBottom: '1rem' }}>
            <div className="ent-autocomplete-input-wrap">
              <Search size={15} />
              <input
                className="ent-input"
                placeholder="Search student by name or student number..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
              />
            </div>
            {showResults && query && (
              <div className="ent-autocomplete-list">
                {filteredStudents.length === 0 ? (
                  <div className="ent-autocomplete-empty">No matching students.</div>
                ) : (
                  filteredStudents.map((s) => (
                    <div key={s.studentId} className="ent-autocomplete-item" onClick={() => selectStudent(s)}>
                      <span>{s.firstName} {s.lastName}</span>
                      <small>{s.studentNumber}</small>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {loadingLetter && <p style={{ color: 'var(--c-faint)', fontSize: '0.82rem' }}>Loading fee details...</p>}

          {letterData && !loadingLetter && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--c-ink)' }}>{letterData.student.firstName} {letterData.student.lastName}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--c-faint)' }}>{letterData.student.studentNumber} &bull; {schoolLabel}</div>
                </div>
                <span
                  className="ent-badge"
                  style={{
                    background: letterData.ledger.status === 'Chronic Debtors' ? 'var(--c-danger)'
                      : letterData.ledger.status === 'Debtors' ? 'var(--c-warning)'
                      : letterData.ledger.status === 'Overpaid' ? 'var(--c-success)' : 'var(--c-faint)'
                  }}
                >
                  {letterData.ledger.status}
                </span>
              </div>

              {letterData.guardian ? (
                <div style={{ background: 'var(--c-surface-flat)', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', padding: '0.9rem 1.1rem', marginBottom: '1.1rem', fontSize: '0.82rem' }}>
                  <strong>{letterData.guardian.firstName} {letterData.guardian.lastName}</strong> ({letterData.guardian.relationship || 'Guardian'})<br />
                  {letterData.guardian.phonePrimary} {letterData.guardian.email ? `· ${letterData.guardian.email}` : ''}<br />
                  {letterData.guardian.addressLine1 ? `${letterData.guardian.addressLine1}, ` : ''}{letterData.guardian.city}
                </div>
              ) : (
                <div className="ent-error-box">No guardian on file for this student — add one via Student Registration before generating a letter.</div>
              )}

              <p className="ent-hint" style={{ marginBottom: '0.5rem' }}>The letter includes the last 3 months of transaction detail below, not just what's outstanding — with anything older carried forward as a single opening balance so the running total still adds up correctly.</p>
              <div className="ent-table-wrap">
                <table className="ent-table">
                  <thead><tr><th>Date</th><th>Description</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead>
                  <tbody>
                    {letterData.transactions.length === 0 ? (
                      <tr><td colSpan={5} className="ent-table-empty">No transactions on record yet.</td></tr>
                    ) : letterData.transactions.map((t, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.78rem' }}>{t.date}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{t.description}</td>
                        <td className="ent-td-num">{t.debit ? money(t.debit) : ''}</td>
                        <td className="ent-td-num">{t.credit ? money(t.credit) : ''}</td>
                        <td className="ent-td-num">{money(t.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--c-muted)', marginRight: '0.6rem' }}>Current Balance:</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 800, color: letterData.ledger.balance > 0 ? 'var(--c-danger)' : 'var(--c-success)' }}>{money(letterData.ledger.balance)}</span>
              </div>

              <button
                className="ent-btn ent-btn--primary"
                style={{ marginTop: '1rem' }}
                disabled={letterData.ledger.balance <= 0 || !letterData.guardian}
                onClick={generatePDF}
              >
                <FileDown size={15} /> Generate &amp; Download Letter (PDF)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
