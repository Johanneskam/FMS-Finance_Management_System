import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  UserPlus, Search, BookOpen, ClipboardList, Layers, Settings,
  Users, FileText, DollarSign, Calendar, Award, PieChart,
  FileSpreadsheet, CheckSquare, UserCheck, Archive, Trash2,
  Edit, UserX, UserMinus, UserCog, Plus, Minus, Copy, Move,
  Printer, BarChart2, Receipt, CreditCard, AlertTriangle,
  CheckCircle, XCircle, Save, RefreshCw, ChevronLeft, ChevronRight,
  X, Eye, Download, Filter, ArrowUpDown, Check, AlertOctagon,
  Home, Bus, Hotel, GraduationCap, BookMarked, Clipboard,
  ListChecks, Tag, UsersRound, School, Notebook, Building,
  UserRound, Phone, Mail, MapPin, CalendarDays, BadgeCheck,
  GraduationCap as GradCap, Star, Trophy, Music, Monitor,
  Palette, Dumbbell, Gamepad, Globe, Heart, Coffee, Brush,
  Code, Megaphone, Users2, UserCog2, ShieldCheck, Crown,
  Sparkles, ArrowRight, ArrowLeft, Upload, Download as DownloadIcon,
  Loader, Trash, Edit2, MoreVertical, EyeOff, Clock, Presentation,
  DollarSign as DollarIcon, TrendingUp, TrendingDown, Percent, FileDown
} from 'lucide-react';
import Toggle from './ui/Toggle.jsx';
import Portal from './ui/Portal.jsx';
import AutocompleteDropdown from './ui/AutocompleteDropdown.jsx';
import Pagination from './ui/Pagination.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { jsPDF } from 'jspdf';
import {
  drawLetterheadHeader, drawLetterheadFooter, drawSectionHeading, money,
  generateStudentStatementPdf, generateClassGradeStatementPdf,
  generateFeeCategoryReportPdf, generateFinancialOverviewPdf,
  buildRegistrationSummaryPdf
} from './Reports.jsx';
import { playNotificationChime } from '../utils/sound.js';

