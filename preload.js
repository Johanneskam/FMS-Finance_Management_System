// preload.js — runs in an isolated context with access to Node APIs,
// but the renderer (React app) only ever sees what we explicitly expose here.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  getRememberedUsername: () => ipcRenderer.invoke('auth:getRememberedUsername'),
  setRememberedUsername: (username) => ipcRenderer.invoke('auth:setRememberedUsername', username),

  // ---- sync ----
  isSyncConfigured: () => ipcRenderer.invoke('sync:isConfigured'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncStatus: () => ipcRenderer.invoke('diagnostics:syncStatus'),
  getDatabaseStats: () => ipcRenderer.invoke('diagnostics:databaseStats'),
  onSyncStatus: (callback) => ipcRenderer.on('sync:status', (_event, text) => callback(text)),
  onSyncCompleted: (callback) => ipcRenderer.on('sync:completed', (_event, info) => callback(info)),
  onUsbBackupStatus: (callback) => ipcRenderer.on('usb-backup:status', (_event, text) => callback(text)),
  
  // ---- Keila (Elite) ----
  // createInstallmentPlan is deliberately NOT reused here — that name
  // already means something different below (the original Wendy/general
  // payment-plan flow, payload shape: totalAmount + numberOfInstallments).
  // This was previously exposed under the same name as that one, so
  // whichever definition appeared later in the file silently won and the
  // other became unreachable. createInstallmentPlanKeila matches the
  // distinctly-named db.js function it actually calls.
  listCourses: (school) => ipcRenderer.invoke('courses:list', { school }),
  createCourse: (payload) => ipcRenderer.invoke('courses:create', payload),
  listSubjects: (courseId) => ipcRenderer.invoke('subjects:list', { courseId }),
  createSubject: (payload) => ipcRenderer.invoke('subjects:create', payload),
  enrollStudent: (payload) => ipcRenderer.invoke('enrollment:enroll', payload),
  listSponsors: (school) => ipcRenderer.invoke('sponsors:list', { school }),
  createSponsor: (payload) => ipcRenderer.invoke('sponsors:create', payload),
  createInstallmentPlanKeila: (payload) => ipcRenderer.invoke('installments:create', payload),
  generateMonthlyInvoices: (payload) => ipcRenderer.invoke('billing:generateMonthlyInvoices', payload),
  generateTermlyInvoices: (payload) => ipcRenderer.invoke('billing:generateTermlyInvoices', payload),
  bulkAssignFee: (payload) => ipcRenderer.invoke('bulk:assignFee', payload),
  bulkRemoveFee: (payload) => ipcRenderer.invoke('bulk:removeFee', payload),
  listFeeAssignments: (studentId) => ipcRenderer.invoke('feeAssignments:list', { studentId }),
  listClasses: (school) => ipcRenderer.invoke('classes:list', { school }),
  createClass: (payload) => ipcRenderer.invoke('classes:create', payload),
  listAcademicYears: (school) => ipcRenderer.invoke('academicYears:list', { school }),
  createAcademicYear: (payload) => ipcRenderer.invoke('academicYears:create', payload),
  setCurrentAcademicYear: (school, yearId) => ipcRenderer.invoke('academicYears:setCurrent', { school, yearId }),
  getCurrentAcademicYear: (school) => ipcRenderer.invoke('academicYears:getCurrent', { school }),
  promoteStudents: (payload) => ipcRenderer.invoke('students:promote', payload),
  listTerms: (school, yearId) => ipcRenderer.invoke('terms:list', { school, yearId }),
  createTerm: (payload) => ipcRenderer.invoke('terms:create', payload),
  createFeeTemplate: (payload) => ipcRenderer.invoke('feeTemplate:create', payload),
  listAllFeeCatalogTemplates: (school) => ipcRenderer.invoke('feeTemplate:listAll', { school }),
  updateFeeCatalogTemplate: (templateId, patch) => ipcRenderer.invoke('feeTemplate:update', { templateId, patch }),
  createFeeCategory: (payload) => ipcRenderer.invoke('feeCategory:create', payload),
  listFeeCategories: (school) => ipcRenderer.invoke('feeCategory:list', { school }),
  getStudentLedger: (studentId) => ipcRenderer.invoke('students:ledger', { studentId }),

  // ---- user management ----
  listUsers: (requestingRole) => ipcRenderer.invoke('users:list', { requestingRole }),
  createUser: (payload) => ipcRenderer.invoke('users:create', payload),
  updateUser: (payload) => ipcRenderer.invoke('users:update', payload),
  resetUserPassword: (payload) => ipcRenderer.invoke('users:resetPassword', payload),

  // ---- secretary dashboard ----
  getSecretaryDashboardData: (school) => ipcRenderer.invoke('secretary:dashboardData', { school }),

  // ---- student registration ----
  listStudents: (school) => ipcRenderer.invoke('students:list', { school }),
  createStudent: (payload) => ipcRenderer.invoke('students:create', payload),
  updateStudent: (studentId, patch) => ipcRenderer.invoke('students:update', { studentId, patch }),
  bulkUpdateStudents: (studentIds, patch) => ipcRenderer.invoke('students:bulkUpdate', { studentIds, patch }),
  requestStudentDeletion: (payload) => ipcRenderer.invoke('students:requestDeletion', payload),
  listPendingDeletionRequests: (school) => ipcRenderer.invoke('students:listPendingDeletions', { school }),
  decideStudentDeletion: (payload) => ipcRenderer.invoke('students:decideDeletion', payload),
  getSecretaryAuditReport: (payload) => ipcRenderer.invoke('reports:secretaryAudit', payload),
  getSecretaryTransactionSummary: (payload) => ipcRenderer.invoke('reports:secretaryTransactionSummary', payload),
  getStudentStatementData: (studentId) => ipcRenderer.invoke('reports:studentStatement', { studentId }),
  getStudentStatementDataForLetter: (studentId) => ipcRenderer.invoke('reports:studentStatementForLetter', { studentId }),
  getAllPaymentsDetailed: (filters) => ipcRenderer.invoke('payments:allDetailed', filters),
  getStudentsByFilters: (filters) => ipcRenderer.invoke('reports:studentsByFilters', filters),
  getClassOrGradeStatement: (payload) => ipcRenderer.invoke('reports:classOrGradeStatement', payload),
  getFeeCategoryReport: (payload) => ipcRenderer.invoke('reports:feeCategoryReport', payload),
  saveStudentDocumentsPdf: (studentId, pdfBase64, kind) => ipcRenderer.invoke('students:saveDocumentsPdf', { studentId, pdfBase64, kind }),
  savePaymentReceipt: (paymentId, fileBase64, extension) => ipcRenderer.invoke('payments:saveReceipt', { paymentId, fileBase64, extension }),
  updatePaymentReceiptPath: (paymentId, filePath) => ipcRenderer.invoke('payments:updateReceiptPath', { paymentId, filePath }),
  openPaymentReceipt: (filePath) => ipcRenderer.invoke('payments:openReceipt', { filePath }),
  listGuardians: () => ipcRenderer.invoke('guardians:list'),
  createGuardian: (payload) => ipcRenderer.invoke('guardians:create', payload),

  // ---- financial communication ----
  getTopLists: (school) => ipcRenderer.invoke('financialComm:topLists', { school }),
  getFeeCategoryLeaderboards: (school) => ipcRenderer.invoke('financialComm:feeCategoryLeaderboards', { school }),
  getArrearsLetterData: (studentId) => ipcRenderer.invoke('financialComm:arrearsLetter', { studentId }),
  getFinancialReportData: (school) => ipcRenderer.invoke('reports:financialReport', { school }),
  getReportsCenterExtras: (school) => ipcRenderer.invoke('reports:centerExtras', { school }),
  getSecretaryPerformanceData: (school) => ipcRenderer.invoke('reports:secretaryPerformance', { school }),
  getSchoolCategoryBreakdown: (school) => ipcRenderer.invoke('reports:schoolCategoryBreakdown', { school }),
  getFeeTemplateBreakdown: (school) => ipcRenderer.invoke('reports:feeTemplateBreakdown', { school }),
  getMonthlyManagementReport: (school, monthKey) => ipcRenderer.invoke('reports:monthlyManagementReport', { school, monthKey }),
  getActiveAlerts: () => ipcRenderer.invoke('alerts:getActive'),
  getFinancialForecast: (school) => ipcRenderer.invoke('reports:financialForecast', { school }),
  getStudentBillingSummary: (studentId, school) => ipcRenderer.invoke('payment:billingSummary', { studentId, school }),
  listFeeCatalogTemplates: (school) => ipcRenderer.invoke('payment:listCatalog', { school }),
  createCharge: (payload) => ipcRenderer.invoke('payment:createCharge', payload),
  createInstallmentPlan: (payload) => ipcRenderer.invoke('payment:createInstallmentPlan', payload),
  bulkCreateInstallmentPlans: (payload) => ipcRenderer.invoke('payment:bulkCreateInstallmentPlans', payload),
  checkDuplicateCharges: (payload) => ipcRenderer.invoke('payment:checkDuplicateCharges', payload),
  bulkCreateFeeExpectations: (payload) => ipcRenderer.invoke('payment:bulkCreateFeeExpectations', payload),
  correctPayment: (payload) => ipcRenderer.invoke('payment:correct', payload),
  getCorrectionsForPayment: (paymentId) => ipcRenderer.invoke('payment:getCorrections', { paymentId }),
  capturePayment: (payload) => ipcRenderer.invoke('payment:capture', payload),
  applyAdminAdjustment: (payload) => ipcRenderer.invoke('adjustments:apply', payload),
  getOwnProfile: (username) => ipcRenderer.invoke('profile:getOwn', { username }),
  updateOwnProfile: (payload) => ipcRenderer.invoke('profile:update', payload),
  changeOwnPassword: (payload) => ipcRenderer.invoke('profile:changePassword', payload),

  // ---- notifications (sound/dialog) ----
  beep: () => ipcRenderer.invoke('notify:beep'),
  getLogoBase64: () => ipcRenderer.invoke('assets:getLogoBase64'),
  listPrinters: () => ipcRenderer.invoke('print:listPrinters'),
  printPdf: (payload) => ipcRenderer.invoke('print:pdf', payload),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  restoreFromBackup: (backupName) => ipcRenderer.invoke('backup:restore', { backupName }),
  showDialog: (options) => ipcRenderer.invoke('notify:dialog', options)
});