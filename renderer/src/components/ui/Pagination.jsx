import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Simple page-number pagination. Purely presentational — the parent owns
 * the actual data slicing (`data.slice((page-1)*pageSize, page*pageSize)`).
 *
 * Usage:
 *   <Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} />
 */
export default function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // Compact page-number list: always show first/last, current +/-1, ellipsis for gaps.
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <div className="ent-pagination">
      <span className="ent-pagination-info">
        Showing {start}–{end} of {total}
      </span>
      <div className="ent-pagination-controls">
        <button className="ent-page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--c-faint)', fontSize: '0.78rem' }}>…</span>
          ) : (
            <button
              key={p}
              className={`ent-page-btn ${p === page ? 'is-active' : ''}`}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button className="ent-page-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}