// ---------------------------------------------------------------------------
// Helper: Stepper component for multi-step forms
// ---------------------------------------------------------------------------
const Stepper = ({ steps, currentStep, onStepChange, children }) => {
  return (
    <div className="ent-stepper">
      <div className="ent-stepper-steps" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        {steps.map((label, idx) => (
          <React.Fragment key={idx}>
            <div
              className={`ent-stepper-step ${idx < currentStep ? 'completed' : ''} ${idx === currentStep ? 'active' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.2rem 0.8rem',
                borderRadius: '999px',
                background: idx < currentStep ? 'var(--c-success-bg)' : idx === currentStep ? 'var(--gradient-action)' : 'var(--c-border-soft)',
                color: idx < currentStep ? 'var(--c-success)' : idx === currentStep ? '#fff' : 'var(--c-muted)',
                fontWeight: 600, fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => onStepChange(idx)}
            >
              {idx < currentStep && <CheckCircle size={14} />}
              {idx + 1}. {label}
            </div>
            {idx < steps.length - 1 && <span style={{ color: 'var(--c-border)' }}>→</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="ent-stepper-content">
        {children}
      </div>
    </div>
  );
};

// Namibian regions list
const NAMIBIA_REGIONS = [
  'Erongo', 'Hardap', 'Karas', 'Kavango East', 'Kavango West',
  'Khomas', 'Kunene', 'Ohangwena', 'Omaheke', 'Omusati',
  'Oshana', 'Oshikoto', 'Otjozondjupa', 'Zambezi'
];

// Common countries for foreign nationals
// Combined limit for ALL documents uploaded for one student — certificates,
// report cards, ID copies, etc. together, not per individual file. Keeps
// the final combined PDF (and the local database it gets stored in) a
// reasonable size even with several scans per student.
const MAX_TOTAL_DOCUMENT_BYTES = 10 * 1024 * 1024;

const COMMON_COUNTRIES = [
  'Namibia', 'South Africa', 'Botswana', 'Zambia', 'Zimbabwe', 'Angola',
  'Kenya', 'Nigeria', 'Ghana', 'UK', 'USA', 'Canada', 'Australia', 'Other'
];

// Name formatter: first letter capital, rest lowercase
function formatName(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

// Phone formatter: auto-insert spaces for Namibian numbers, keep foreign numbers clean
function formatPhoneDisplay(raw) {
  if (!raw) return '';
  let digits = raw.replace(/[^\d\+]/g, '');
  if (digits.length > 0 && digits[0] !== '+') digits = '+' + digits;
  if (digits.startsWith('+264')) {
    const rest = digits.slice(4);
    if (rest.length === 0) return '+264';
    let formatted = '+264';
    if (rest.length <= 2) {
      formatted += ' ' + rest;
    } else {
      formatted += ' ' + rest.slice(0, 2) + ' ' + rest.slice(2, 5);
      if (rest.length > 5) formatted += ' ' + rest.slice(5, 9);
    }
    return formatted;
  }
  return digits;
}

// Common providers — gmail first so it's the default suggestion the
// moment someone types "@" with nothing after it yet; the list then
// narrows/reorders to whatever actually matches as they keep typing.
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];

/** An email input with Gmail-style domain autocomplete — type up to and
 * past "@", a dropdown of matching providers appears with the closest
 * match highlighted, and Tab completes it. Always stores/displays the
 * email in lowercase, regardless of how it was typed. */
function EmailFieldWithAutocomplete({ label, value, onChange, required, placeholder }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const anchorRef = useRef(null);

  const { localPart, suggestions } = useMemo(() => {
    if (!value || !value.includes('@')) return { localPart: '', suggestions: [] };
    const atIndex = value.indexOf('@');
    const local = value.slice(0, atIndex);
    const domainQuery = value.slice(atIndex + 1);
    if (!local) return { localPart: local, suggestions: [] };
    const matches = EMAIL_DOMAINS.filter((d) => d.startsWith(domainQuery) && d !== domainQuery);
    return { localPart: local, suggestions: matches };
  }, [value]);

  const topSuggestion = suggestions[0];

  function handleKeyDown(e) {
    if (e.key === 'Tab' && topSuggestion) {
      e.preventDefault();
      onChange(`${localPart}@${topSuggestion}`);
      setShowSuggestions(false);
    }
  }

  return (
    <div className="ent-field">
      <label>{label}{required ? ' *' : ''}</label>
      <div ref={anchorRef}>
        <input
          type="email" value={value || ''}
          onChange={(e) => { onChange(e.target.value.toLowerCase()); setShowSuggestions(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={placeholder || 'name@example.com'}
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <AutocompleteDropdown anchorRef={anchorRef}>
          {suggestions.map((domain, i) => (
            <div
              key={domain}
              className="ent-autocomplete-item"
              style={i === 0 ? { background: '#dbeafe' } : undefined}
              onMouseDown={(e) => { e.preventDefault(); onChange(`${localPart}@${domain}`); setShowSuggestions(false); }}
            >
              <span>{localPart}@{domain}</span>
              {i === 0 && <small style={{ color: 'var(--c-primary)', fontWeight: 600 }}>Tab</small>}
            </div>
          ))}
        </AutocompleteDropdown>
      )}
    </div>
  );
}

// Helper: calculate age from a date string (YYYY-MM-DD)
function getAge(dateString) {
  if (!dateString) return null;
  const today = new Date();
  const birthDate = new Date(dateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Main StudentHub Component
// ---------------------------------------------------------------------------
export default function StudentHub({ user }) {
  const isBothSchools = user.section === 'Both';
  const [viewSchool, setViewSchool] = useState(isBothSchools ? 'WENDY' : user.section);
  const school = viewSchool;
  const isWendy = school === 'WENDY';
  const isKeila = school === 'KEILA';

  const wendyTabs = [
    { key: 'records', label: 'Student Records', icon: Search },
    { key: 'feeStructure', label: 'Fee Structure Manager', icon: Layers },
    { key: 'feeAssignment', label: 'Fee Assignment Manager', icon: ClipboardList },
    { key: 'ledger', label: 'Financial Ledger', icon: FileText },
    { key: 'bulk', label: 'Bulk Operations', icon: CheckSquare },
    { key: 'feeSettings', label: 'Fee Settings', icon: Settings }
  ];

  const keilaTabs = [
    { key: 'records', label: 'Student Records', icon: Search },
    { key: 'courses', label: 'Course Management', icon: BookOpen },
    { key: 'subjects', label: 'Subject Management', icon: FileText },
    { key: 'enrolment', label: 'Student Enrolment', icon: ClipboardList },
    { key: 'installments', label: 'Installment Plans', icon: Calendar },
    { key: 'ledger', label: 'Student Financial Ledger', icon: FileText },
    { key: 'accountManagement', label: 'Student Account Management', icon: UserCog },
    { key: 'courseFeeAssignment', label: 'Course Fee Assignment', icon: Layers },
    { key: 'sponsors', label: 'Sponsor Management', icon: Users },
    { key: 'statements', label: 'Parent/Sponsor Statements', icon: Printer },
    { key: 'settings', label: 'Settings', icon: Settings }
  ];

  const tabs = isWendy ? wendyTabs : keilaTabs;
  const [activeTab, setActiveTab] = useState(tabs[0].key);

  useEffect(() => {
    setActiveTab((isWendy ? wendyTabs : keilaTabs)[0].key);
  }, [viewSchool]);

  const renderContent = () => {
    switch (activeTab) {
      case 'ledger': return <FinancialLedgerTab user={user} school={school} />;
      case 'feeSettings': return <FeeSettingsTab user={user} school={school} />;
      case 'settings': return <FeeSettingsTab user={user} school={school} />; // Keila Settings
      case 'records': return <StudentRecordsTab user={user} school={school} />;
      case 'feeStructure': return <FeeStructureManagerTab user={user} school={school} />;
      case 'feeAssignment': return <FeeAssignmentManagerTab user={user} />;
      case 'bulk': return <BulkOperationsTab user={user} />;
      case 'courses': return <CourseManagementTab user={user} />;
      case 'subjects': return <SubjectManagementTab user={user} />;
      case 'enrolment': return <StudentEnrolmentTab user={user} />;
      case 'installments': return <InstallmentPlansTab user={user} />;
      case 'accountManagement': return <AccountManagementTab user={user} />;
      case 'courseFeeAssignment': return <CourseFeeAssignmentTab user={user} />;
      case 'sponsors': return <SponsorManagementTab user={user} />;
      case 'statements': return <SponsorStatementsTab user={user} />;
      default: return <div className="ent-empty">Module under construction.</div>;
    }
  };

  return (
    <div className="student-hub">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '1.2rem', fontSize: '1.3rem', fontWeight: 700, color: 'var(--c-ink)' }}>
        <School size={20} style={{ color: 'var(--c-primary)' }} />
        {isWendy ? 'Wendy Private School' : 'Keila Academy'}
      </h2>
      {isBothSchools && (
        <div className="ent-tabs" style={{ marginBottom: '1rem' }}>
          <button className={`ent-tab ${isWendy ? 'is-active' : ''}`} onClick={() => setViewSchool('WENDY')}>Wendy Private School</button>
          <button className={`ent-tab ${isKeila ? 'is-active' : ''}`} onClick={() => setViewSchool('KEILA')}>Keila Academy</button>
        </div>
      )}
      <div className="ent-tabs" style={{ marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`ent-tab ${activeTab === tab.key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>
      <div className="ent-tab-content">
        {renderContent()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document handling for the registration form's Documents step. Images get
// compressed and laid out as pages via jsPDF (unchanged from before); a
// genuine PDF a parent already has (a scanned ID, a passport copy) gets its
// real pages copied in directly via pdf-lib, rather than being forced
// through an image-rendering pipeline that would degrade it. Either way,
// what's saved at the end is one combined PDF.
// ---------------------------------------------------------------------------
function compressImageFile(file, maxDimension = 900, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          } else {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width, height });
      };
      img.onerror = () => reject(new Error('Could not read image: ' + file.name));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file: ' + file.name));
    reader.readAsDataURL(file);
  });
}

/** Converts bytes to base64 without ever spreading the whole array as
 * individual function arguments — String.fromCharCode(...bigArray) blows
 * the call stack once the array gets past roughly tens of thousands of
 * bytes, which any real PDF (even a single scanned page) reaches easily.
 * Processing in fixed-size chunks keeps every individual call small,
 * regardless of how large the overall file is. */
function uint8ArrayToBase64(bytes) {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file: ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

async function buildCombinedDocumentsPdf(files) {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'));
  const pdfFiles = files.filter((f) => f.type === 'application/pdf');

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let addedFirstPage = false;
  for (const file of imageFiles) {
    const { dataUrl, width, height } = await compressImageFile(file);
    if (addedFirstPage) doc.addPage();
    addedFirstPage = true;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(file.name.slice(0, 60), 10, 12);
    const maxW = pageWidth - 20;
    const maxH = pageHeight - 30;
    const scale = Math.min(maxW / width, maxH / height, 1);
    const w = width * scale, h = height * scale;
    const x = (pageWidth - w) / 2;
    doc.addImage(dataUrl, 'JPEG', x, 20, w, h, undefined, 'FAST');
  }

  // No images at all, only PDFs — jsPDF always creates a blank first page,
  // so start from an empty pdf-lib document instead of carrying that
  // blank page into the final merged file.
  const { PDFDocument } = await import('pdf-lib');
  let finalDoc;
  if (addedFirstPage) {
    const imagePdfBytes = doc.output('arraybuffer');
    finalDoc = await PDFDocument.load(imagePdfBytes);
  } else {
    finalDoc = await PDFDocument.create();
  }

  for (const file of pdfFiles) {
    const bytes = await fileToArrayBuffer(file);
    const sourceDoc = await PDFDocument.load(bytes);
    const copiedPages = await finalDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());
    copiedPages.forEach((p) => finalDoc.addPage(p));
  }

  const finalBytes = await finalDoc.save();
  const base64 = uint8ArrayToBase64(finalBytes);
  return { base64, sizeBytes: finalBytes.byteLength };
}

// ---------------------------------------------------------------------------
// 1. Student Registration (shared) – with stepper
// ---------------------------------------------------------------------------
function StudentRegistrationTab({ user, school }) {
  const steps = ['Student Details', 'Guardian / Parent', 'Sponsor & Financial', 'Enrollment', 'Documents'];
  const [step, setStep] = useState(0);
  const schoolLabel = school === 'WENDY' ? 'Wendy Private School' : 'Keila Academy';

  const emptyFormData = {
    firstName: '', lastName: '', dateOfBirth: '', gender: '',
    nationalId: '', passport: '',
    phone: '', email: '', address: '', emergencyContact: '', emergencyContactName: '',
    previousSchool: '', isRepeating: false,
    isForeignNational: false, country: 'Namibia', region: '',
    guardianMode: 'new', guardianSearch: '', selectedGuardianId: '',
    guardianFirstName: '', guardianLastName: '', guardianRelationship: 'Mother', guardianRelationshipOther: '',
    guardianPhone: '', guardianPhone2: '', guardianEmail: '', guardianAddress: '', guardianCity: '',
    guardianIsForeignNational: false, guardianNationalId: '', guardianPassport: '', guardianCountry: 'Namibia',
    sponsorType: 'Self', employerName: '', jobTitle: '', employerPhone: '', employerAddress: '',
    sponsorOrgName: '', sponsorContactPerson: '', sponsorPhone: '', sponsorEmail: '', sponsorAddress: '',
    classId: '', courseId: '', subjects: [],
    enrollmentDate: new Date().toISOString().slice(0, 10),
    academicYear: new Date().getFullYear().toString(), intake: '',
    usesBus: false, busType: '', isHostelite: false, hostelType: ''
  };
  const [formData, setFormData] = useState(emptyFormData);
  const [documentFiles, setDocumentFiles] = useState([]);
  const [documentSizeError, setDocumentSizeError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState('');

  const [classes, setClasses] = useState([]);
  const [courses, setCourses] = useState([]);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [guardians, setGuardians] = useState([]);

  const isWendy = school === 'WENDY';
  const isKeila = school === 'KEILA';

  useEffect(() => {
    if (isWendy) {
      window.electronAPI.listClasses(school).then(res => { if (res.success) setClasses(res.classes); });
    } else {
      window.electronAPI.listCourses(school).then(res => { if (res.success) setCourses(res.courses); });
    }
    window.electronAPI.listGuardians().then(res => { if (res.success) setGuardians(res.guardians); });
  }, [isWendy, isKeila, school]);

  useEffect(() => {
    if (formData.courseId) {
      window.electronAPI.listSubjects(formData.courseId).then(res => { if (res.success) setAvailableSubjects(res.subjects); });
    } else {
      setAvailableSubjects([]);
    }
  }, [formData.courseId]);

  const updateField = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const matchingGuardians = useMemo(() => {
    const q = formData.guardianSearch.trim().toLowerCase();
    if (!q) return [];
    return guardians.filter(g =>
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) || (g.phonePrimary || '').includes(q)
    ).slice(0, 6);
  }, [guardians, formData.guardianSearch]);

  const nextStep = () => {
    if (step === 0) {
      if (!formData.firstName || !formData.lastName || !formData.dateOfBirth || !formData.gender) {
        setError('Please fill all required student fields.');
        return;
      }
      if (formData.email && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(formData.email)) {
        setError('Please enter a valid email address.');
        return;
      }

      const age = getAge(formData.dateOfBirth);
      if (formData.isForeignNational) {
        if (!formData.passport) {
          setError('Passport number is required for foreign nationals.');
          return;
        }
        if (!formData.country || formData.country === 'Namibia') {
          setError('Please select a home country other than Namibia for a foreign national.');
          return;
        }
      } else {
        // Namibian citizen – National ID only exists as a real document
        // once someone turns 18, so the field itself doesn't apply before
        // that, not just "not required yet."
        if (age !== null && age >= 18 && !formData.nationalId) {
          setError('National ID is required for students aged 18 or older.');
          return;
        }
      }
    }
    if (step === 1) {
      if (formData.guardianMode === 'existing' && !formData.selectedGuardianId) {
        setError('Select an existing guardian, or switch to "Create New."');
        return;
      }
      if (formData.guardianMode === 'new') {
        if (!formData.guardianFirstName || !formData.guardianLastName || !formData.guardianPhone) {
          setError('Guardian first name, last name, and phone are required.');
          return;
        }
        if (formData.guardianEmail && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(formData.guardianEmail)) {
          setError('Please enter a valid email address for the guardian.');
          return;
        }
        if (formData.guardianRelationship === 'Other' && !formData.guardianRelationshipOther.trim()) {
          setError('Please specify the guardian\'s relationship to the student.');
          return;
        }
        if (formData.guardianIsForeignNational) {
          if (!formData.guardianPassport) {
            setError('Passport number is required for a foreign national guardian.');
            return;
          }
          if (!formData.guardianCountry || formData.guardianCountry === 'Namibia') {
            setError('Please select the guardian\'s home country (not Namibia, since they\'re marked as a foreign national).');
            return;
          }
        } else if (!formData.guardianNationalId) {
          setError('National ID is required for a Namibian guardian.');
          return;
        }
      }
    }
    if (step === 2) {
      if (['Company', 'Government', 'NGO'].includes(formData.sponsorType) && !formData.sponsorOrgName.trim()) {
        setError('Organization name is required for this sponsor type.');
        return;
      }
      if (formData.sponsorEmail && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(formData.sponsorEmail)) {
        setError('Please enter a valid sponsor email address.');
        return;
      }
    }
    setError('');
    setStep(s => Math.min(s + 1, steps.length - 1));
  };
  const prevStep = () => { setError(''); setStep(s => Math.max(s - 1, 0)); };

  const handleNameChange = (field, rawValue) => {
    const formatted = formatName(rawValue);
    updateField(field, formatted);
  };

  const handlePhoneChange = (field, rawValue) => {
    const formatted = formatPhoneDisplay(rawValue);
    updateField(field, formatted);
  };

  const handlePhoneFocus = (field) => {
    if (!formData[field] || formData[field].trim() === '') {
      updateField(field, '+264 ');
    }
  };

  const handlePhoneBlur = (field) => {
    if (formData[field] === '+264' || formData[field] === '+264 ') {
      updateField(field, '');
    }
  };

  function handleDocumentFiles(e) {
    const newFiles = Array.from(e.target.files || []);
    e.target.value = '';
    const currentTotal = documentFiles.reduce((sum, f) => sum + f.size, 0);
    const newTotal = newFiles.reduce((sum, f) => sum + f.size, 0);
    if (currentTotal + newTotal > MAX_TOTAL_DOCUMENT_BYTES) {
      const remainingMB = ((MAX_TOTAL_DOCUMENT_BYTES - currentTotal) / (1024 * 1024)).toFixed(1);
      setDocumentSizeError(
        `That would put this student's documents over the 10MB limit — about ${remainingMB}MB of room left. ` +
        `Try a lower-resolution photo, or split large scans into separate uploads.`
      );
      return;
    }
    setDocumentSizeError('');
    setDocumentFiles(prev => [...prev, ...newFiles]);
  }
  function removeDocumentFile(idx) {
    setDocumentFiles(prev => prev.filter((_, i) => i !== idx));
    setDocumentSizeError('');
  }

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      setSavingStage('Saving guardian...');
      let guardianId = formData.selectedGuardianId;
      let guardianRecord = guardians.find(g => g.guardianId === guardianId);
      if (formData.guardianMode === 'new') {
        const guardianPayload = {
          firstName: formData.guardianFirstName, lastName: formData.guardianLastName,
          relationship: formData.guardianRelationship === 'Other' ? formData.guardianRelationshipOther.trim() : formData.guardianRelationship,
          phonePrimary: formData.guardianPhone,
          phoneSecondary: formData.guardianPhone2, email: formData.guardianEmail,
          addressLine1: formData.guardianAddress, city: formData.guardianCity,
          isForeignNational: formData.guardianIsForeignNational,
          nationalId: formData.guardianIsForeignNational ? '' : formData.guardianNationalId,
          passport: formData.guardianIsForeignNational ? formData.guardianPassport : '',
          country: formData.guardianIsForeignNational ? formData.guardianCountry : 'Namibia',
          employerName: formData.sponsorType === 'Parent' ? formData.employerName : '',
          jobTitle: formData.sponsorType === 'Parent' ? formData.jobTitle : '',
          employerPhone: formData.sponsorType === 'Parent' ? formData.employerPhone : '',
          employerAddress: formData.sponsorType === 'Parent' ? formData.employerAddress : ''
        };
        const createRes = await window.electronAPI.createGuardian(guardianPayload);
        if (!createRes.success) { setError(createRes.message || 'Could not save guardian.'); setSaving(false); return; }
        guardianRecord = createRes.guardian;
        guardianId = guardianRecord.guardianId;
      }

      let sponsorId = '';
      let sponsorRecord = null;
      if (['Company', 'Government', 'NGO'].includes(formData.sponsorType) && formData.sponsorOrgName) {
        setSavingStage('Saving sponsor...');
        const sponsorRes = await window.electronAPI.createSponsor({
          school, name: formData.sponsorOrgName, type: formData.sponsorType,
          contactPerson: formData.sponsorContactPerson, phone: formData.sponsorPhone,
          email: formData.sponsorEmail, address: formData.sponsorAddress
        });
        if (sponsorRes.success && sponsorRes.sponsor && sponsorRes.sponsor.sponsorId) {
          sponsorId = sponsorRes.sponsor.sponsorId;
          sponsorRecord = sponsorRes.sponsor;
        }
      }

      setSavingStage('Registering student...');
      const studentPayload = {
        firstName: formData.firstName, lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth, gender: formData.gender,
        school, guardianId,
        enrollmentDate: formData.enrollmentDate,
        phone: formData.phone, email: formData.email, address: formData.address,
        emergencyContactName: formData.emergencyContactName,
        emergencyContact: formData.emergencyContact,
        nationalId: formData.isForeignNational ? '' : formData.nationalId,
        passport: formData.isForeignNational ? formData.passport : '',
        country: formData.isForeignNational ? formData.country : 'Namibia',
        region: formData.isForeignNational ? '' : formData.region,
        previousSchool: formData.previousSchool, isRepeating: formData.isRepeating,
        usesBus: formData.usesBus, busType: formData.usesBus ? formData.busType : '',
        isHostelite: formData.isHostelite, hostelType: formData.isHostelite ? formData.hostelType : '',
        registeredBy: user.username,
        academicYear: formData.academicYear, intake: formData.intake,
        classId: isWendy ? formData.classId : undefined,
        courseId: isKeila ? formData.courseId : undefined,
        sponsorType: formData.sponsorType,
        sponsorId: sponsorId || undefined,
        isForeignNational: formData.isForeignNational
      };
      const result = await window.electronAPI.createStudent(studentPayload);
      if (!result.success) { setError(result.message); setSaving(false); setSavingStage(''); return; }
      const student = result.student;

      if (isKeila && formData.courseId) {
        const enrollRes = await window.electronAPI.enrollStudent({
          studentId: student.studentId, courseId: formData.courseId, subjects: formData.subjects || [],
          academicYear: formData.academicYear, intake: formData.intake
        });
        if (!enrollRes.success) {
          setError('Student created but enrollment failed: ' + enrollRes.message);
          setSaving(false); setSavingStage('');
          return;
        }
      }

      let docsSizeKb = 0;
      if (documentFiles.length > 0) {
        setSavingStage(`Compressing ${documentFiles.length} document image(s)...`);
        const { base64: docsBase64, sizeBytes } = await buildCombinedDocumentsPdf(documentFiles);
        docsSizeKb = Math.round(sizeBytes / 1024);
        const saveRes = await window.electronAPI.saveStudentDocumentsPdf(student.studentId, docsBase64, 'documents');
        if (saveRes.success) {
          await window.electronAPI.updateStudent(student.studentId, { documentsPdfPath: saveRes.filePath });
        }
      }

      setSavingStage('Generating registration summary...');
      const summaryBase64 = await buildRegistrationSummaryPdf(school, schoolLabel, studentPayload, guardianRecord || {}, sponsorRecord);
      const summarySaveRes = await window.electronAPI.saveStudentDocumentsPdf(student.studentId, summaryBase64, 'summary');
      if (summarySaveRes.success) {
        await window.electronAPI.updateStudent(student.studentId, { summaryPdfPath: summarySaveRes.filePath });
      }

      playNotificationChime();
      setSuccess({ name: `${student.firstName} ${student.lastName}`, docsSizeKb, docsCount: documentFiles.length });
      setFormData(emptyFormData);
      setDocumentFiles([]);
      setStep(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setSavingStage('');
    }
  };

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><UserPlus size={16} /> Register New Student</h3>
      {error && <div className="ent-error-box">{error}</div>}
      {success && (
        <div className="ent-success-box">
          {success.name} registered successfully.
          {success.docsCount > 0 && ` ${success.docsCount} document(s) combined into a ${success.docsSizeKb}KB PDF.`}
          {' '}A registration summary was also generated.
        </div>
      )}

      <Stepper steps={steps} currentStep={step} onStepChange={setStep}>
        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field"><label>First Name *</label>
              <input value={formData.firstName} onChange={e => handleNameChange('firstName', e.target.value)} />
            </div>
            <div className="ent-field"><label>Last Name *</label>
              <input value={formData.lastName} onChange={e => handleNameChange('lastName', e.target.value)} />
            </div>
            <div className="ent-field"><label>Date of Birth *</label><input type="date" value={formData.dateOfBirth} onChange={e => updateField('dateOfBirth', e.target.value)} /></div>
            <div className="ent-field"><label>Gender *</label>
              <select value={formData.gender} onChange={e => updateField('gender', e.target.value)}>
                <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <Toggle
                checked={formData.isForeignNational}
                onChange={(val) => {
                  updateField('isForeignNational', val);
                  if (!val) updateField('country', 'Namibia');
                  else updateField('region', '');
                }}
                label="Foreign National (non-Namibian)"
                id="foreignNational"
              />
            </div>

            {!formData.isForeignNational ? (
              getAge(formData.dateOfBirth) !== null && getAge(formData.dateOfBirth) >= 18 ? (
                <div className="ent-field"><label>National ID *</label><input value={formData.nationalId} onChange={e => updateField('nationalId', e.target.value)} /></div>
              ) : (
                <div className="ent-field">
                  <label>National ID</label>
                  <input value="" disabled placeholder="Not applicable — student is under 18" />
                </div>
              )
            ) : (
              <div className="ent-field"><label>Passport Number *</label><input value={formData.passport} onChange={e => updateField('passport', e.target.value)} /></div>
            )}
            {formData.isForeignNational && (
              <div className="ent-field"><label>Home Country *</label>
                <select value={formData.country} onChange={e => updateField('country', e.target.value)}>
                  <option value="">Select country</option>
                  {COMMON_COUNTRIES.filter(c => c !== 'Namibia').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            <div className="ent-field">
              <label>Phone</label>
              <input
                value={formData.phone}
                onChange={e => handlePhoneChange('phone', e.target.value)}
                onFocus={() => handlePhoneFocus('phone')}
                onBlur={() => handlePhoneBlur('phone')}
                placeholder="+264 81 234 5678"
              />
            </div>

            <EmailFieldWithAutocomplete label="Email" value={formData.email} onChange={(v) => updateField('email', v)} placeholder="student@example.com" />

            <div className="ent-field" style={{ gridColumn: '1 / -1' }}><label>Address</label><input value={formData.address} onChange={e => updateField('address', e.target.value)} /></div>

            {!formData.isForeignNational ? (
              <div className="ent-field">
                <label>Region</label>
                <select value={formData.region} onChange={e => updateField('region', e.target.value)}>
                  <option value="">Select region</option>
                  {NAMIBIA_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ) : (
              <div className="ent-field">
                <label>Country</label>
                <select value={formData.country} onChange={e => updateField('country', e.target.value)}>
                  <option value="">Select country</option>
                  {COMMON_COUNTRIES.filter(c => c !== 'Namibia').map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
            )}

            <div className="ent-field"><label>Emergency Contact Name</label><input value={formData.emergencyContactName} onChange={e => handleNameChange('emergencyContactName', e.target.value)} /></div>
            <div className="ent-field"><label>Emergency Contact Phone</label><input value={formData.emergencyContact} onChange={e => updateField('emergencyContact', e.target.value)} /></div>
            <div className="ent-field"><label>Previous School (if any)</label><input value={formData.previousSchool} onChange={e => updateField('previousSchool', e.target.value)} /></div>
            <div style={{ gridColumn: '1 / -1' }}><Toggle checked={formData.isRepeating} onChange={val => updateField('isRepeating', val)} label="Repeating student" id="repeating" /></div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="ent-tabs" style={{ marginBottom: '1rem' }}>
              <button type="button" className={`ent-tab ${formData.guardianMode === 'new' ? 'is-active' : ''}`} onClick={() => updateField('guardianMode', 'new')}>Create New</button>
              <button type="button" className={`ent-tab ${formData.guardianMode === 'existing' ? 'is-active' : ''}`} onClick={() => updateField('guardianMode', 'existing')}>Link Existing</button>
            </div>
            {formData.guardianMode === 'existing' ? (
              <div className="ent-field">
                <label>Search by name or phone</label>
                <input value={formData.guardianSearch} onChange={e => { updateField('guardianSearch', e.target.value); updateField('selectedGuardianId', ''); }} placeholder="Start typing..." />
                {matchingGuardians.length > 0 && (
                  <div style={{ marginTop: '0.4rem', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                    {matchingGuardians.map(g => (
                      <div key={g.guardianId} className="ent-autocomplete-item" style={{ background: formData.selectedGuardianId === g.guardianId ? 'var(--c-surface-flat)' : undefined }} onClick={() => updateField('selectedGuardianId', g.guardianId)}>
                        <span>{g.firstName} {g.lastName}</span><small>{g.phonePrimary}</small>
                      </div>
                    ))}
                  </div>
                )}
                {formData.selectedGuardianId && <p className="ent-hint">Selected — this student will link to that existing guardian record.</p>}
              </div>
            ) : (
              <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div className="ent-field"><label>First Name *</label><input value={formData.guardianFirstName} onChange={e => handleNameChange('guardianFirstName', e.target.value)} /></div>
                <div className="ent-field"><label>Last Name *</label><input value={formData.guardianLastName} onChange={e => handleNameChange('guardianLastName', e.target.value)} /></div>
                <div className="ent-field"><label>Relationship</label>
                  <select value={formData.guardianRelationship} onChange={e => updateField('guardianRelationship', e.target.value)}>
                    <option>Mother</option><option>Father</option><option>Guardian</option><option>Grandparent</option><option>Other</option>
                  </select>
                </div>
                {formData.guardianRelationship === 'Other' && (
                  <div className="ent-field"><label>Please Specify *</label><input value={formData.guardianRelationshipOther} onChange={e => updateField('guardianRelationshipOther', e.target.value)} placeholder="e.g. Aunt, Family Friend" /></div>
                )}
                <div className="ent-field">
                  <label>Phone *</label>
                  <input
                    value={formData.guardianPhone}
                    onChange={e => handlePhoneChange('guardianPhone', e.target.value)}
                    onFocus={() => handlePhoneFocus('guardianPhone')}
                    onBlur={() => handlePhoneBlur('guardianPhone')}
                    placeholder="+264 81 234 5678"
                  />
                </div>
                <div className="ent-field">
                  <label>Secondary Phone</label>
                  <input
                    value={formData.guardianPhone2}
                    onChange={e => handlePhoneChange('guardianPhone2', e.target.value)}
                    onFocus={() => handlePhoneFocus('guardianPhone2')}
                    onBlur={() => handlePhoneBlur('guardianPhone2')}
                    placeholder="+264 81 234 5678"
                  />
                </div>
                <EmailFieldWithAutocomplete label="Email" value={formData.guardianEmail} onChange={(v) => updateField('guardianEmail', v)} />
                <div className="ent-field"><label>Address</label><input value={formData.guardianAddress} onChange={e => updateField('guardianAddress', e.target.value)} /></div>
                <div className="ent-field"><label>City</label><input value={formData.guardianCity} onChange={e => handleNameChange('guardianCity', e.target.value)} /></div>
              </div>

              <div style={{ marginTop: '0.6rem' }}>
                <Toggle
                  checked={formData.guardianIsForeignNational}
                  onChange={(val) => { updateField('guardianIsForeignNational', val); if (!val) updateField('guardianCountry', 'Namibia'); }}
                  label="Guardian is a Foreign National"
                  id="guardianForeignNational"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.6rem' }}>
                {!formData.guardianIsForeignNational ? (
                  <div className="ent-field"><label>National ID *</label><input value={formData.guardianNationalId} onChange={e => updateField('guardianNationalId', e.target.value)} /></div>
                ) : (
                  <>
                    <div className="ent-field"><label>Passport Number *</label><input value={formData.guardianPassport} onChange={e => updateField('guardianPassport', e.target.value)} /></div>
                    <div className="ent-field"><label>Home Country *</label>
                      <select value={formData.guardianCountry} onChange={e => updateField('guardianCountry', e.target.value)}>
                        <option value="">Select country</option>
                        {COMMON_COUNTRIES.filter(c => c !== 'Namibia').map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="ent-field">
              <label>Sponsor Type</label>
              <select value={formData.sponsorType} onChange={e => updateField('sponsorType', e.target.value)}>
                <option>Self</option><option>Parent</option><option>Company</option><option>Government</option><option>NGO</option>
              </select>
              <p className="ent-hint">
                {formData.sponsorType === 'Self' && 'Family self-funds — no further info needed.'}
                {formData.sponsorType === 'Parent' && "Parent funds fees from employment — capture their employer below."}
                {['Company', 'Government', 'NGO'].includes(formData.sponsorType) && 'A sponsoring organization pays fees — capture their details below.'}
              </p>
            </div>

            {formData.sponsorType === 'Parent' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem' }}>
                <div className="ent-field"><label>Employer Name</label><input value={formData.employerName} onChange={e => updateField('employerName', e.target.value)} /></div>
                <div className="ent-field"><label>Job Title</label><input value={formData.jobTitle} onChange={e => updateField('jobTitle', e.target.value)} /></div>
                <div className="ent-field">
                  <label>Employer Phone</label>
                  <input
                    value={formData.employerPhone}
                    onChange={e => handlePhoneChange('employerPhone', e.target.value)}
                    onFocus={() => handlePhoneFocus('employerPhone')}
                    onBlur={() => handlePhoneBlur('employerPhone')}
                    placeholder="+264 81 234 5678"
                  />
                </div>
                <div className="ent-field"><label>Employer Address</label><input value={formData.employerAddress} onChange={e => updateField('employerAddress', e.target.value)} /></div>
              </div>
            )}

            {['Company', 'Government', 'NGO'].includes(formData.sponsorType) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem' }}>
                <div className="ent-field" style={{ gridColumn: '1 / -1' }}><label>Organization Name *</label><input value={formData.sponsorOrgName} onChange={e => updateField('sponsorOrgName', e.target.value)} /></div>
                <div className="ent-field"><label>Contact Person</label><input value={formData.sponsorContactPerson} onChange={e => handleNameChange('sponsorContactPerson', e.target.value)} /></div>
                <div className="ent-field">
                  <label>Phone</label>
                  <input
                    value={formData.sponsorPhone}
                    onChange={e => handlePhoneChange('sponsorPhone', e.target.value)}
                    onFocus={() => handlePhoneFocus('sponsorPhone')}
                    onBlur={() => handlePhoneBlur('sponsorPhone')}
                    placeholder="+264 81 234 5678"
                  />
                </div>
                <EmailFieldWithAutocomplete label="Email" value={formData.sponsorEmail} onChange={(v) => updateField('sponsorEmail', v)} />
                <div className="ent-field"><label>Address</label><input value={formData.sponsorAddress} onChange={e => updateField('sponsorAddress', e.target.value)} /></div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            {isWendy && (
              <div className="ent-field">
                <label>Class</label>
                <select value={formData.classId} onChange={e => updateField('classId', e.target.value)}>
                  <option value="">Select Class</option>
                  {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
                </select>
              </div>
            )}
            {isKeila && (
              <>
                <div className="ent-field">
                  <label>Course</label>
                  <select value={formData.courseId} onChange={e => updateField('courseId', e.target.value)}>
                    <option value="">Select Course</option>
                    {courses.map(c => <option key={c.courseId} value={c.courseId}>{c.courseName}</option>)}
                  </select>
                </div>
                {availableSubjects.length > 0 && (
                  <div className="ent-field">
                    <label>Subjects (select multiple)</label>
                    <select multiple value={formData.subjects} onChange={e => {
                      const opts = Array.from(e.target.selectedOptions, o => o.value);
                      updateField('subjects', opts);
                    }} style={{ height: '100px' }}>
                      {availableSubjects.map(s => <option key={s.subjectId} value={s.subjectId}>{s.subjectName}</option>)}
                    </select>
                    <span className="ent-hint">Hold Ctrl to select multiple</span>
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <div className="ent-field"><label>Enrollment Date</label><input type="date" value={formData.enrollmentDate} onChange={e => updateField('enrollmentDate', e.target.value)} /></div>
              <div className="ent-field"><label>Academic Year</label><input value={formData.academicYear} onChange={e => updateField('academicYear', e.target.value)} /></div>
              <div className="ent-field"><label>Intake (e.g., January 2026)</label><input value={formData.intake} onChange={e => updateField('intake', e.target.value)} /></div>
            </div>
            {isWendy && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                <div><Toggle checked={formData.usesBus} onChange={val => updateField('usesBus', val)} label="Uses Bus" id="bus" />
                  {formData.usesBus && <select value={formData.busType} onChange={e => updateField('busType', e.target.value)}><option value="">Type</option><option>Kinder</option><option>Pre-Grade</option><option>Grade 1-12</option></select>}</div>
                <div><Toggle checked={formData.isHostelite} onChange={val => updateField('isHostelite', val)} label="Hostelite" id="hostel" />
                  {formData.isHostelite && <select value={formData.hostelType} onChange={e => updateField('hostelType', e.target.value)}><option value="">Type</option><option>Boarding</option><option>Day Care</option><option>Full-Time</option></select>}</div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
              {formData.isForeignNational
                ? 'Required: Passport (mandatory) and visa / residence permit (if applicable).'
                : `Required: ${getAge(formData.dateOfBirth) !== null && getAge(formData.dateOfBirth) >= 18 ? 'National ID (mandatory).' : 'No single mandatory document at this age.'}`}
              {' '}Also upload anything else on hand — report cards, certificates, transfer letters, and similar — images and PDFs both accepted.
              All uploads are combined into a single PDF for this student (images get compressed automatically; uploaded PDFs keep their original pages).
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input type="file" accept="image/*,application/pdf" multiple onChange={handleDocumentFiles} />
              <span className="ent-hint" style={{ margin: 0 }}>
                {(documentFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)}MB of 10MB used
              </span>
            </div>
            {documentSizeError && <div className="ent-error-box" style={{ marginBottom: '0.6rem' }}>{documentSizeError}</div>}
            {documentFiles.length > 0 && (
              <div style={{ marginTop: '0.8rem' }}>
                {documentFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: 'var(--c-surface-flat)', borderRadius: 'var(--r-sm)', marginBottom: '0.4rem', fontSize: '0.82rem' }}>
                    <span>{f.name} <span style={{ color: 'var(--c-muted)' }}>({Math.round(f.size / 1024)}KB)</span></span>
                    <button type="button" className="ent-icon-btn ent-icon-btn--red" onClick={() => removeDocumentFile(i)}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Stepper>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
        <button className="ent-btn ent-btn--secondary" onClick={prevStep} disabled={step === 0}>Previous</button>
        {step < steps.length - 1 ? (
          <button className="ent-btn ent-btn--primary" onClick={nextStep}>Next</button>
        ) : (
          <button className="ent-btn ent-btn--primary" onClick={handleSubmit} disabled={saving}>
            {saving ? (savingStage || 'Saving...') : 'Register Student'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Student — search, then correct core details after registration.
// Uses the same field set as registration, minus the multi-step wizard —
// this is for fixing a typo or an outdated phone number, not re-doing the
// whole intake process.
// ---------------------------------------------------------------------------
function EditStudentTab({ user, school }) {
  const isWendy = school === 'WENDY';
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [courses, setCourses] = useState([]);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchAnchorRef = useRef(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    window.electronAPI.listStudents(school).then((res) => { if (res.success) setStudents(res.students); });
    if (isWendy) window.electronAPI.listClasses(school).then((res) => { if (res.success) setClasses(res.classes); });
    else window.electronAPI.listCourses(school).then((res) => { if (res.success) setCourses(res.courses); });
  }, [school]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [students, query]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery(`${s.firstName} ${s.lastName}`);
    setShowResults(false);
    setSuccess(false);
    setError('');
    setForm({
      firstName: s.firstName || '', lastName: s.lastName || '', dateOfBirth: s.dateOfBirth || '', gender: s.gender || 'Male',
      phone: s.phone || '', email: s.email || '', address: s.address || '', emergencyContact: s.emergencyContact || '', emergencyContactName: s.emergencyContactName || '',
      enrollmentStatus: s.enrollmentStatus || 'Active', classId: s.classId || '', courseId: s.courseId || '',
      usesBus: !!s.usesBus, busType: s.busType || '', isHostelite: !!s.isHostelite, hostelType: s.hostelType || '',
      nationalId: s.nationalId || '', passport: s.passport || '', country: s.country || 'Namibia',
      previousSchool: s.previousSchool || '', isRepeating: !!s.isRepeating,
      sponsorType: s.sponsorType || 'Self', isOnScholarship: !!s.isOnScholarship,
      academicYear: s.academicYear || '', intake: s.intake || ''
    });
  }

  function updateField(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function handleSave() {
    setError(''); setSuccess(false);
    if (!form.firstName || !form.lastName) { setError('First and last name are required.'); return; }
    setSaving(true);
    try {
      const patch = { ...form };
      if (!patch.usesBus) patch.busType = '';
      if (!patch.isHostelite) patch.hostelType = '';
      const res = await window.electronAPI.updateStudent(selectedStudent.studentId, patch);
      if (!res.success) { setError(res.message); return; }
      playNotificationChime();
      setSuccess(true);
      setStudents((prev) => prev.map((s) => (s.studentId === selectedStudent.studentId ? { ...s, ...patch } : s)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Edit size={16} /> Edit Student</h3>
      <div className="ent-autocomplete" style={{ marginBottom: '1.2rem' }}>
        <div className="ent-autocomplete-input-wrap" ref={searchAnchorRef}>
          <Search size={15} />
          <input
            className="ent-input" placeholder="Search by name or student number..."
            value={query} onChange={(e) => { setQuery(e.target.value); setShowResults(true); }} onFocus={() => setShowResults(true)}
          />
        </div>
        {showResults && query && (
          <AutocompleteDropdown anchorRef={searchAnchorRef}>
            {filteredStudents.length === 0 ? (
              <div className="ent-autocomplete-empty">No matching students.</div>
            ) : filteredStudents.map((s) => (
              <div key={s.studentId} className="ent-autocomplete-item" onClick={() => selectStudent(s)}>
                <span>{s.firstName} {s.lastName}</span><small>{s.studentNumber}</small>
              </div>
            ))}
          </AutocompleteDropdown>
        )}
      </div>

      {selectedStudent && form && (
        <div>
          {error && <div className="ent-error-box">{error}</div>}
          {success && <div className="ent-success-box">Changes saved for {form.firstName} {form.lastName}.</div>}

          <h4 style={{ fontSize: '0.8rem', color: 'var(--c-muted)', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Basic Details</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field"><label>First Name *</label><input value={form.firstName} onChange={(e) => updateField('firstName', formatName(e.target.value))} /></div>
            <div className="ent-field"><label>Last Name *</label><input value={form.lastName} onChange={(e) => updateField('lastName', formatName(e.target.value))} /></div>
            <div className="ent-field"><label>Date of Birth</label><input type="date" value={form.dateOfBirth} onChange={(e) => updateField('dateOfBirth', e.target.value)} /></div>
            <div className="ent-field"><label>Gender</label>
              <select value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
                <option>Male</option><option>Female</option><option>Other</option>
              </select>
            </div>
            <div className="ent-field"><label>National ID</label><input value={form.nationalId} onChange={(e) => updateField('nationalId', e.target.value)} /></div>
            <div className="ent-field"><label>Passport Number</label><input value={form.passport} onChange={(e) => updateField('passport', e.target.value)} placeholder="If a foreign national" /></div>
            <div className="ent-field"><label>Country</label>
              <select value={form.country} onChange={(e) => updateField('country', e.target.value)}>
                {COMMON_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <h4 style={{ fontSize: '0.8rem', color: 'var(--c-muted)', margin: '1.1rem 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contact</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field">
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => updateField('phone', formatPhoneDisplay(e.target.value))}
                onFocus={() => { if (!form.phone) updateField('phone', '+264 '); }}
                onBlur={() => { if (form.phone === '+264' || form.phone === '+264 ') updateField('phone', ''); }}
                placeholder="+264 81 234 5678"
              />
            </div>
            <EmailFieldWithAutocomplete label="Email" value={form.email} onChange={(v) => updateField('email', v)} />
            <div className="ent-field" style={{ gridColumn: '1 / -1' }}><label>Address</label><input value={form.address} onChange={(e) => updateField('address', e.target.value)} /></div>
            <div className="ent-field"><label>Emergency Contact Name</label><input value={form.emergencyContactName} onChange={(e) => updateField('emergencyContactName', formatName(e.target.value))} /></div>
            <div className="ent-field">
              <label>Emergency Contact Phone</label>
              <input
                value={form.emergencyContact}
                onChange={(e) => updateField('emergencyContact', formatPhoneDisplay(e.target.value))}
                onFocus={() => { if (!form.emergencyContact) updateField('emergencyContact', '+264 '); }}
                onBlur={() => { if (form.emergencyContact === '+264' || form.emergencyContact === '+264 ') updateField('emergencyContact', ''); }}
                placeholder="+264 81 234 5678"
              />
            </div>
          </div>

          <h4 style={{ fontSize: '0.8rem', color: 'var(--c-muted)', margin: '1.1rem 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Enrollment & History</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="ent-field"><label>Enrollment Status</label>
              <select value={form.enrollmentStatus} onChange={(e) => updateField('enrollmentStatus', e.target.value)}>
                {ENROLLMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="ent-hint">Changing this directly bypasses the approval workflow — use Deactivation requests in Student Records for that instead, this is for corrections.</p>
            </div>
            {isWendy ? (
              <div className="ent-field"><label>Class</label>
                <select value={form.classId} onChange={(e) => updateField('classId', e.target.value)}>
                  <option value="">Unassigned</option>
                  {classes.map((c) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
                </select>
              </div>
            ) : (
              <div className="ent-field"><label>Course</label>
                <select value={form.courseId} onChange={(e) => updateField('courseId', e.target.value)}>
                  <option value="">Unassigned</option>
                  {courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.courseName}</option>)}
                </select>
              </div>
            )}
            <div className="ent-field"><label>Academic Year</label><input value={form.academicYear} onChange={(e) => updateField('academicYear', e.target.value)} /></div>
            <div className="ent-field"><label>Intake</label><input value={form.intake} onChange={(e) => updateField('intake', e.target.value)} placeholder="e.g. January 2026" /></div>
            <div className="ent-field"><label>Previous School</label><input value={form.previousSchool} onChange={(e) => updateField('previousSchool', e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.4rem' }}>
            <Toggle checked={form.isRepeating} onChange={(v) => updateField('isRepeating', v)} label="Repeating Student" id="edit-repeating" />
            <Toggle checked={form.isOnScholarship} onChange={(v) => updateField('isOnScholarship', v)} label="On Scholarship" id="edit-scholarship" />
          </div>

          <h4 style={{ fontSize: '0.8rem', color: 'var(--c-muted)', margin: '1.1rem 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Financial</h4>
          <div className="ent-field" style={{ maxWidth: '260px' }}>
            <label>Sponsor Type</label>
            <select value={form.sponsorType} onChange={(e) => updateField('sponsorType', e.target.value)}>
              <option>Self</option><option>Parent</option><option>Company</option><option>Government</option><option>NGO</option>
            </select>
            <p className="ent-hint">To change WHO the sponsor organization is (not just the type), use Sponsor Management — this only changes the category.</p>
          </div>

          {isWendy && (
            <>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--c-muted)', margin: '1.1rem 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Transport & Boarding</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <Toggle checked={form.usesBus} onChange={(v) => updateField('usesBus', v)} label="Uses Bus" id="edit-bus" />
                  {form.usesBus && (
                    <select value={form.busType} onChange={(e) => updateField('busType', e.target.value)} style={{ marginTop: '0.4rem' }}>
                      <option value="">Type</option><option>Kinder</option><option>Pre-Grade</option><option>Grade 1-12</option>
                    </select>
                  )}
                </div>
                <div>
                  <Toggle checked={form.isHostelite} onChange={(v) => updateField('isHostelite', v)} label="Hostelite" id="edit-hostel" />
                  {form.isHostelite && (
                    <select value={form.hostelType} onChange={(e) => updateField('hostelType', e.target.value)} style={{ marginTop: '0.4rem' }}>
                      <option value="">Type</option><option>Boarding</option><option>Day Care</option><option>Full-Time</option>
                    </select>
                  )}
                </div>
              </div>
            </>
          )}

          <button className="ent-btn ent-btn--primary" style={{ marginTop: '1.2rem' }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Student Records (Wendy)
// ---------------------------------------------------------------------------
const FINANCIAL_STATUS_OPTIONS = [
  { value: 'Good', label: 'Fully Paid' },
  { value: 'Overpaid', label: 'Overpaid (Credit)' },
  { value: 'OK', label: 'OK (recently overdue)' },
  { value: 'Debtors', label: 'Debtor' },
  { value: 'Chronic Debtors', label: 'Chronic Debtor' }
];
const ENROLLMENT_STATUS_OPTIONS = ['Active', 'Inactive', 'Graduated', 'Transferred', 'Suspended', 'Withdrawn'];
const SPONSOR_TYPE_OPTIONS = ['Self', 'Parent', 'Company', 'Government', 'NGO'];

const emptyFilters = {
  enrollmentStatus: '', gradeLevel: '', debtorStatus: '', feeCategory: '',
  isOnScholarship: '', sponsorType: '', usesBus: '', isHostelite: '',
  minBalance: '', maxBalance: ''
};

function StudentRecordsTab({ user, school }) {
  const [students, setStudents] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [viewTarget, setViewTarget] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [promoteTarget, setPromoteTarget] = useState(null);
  const [promoteYears, setPromoteYears] = useState([]);
  const [promoteYearId, setPromoteYearId] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [requestingDeactivation, setRequestingDeactivation] = useState(false);
  const [feesTarget, setFeesTarget] = useState(null);
  const [assignedFees, setAssignedFees] = useState([]);
  const [feeTemplatesById, setFeeTemplatesById] = useState({});
  const [feesLoading, setFeesLoading] = useState(false);
  const [removingFeeId, setRemovingFeeId] = useState(null);

  async function openAssignedFees(s) {
    setFeesTarget(s);
    setFeesLoading(true);
    const [assignmentsRes, templatesRes] = await Promise.all([
      window.electronAPI.listFeeAssignments(s.studentId),
      window.electronAPI.listAllFeeCatalogTemplates(user.section)
    ]);
    setFeesLoading(false);
    if (assignmentsRes.success) setAssignedFees(assignmentsRes.assignments);
    if (templatesRes.success) setFeeTemplatesById(Object.fromEntries(templatesRes.templates.map((t) => [t.templateId, t])));
  }

  async function handleRemoveAssignedFee(assignmentId) {
    setRemovingFeeId(assignmentId);
    try {
      await window.electronAPI.bulkRemoveFee({ assignmentIds: [assignmentId] });
      setAssignedFees((prev) => prev.filter((a) => a.assignmentId !== assignmentId));
    } finally {
      setRemovingFeeId(null);
    }
  }

  async function openPromote(student) {
    setPromoteTarget(student);
    setPromoteResult(null);
    const res = await window.electronAPI.listAcademicYears(student.school);
    if (res.success) {
      setPromoteYears(res.years);
      // Default to whichever year isn't the student's current one — the
      // most common case is promoting into the next year that already
      // exists, not re-selecting the year they're already in.
      const notCurrent = res.years.find((y) => y.label !== student.academicYear);
      setPromoteYearId(notCurrent ? notCurrent.yearId : (res.years[0]?.yearId || ''));
    }
  }

  async function confirmPromote() {
    if (!promoteTarget || !promoteYearId) return;
    setPromoting(true);
    try {
      const res = await window.electronAPI.promoteStudents({
        studentIds: [promoteTarget.studentId], school: promoteTarget.school, targetYearId: promoteYearId
      });
      if (!res.success) { setPromoteResult({ success: false, message: res.message }); return; }
      const outcome = res.results[0];
      if (!outcome.success) { setPromoteResult({ success: false, message: outcome.reason }); return; }
      setPromoteResult({ success: true, outcome });
      playNotificationChime();
      load();
    } finally {
      setPromoting(false);
    }
  }

  function load() {
    setLoading(true);
    const activeFilters = { school: user.section, attachFinancials: true, ...filters };
    Object.keys(activeFilters).forEach((k) => { if (activeFilters[k] === '') delete activeFilters[k]; });
    window.electronAPI.getStudentsByFilters(activeFilters).then((res) => {
      if (res.success) setStudents(res.students);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [user.section, filters]);
  useEffect(() => {
    window.electronAPI.listFeeCategories(user.section).then((res) => { if (res.success) setCategories(res.categories); });
  }, [user.section]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      s.studentNumber.toLowerCase().includes(q) ||
      (s.guardianName || '').toLowerCase().includes(q)
    );
  }, [students, searchTerm]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (filters.enrollmentStatus) chips.push({ key: 'enrollmentStatus', label: `Status: ${filters.enrollmentStatus}` });
    if (filters.gradeLevel) chips.push({ key: 'gradeLevel', label: `Grade: ${filters.gradeLevel}` });
    if (filters.debtorStatus) chips.push({ key: 'debtorStatus', label: FINANCIAL_STATUS_OPTIONS.find((o) => o.value === filters.debtorStatus)?.label || filters.debtorStatus });
    if (filters.feeCategory) chips.push({ key: 'feeCategory', label: `Fee: ${filters.feeCategory}` });
    if (filters.isOnScholarship) chips.push({ key: 'isOnScholarship', label: 'On Scholarship' });
    if (filters.sponsorType) chips.push({ key: 'sponsorType', label: `Sponsor: ${filters.sponsorType}` });
    if (filters.usesBus) chips.push({ key: 'usesBus', label: 'Uses Bus' });
    if (filters.isHostelite) chips.push({ key: 'isHostelite', label: 'Boarding' });
    if (filters.minBalance) chips.push({ key: 'minBalance', label: `Min owed: N$${filters.minBalance}` });
    if (filters.maxBalance) chips.push({ key: 'maxBalance', label: `Max owed: N$${filters.maxBalance}` });
    return chips;
  }, [filters]);

  function removeChip(key) { setFilters((f) => ({ ...f, [key]: key === 'isOnScholarship' || key === 'usesBus' || key === 'isHostelite' ? '' : '' })); }
  function clearAllFilters() { setFilters(emptyFilters); }
  function updateFilter(key, value) { setFilters((f) => ({ ...f, [key]: value })); }

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleSelectAllVisible() {
    const visibleIds = paged.map((s) => s.studentId);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => (allSelected ? prev.filter((id) => !visibleIds.includes(id)) : [...new Set([...prev, ...visibleIds])]));
  }

  async function openView(s) {
    setViewTarget(s);
    setViewLoading(true);
    setActionError('');
    const res = await window.electronAPI.getStudentStatementData(s.studentId);
    setViewLoading(false);
    if (res.success) setViewData(res.data);
    else setActionError(res.message);
  }

  async function handlePrintStatement(s) {
    setActionError('');
    setPrintingId(s.studentId);
    try {
      const res = await window.electronAPI.getStudentStatementData(s.studentId);
      if (!res.success) { setActionError(res.message); return; }
      const doc = await generateStudentStatementPdf(res.data, s.school || user.section, 'student');
      doc.save(`statement-${s.studentNumber}.pdf`);
    } finally {
      setPrintingId(null);
    }
  }

  async function handleRequestDeactivation() {
    setActionError('');
    if (!deactivateReason.trim()) { setActionError('A reason is required.'); return; }
    setRequestingDeactivation(true);
    try {
      const res = await window.electronAPI.requestStudentDeletion({
        studentId: deactivateTarget.studentId, reason: deactivateReason.trim(), requestedBy: user.username
      });
      if (!res.success) { setActionError(res.message); return; }
      playNotificationChime();
      setDeactivateTarget(null);
      setDeactivateReason('');
      load(); // refresh so the pending state is reflected if the row shows it
    } finally {
      setRequestingDeactivation(false);
    }
  }

  async function handleBulkPdf() {
    setBulkGenerating(true);
    setActionError('');
    try {
      const selected = students.filter((s) => selectedIds.includes(s.studentId));
      const doc = new jsPDF();
      for (let i = 0; i < selected.length; i++) {
        const res = await window.electronAPI.getStudentStatementData(selected[i].studentId);
        if (!res.success) continue;
        if (i > 0) doc.addPage();
        await drawLetterheadHeader(doc, selected[i].school || user.section, 'STUDENT STATEMENT', `${res.data.student.firstName} ${res.data.student.lastName} \u2022 ${res.data.student.studentNumber}`);
        let y = 60;
        doc.setFontSize(10);
        doc.text(`Balance: ${money(res.data.ledger.balance)}  |  Status: ${res.data.ledger.status}`, 14, y);
        y += 10;
        res.data.transactions.slice(0, 15).forEach((t) => {
          doc.text(`${t.date}  ${(t.description || '').slice(0, 40)}  ${t.debit ? '-' + t.debit.toFixed(2) : ''}  ${t.credit ? '+' + t.credit.toFixed(2) : ''}  bal: ${t.balance.toFixed(2)}`, 14, y);
          y += 6;
        });
      }
      if (selected.length > 0) drawLetterheadFooter(doc, user.section);
      doc.save(`student-statements-batch-${selected.length}.pdf`);
    } finally {
      setBulkGenerating(false);
    }
  }

  return (
    <div className="ent-card" style={{ position: 'relative', paddingBottom: selectedIds.length > 0 ? '4rem' : undefined }}>
      <div className="ent-card-head">
        <h3 className="ent-card-title"><Search size={16} /> Student Records</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowEditModal(true)}>
            <Edit size={14} /> Edit Student
          </button>
          <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={() => setShowRegisterModal(true)}>
            <UserPlus size={14} /> Register New Student
          </button>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowFilterPanel((v) => !v)}>
            <Filter size={14} /> Filters {activeFilterChips.length > 0 && `(${activeFilterChips.length})`}
          </button>
        </div>
      </div>
      {actionError && <div className="ent-error-box">{actionError}</div>}

      <div className="ent-autocomplete-input-wrap" style={{ marginBottom: '0.8rem' }}>
        <Search size={14} />
        <input className="ent-input" placeholder="Search by name, admission no, parent..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      {activeFilterChips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.8rem' }}>
          {activeFilterChips.map((c) => (
            <span key={c.key} className="ent-badge ent-badge--soft" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              {c.label}
              <X size={11} style={{ cursor: 'pointer' }} onClick={() => updateFilter(c.key, '')} />
            </span>
          ))}
          <button type="button" style={{ background: 'none', border: 'none', color: 'var(--c-danger)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }} onClick={clearAllFilters}>
            Clear filters
          </button>
        </div>
      )}

      {showFilterPanel && (
        <div style={{ background: 'var(--c-surface-flat)', border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.7rem' }}>
            <div className="ent-field"><label>Status</label>
              <select value={filters.enrollmentStatus} onChange={(e) => updateFilter('enrollmentStatus', e.target.value)}>
                <option value="">Any</option>
                {ENROLLMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="ent-field"><label>Grade Level</label>
              <input type="number" value={filters.gradeLevel} onChange={(e) => updateFilter('gradeLevel', e.target.value)} placeholder="e.g. 8" />
            </div>
            <div className="ent-field"><label>Financial Status</label>
              <select value={filters.debtorStatus} onChange={(e) => updateFilter('debtorStatus', e.target.value)}>
                <option value="">Any</option>
                {FINANCIAL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ent-field"><label>Fee Category</label>
              <input value={filters.feeCategory} onChange={(e) => updateFilter('feeCategory', e.target.value)} list="rec-fee-cats" placeholder="e.g. Hostel" />
              <datalist id="rec-fee-cats">{categories.map((c) => <option key={c.categoryId} value={c.name} />)}</datalist>
            </div>
            <div className="ent-field"><label>Sponsor Type</label>
              <select value={filters.sponsorType} onChange={(e) => updateFilter('sponsorType', e.target.value)}>
                <option value="">Any</option>
                {SPONSOR_TYPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="ent-field"><label>Min Owed (N$)</label><input type="number" value={filters.minBalance} onChange={(e) => updateFilter('minBalance', e.target.value)} /></div>
            <div className="ent-field"><label>Max Owed (N$)</label><input type="number" value={filters.maxBalance} onChange={(e) => updateFilter('maxBalance', e.target.value)} /></div>
            <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-end', paddingBottom: '0.4rem' }}>
              <Toggle checked={!!filters.isOnScholarship} onChange={(v) => updateFilter('isOnScholarship', v)} label="Scholarship" id="filt-scholarship" />
              <Toggle checked={!!filters.usesBus} onChange={(v) => updateFilter('usesBus', v)} label="Bus" id="filt-bus" />
              <Toggle checked={!!filters.isHostelite} onChange={(v) => updateFilter('isHostelite', v)} label="Boarding" id="filt-hostel" />
            </div>
          </div>
          <p className="ent-hint" style={{ marginTop: '0.7rem' }}>
            This covers the highest-value filters (financial status, fee category, scholarship, sponsor, bus/hostel, amount owed). A few from the fuller proposal — receipt delivery tracking, per-activity enrollment, cashier reconciliation — aren't wired yet, since they need data this app doesn't collect yet.
          </p>
        </div>
      )}

      <div className="ent-table-wrap">
        <table className="ent-table">
          <thead>
            <tr>
              <th style={{ width: '32px' }}><input type="checkbox" checked={paged.length > 0 && paged.every((s) => selectedIds.includes(s.studentId))} onChange={toggleSelectAllVisible} /></th>
              <th>Admission No</th><th>Name</th><th>Parent</th><th>Grade</th><th>Class</th><th>Status</th><th>Balance</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="9" className="ent-table-empty">Loading...</td></tr> :
              paged.length === 0 ? <tr><td colSpan="9" className="ent-table-empty">No students match these filters.</td></tr> :
              paged.map((s) => (
                <tr key={s.studentId}>
                  <td><input type="checkbox" checked={selectedIds.includes(s.studentId)} onChange={() => toggleSelect(s.studentId)} /></td>
                  <td className="ent-td-mono">{s.studentNumber}</td>
                  <td><strong>{s.firstName} {s.lastName}</strong></td>
                  <td>{s.guardianName || '—'}</td>
                  <td>{s.gradeLevel !== undefined && s.gradeLevel !== null ? s.gradeLevel : '—'}</td>
                  <td>{s.className || '—'}</td>
                  <td><span className={`ent-badge ${s.enrollmentStatus === 'Active' ? 'ent-badge--success' : 'ent-badge--muted'}`}>{s.enrollmentStatus}</span></td>
                  <td className="ent-td-num" style={{ color: s.balance > 0 ? 'var(--c-danger)' : s.balance < 0 ? 'var(--c-success)' : undefined }}>{s.balance !== undefined ? money(s.balance) : '—'}</td>
                  <td>
                    <button className="ent-icon-btn ent-icon-btn--blue" title="View Profile" onClick={() => openView(s)}><Eye size={14} /></button>
                    <button className="ent-icon-btn ent-icon-btn--purple" title="View Ledger" onClick={() => openView(s)}><ClipboardList size={14} /></button>
                    <button className="ent-icon-btn ent-icon-btn--amber" title="Assign Fees" onClick={() => openAssignedFees(s)}><DollarSign size={14} /></button>
                    <button className="ent-icon-btn ent-icon-btn--blue" title="Print Statement" onClick={() => handlePrintStatement(s)} disabled={printingId === s.studentId}><Printer size={14} /></button>
                    <button className="ent-icon-btn ent-icon-btn--green" title="Promote" onClick={() => openPromote(s)}><GradCap size={14} /></button>
                    <button className="ent-icon-btn ent-icon-btn--red" title="Deactivate" onClick={() => { setDeactivateTarget(s); setDeactivateReason(''); setActionError(''); }}><UserX size={14} /></button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} />

      {selectedIds.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0, marginTop: '1rem',
          background: '#1e293b', borderRadius: 'var(--r-lg)', padding: '0.8rem 1.2rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 -4px 16px rgba(0,0,0,0.15)'
        }}>
          <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>{selectedIds.length} selected</span>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setSelectedIds([])}>Clear Selection</button>
            <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleBulkPdf} disabled={bulkGenerating}>
              <FileDown size={14} /> {bulkGenerating ? 'Generating...' : 'Download PDF with details'}
            </button>
          </div>
        </div>
      )}

      {viewTarget && (
        <Portal>
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => { setViewTarget(null); setViewData(null); }}>
          <div className="ent-modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head">
              <h3>{viewTarget.firstName} {viewTarget.lastName} — Profile & Ledger</h3>
              <button className="ent-modal-close" onClick={() => { setViewTarget(null); setViewData(null); }}><X size={18} /></button>
            </div>
            <div className="ent-modal-body">
              {viewLoading ? <p className="ent-hint">Loading...</p> : viewData && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    <div><strong>Admission No:</strong> {viewData.student.studentNumber}</div>
                    <div><strong>Status:</strong> <span className={`ent-badge ${viewData.ledger.status === 'Good' || viewData.ledger.status === 'Overpaid' ? 'ent-badge--success' : 'ent-badge--muted'}`}>{viewData.ledger.status}</span></div>
                    <div><strong>Guardian:</strong> {viewData.guardian ? `${viewData.guardian.firstName} ${viewData.guardian.lastName}` : '—'}</div>
                    <div><strong>Balance:</strong> {money(viewData.ledger.balance)}</div>
                  </div>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Transaction History</h4>
                  <div className="ent-table-wrap" style={{ maxHeight: '260px' }}>
                    <table className="ent-table">
                      <thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
                      <tbody>
                        {viewData.transactions.length === 0 ? <tr><td colSpan={5} className="ent-table-empty">No transactions yet.</td></tr> :
                          viewData.transactions.map((t, i) => (
                            <tr key={i}>
                              <td style={{ fontSize: '0.78rem' }}>{t.date}</td>
                              <td style={{ fontSize: '0.78rem' }}>{t.description}</td>
                              <td className="ent-td-num">{t.debit ? money(t.debit) : ''}</td>
                              <td className="ent-td-num">{t.credit ? money(t.credit) : ''}</td>
                              <td className="ent-td-num">{money(t.balance)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: '1rem' }}>
                    <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={async () => {
                      const doc = await generateStudentStatementPdf(viewData, viewTarget.school || user.section, 'student');
                      doc.save(`statement-${viewTarget.studentNumber}.pdf`);
                    }}>
                      <Printer size={14} /> Download Statement PDF
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        </Portal>
      )}

      {deactivateTarget && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setDeactivateTarget(null)}>
          <div className="ent-modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head">
              <h3>Request Deactivation</h3>
              <button className="ent-modal-close" onClick={() => setDeactivateTarget(null)}><X size={18} /></button>
            </div>
            <div className="ent-modal-body">
              {actionError && <div className="ent-error-box">{actionError}</div>}
              <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
                This sends a request to an Admin/Superadmin for approval — {deactivateTarget.firstName} {deactivateTarget.lastName} stays Active until it's approved. Nothing changes yet.
              </p>
              <div className="ent-field">
                <label>Reason *</label>
                <textarea value={deactivateReason} onChange={(e) => setDeactivateReason(e.target.value)} rows={3} placeholder="e.g. Transferred to another school" />
              </div>
              <button className="ent-btn ent-btn--danger" style={{ marginTop: '0.8rem' }} disabled={requestingDeactivation} onClick={handleRequestDeactivation}>
                {requestingDeactivation ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegisterModal && (
        <Portal>
          <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => { setShowRegisterModal(false); load(); }}>
            <div className="ent-modal" style={{ maxWidth: '760px', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div className="ent-modal-head">
                <h3>Register New Student</h3>
                <button className="ent-modal-close" onClick={() => { setShowRegisterModal(false); load(); }}><X size={18} /></button>
              </div>
              <div className="ent-modal-body">
                <StudentRegistrationTab user={user} school={school} />
              </div>
            </div>
          </div>
        </Portal>
      )}

      {showEditModal && (
        <Portal>
          <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => { setShowEditModal(false); load(); }}>
            <div className="ent-modal" style={{ maxWidth: '760px', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div className="ent-modal-head">
                <h3>Edit Student</h3>
                <button className="ent-modal-close" onClick={() => { setShowEditModal(false); load(); }}><X size={18} /></button>
              </div>
              <div className="ent-modal-body">
                <EditStudentTab user={user} school={school} />
              </div>
            </div>
          </div>
        </Portal>
      )}

      {promoteTarget && (
        <Portal>
          <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setPromoteTarget(null)}>
            <div className="ent-modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="ent-modal-head">
                <h3>Promote — {promoteTarget.firstName} {promoteTarget.lastName}</h3>
                <button className="ent-modal-close" onClick={() => setPromoteTarget(null)}><X size={18} /></button>
              </div>
              <div className="ent-modal-body">
                <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
                  Moves this student to the next grade for the year you pick below. All existing fee and payment history stays exactly as it is — only where they're currently enrolled changes going forward.
                </p>
                {promoteResult && !promoteResult.success && <div className="ent-error-box">{promoteResult.message}</div>}
                {promoteResult && promoteResult.success ? (
                  <div className="ent-success-box">
                    Promoted from Grade {promoteResult.outcome.fromGrade} to Grade {promoteResult.outcome.toGrade} ({promoteResult.outcome.toClassName}), {promoteResult.outcome.toAcademicYear}.
                  </div>
                ) : (
                  <>
                    <div className="ent-field">
                      <label>Target Academic Year</label>
                      {promoteYears.length === 0 ? (
                        <p className="ent-hint">No academic years set up yet — add one first in Fee Settings.</p>
                      ) : (
                        <select value={promoteYearId} onChange={(e) => setPromoteYearId(e.target.value)}>
                          {promoteYears.map((y) => <option key={y.yearId} value={y.yearId}>{y.label}{y.isCurrent ? ' (Current)' : ''}</option>)}
                        </select>
                      )}
                    </div>
                    <button className="ent-btn ent-btn--primary" style={{ marginTop: '0.6rem' }} disabled={promoting || !promoteYearId} onClick={confirmPromote}>
                      {promoting ? 'Promoting...' : 'Confirm Promotion'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}

      {feesTarget && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => { setFeesTarget(null); setAssignedFees([]); }}>
          <div className="ent-modal" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head">
              <h3>Assigned Fees — {feesTarget.firstName} {feesTarget.lastName}</h3>
              <button className="ent-modal-close" onClick={() => { setFeesTarget(null); setAssignedFees([]); }}><X size={18} /></button>
            </div>
            <div className="ent-modal-body">
              {feesLoading ? (
                <p className="ent-hint">Loading...</p>
              ) : assignedFees.length === 0 ? (
                <p className="ent-hint">No recurring fees currently tied to this student. Set these up in Fee Assignment Manager.</p>
              ) : (
                <div className="ent-table-wrap">
                  <table className="ent-table">
                    <thead><tr><th>Fee</th><th>Amount</th><th>Frequency</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {assignedFees.map((a) => (
                        <tr key={a.assignmentId}>
                          <td>{feeTemplatesById[a.feeTemplateId]?.itemName || a.feeTemplateId}</td>
                          <td className="ent-td-num">{money(a.amount)}</td>
                          <td>{a.frequency}</td>
                          <td><span className={`ent-badge ${a.isActive ? 'ent-badge--success' : 'ent-badge--muted'}`}>{a.isActive ? 'Active' : 'Inactive'}</span></td>
                          <td>
                            <button
                              className="ent-icon-btn ent-icon-btn--red" title="Remove"
                              disabled={removingFeeId === a.assignmentId}
                              onClick={() => handleRemoveAssignedFee(a.assignmentId)}
                            ><Trash size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="ent-hint" style={{ marginTop: '0.8rem' }}>
                Removing a tie here stops future monthly invoices for it — it doesn't touch any charges already billed.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Fee Structure Manager (Wendy) – with pagination, search, filter
// ---------------------------------------------------------------------------
function FeeStructureManagerTab({ user, school }) {
  const isAdmin = user.role === 'Superadmin' || user.role === 'Admin';
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [step, setStep] = useState(0);
  const steps = ['Fee Details', 'Pricing & Priority'];
  const emptyForm = { itemName: '', category: '', school, standardCharge: '', priorityTier: 2, frequency: 'one-time', gradePricing: [] };
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  // Pagination, search, filter
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'active', 'inactive'
  const [categoryFilter, setCategoryFilter] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      window.electronAPI.listAllFeeCatalogTemplates(school),
      window.electronAPI.listFeeCategories(school)
    ]).then(([templatesRes, categoriesRes]) => {
      if (templatesRes.success) setTemplates(templatesRes.templates);
      if (categoriesRes.success) setCategories(categoriesRes.categories.filter((c) => c.isActive !== false));
      setLoading(false);
    });
  }

  useEffect(() => {
    load();
    setForm({ ...emptyForm, school });
  }, [school]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...emptyForm, school });
    setError('');
    setStep(0);
    setShowModal(true);
  }

  function openEdit(t) {
    setEditingId(t.templateId);
    setForm({
      itemName: t.itemName, category: t.category, school: t.school,
      standardCharge: String(t.standardCharge), priorityTier: t.priorityTier, frequency: t.frequency,
      gradePricing: t.gradePricing || []
    });
    setError('');
    setStep(0);
    setShowModal(true);
  }

  function requestDelete(t) {
    setDeleteTarget(t);
  }

  async function confirmDeactivate() {
    setDeleting(true);
    try {
      const res = await window.electronAPI.updateFeeCatalogTemplate(deleteTarget.templateId, { isActive: false });
      if (res.success) {
        setTemplates((prev) => prev.map((t) => (t.templateId === deleteTarget.templateId ? res.template : t)));
        setDeleteTarget(null);
      } else {
        setError(res.message);
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  const handleAdd = async () => {
    setError('');
    if (!form.itemName || !form.standardCharge) {
      setError('Item name and charge are required.');
      return;
    }
    if (!form.category) {
      setError('Select a category — create one in Fee Settings first if none exist yet.');
      return;
    }
    const payload = { ...form, standardCharge: parseFloat(form.standardCharge), priorityTier: parseInt(form.priorityTier) };
    const res = editingId
      ? await window.electronAPI.updateFeeCatalogTemplate(editingId, payload)
      : await window.electronAPI.createFeeTemplate(payload);
    if (res.success) {
      playNotificationChime();
      if (editingId) {
        setTemplates((prev) => prev.map((t) => (t.templateId === editingId ? res.template : t)));
      } else {
        setTemplates([...templates, res.template]);
      }
      setShowModal(false);
      setEditingId(null);
      setForm({ ...emptyForm, school });
      setStep(0);
    } else {
      setError(res.message);
    }
  };

  // Filtering logic
  const filteredTemplates = useMemo(() => {
    let result = templates;
    // Status filter
    if (statusFilter === 'active') result = result.filter(t => t.isActive !== false);
    else if (statusFilter === 'inactive') result = result.filter(t => t.isActive === false);
    // Category filter (auto‑complete dropdown)
    if (categoryFilter) result = result.filter(t => t.category === categoryFilter);
    // Search term (by item name)
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(t => t.itemName.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    }
    return result;
  }, [templates, statusFilter, categoryFilter, searchTerm]);

  const paginatedTemplates = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTemplates.slice(start, start + pageSize);
  }, [filteredTemplates, page, pageSize]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, categoryFilter]);

  return (
    <div className="ent-card">
      <div className="ent-card-head">
        <h3 className="ent-card-title"><Layers size={16} /> Fee Structure Manager</h3>
        <button className="ent-btn ent-btn--primary" onClick={openAdd}><Plus size={14} /> Add Fee Template</button>
      </div>
      {error && !showModal && !deleteTarget && <div className="ent-error-box">{error}</div>}

      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '2', minWidth: '200px' }}>
          <input
            className="ent-input"
            placeholder="Search by item name or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div style={{ flex: '1', minWidth: '130px' }}>
          <select
            className="ent-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div style={{ flex: '1.2', minWidth: '140px' }}>
          <select
            className="ent-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        {categoryFilter && (
          <button
            className="ent-icon-btn ent-icon-btn--red"
            onClick={() => setCategoryFilter('')}
            title="Clear category filter"
          >
            <X size={14} />
          </button>
        )}
        {(searchTerm || statusFilter !== 'all' || categoryFilter) && (
          <button
            className="ent-btn ent-btn--secondary ent-btn--sm"
            onClick={() => { setSearchTerm(''); setStatusFilter('all'); setCategoryFilter(''); }}
          >
            Clear Filters
          </button>
        )}
      </div>

      <div className="ent-table-wrap">
        <table className="ent-table">
          <thead><tr><th>Item</th><th>Category</th><th>Charge (N$)</th><th>Priority</th><th>Frequency</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="7" className="ent-table-empty">Loading...</td></tr> :
              filteredTemplates.length === 0 ? <tr><td colSpan="7" className="ent-table-empty">No fee templates match your filters.</td></tr> :
              paginatedTemplates.map(t => (
                <tr key={t.templateId}>
                  <td>{t.itemName}</td>
                  <td>{t.category}</td>
                  <td className="ent-td-num">
                    {t.standardCharge.toFixed(2)}
                    {t.gradePricing?.length > 0 && <span className="ent-badge ent-badge--soft" style={{ marginLeft: '6px', fontSize: '0.6rem' }}>Varies by grade</span>}
                  </td>
                  <td><span className="ent-badge ent-badge--info">Tier {t.priorityTier}</span></td>
                  <td>{t.frequency}</td>
                  <td><span className={`ent-badge ${t.isActive ? 'ent-badge--success' : 'ent-badge--muted'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="ent-icon-btn ent-icon-btn--blue ent-tooltip" data-tooltip="Edit" onClick={() => openEdit(t)}><Edit2 size={13} /></button>
                      {t.isActive !== false && (
                        <button className="ent-icon-btn ent-icon-btn--red ent-tooltip" data-tooltip="Deactivate" onClick={() => requestDelete(t)}><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={filteredTemplates.length} onChange={setPage} />

      {showModal && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowModal(false)}>
          <div className="ent-modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>{editingId ? 'Edit Fee Template' : 'Add Fee Template'}</h3><button className="ent-modal-close" onClick={() => setShowModal(false)}><X size={18} /></button></div>
            <div className="ent-modal-body">
              {error && <div className="ent-error-box">{error}</div>}
              <Stepper steps={steps} currentStep={step} onStepChange={setStep}>
                {step === 0 && (
                  <div>
                    <div className="ent-field"><label>Item Name *</label><input value={form.itemName} onChange={e => setForm({...form, itemName: e.target.value})} /></div>
                    <div className="ent-field">
                      <label>Category *</label>
                      <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                        <option value="">Select a category...</option>
                        {categories.map((c) => <option key={c.categoryId} value={c.name}>{c.name}</option>)}
                      </select>
                      {categories.length === 0 && (
                        <p className="ent-hint">No categories yet for this school — create one in Fee Settings first.</p>
                      )}
                    </div>
                    <div className="ent-field">
                      <label>School Scope</label>
                      {isAdmin ? (
                        <select value={form.school} onChange={e => setForm({...form, school: e.target.value})}>
                          <option value="SHARED">Shared (Both)</option>
                          <option value="WENDY">Wendy Only</option>
                          <option value="KEILA">Keila Only</option>
                        </select>
                      ) : (
                        <>
                          <input value={school === 'WENDY' ? 'Wendy Private School' : 'Keila Academy'} disabled />
                          <p className="ent-hint">Locked to your own school — only Admin/Superadmin can create shared or cross-school templates.</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <div>
                    <div className="ent-field"><label>Standard Charge (N$) *</label><input type="number" step="0.01" value={form.standardCharge} onChange={e => setForm({...form, standardCharge: e.target.value})} /></div>
                    <div className="ent-field"><label>Priority Tier</label>
                      <select value={form.priorityTier} onChange={e => setForm({...form, priorityTier: parseInt(e.target.value)})}>
                        <option value="1">1 – Tuition/Registration</option>
                        <option value="2">2 – Bus/Hostel</option>
                        <option value="3">3 – Ad-hoc/Extracurricular</option>
                        <option value="4">4 – Fines/Discretionary</option>
                      </select>
                    </div>
                    <div className="ent-field"><label>Frequency</label>
                      <select value={form.frequency} onChange={e => setForm({...form, frequency: e.target.value})}>
                        <option value="one-time">One-time</option>
                        <option value="monthly">Monthly</option>
                        <option value="termly">Termly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div className="ent-field">
                      <label>Grade-Specific Pricing (optional)</label>
                      <p className="ent-hint" style={{ marginBottom: '0.5rem' }}>
                        Only needed if this fee costs different amounts by grade — e.g. Pre-Primary pays less than Grade 12 for the same Tuition item. Any grade not covered below just uses the Standard Charge.
                      </p>
                      {form.gradePricing.map((tier, i) => (
                        <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                          <input type="number" placeholder="From grade" value={tier.minGrade} style={{ width: '90px' }}
                            onChange={(e) => { const gp = [...form.gradePricing]; gp[i] = { ...gp[i], minGrade: parseInt(e.target.value) || 0 }; setForm({ ...form, gradePricing: gp }); }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--c-muted)' }}>to</span>
                          <input type="number" placeholder="To grade" value={tier.maxGrade} style={{ width: '90px' }}
                            onChange={(e) => { const gp = [...form.gradePricing]; gp[i] = { ...gp[i], maxGrade: parseInt(e.target.value) || 0 }; setForm({ ...form, gradePricing: gp }); }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--c-muted)' }}>=</span>
                          <input type="number" step="0.01" placeholder="N$" value={tier.amount} style={{ width: '110px' }}
                            onChange={(e) => { const gp = [...form.gradePricing]; gp[i] = { ...gp[i], amount: parseFloat(e.target.value) || 0 }; setForm({ ...form, gradePricing: gp }); }} />
                          <button type="button" className="ent-icon-btn ent-icon-btn--red" onClick={() => setForm({ ...form, gradePricing: form.gradePricing.filter((_, idx) => idx !== i) })}><X size={12} /></button>
                        </div>
                      ))}
                      <button type="button" className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setForm({ ...form, gradePricing: [...form.gradePricing, { minGrade: 0, maxGrade: 6, amount: 0 }] })}>
                        <Plus size={12} /> Add Grade Range
                      </button>
                    </div>
                  </div>
                )}
              </Stepper>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                <button className="ent-btn ent-btn--secondary" onClick={() => setStep(s => Math.max(0, s-1))} disabled={step===0}>Back</button>
                {step < steps.length - 1 ?
                  <button className="ent-btn ent-btn--primary" onClick={() => setStep(s => s+1)}>Next</button> :
                  <button className="ent-btn ent-btn--primary" onClick={handleAdd}>Save</button>
                }
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="danger"
        title="Deactivate Fee Template"
        message="This deactivates the template — it stops appearing when charging students, but stays visible here (and can be reactivated) so nothing that already referenced it is affected."
        detailBlock={deleteTarget && (
          <>
            <strong>{deleteTarget.itemName}</strong><br />
            {deleteTarget.category} &bull; N${deleteTarget.standardCharge?.toFixed(2)}
          </>
        )}
        confirmLabel={deleting ? 'Deactivating...' : 'Deactivate Template'}
        cancelLabel="Keep It"
        confirming={deleting}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Fee Assignment Manager — tie a fee to many students at once, then
// generate this month's invoices for everyone already tied. No more
// re-selecting students every month: tie once, invoice repeatedly.
// ---------------------------------------------------------------------------
function FeeAssignmentManagerTab({ user }) {
  const school = user.section === 'Both' ? 'WENDY' : user.section;

  // --- Student selection (same filter+checkbox pattern as Student Records,
  // so tying a fee to "everyone in Grade 8" is a filter + select-all, not
  // 200 individual clicks) ---
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // --- Fee template + tie action (recurring mode) ---
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [tying, setTying] = useState(false);
  const [tieResult, setTieResult] = useState(null);
  const [tieError, setTieError] = useState('');

  // --- One-time fee mode (Registration, Uniform, a school trip — with an
  // optional installment split for parents who can't pay it all at once) ---
  const [billingMode, setBillingMode] = useState('recurring'); // 'recurring' | 'oneTime'
  const [oneTimeItemName, setOneTimeItemName] = useState('');
  const [oneTimeTemplateId, setOneTimeTemplateId] = useState('');
  const [oneTimeCategory, setOneTimeCategory] = useState('');
  const [oneTimeAmount, setOneTimeAmount] = useState('');
  const [oneTimeDueDate, setOneTimeDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitInstallments, setSplitInstallments] = useState(false);
  const [numberOfInstallments, setNumberOfInstallments] = useState(3);
  const [billing, setBilling] = useState(false);
  const [billResult, setBillResult] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [billError, setBillError] = useState('');

  // --- Monthly invoice generation ---
  const [billingPeriod, setBillingPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [invoiceError, setInvoiceError] = useState('');

  function loadStudents() {
    setLoadingStudents(true);
    const filters = { school, attachFinancials: false };
    if (gradeFilter) filters.gradeLevel = gradeFilter;
    window.electronAPI.getStudentsByFilters(filters).then((res) => {
      if (res.success) setStudents(res.students);
      setLoadingStudents(false);
    });
  }

  useEffect(() => { loadStudents(); }, [school, gradeFilter]);
  useEffect(() => {
    window.electronAPI.listFeeCatalogTemplates(school).then((res) => { if (res.success) setTemplates(res.templates); });
  }, [school]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q)
    );
  }, [students, searchTerm]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleSelectAllVisible() {
    const visibleIds = paged.map((s) => s.studentId);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => (allSelected ? prev.filter((id) => !visibleIds.includes(id)) : [...new Set([...prev, ...visibleIds])]));
  }
  function selectAllFiltered() {
    // Ties every student matching the current search/grade filter, not
    // just the current page — this is the "500 students, fast" path.
    setSelectedIds(filtered.map((s) => s.studentId));
  }

  async function handleTie() {
    setTieError('');
    setTieResult(null);
    if (!selectedTemplateId) { setTieError('Select a fee first.'); return; }
    if (selectedIds.length === 0) { setTieError('Select at least one student.'); return; }
    const template = templates.find((t) => t.templateId === selectedTemplateId);
    setTying(true);
    try {
      const assignments = await window.electronAPI.bulkAssignFee({
        studentIds: selectedIds, feeTemplateId: selectedTemplateId,
        frequency: template.frequency,
        startDate: new Date().toISOString().slice(0, 10)
      });
      playNotificationChime();
      setTieResult({ count: Array.isArray(assignments) ? assignments.length : selectedIds.length, feeName: template.itemName });
      setSelectedIds([]);
    } catch (err) {
      setTieError(err.message || 'Could not tie the fee to the selected students.');
    } finally {
      setTying(false);
    }
  }

  async function handleBillOneTime() {
    setBillError('');
    setBillResult(null);
    if (!oneTimeItemName || !oneTimeCategory) { setBillError('Item name and category are required.'); return; }
    if (!(Number(oneTimeAmount) > 0)) { setBillError('Enter an amount greater than 0.'); return; }
    if (selectedIds.length === 0) { setBillError('Select at least one student.'); return; }

    setCheckingDuplicates(true);
    try {
      const dupRes = await window.electronAPI.checkDuplicateCharges({
        studentIds: selectedIds, category: oneTimeCategory, description: oneTimeItemName
      });
      if (dupRes.success && dupRes.duplicateStudentIds.length > 0) {
        const names = dupRes.duplicateStudentIds.map((id) => {
          const s = students.find((st) => st.studentId === id);
          return s ? `${s.firstName} ${s.lastName}` : id;
        });
        setDuplicateWarning({ names, studentIds: dupRes.duplicateStudentIds });
        return; // wait for the secretary's decision — never bill silently past a flagged duplicate
      }
    } finally {
      setCheckingDuplicates(false);
    }
    await proceedWithBilling();
  }

  async function proceedWithBilling() {
    setDuplicateWarning(null);
    setBilling(true);
    try {
      if (splitInstallments) {
        const res = await window.electronAPI.bulkCreateInstallmentPlans({
          studentIds: selectedIds, school, category: oneTimeCategory, description: oneTimeItemName,
          totalAmount: Number(oneTimeAmount), numberOfInstallments: Number(numberOfInstallments),
          startDate: oneTimeDueDate, priorityTier: 3,
          ...(oneTimeTemplateId ? { templateId: oneTimeTemplateId } : {})
        });
        if (!res.success) { setBillError(res.message); return; }
        playNotificationChime();
        setBillResult({ students: res.studentsCount, note: `split into ${numberOfInstallments} installments each` });
      } else {
        const res = await window.electronAPI.bulkCreateFeeExpectations({
          studentIds: selectedIds, school, category: oneTimeCategory, description: oneTimeItemName,
          amount: Number(oneTimeAmount), dueDate: oneTimeDueDate, priorityTier: 3,
          ...(oneTimeTemplateId ? { templateId: oneTimeTemplateId } : {})
        });
        if (!res.success) { setBillError(res.message); return; }
        playNotificationChime();
        setBillResult({ students: res.studentsCount, note: 'billed in full' });
      }
      setSelectedIds([]);
      setOneTimeTemplateId('');
    } finally {
      setBilling(false);
    }
  }

  async function handleGenerateInvoices() {
    setInvoiceError('');
    setInvoiceResult(null);
    setGenerating(true);
    try {
      const res = await window.electronAPI.generateMonthlyInvoices({ school, billingPeriod });
      if (!res.success) { setInvoiceError(res.message); return; }
      playNotificationChime();
      setInvoiceResult(res.result);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <h3 className="ent-card-title"><Calendar size={16} /> Generate This Month's Invoices</h3>
        <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
          Every student already tied to a monthly fee below gets billed in one click — nobody needs to be re-selected. Safe to run more than once for the same month: already-invoiced students are automatically skipped, never billed twice.
        </p>
        {invoiceError && <div className="ent-error-box">{invoiceError}</div>}
        {invoiceResult && (
          <div className="ent-success-box">
            {invoiceResult.created > 0
              ? `Generated ${invoiceResult.created} invoice(s) for ${invoiceResult.billingPeriod}.`
              : `Nothing new to invoice for ${invoiceResult.billingPeriod}.`}
            {invoiceResult.skippedAlreadyInvoiced > 0 && ` ${invoiceResult.skippedAlreadyInvoiced} student(s) were already invoiced this period and were skipped.`}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end' }}>
          <div className="ent-field" style={{ maxWidth: '180px' }}>
            <label>Billing Month</label>
            <input type="month" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} />
          </div>
          <button className="ent-btn ent-btn--primary" onClick={handleGenerateInvoices} disabled={generating}>
            <FileText size={14} /> {generating ? 'Generating...' : 'Generate Invoices'}
          </button>
        </div>
      </div>

      <div className="ent-card" style={{ position: 'relative', paddingBottom: selectedIds.length > 0 ? '4rem' : undefined }}>
        <h3 className="ent-card-title"><ClipboardList size={16} /> Bill or Tie a Fee to Students</h3>

        <div className="ent-tabs" style={{ marginBottom: '1rem' }}>
          <button type="button" className={`ent-tab ${billingMode === 'recurring' ? 'is-active' : ''}`} onClick={() => setBillingMode('recurring')}>Recurring Fee (Tuition, etc.)</button>
          <button type="button" className={`ent-tab ${billingMode === 'oneTime' ? 'is-active' : ''}`} onClick={() => setBillingMode('oneTime')}>One-Time Fee (Uniform, Registration...)</button>
        </div>

        {billingMode === 'recurring' ? (
          <>
            <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
              This is the one-time setup — e.g. "John is tied to Tuition." Once tied, it stays tied every month until removed; the invoice generator above is what actually bills it, month after month, with no re-tying needed.
            </p>
            {tieError && <div className="ent-error-box">{tieError}</div>}
            {tieResult && <div className="ent-success-box">Tied {tieResult.feeName} to {tieResult.count} student(s).</div>}
            <div className="ent-field" style={{ marginBottom: '1rem' }}>
              <label>Fee to Tie</label>
              <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                <option value="">Select a fee...</option>
                {templates.map((t) => <option key={t.templateId} value={t.templateId}>{t.itemName} — {money(t.standardCharge)} ({t.frequency})</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
              For a fee that's billed once but not every parent can pay in full right away — e.g. a N$450 Uniform fee split into 3 monthly installments per student. Bills immediately (unlike the recurring tab, there's no separate "generate invoices" step).
            </p>
            {billError && <div className="ent-error-box">{billError}</div>}
            {billResult && <div className="ent-success-box">Billed {billResult.students} student(s) — {billResult.note}.</div>}
            <div className="ent-field" style={{ marginBottom: '0.8rem' }}>
              <label>Pick from the fee catalog (optional)</label>
              <select
                value={oneTimeTemplateId}
                onChange={(e) => {
                  const id = e.target.value;
                  setOneTimeTemplateId(id);
                  const picked = templates.find((t) => t.templateId === id);
                  if (picked) {
                    setOneTimeItemName(picked.itemName);
                    setOneTimeCategory(picked.category);
                    setOneTimeAmount(String(picked.standardCharge));
                  }
                }}
              >
                <option value="">Type a custom item instead...</option>
                {templates.filter((t) => t.frequency !== 'monthly').map((t) => (
                  <option key={t.templateId} value={t.templateId}>{t.itemName} — N${t.standardCharge.toFixed(2)}</option>
                ))}
              </select>
              <p className="ent-hint">Picking one links this charge back to that catalog item, so it shows up correctly in fee revenue reports later — typing a custom item still works fine, it just won't be linked.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
              <div className="ent-field"><label>Item Name</label><input value={oneTimeItemName} onChange={(e) => { setOneTimeItemName(e.target.value); setOneTimeTemplateId(''); }} placeholder="e.g. School Uniform" /></div>
              <div className="ent-field"><label>Category</label><input value={oneTimeCategory} onChange={(e) => { setOneTimeCategory(e.target.value); setOneTimeTemplateId(''); }} placeholder="e.g. Uniform" /></div>
              <div className="ent-field"><label>Total Amount (N$)</label><input type="number" step="0.01" value={oneTimeAmount} onChange={(e) => setOneTimeAmount(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
              <div className="ent-field" style={{ maxWidth: '180px' }}><label>Due Date</label><input type="date" value={oneTimeDueDate} onChange={(e) => setOneTimeDueDate(e.target.value)} /></div>
              <Toggle checked={splitInstallments} onChange={setSplitInstallments} label="Split into installments" id="split-installments" />
              {splitInstallments && (
                <div className="ent-field" style={{ maxWidth: '180px' }}>
                  <label>Number of Installments</label>
                  <select value={numberOfInstallments} onChange={(e) => setNumberOfInstallments(e.target.value)}>
                    <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={6}>6</option>
                  </select>
                </div>
              )}
            </div>
            {splitInstallments && oneTimeAmount > 0 && (
              <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
                Each student pays {money(Math.floor((Number(oneTimeAmount) / numberOfInstallments) * 100) / 100)} per installment, one month apart, starting {oneTimeDueDate}.
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div className="ent-field" style={{ flex: 1, minWidth: '140px' }}>
            <label>Grade</label>
            <input type="number" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} placeholder="Any" />
          </div>
          <div className="ent-field" style={{ flex: 2, minWidth: '220px' }}>
            <label>Search</label>
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Name or admission no..." />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span className="ent-hint">{filtered.length} student(s) match this filter — {selectedIds.length} selected</span>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={selectAllFiltered} disabled={filtered.length === 0}>
            <CheckSquare size={13} /> Select All {filtered.length} Matching
          </button>
        </div>

        <div className="ent-table-wrap">
          <table className="ent-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}><input type="checkbox" checked={paged.length > 0 && paged.every((s) => selectedIds.includes(s.studentId))} onChange={toggleSelectAllVisible} /></th>
                <th>Admission No</th><th>Name</th><th>Grade</th><th>Class</th>
              </tr>
            </thead>
            <tbody>
              {loadingStudents ? <tr><td colSpan="5" className="ent-table-empty">Loading...</td></tr> :
                paged.length === 0 ? <tr><td colSpan="5" className="ent-table-empty">No students match.</td></tr> :
                paged.map((s) => (
                  <tr key={s.studentId}>
                    <td><input type="checkbox" checked={selectedIds.includes(s.studentId)} onChange={() => toggleSelect(s.studentId)} /></td>
                    <td className="ent-td-mono">{s.studentNumber}</td>
                    <td><strong>{s.firstName} {s.lastName}</strong></td>
                    <td>{s.gradeLevel !== undefined && s.gradeLevel !== null ? s.gradeLevel : '—'}</td>
                    <td>{s.className || '—'}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} />

        {selectedIds.length > 0 && (
          <div style={{
            position: 'sticky', bottom: 0, left: 0, right: 0, marginTop: '1rem',
            background: '#1e293b', borderRadius: 'var(--r-lg)', padding: '0.8rem 1.2rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 -4px 16px rgba(0,0,0,0.15)'
          }}>
            <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>{selectedIds.length} selected</span>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setSelectedIds([])}>Clear Selection</button>
              {billingMode === 'recurring' ? (
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleTie} disabled={tying}>
                  <Plus size={14} /> {tying ? 'Tying...' : `Tie Fee to ${selectedIds.length} Student(s)`}
                </button>
              ) : (
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleBillOneTime} disabled={billing || checkingDuplicates}>
                  <DollarSign size={14} /> {billing ? 'Billing...' : checkingDuplicates ? 'Checking...' : `Bill ${selectedIds.length} Student(s)`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {duplicateWarning && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setDuplicateWarning(null)}>
          <div className="ent-modal" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Already Billed This Month</h3></div>
            <div className="ent-modal-body">
              <p style={{ fontSize: '0.85rem', marginBottom: '0.7rem' }}>
                {duplicateWarning.names.length} student{duplicateWarning.names.length !== 1 ? 's' : ''} already {duplicateWarning.names.length !== 1 ? 'have' : 'has'} a "{oneTimeItemName}" charge this month:
              </p>
              <ul style={{ fontSize: '0.82rem', marginBottom: '0.9rem', paddingLeft: '1.2rem' }}>
                {duplicateWarning.names.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
              <p className="ent-hint" style={{ marginBottom: '1rem' }}>
                If this is a genuinely new instance — a replacement uniform, an extra activity fee — billing again is fine. If it's an accidental repeat, cancel and adjust the selection instead.
              </p>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setDuplicateWarning(null)}>Cancel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={proceedWithBilling} disabled={billing}>
                  {billing ? 'Billing...' : 'Bill Everyone Anyway'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fee Allocation Manager (by Student) – kept as-is; still used by Keila's
// Account Management tab for viewing/removing a single student's ties.
// ---------------------------------------------------------------------------
function FeeAllocationManagerTab({ user }) {
  const [studentId, setStudentId] = useState('');
  const [assignments, setAssignments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadAssignments = async () => {
    if (!studentId) return;
    setLoading(true);
    const res = await window.electronAPI.listFeeAssignments(studentId);
    if (res.success) setAssignments(res.assignments);
    setLoading(false);
  };

  useEffect(() => {
    window.electronAPI.listFeeCatalogTemplates(user.section).then(res => {
      if (res.success) setTemplates(res.templates);
    });
  }, [user.section]);

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><DollarSign size={16} /> Fee Allocation Manager</h3>
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end' }}>
        <div className="ent-field" style={{ flex: 1 }}>
          <label>Student</label>
          <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="Student ID" />
        </div>
        <button className="ent-btn ent-btn--primary" onClick={loadAssignments}>Load</button>
      </div>
      {loading && <div className="ent-skeleton" style={{ height: '30px' }} />}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {templates.map(t => (
            <button key={t.templateId} className="ent-btn ent-btn--secondary ent-btn--sm" onClick={async () => {
              if (!studentId) return;
              const res = await window.electronAPI.bulkAssignFee({
                studentIds: [studentId],
                feeTemplateId: t.templateId,
                frequency: t.frequency,
                startDate: new Date().toISOString().slice(0,10)
              });
              if (res.success) {
                playNotificationChime();
                loadAssignments();
              }
            }}><Plus size={12} /> {t.itemName}</button>
          ))}
        </div>
        <div className="ent-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="ent-table"><thead><tr><th>Fee</th><th>Amount</th><th>Frequency</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {assignments.map(a => (
                <tr key={a.assignmentId}>
                  <td>{a.feeTemplateId}</td>
                  <td className="ent-td-num">{a.amount}</td>
                  <td>{a.frequency}</td>
                  <td><span className={`ent-badge ${a.isActive ? 'ent-badge--success' : 'ent-badge--muted'}`}>{a.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td><button className="ent-icon-btn ent-icon-btn--red" onClick={async () => {
                    await window.electronAPI.bulkRemoveFee({ assignmentIds: [a.assignmentId] });
                    playNotificationChime();
                    loadAssignments();
                  }}><Trash size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Bulk Operations (Wendy)
// ---------------------------------------------------------------------------
function BulkOperationsTab({ user }) {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionResult, setActionResult] = useState('');
  const [busy, setBusy] = useState(false);

  const [showBusModal, setShowBusModal] = useState(false);
  const [busType, setBusType] = useState('Grade 1-12');
  const [showHostelModal, setShowHostelModal] = useState(false);
  const [hostelType, setHostelType] = useState('Boarding');
  const [showClassModal, setShowClassModal] = useState(false);
  const [targetClassId, setTargetClassId] = useState('');
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState('');

  function load() {
    setLoading(true);
    window.electronAPI.listStudents(user.section).then(res => {
      if (res.success) setStudents(res.students);
      setLoading(false);
    });
  }
  useEffect(() => { load(); }, [user.section]);
  useEffect(() => { window.electronAPI.listClasses(user.section).then(res => { if (res.success) setClasses(res.classes); }); }, [user.section]);

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleAll = () => setSelected(selected.length === students.length ? [] : students.map(s => s.studentId));

  function afterAction(message) {
    setActionResult(message);
    setSelected([]);
    load();
  }

  async function handleAssignBus() {
    setActionError(''); setBusy(true);
    try {
      const res = await window.electronAPI.bulkUpdateStudents(selected, { usesBus: true, busType });
      if (!res.success) { setActionError(res.message); return; }
      setShowBusModal(false);
      afterAction(`Assigned bus (${busType}) to ${res.updated} student(s).`);
    } finally { setBusy(false); }
  }

  async function handleAssignHostel() {
    setActionError(''); setBusy(true);
    try {
      const res = await window.electronAPI.bulkUpdateStudents(selected, { isHostelite: true, hostelType });
      if (!res.success) { setActionError(res.message); return; }
      setShowHostelModal(false);
      afterAction(`Assigned hostel (${hostelType}) to ${res.updated} student(s).`);
    } finally { setBusy(false); }
  }

  async function handleMoveClass() {
    if (!targetClassId) { setActionError('Select a class.'); return; }
    setActionError(''); setBusy(true);
    try {
      const res = await window.electronAPI.bulkUpdateStudents(selected, { classId: targetClassId });
      if (!res.success) { setActionError(res.message); return; }
      setShowClassModal(false);
      const cls = classes.find(c => c.classId === targetClassId);
      afterAction(`Moved ${res.updated} student(s) to ${cls?.className || 'the selected class'}.`);
    } finally { setBusy(false); }
  }

  async function handleDeactivate() {
    if (!deactivateReason.trim()) { setActionError('A reason is required.'); return; }
    setActionError(''); setBusy(true);
    try {
      let count = 0;
      for (const studentId of selected) {
        const res = await window.electronAPI.requestStudentDeletion({ studentId, reason: deactivateReason.trim(), requestedBy: user.username });
        if (res.success) count++;
      }
      setShowDeactivateModal(false);
      setDeactivateReason('');
      afterAction(`Submitted deactivation requests for ${count} student(s) — pending Admin/Superadmin approval.`);
    } finally { setBusy(false); }
  }

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><CheckSquare size={16} /> Bulk Operations</h3>
      <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>Select students below, then choose an action. Fee-related bulk actions (tying a fee, one-time billing) live in Fee Assignment Manager.</p>
      {actionError && <div className="ent-error-box">{actionError}</div>}
      {actionResult && <div className="ent-success-box">{actionResult}</div>}
      <div className="ent-btn-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className="ent-btn ent-btn--primary" disabled={selected.length === 0} onClick={() => setShowBusModal(true)}>Assign Bus</button>
        <button className="ent-btn ent-btn--primary" disabled={selected.length === 0} onClick={() => setShowHostelModal(true)}>Assign Hostel</button>
        <button className="ent-btn ent-btn--secondary" disabled={selected.length === 0} onClick={() => setShowClassModal(true)}>Move to Class</button>
        <button className="ent-btn ent-btn--danger" disabled={selected.length === 0} onClick={() => setShowDeactivateModal(true)}>Request Deactivation</button>
      </div>
      <div className="ent-table-wrap">
        <table className="ent-table">
          <thead><tr><th><input type="checkbox" checked={selected.length === students.length && students.length > 0} onChange={toggleAll} /></th><th>Name</th><th>Number</th><th>Class</th><th>Status</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="5" className="ent-table-empty">Loading...</td></tr> :
              students.map(s => (
                <tr key={s.studentId}>
                  <td><input type="checkbox" checked={selected.includes(s.studentId)} onChange={() => toggleSelect(s.studentId)} /></td>
                  <td>{s.firstName} {s.lastName}</td>
                  <td className="ent-td-mono">{s.studentNumber}</td>
                  <td>{s.className || '—'}</td>
                  <td><span className={`ent-badge ${s.enrollmentStatus === 'Active' ? 'ent-badge--success' : 'ent-badge--muted'}`}>{s.enrollmentStatus}</span></td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '0.5rem' }}>Selected: {selected.length} students</div>

      {showBusModal && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowBusModal(false)}>
          <div className="ent-modal" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Assign Bus to {selected.length} Student(s)</h3></div>
            <div className="ent-modal-body">
              <div className="ent-field"><label>Bus Type</label>
                <select value={busType} onChange={e => setBusType(e.target.value)}><option>Kinder</option><option>Pre-Grade</option><option>Grade 1-12</option></select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowBusModal(false)}>Cancel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleAssignBus} disabled={busy}>{busy ? 'Applying...' : 'Assign'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHostelModal && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowHostelModal(false)}>
          <div className="ent-modal" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Assign Hostel to {selected.length} Student(s)</h3></div>
            <div className="ent-modal-body">
              <div className="ent-field"><label>Hostel Type</label>
                <select value={hostelType} onChange={e => setHostelType(e.target.value)}><option>Boarding</option><option>Day Care</option><option>Full-Time</option></select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowHostelModal(false)}>Cancel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleAssignHostel} disabled={busy}>{busy ? 'Applying...' : 'Assign'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClassModal && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowClassModal(false)}>
          <div className="ent-modal" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Move {selected.length} Student(s) to a Class</h3></div>
            <div className="ent-modal-body">
              <div className="ent-field"><label>Target Class</label>
                <select value={targetClassId} onChange={e => setTargetClassId(e.target.value)}>
                  <option value="">Select a class...</option>
                  {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
                </select>
                {classes.length === 0 && <p className="ent-hint">No classes exist yet — create one first.</p>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowClassModal(false)}>Cancel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleMoveClass} disabled={busy}>{busy ? 'Applying...' : 'Move'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeactivateModal && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowDeactivateModal(false)}>
          <div className="ent-modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Request Deactivation for {selected.length} Student(s)</h3></div>
            <div className="ent-modal-body">
              <p className="ent-hint" style={{ marginBottom: '0.6rem' }}>Each student's request goes to Admin/Superadmin for approval — nothing changes until it's approved.</p>
              <div className="ent-field"><label>Reason *</label><textarea rows={3} value={deactivateReason} onChange={e => setDeactivateReason(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowDeactivateModal(false)}>Cancel</button>
                <button className="ent-btn ent-btn--danger ent-btn--sm" onClick={handleDeactivate} disabled={busy}>{busy ? 'Submitting...' : 'Submit Requests'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Financial Ledger (shared)
// ---------------------------------------------------------------------------
function FinancialLedgerTab({ user, school }) {
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchAnchorRef = useRef(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.electronAPI.listStudents(user.section).then((res) => { if (res.success) setStudents(res.students); });
  }, [user.section]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [students, query]);

  async function selectStudent(s) {
    setSelectedStudent(s);
    setQuery(`${s.firstName} ${s.lastName}`);
    setShowResults(false);
    setError('');
    setLoading(true);
    const res = await window.electronAPI.getStudentStatementData(s.studentId);
    setLoading(false);
    if (res.success) setStatement(res.data);
    else setError(res.message);
  }

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><FileText size={16} /> Student Financial Ledger</h3>
      <div className="ent-autocomplete" style={{ marginBottom: '1rem' }}>
        <div className="ent-autocomplete-input-wrap" ref={searchAnchorRef}>
          <Search size={15} />
          <input
            className="ent-input" placeholder="Search by name or student number..."
            value={query} onChange={(e) => { setQuery(e.target.value); setShowResults(true); }} onFocus={() => setShowResults(true)}
          />
        </div>
        {showResults && query && (
          <AutocompleteDropdown anchorRef={searchAnchorRef}>
            {filteredStudents.length === 0 ? (
              <div className="ent-autocomplete-empty">No matching students.</div>
            ) : filteredStudents.map((s) => (
              <div key={s.studentId} className="ent-autocomplete-item" onClick={() => selectStudent(s)}>
                <span>{s.firstName} {s.lastName}</span><small>{s.studentNumber}</small>
              </div>
            ))}
          </AutocompleteDropdown>
        )}
      </div>
      {error && <div className="ent-error-box">{error}</div>}
      {loading && <div className="ent-skeleton" style={{ height: '40px' }} />}
      {statement && !loading && (
        <div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div><strong>Balance:</strong> {money(statement.ledger.balance)}</div>
            <div><strong>Status:</strong> <span className={`ent-badge ${statement.ledger.status === 'Good' || statement.ledger.status === 'Overpaid' ? 'ent-badge--success' : 'ent-badge--muted'}`}>{statement.ledger.status}</span></div>
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
              <tbody>
                {statement.transactions.length === 0 ? (
                  <tr><td colSpan={5} className="ent-table-empty">No transactions yet.</td></tr>
                ) : statement.transactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: '0.78rem' }}>{t.date}</td>
                    <td style={{ fontSize: '0.82rem' }}>{t.description}</td>
                    <td className="ent-td-num">{t.debit ? money(t.debit) : ''}</td>
                    <td className="ent-td-num">{t.credit ? money(t.credit) : ''}</td>
                    <td className="ent-td-num">{money(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Fee Settings (shared)
// ---------------------------------------------------------------------------
function FeeSettingsTab({ user, school }) {
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });

  const isWendy = school === 'WENDY';
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [years, setYears] = useState([]);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [newYear, setNewYear] = useState({ label: '', startDate: '', endDate: '' });
  const [yearError, setYearError] = useState('');
  const [savingYear, setSavingYear] = useState(false);
  const [terms, setTerms] = useState([]);
  const [selectedYearForTerm, setSelectedYearForTerm] = useState('');
  const [newTerm, setNewTerm] = useState({ label: '', startDate: '', endDate: '' });
  const [termError, setTermError] = useState('');
  const [savingTerm, setSavingTerm] = useState(false);
  const [generatingTermId, setGeneratingTermId] = useState('');
  const [termGenResult, setTermGenResult] = useState(null);
  const emptyClassForm = { className: '', gradeLevel: '', section: '', academicYear: new Date().getFullYear().toString(), monthlyTuitionFee: '' };
  const [classForm, setClassForm] = useState(emptyClassForm);
  const [classError, setClassError] = useState('');
  const [savingClass, setSavingClass] = useState(false);

  function loadYears() {
    setYearsLoading(true);
    window.electronAPI.listAcademicYears(school).then((res) => {
      if (res.success) {
        setYears(res.years);
        if (res.years.length > 0 && !selectedYearForTerm) setSelectedYearForTerm(res.years[0].yearId);
      }
      setYearsLoading(false);
    });
  }
  useEffect(() => { loadYears(); }, [school]);

  useEffect(() => {
    if (!selectedYearForTerm) { setTerms([]); return; }
    window.electronAPI.listTerms(school, selectedYearForTerm).then((res) => { if (res.success) setTerms(res.terms); });
  }, [school, selectedYearForTerm]);

  async function handleAddYear() {
    setYearError('');
    if (!newYear.label.trim()) { setYearError('A label is required, e.g. "2027".'); return; }
    setSavingYear(true);
    try {
      const res = await window.electronAPI.createAcademicYear({ school, ...newYear, makeCurrent: years.length === 0 });
      if (!res.success) { setYearError(res.message); return; }
      setNewYear({ label: '', startDate: '', endDate: '' });
      loadYears();
      playNotificationChime();
    } finally {
      setSavingYear(false);
    }
  }

  async function handleSetCurrentYear(yearId) {
    await window.electronAPI.setCurrentAcademicYear(school, yearId);
    loadYears();
  }

  async function handleAddTerm() {
    setTermError('');
    if (!selectedYearForTerm) { setTermError('Pick an academic year first.'); return; }
    if (!newTerm.label.trim() || !newTerm.startDate || !newTerm.endDate) { setTermError('A term needs a label and both dates.'); return; }
    setSavingTerm(true);
    try {
      const res = await window.electronAPI.createTerm({ school, yearId: selectedYearForTerm, ...newTerm });
      if (!res.success) { setTermError(res.message); return; }
      setNewTerm({ label: '', startDate: '', endDate: '' });
      const termsRes = await window.electronAPI.listTerms(school, selectedYearForTerm);
      if (termsRes.success) setTerms(termsRes.terms);
      playNotificationChime();
    } finally {
      setSavingTerm(false);
    }
  }

  async function handleGenerateTermlyInvoices(termId) {
    setGeneratingTermId(termId);
    setTermGenResult(null);
    try {
      const res = await window.electronAPI.generateTermlyInvoices({ school, termId });
      if (res.success) {
        setTermGenResult({ termId, ...res.result });
        playNotificationChime();
      }
    } finally {
      setGeneratingTermId('');
    }
  }

  useEffect(() => {
    window.electronAPI.listFeeCategories(school).then(res => {
      if (res.success) setCategories(res.categories);
    });
  }, [school]);

  useEffect(() => {
    if (!isWendy) return;
    setClassesLoading(true);
    window.electronAPI.listClasses(school).then(res => {
      if (res.success) setClasses(res.classes);
      setClassesLoading(false);
    });
  }, [school, isWendy]);

  const addCategory = async () => {
    if (!newCategory.name) return;
    const res = await window.electronAPI.createFeeCategory({ ...newCategory, school });
    if (res.success) {
      setCategories([...categories, res.category]);
      setNewCategory({ name: '', description: '' });
      playNotificationChime();
    }
  };

  async function handleAddClass() {
    setClassError('');

    if (!classForm.className.trim()) { setClassError('Class name is required (e.g. "Grade 8A" or "Pre-Primary A").'); return; }
    if (classForm.gradeLevel === '') { setClassError('Grade level is required — this is what grade-specific fee pricing uses to know which price applies.'); return; }
    setSavingClass(true);
    try {
      const res = await window.electronAPI.createClass({
        school, className: classForm.className.trim(), gradeLevel: parseInt(classForm.gradeLevel),
        section: classForm.section.trim(), academicYear: classForm.academicYear,
        monthlyTuitionFee: classForm.monthlyTuitionFee ? parseFloat(classForm.monthlyTuitionFee) : undefined
      });
      if (!res.success) { setClassError(res.message); return; }
      playNotificationChime();
      setClasses((prev) => [...prev, res.class]);
      setClassForm(emptyClassForm);
    } finally {
      setSavingClass(false);
    }
  }

  return (
    <div>
      {isWendy && (
        <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
          <h3 className="ent-card-title"><Calendar size={16} /> Academic Years &amp; Terms</h3>
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            One year is always "current" — that's what new registrations and new billing default to, so there's never a question of which year something belongs to.
          </p>
          {yearError && <div className="ent-error-box">{yearError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.6rem', alignItems: 'end', marginBottom: '1rem' }}>
            <div className="ent-field"><label>Year Label *</label><input value={newYear.label} onChange={(e) => setNewYear({ ...newYear, label: e.target.value })} placeholder="e.g. 2027" /></div>
            <div className="ent-field"><label>Start Date</label><input type="date" value={newYear.startDate} onChange={(e) => setNewYear({ ...newYear, startDate: e.target.value })} /></div>
            <div className="ent-field"><label>End Date</label><input type="date" value={newYear.endDate} onChange={(e) => setNewYear({ ...newYear, endDate: e.target.value })} /></div>
            <button className="ent-btn ent-btn--primary" onClick={handleAddYear} disabled={savingYear} style={{ marginBottom: '1rem' }}>
              <Plus size={14} /> {savingYear ? 'Adding...' : 'Add Year'}
            </button>
          </div>
          <div className="ent-table-wrap" style={{ marginBottom: '1.2rem' }}>
            <table className="ent-table">
              <thead><tr><th>Year</th><th>Dates</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {yearsLoading ? <tr><td colSpan={4} className="ent-table-empty">Loading...</td></tr> :
                  years.length === 0 ? <tr><td colSpan={4} className="ent-table-empty">No academic years created yet.</td></tr> :
                  years.map((y) => (
                    <tr key={y.yearId}>
                      <td style={{ fontWeight: 600 }}>{y.label}</td>
                      <td style={{ fontSize: '0.78rem' }}>{y.startDate || '—'} to {y.endDate || '—'}</td>
                      <td>{y.isCurrent ? <span className="ent-badge ent-badge--success">Current</span> : <span className="ent-badge ent-badge--muted">Inactive</span>}</td>
                      <td>{!y.isCurrent && <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => handleSetCurrentYear(y.yearId)}>Make Current</button>}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          <div style={{ borderTop: '1px solid var(--c-border-soft)', paddingTop: '1rem' }}>
            <p className="ent-hint" style={{ marginBottom: '0.6rem' }}>Terms within a year — what termly fees (like a per-term activity fee) actually bill against.</p>
            {termError && <div className="ent-error-box">{termError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '0.6rem', alignItems: 'end', marginBottom: '1rem' }}>
              <div className="ent-field"><label>For Year</label>
                <select value={selectedYearForTerm} onChange={(e) => setSelectedYearForTerm(e.target.value)}>
                  {years.map((y) => <option key={y.yearId} value={y.yearId}>{y.label}</option>)}
                </select>
              </div>
              <div className="ent-field"><label>Term Label *</label><input value={newTerm.label} onChange={(e) => setNewTerm({ ...newTerm, label: e.target.value })} placeholder="e.g. Term 1" /></div>
              <div className="ent-field"><label>Start Date *</label><input type="date" value={newTerm.startDate} onChange={(e) => setNewTerm({ ...newTerm, startDate: e.target.value })} /></div>
              <div className="ent-field"><label>End Date *</label><input type="date" value={newTerm.endDate} onChange={(e) => setNewTerm({ ...newTerm, endDate: e.target.value })} /></div>
              <button className="ent-btn ent-btn--primary" onClick={handleAddTerm} disabled={savingTerm} style={{ marginBottom: '1rem' }}>
                <Plus size={14} /> {savingTerm ? 'Adding...' : 'Add Term'}
              </button>
            </div>
            {termGenResult && (
              <div className="ent-success-box" style={{ marginBottom: '0.8rem' }}>
                Billed {termGenResult.created} student(s) for this term{termGenResult.skipped > 0 ? ` (${termGenResult.skipped} already billed, correctly skipped)` : ''}.
              </div>
            )}
            <div className="ent-table-wrap">
              <table className="ent-table">
                <thead><tr><th>Term</th><th>Dates</th><th></th></tr></thead>
                <tbody>
                  {terms.length === 0 ? <tr><td colSpan={3} className="ent-table-empty">No terms yet for this year.</td></tr> :
                    terms.map((t) => (
                      <tr key={t.termId}>
                        <td style={{ fontWeight: 600 }}>{t.label}</td>
                        <td style={{ fontSize: '0.78rem' }}>{t.startDate} to {t.endDate}</td>
                        <td>
                          <button
                            className="ent-btn ent-btn--secondary ent-btn--sm"
                            onClick={() => handleGenerateTermlyInvoices(t.termId)}
                            disabled={generatingTermId === t.termId}
                          >
                            {generatingTermId === t.termId ? 'Billing...' : 'Bill Termly Fees'}
                          </button>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isWendy && (
        <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
          <h3 className="ent-card-title"><Presentation size={16} /> Classes & Grades</h3>
          <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
            Grade level is what grade-specific fee pricing (in Fee Structure Manager) uses to know which price applies to a student — set it accurately here, e.g. 0 for Pre-Primary, 12 for the final year.
          </p>
          {classError && <div className="ent-error-box">{classError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.8fr 0.8fr 0.8fr 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
            <div className="ent-field"><label>Class Name *</label><input value={classForm.className} onChange={(e) => setClassForm({ ...classForm, className: e.target.value })} placeholder="e.g. Grade 8A" /></div>
            <div className="ent-field"><label>Grade Level *</label><input type="number" value={classForm.gradeLevel} onChange={(e) => setClassForm({ ...classForm, gradeLevel: e.target.value })} placeholder="0-12" /></div>
            <div className="ent-field"><label>Section</label><input value={classForm.section} onChange={(e) => setClassForm({ ...classForm, section: e.target.value })} placeholder="A" /></div>
            <div className="ent-field"><label>Academic Year</label>
              {years.length > 0 ? (
                <select value={classForm.academicYear} onChange={(e) => setClassForm({ ...classForm, academicYear: e.target.value })}>
                  {years.map((y) => <option key={y.yearId} value={y.label}>{y.label}{y.isCurrent ? ' (Current)' : ''}</option>)}
                </select>
              ) : (
                <input value={classForm.academicYear} onChange={(e) => setClassForm({ ...classForm, academicYear: e.target.value })} title="No academic years set up yet — add one above for a proper dropdown here." />
              )}
            </div>
            <div className="ent-field"><label>Default Monthly Fee (optional)</label><input type="number" step="0.01" value={classForm.monthlyTuitionFee} onChange={(e) => setClassForm({ ...classForm, monthlyTuitionFee: e.target.value })} placeholder="N$" /></div>
            <button className="ent-btn ent-btn--primary" onClick={handleAddClass} disabled={savingClass} style={{ marginBottom: '1rem' }}>
              <Plus size={14} /> {savingClass ? 'Adding...' : 'Add'}
            </button>
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead><tr><th>Class</th><th>Grade Level</th><th>Section</th><th>Academic Year</th></tr></thead>
              <tbody>
                {classesLoading ? <tr><td colSpan={4} className="ent-table-empty">Loading...</td></tr> :
                  classes.length === 0 ? <tr><td colSpan={4} className="ent-table-empty">No classes created yet.</td></tr> :
                  classes.slice().sort((a, b) => (a.gradeLevel ?? 0) - (b.gradeLevel ?? 0)).map((c) => (
                    <tr key={c.classId}>
                      <td>{c.className}</td>
                      <td><span className="ent-badge ent-badge--info">Grade {c.gradeLevel}</span></td>
                      <td>{c.section || '—'}</td>
                      <td>{c.academicYear || '—'}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}


      <div className="ent-card">
        <h3 className="ent-card-title"><Settings size={16} /> Fee Settings</h3>
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end' }}>
          <div className="ent-field" style={{ flex: 1 }}><label>Category Name</label><input value={newCategory.name} onChange={e => setNewCategory({...newCategory, name: e.target.value})} /></div>
          <div className="ent-field" style={{ flex: 1 }}><label>Description</label><input value={newCategory.description} onChange={e => setNewCategory({...newCategory, description: e.target.value})} /></div>
          <button className="ent-btn ent-btn--primary" onClick={addCategory}>Add</button>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {categories.map(c => (
            <span key={c.categoryId} className="ent-badge ent-badge--soft">{c.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keila (Elite) specific tabs
// ---------------------------------------------------------------------------

function CourseManagementTab({ user }) {
  const [courses, setCourses] = useState([]);
  const [newCourse, setNewCourse] = useState({ courseName: '', duration: '', academicYear: '' });
  useEffect(() => {
    window.electronAPI.listCourses('KEILA').then(res => {
      if (res.success) setCourses(res.courses);
    });
  }, []);
  const addCourse = async () => {
    const res = await window.electronAPI.createCourse({ ...newCourse, school: 'KEILA' });
    if (res.success) {
      setCourses([...courses, res.course]);
      setNewCourse({ courseName: '', duration: '', academicYear: '' });
      playNotificationChime();
    }
  };
  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><BookOpen size={16} /> Course Management</h3>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div className="ent-field"><label>Name</label><input value={newCourse.courseName} onChange={e => setNewCourse({...newCourse, courseName: e.target.value})} /></div>
        <div className="ent-field"><label>Duration</label><input value={newCourse.duration} onChange={e => setNewCourse({...newCourse, duration: e.target.value})} /></div>
        <div className="ent-field"><label>Year</label><input value={newCourse.academicYear} onChange={e => setNewCourse({...newCourse, academicYear: e.target.value})} /></div>
        <button className="ent-btn ent-btn--primary" onClick={addCourse}>Add Course</button>
      </div>
      <div className="ent-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="ent-table"><thead><tr><th>Name</th><th>Duration</th><th>Year</th></tr></thead>
          <tbody>{courses.map(c => <tr key={c.courseId}><td>{c.courseName}</td><td>{c.duration}</td><td>{c.academicYear}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function SubjectManagementTab({ user }) {
  const [subjects, setSubjects] = useState([]);
  const [newSubject, setNewSubject] = useState({ subjectName: '', subjectFee: '', courseId: '' });
  const [courses, setCourses] = useState([]);
  useEffect(() => {
    window.electronAPI.listCourses('KEILA').then(res => {
      if (res.success) setCourses(res.courses);
    });
  }, []);
  const loadSubjects = async () => {
    const res = await window.electronAPI.listSubjects(newSubject.courseId || undefined);
    if (res.success) setSubjects(res.subjects);
  };
  useEffect(() => { loadSubjects(); }, [newSubject.courseId]);
  const addSubject = async () => {
    const res = await window.electronAPI.createSubject({ ...newSubject, school: 'KEILA', subjectFee: parseFloat(newSubject.subjectFee) });
    if (res.success) { setSubjects([...subjects, res.subject]); setNewSubject({ subjectName: '', subjectFee: '', courseId: '' }); playNotificationChime(); }
  };
  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><FileText size={16} /> Subject Management</h3>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div className="ent-field"><label>Name</label><input value={newSubject.subjectName} onChange={e => setNewSubject({...newSubject, subjectName: e.target.value})} /></div>
        <div className="ent-field"><label>Fee (N$)</label><input type="number" value={newSubject.subjectFee} onChange={e => setNewSubject({...newSubject, subjectFee: e.target.value})} /></div>
        <div className="ent-field"><label>Course</label>
          <select value={newSubject.courseId} onChange={e => setNewSubject({...newSubject, courseId: e.target.value})}>
            <option value="">All Courses</option>
            {courses.map(c => <option key={c.courseId} value={c.courseId}>{c.courseName}</option>)}
          </select>
        </div>
        <button className="ent-btn ent-btn--primary" onClick={addSubject}>Add Subject</button>
      </div>
      <div className="ent-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="ent-table"><thead><tr><th>Subject</th><th>Fee</th><th>Course</th></tr></thead>
          <tbody>{subjects.map(s => <tr key={s.subjectId}><td>{s.subjectName}</td><td className="ent-td-num">{s.subjectFee}</td><td>{s.courseId || '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function StudentEnrolmentTab({ user }) {
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [chosenSubjects, setChosenSubjects] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    window.electronAPI.listStudents('KEILA').then(res => { if (res.success) setStudents(res.students); });
    window.electronAPI.listCourses('KEILA').then(res => { if (res.success) setCourses(res.courses); });
  }, []);
  useEffect(() => {
    if (selectedCourse) {
      window.electronAPI.listSubjects(selectedCourse).then(res => { if (res.success) setSubjects(res.subjects); });
    } else setSubjects([]);
  }, [selectedCourse]);
  const enroll = async () => {
    setError(''); setSuccess('');
    if (!selectedStudent || !selectedCourse) { setError('Select both a student and a course first.'); return; }
    setEnrolling(true);
    try {
      const res = await window.electronAPI.enrollStudent({
        studentId: selectedStudent,
        courseId: selectedCourse,
        subjects: chosenSubjects,
        academicYear: new Date().getFullYear().toString(),
        intake: 'January 2026'
      });
      if (!res.success) { setError(res.message || 'Could not enrol this student.'); return; }
      playNotificationChime();
      const studentName = students.find((s) => s.studentId === selectedStudent);
      setSuccess(`Enrolled ${studentName ? studentName.firstName + ' ' + studentName.lastName : 'the student'} successfully.`);
      setSelectedStudent(''); setSelectedCourse(''); setChosenSubjects([]);
    } finally {
      setEnrolling(false);
    }
  };
  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><ClipboardList size={16} /> Enrol Student</h3>
      {error && <div className="ent-error-box">{error}</div>}
      {success && <div className="ent-success-box">{success}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
        <div className="ent-field"><label>Student</label>
          <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
            <option value="">Select</option>
            {students.map(s => <option key={s.studentId} value={s.studentId}>{s.firstName} {s.lastName}</option>)}
          </select>
        </div>
        <div className="ent-field"><label>Course</label>
          <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}>
            <option value="">Select</option>
            {courses.map(c => <option key={c.courseId} value={c.courseId}>{c.courseName}</option>)}
          </select>
        </div>
        {subjects.length > 0 && (
          <div className="ent-field" style={{ gridColumn: '1 / -1' }}>
            <label>Subjects</label>
            <select multiple value={chosenSubjects} onChange={e => setChosenSubjects(Array.from(e.target.selectedOptions, o => o.value))} style={{ height: '80px' }}>
              {subjects.map(s => <option key={s.subjectId} value={s.subjectId}>{s.subjectName}</option>)}
            </select>
          </div>
        )}
      </div>
      <button className="ent-btn ent-btn--primary" onClick={enroll} disabled={enrolling}>{enrolling ? 'Enrolling...' : 'Enrol'}</button>
    </div>
  );
}

function InstallmentPlansTab({ user }) {
  const [plan, setPlan] = useState({ studentId: '', name: '', totalAmount: '', installments: [{ dueDate: '', amount: '' }] });
  const addInstallment = () => setPlan({ ...plan, installments: [...plan.installments, { dueDate: '', amount: '' }] });
  const removeInstallment = (idx) => setPlan({ ...plan, installments: plan.installments.filter((_, i) => i !== idx) });
  const updateInstallment = (idx, field, value) => {
    const updated = [...plan.installments];
    updated[idx][field] = value;
    setPlan({ ...plan, installments: updated });
  };
  const savePlan = async () => {
    const payload = { ...plan, totalAmount: parseFloat(plan.totalAmount), installments: plan.installments.map(i => ({ ...i, amount: parseFloat(i.amount) })) };
    const res = await window.electronAPI.createInstallmentPlanKeila(payload);
    if (res.success) { playNotificationChime(); alert('Plan created!'); }
  };
  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Calendar size={16} /> Installment Plans</h3>
      <div className="ent-field"><label>Student ID</label><input value={plan.studentId} onChange={e => setPlan({...plan, studentId: e.target.value})} /></div>
      <div className="ent-field"><label>Plan Name</label><input value={plan.name} onChange={e => setPlan({...plan, name: e.target.value})} /></div>
      <div className="ent-field"><label>Total Amount</label><input type="number" value={plan.totalAmount} onChange={e => setPlan({...plan, totalAmount: e.target.value})} /></div>
      <h4>Installments</h4>
      {plan.installments.map((inst, idx) => (
        <div key={idx} style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <div className="ent-field"><label>Due Date</label><input type="date" value={inst.dueDate} onChange={e => updateInstallment(idx, 'dueDate', e.target.value)} /></div>
          <div className="ent-field"><label>Amount</label><input type="number" value={inst.amount} onChange={e => updateInstallment(idx, 'amount', e.target.value)} /></div>
          <button className="ent-icon-btn ent-icon-btn--red" onClick={() => removeInstallment(idx)}><Trash size={14} /></button>
        </div>
      ))}
      <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={addInstallment}>+ Add Installment</button>
      <button className="ent-btn ent-btn--primary" style={{ marginLeft: '1rem' }} onClick={savePlan}>Save Plan</button>
    </div>
  );
}

function AccountManagementTab({ user }) {
  return <FeeAllocationManagerTab user={user} />;
}

function CourseFeeAssignmentTab({ user }) {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [feeItems, setFeeItems] = useState({
    'Registration Fee': { checked: true, amount: '500', category: 'Registration' },
    'Tuition': { checked: true, amount: '4500', category: 'Tuition' },
    'Administration Fee': { checked: true, amount: '250', category: 'Administration' },
    'Laboratory': { checked: false, amount: '600', category: 'Laboratory' },
    'Transport': { checked: false, amount: '800', category: 'Transport' },
    'Accommodation': { checked: false, amount: '3500', category: 'Accommodation' }
  });
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    window.electronAPI.listCourses('KEILA').then((res) => {
      if (res.success) {
        setCourses(res.courses);
        if (res.courses.length > 0) setSelectedCourseId(res.courses[0].courseId);
      }
    });
  }, []);

  function toggleFee(name) {
    setFeeItems((prev) => ({ ...prev, [name]: { ...prev[name], checked: !prev[name].checked } }));
  }
  function setAmount(name, amount) {
    setFeeItems((prev) => ({ ...prev, [name]: { ...prev[name], amount } }));
  }

  async function handleApply() {
    setError(''); setResult(null);
    if (!selectedCourseId) { setError('Select a course first.'); return; }
    const selected = Object.entries(feeItems)
      .filter(([, v]) => v.checked)
      .map(([name, v]) => ({ name, amount: Number(v.amount), category: v.category }));
    if (selected.length === 0) { setError('Select at least one fee to apply.'); return; }
    if (selected.some((f) => !(f.amount > 0))) { setError('Every selected fee needs a valid amount.'); return; }

    setApplying(true);
    try {
      const res = await window.electronAPI.applyCourseFeesToEnrolledStudents({ courseId: selectedCourseId, school: 'KEILA', feeItems: selected });
      if (!res.success) { setError(res.message); return; }
      setResult(res.result);
      playNotificationChime();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Layers size={16} /> Course Fee Assignment</h3>
      <p className="ent-hint">Automatically bill every student currently enrolled in a course, for whichever fees you select below.</p>

      {error && <div className="ent-error-box">{error}</div>}
      {result && (
        <div className="ent-success-box">
          Applied to {result.studentsBilled} enrolled student(s) — {result.chargesCreated} new charge(s) created
          {result.chargesCreated < result.studentsBilled * Object.values(feeItems).filter((f) => f.checked).length
            ? ' (some students were already billed for one or more of these items, so they were correctly skipped).' : '.'}
        </div>
      )}

      <div className="ent-field">
        <label>Select Course</label>
        <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
          {courses.length === 0 ? <option value="">No courses yet — add one in Course Management</option> :
            courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.courseName}</option>)}
        </select>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p><strong>Default Fees:</strong></p>
        {['Registration Fee', 'Tuition', 'Administration Fee'].map((name) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.4rem' }}>
            <Toggle checked={feeItems[name].checked} onChange={() => toggleFee(name)} label={name} />
            <input
              type="number" className="ent-input" style={{ width: '110px' }} value={feeItems[name].amount}
              onChange={(e) => setAmount(name, e.target.value)} disabled={!feeItems[name].checked}
            />
          </div>
        ))}
        <div style={{ marginTop: '0.5rem' }}><strong>Optional:</strong></div>
        {['Laboratory', 'Transport', 'Accommodation'].map((name) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.4rem' }}>
            <Toggle checked={feeItems[name].checked} onChange={() => toggleFee(name)} label={name} />
            <input
              type="number" className="ent-input" style={{ width: '110px' }} value={feeItems[name].amount}
              onChange={(e) => setAmount(name, e.target.value)} disabled={!feeItems[name].checked}
            />
          </div>
        ))}
        <button className="ent-btn ent-btn--primary" style={{ marginTop: '1rem' }} onClick={handleApply} disabled={applying}>
          {applying ? 'Applying...' : 'Apply to Enrolled Students'}
        </button>
      </div>
    </div>
  );
}

function SponsorManagementTab({ user }) {
  const [sponsors, setSponsors] = useState([]);
  const [newSponsor, setNewSponsor] = useState({ name: '', type: 'Company', contactPerson: '', phone: '', email: '' });
  useEffect(() => {
    window.electronAPI.listSponsors('KEILA').then(res => {
      if (res.success) setSponsors(res.sponsors);
    });
  }, []);
  const addSponsor = async () => {
    const res = await window.electronAPI.createSponsor({ ...newSponsor, school: 'KEILA' });
    if (res.success) {
      setSponsors([...sponsors, res.sponsor]);
      setNewSponsor({ name: '', type: 'Company', contactPerson: '', phone: '', email: '' });
      playNotificationChime();
    }
  };
  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Users size={16} /> Sponsor Management</h3>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div className="ent-field"><label>Name</label><input value={newSponsor.name} onChange={e => setNewSponsor({...newSponsor, name: e.target.value})} /></div>
        <div className="ent-field"><label>Type</label>
          <select value={newSponsor.type} onChange={e => setNewSponsor({...newSponsor, type: e.target.value})}>
            <option>Company</option><option>Government</option><option>NGO</option><option>Individual</option>
          </select>
        </div>
        <div className="ent-field"><label>Contact</label><input value={newSponsor.contactPerson} onChange={e => setNewSponsor({...newSponsor, contactPerson: e.target.value})} /></div>
        <div className="ent-field"><label>Phone</label><input value={newSponsor.phone} onChange={e => setNewSponsor({...newSponsor, phone: e.target.value})} /></div>
        <div className="ent-field"><label>Email</label><input value={newSponsor.email} onChange={e => setNewSponsor({...newSponsor, email: e.target.value})} /></div>
        <button className="ent-btn ent-btn--primary" onClick={addSponsor}>Add Sponsor</button>
      </div>
      <div className="ent-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="ent-table"><thead><tr><th>Name</th><th>Type</th><th>Contact</th></tr></thead>
          <tbody>{sponsors.map(s => <tr key={s.sponsorId}><td>{s.name}</td><td>{s.type}</td><td>{s.contactPerson}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function SponsorStatementsTab({ user }) {
  const [studentId, setStudentId] = useState('');
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateStatement = async () => {
    if (!studentId) return;
    setLoading(true);
    const res = await window.electronAPI.getArrearsLetterData(studentId);
    if (res.success) setStatement(res.data);
    setLoading(false);
  };

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Printer size={16} /> Sponsor Financial Statement</h3>
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end' }}>
        <div className="ent-field" style={{ flex: 1 }}><label>Student ID</label><input value={studentId} onChange={e => setStudentId(e.target.value)} /></div>
        <button className="ent-btn ent-btn--primary" onClick={generateStatement}>Generate</button>
      </div>
      {loading && <div className="ent-skeleton" style={{ height: '200px', marginTop: '1rem' }} />}
      {statement && (
        <div className="ent-doc-page" style={{ marginTop: '1rem' }}>
          <h3>KEILA ACADEMY</h3>
          <h4>Financial Statement</h4>
          <p><strong>Student:</strong> {statement.student?.firstName} {statement.student?.lastName}</p>
          <p><strong>Outstanding:</strong> N${statement.totalArrears?.toFixed(2)}</p>
          <p><strong>Status:</strong> {statement.status}</p>
          <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={() => alert('PDF download (mock)')}><DownloadIcon size={14} /> Download PDF</button>
        </div>
      )}
    </div>
  );
}
