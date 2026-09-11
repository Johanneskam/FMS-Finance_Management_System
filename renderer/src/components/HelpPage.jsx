import React, { useState, useMemo } from 'react';
import { HelpCircle, Search, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { HELP_SCENARIOS, HELP_CATEGORIES } from '../utils/helpContent.js';
import { generateHelpGuidePdf, generateSimpleUserGuidePdf, generateSchoolPitchPdf } from './Reports.jsx';

export default function HelpPage({ user }) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingSimplePdf, setGeneratingSimplePdf] = useState(false);
  const [generatingPitchPdf, setGeneratingPitchPdf] = useState(false);

  const role = user.role === 'Secretary' ? 'Secretary' : 'Admin';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return HELP_SCENARIOS.filter((s) => {
      if (!s.roles.includes(role)) return false;
      if (activeCategory !== 'all' && s.category !== activeCategory) return false;
      if (q && !s.question.toLowerCase().includes(q) && !s.steps.some((step) => step.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [query, activeCategory, role]);

  async function handleDownloadPdf() {
    setGeneratingPdf(true);
    try {
      const doc = await generateHelpGuidePdf(user.section, role);
      doc.save(`FMS-Help-Guide-${role}.pdf`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleDownloadSimpleGuide() {
    setGeneratingSimplePdf(true);
    try {
      const doc = await generateSimpleUserGuidePdf(user.section, role);
      doc.save(`FMS-Getting-Started-${role}.pdf`);
    } finally {
      setGeneratingSimplePdf(false);
    }
  }

  async function handleDownloadPitchPdf() {
    setGeneratingPitchPdf(true);
    try {
      const doc = await generateSchoolPitchPdf(user.section);
      doc.save('FMS-Introduction-for-School-Leadership.pdf');
    } finally {
      setGeneratingPitchPdf(false);
    }
  }

  return (
    <div className="ent-card">
      <div className="ent-card-head">
        <h3 className="ent-card-title"><HelpCircle size={16} /> Help — {role === 'Secretary' ? 'Secretary' : 'Admin'} Guide</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={handleDownloadSimpleGuide} disabled={generatingSimplePdf}>
            <Download size={14} /> {generatingSimplePdf ? 'Generating...' : 'Simple Getting-Started Guide'}
          </button>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={handleDownloadPitchPdf} disabled={generatingPitchPdf}>
            <Download size={14} /> {generatingPitchPdf ? 'Generating...' : 'Introduce the System (for Leadership)'}
          </button>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={handleDownloadPdf} disabled={generatingPdf}>
            <Download size={14} /> {generatingPdf ? 'Generating...' : 'Detailed Step-by-Step PDF'}
          </button>
        </div>
      </div>
      <p className="ent-hint" style={{ marginBottom: '1rem' }}>
        Find what you're looking for below, or search for a task — each answer tells you exactly where to click, step by step.
      </p>

      <div className="ent-autocomplete-input-wrap" style={{ marginBottom: '0.8rem' }}>
        <Search size={14} />
        <input className="ent-input" placeholder="Search for a task, e.g. 'register a student'..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="ent-tabs" style={{ marginBottom: '1.2rem' }}>
        <button className={`ent-tab ${activeCategory === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCategory('all')}>All</button>
        {HELP_CATEGORIES.map((c) => (
          <button key={c} className={`ent-tab ${activeCategory === c ? 'is-active' : ''}`} onClick={() => setActiveCategory(c)}>{c}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="ent-hint">No matching topics — try a different search term.</p>
      ) : (
        <div>
          {filtered.map((s, i) => {
            const isOpen = expandedIndex === i;
            return (
              <div key={i} style={{ border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', marginBottom: '0.6rem', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isOpen ? null : i)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.8rem 1rem', background: isOpen ? 'var(--c-surface-flat)' : '#fff',
                    border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.88rem', fontWeight: 600, color: 'var(--c-ink)'
                  }}
                >
                  <span>{s.question}</span>
                  {isOpen ? <ChevronDown size={16} color="var(--c-muted)" /> : <ChevronRight size={16} color="var(--c-muted)" />}
                </button>
                {isOpen && (
                  <div style={{ padding: '0.2rem 1.2rem 1rem' }}>
                    <ol style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem' }}>
                      {s.steps.map((step, j) => (
                        <li key={j} style={{ fontSize: '0.83rem', color: 'var(--c-ink-soft)', lineHeight: 1.5 }}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}