import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, Bus, Home as HomeIcon, Users as UsersIcon, Search } from 'lucide-react';
import { playNotificationChime } from '../utils/sound.js';
import Toggle from './ui/Toggle.jsx';
import Pagination from './ui/Pagination.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };
const BUS_TYPES = ['Kinder', 'Pre-Grade', 'Grade 1-12'];
const HOSTEL_TYPES = ['Boarding', 'Day Care', 'Full-Time'];
const PAGE_SIZE = 8;

function initials(firstName, lastName) {
  return ((firstName || '')[0] || '') + ((lastName || '')[0] || '') || '?';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function StudentRegistration({ user }) {
  const school = user.section === 'Both' ? 'WENDY' : user.section;
  const schoolLabel = SCHOOL_LABEL[school] || school;

  const [students, setStudents] = useState([]);
  const [guardians, setGuardians] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [guardianMode, setGuardianMode] = useState('existing');
  const [guardianSearch, setGuardianSearch] = useState('');
  const [selectedGuardianId, setSelectedGuardianId] = useState('');
  const [form, setForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '', gender: '',
    enrollmentDate: new Date().toISOString().slice(0, 10),
    usesBus: false, busType: '', isHostelite: false, hostelType: '',
    guardianFirstName: '', guardianLastName: '', guardianRelationship: '', guardianPhone: '', guardianEmail: ''
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadingList(true);
    const [studentsResult, guardiansResult] = await Promise.all([
      window.electronAPI.listStudents(school),
      window.electronAPI.listGuardians()
    ]);
    if (studentsResult.success) setStudents(studentsResult.students);
    if (guardiansResult.success) setGuardians(guardiansResult.guardians);
    setLoadingList(false);
  }, [school]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setPage(1); }, [search]);

  const stats = useMemo(() => ({
    total: students.length,
    active: students.filter((s) => s.enrollmentStatus === 'Active').length,
    bus: students.filter((s) => s.usesBus).length,
    hostel: students.filter((s) => s.isHostelite).length
  }), [students]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      s.studentNumber.toLowerCase().includes(q) ||
      (s.guardianName || '').toLowerCase().includes(q)
    );
  }, [students, search]);

  const pagedStudents = useMemo(
    () => filteredStudents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredStudents, page]
  );

  const filteredGuardians = useMemo(() => {
    const q = guardianSearch.trim().toLowerCase();
    if (!q) return guardians;
    return guardians.filter((g) =>
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) || (g.phonePrimary || '').includes(q)
    );
  }, [guardians, guardianSearch]);

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!form.firstName || !form.lastName || !form.dateOfBirth || !form.gender) {
      setFormError('First name, last name, date of birth, and gender are required.');
      return;
    }
    if (guardianMode === 'existing' && !selectedGuardianId) {
      setFormError('Select a guardian, or switch to "Add New Guardian".');
      return;
    }
    if (guardianMode === 'new' && (!form.guardianFirstName || !form.guardianLastName || !form.guardianPhone)) {
      setFormError('Guardian first name, last name, and phone are required.');
      return;
    }

    setSaving(true);
    try {
      let guardianId = selectedGuardianId;

      if (guardianMode === 'new') {
        const guardianResult = await window.electronAPI.createGuardian({
          firstName: form.guardianFirstName,
          lastName: form.guardianLastName,
          relationship: form.guardianRelationship || 'Guardian',
          phonePrimary: form.guardianPhone,
          email: form.guardianEmail || ''
        });
        if (!guardianResult.success) { setFormError(guardianResult.message); setSaving(false); return; }
        guardianId = guardianResult.guardian.guardianId;
      }

      const studentResult = await window.electronAPI.createStudent({
        firstName: form.firstName,
        lastName: form.lastName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        school,
        guardianId,
        enrollmentDate: form.enrollmentDate,
        usesBus: form.usesBus,
        busType: form.usesBus ? form.busType : '',
        isHostelite: form.isHostelite,
        hostelType: form.isHostelite ? form.hostelType : '',
        registeredBy: user.username
      });

      if (!studentResult.success) { setFormError(studentResult.message); setSaving(false); return; }

      playNotificationChime();
      setFormSuccess(`Registered ${form.firstName} ${form.lastName} — student number ${studentResult.student.studentNumber}.`);
      setForm({
        firstName: '', lastName: '', dateOfBirth: '', gender: '',
        enrollmentDate: new Date().toISOString().slice(0, 10),
        usesBus: false, busType: '', isHostelite: false, hostelType: '',
        guardianFirstName: '', guardianLastName: '', guardianRelationship: '', guardianPhone: '', guardianEmail: ''
      });
      setSelectedGuardianId('');
      setGuardianSearch('');
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="ent-kpi-grid" style={{ marginBottom: '1.4rem' }}>
        <div className="ent-kpi-card ent-kpi-card--highlight"><div className="ent-kpi-icon">🎓</div><div className="ent-kpi-label">Total Students</div><div className="ent-kpi-value">{stats.total}</div></div>
        <div className="ent-kpi-card"><div className="ent-kpi-icon">✅</div><div className="ent-kpi-label">Active</div><div className="ent-kpi-value">{stats.active}</div></div>
        <div className="ent-kpi-card"><div className="ent-kpi-icon">🚌</div><div className="ent-kpi-label">Bus Riders</div><div className="ent-kpi-value">{stats.bus}</div></div>
        <div className="ent-kpi-card"><div className="ent-kpi-icon">🏠</div><div className="ent-kpi-label">Hostelites</div><div className="ent-kpi-value">{stats.hostel}</div></div>
      </div>

      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <h3 className="ent-card-title"><UserPlus size={16} /> Register New Student</h3>
        <span className="ent-badge ent-badge--soft" style={{ marginBottom: '1.1rem', display: 'inline-block' }}>Registering for: {schoolLabel}</span>

        {formError && <div className="ent-error-box">{formError}</div>}
        {formSuccess && <div className="ent-success-box">{formSuccess}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field">
              <label>First Name</label>
              <input value={form.firstName} onChange={(e) => updateField('firstName', e.target.value)} />
            </div>
            <div className="ent-field">
              <label>Last Name</label>
              <input value={form.lastName} onChange={(e) => updateField('lastName', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field">
              <label>Date of Birth</label>
              <input type="date" value={form.dateOfBirth} onChange={(e) => updateField('dateOfBirth', e.target.value)} />
            </div>
            <div className="ent-field">
              <label>Gender</label>
              <select value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="ent-field">
              <label>Enrollment Date</label>
              <input type="date" value={form.enrollmentDate} onChange={(e) => updateField('enrollmentDate', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div>
              <Toggle checked={form.usesBus} onChange={(val) => updateField('usesBus', val)} label="Uses school bus" id="uses-bus-toggle" />
              {form.usesBus && (
                <div className="ent-field" style={{ marginTop: '0.6rem' }}>
                  <select value={form.busType} onChange={(e) => updateField('busType', e.target.value)}>
                    <option value="">Select bus tier</option>
                    {BUS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <Toggle checked={form.isHostelite} onChange={(val) => updateField('isHostelite', val)} label="Hostel resident" id="is-hostelite-toggle" />
              {form.isHostelite && (
                <div className="ent-field" style={{ marginTop: '0.6rem' }}>
                  <select value={form.hostelType} onChange={(e) => updateField('hostelType', e.target.value)}>
                    <option value="">Select hostel type</option>
                    {HOSTEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="ent-field" style={{ marginTop: '0.4rem' }}>
            <label>Guardian</label>
            <div className="ent-tabs" style={{ marginBottom: '1rem' }}>
              <button type="button" className={`ent-tab ${guardianMode === 'existing' ? 'is-active' : ''}`} style={{ flex: 1 }} onClick={() => setGuardianMode('existing')}>Select Existing</button>
              <button type="button" className={`ent-tab ${guardianMode === 'new' ? 'is-active' : ''}`} style={{ flex: 1 }} onClick={() => setGuardianMode('new')}>Add New Guardian</button>
            </div>

            {guardianMode === 'existing' ? (
              <div className="ent-autocomplete">
                <div className="ent-autocomplete-input-wrap">
                  <Search size={14} />
                  <input
                    className="ent-input"
                    placeholder="Search guardians by name or phone..."
                    value={guardianSearch}
                    onChange={(e) => setGuardianSearch(e.target.value)}
                  />
                </div>
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', maxHeight: '160px', overflowY: 'auto', marginTop: '0.5rem' }}>
                  {filteredGuardians.length === 0 ? (
                    <div className="ent-autocomplete-empty">No guardians found — try "Add New Guardian".</div>
                  ) : (
                    filteredGuardians.map((g) => (
                      <div
                        key={g.guardianId}
                        className={`ent-autocomplete-item ${selectedGuardianId === g.guardianId ? 'is-highlighted' : ''}`}
                        onClick={() => setSelectedGuardianId(g.guardianId)}
                      >
                        <span>{g.firstName} {g.lastName}</span>
                        <small>{g.phonePrimary} {g.relationship ? `· ${g.relationship}` : ''}</small>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div className="ent-field">
                  <label>Guardian First Name</label>
                  <input value={form.guardianFirstName} onChange={(e) => updateField('guardianFirstName', e.target.value)} />
                </div>
                <div className="ent-field">
                  <label>Guardian Last Name</label>
                  <input value={form.guardianLastName} onChange={(e) => updateField('guardianLastName', e.target.value)} />
                </div>
                <div className="ent-field">
                  <label>Relationship</label>
                  <select value={form.guardianRelationship} onChange={(e) => updateField('guardianRelationship', e.target.value)}>
                    <option value="">Select</option>
                    <option>Mother</option>
                    <option>Father</option>
                    <option>Guardian</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="ent-field">
                  <label>Phone</label>
                  <input value={form.guardianPhone} onChange={(e) => updateField('guardianPhone', e.target.value)} />
                </div>
                <div className="ent-field">
                  <label>Email (optional)</label>
                  <input type="email" value={form.guardianEmail} onChange={(e) => updateField('guardianEmail', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <button className="ent-btn ent-btn--primary" type="submit" disabled={saving} style={{ marginTop: '0.6rem' }}>
            {saving ? 'Registering...' : 'Register Student'}
          </button>
        </form>
      </div>

      <div className="ent-card">
        <div className="ent-card-head">
          <h3 className="ent-card-title" style={{ margin: 0 }}><UsersIcon size={16} /> Registered Students</h3>
          <div className="ent-autocomplete-input-wrap" style={{ width: '240px' }}>
            <Search size={14} />
            <input className="ent-input" placeholder="Search students..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {loadingList ? (
          <p style={{ color: 'var(--c-faint)', fontSize: '0.82rem' }}>Loading...</p>
        ) : (
          <>
            <div className="ent-table-wrap" style={{ maxHeight: '480px' }}>
              <table className="ent-table ent-table--zebra">
                <thead>
                  <tr><th>Student</th><th>Guardian</th><th>Enrolled</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {pagedStudents.length === 0 && (
                    <tr><td colSpan={4} className="ent-table-empty">No students registered yet.</td></tr>
                  )}
                  {pagedStudents.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                          <div className="ent-avatar ent-avatar--sm">{initials(s.firstName, s.lastName)}</div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{s.firstName} {s.lastName}</div>
                            <div className="ent-td-mono">{s.studentNumber}</div>
                            <div>
                              {s.usesBus && <span className="ent-badge ent-badge--soft" style={{ marginRight: '4px' }}><Bus size={10} /> Bus</span>}
                              {s.isHostelite && <span className="ent-badge ent-badge--soft"><HomeIcon size={10} /> Hostel</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        <div>{s.guardianName || '—'}</div>
                        <div style={{ color: 'var(--c-faint)', fontSize: '0.72rem' }}>{s.guardianPhone}</div>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--c-ink-soft)' }}>{formatDate(s.enrollmentDate)}</td>
                      <td>
                        <span className={`ent-badge ${s.enrollmentStatus === 'Active' ? 'ent-badge--success' : 'ent-badge--muted'}`}>
                          {s.enrollmentStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filteredStudents.length} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
