export const gates = {
  P0: ['pathGuardTests', 'actualProfile', 'actualData', 'parentProcess', 'noAccount', 'syncOff', 'connectorOff', 'wordInstallSkipped', 'productionProcessesPreserved', 'protectedFilesUnchanged', 'nativeDatabaseCreated', 'emptyLibrary', 'restartVerified', 'closedSnapshotVerified', 'visualReview'],
  P1: ['nativeHostPreserved', 'existingAnnotations', 'annotationCRUD', 'annotationTagsComments', 'addToNoteCopyDrag', 'restartPersistence', 'disablePersistence', 'permissions', 'UI-01', 'UI-03', 'UI-04'],
  P2: ['twentyModeSwitches', 'bidirectionalNavigation', 'nineteenPageAlignment', 'anchorError', 'latencyP95', 'zoomResize', 'annotationInteraction', 'cleanup', 'UI-01', 'UI-02', 'UI-03', 'UI-04', 'UI-05', 'UI-06'],
  P3: ['threeRealDownloads', 'loginRecovery', 'cancelTimeout', 'deduplication', 'pdfValidation', 'noCredentials'],
  P4: ['correctParentAndPair', 'multipleAttachments', 'importRecovery', 'restartPairing', 'sourcePreserved', 'UI-07'],
  P5: ['disableUninstall', 'tasksStopped', 'preciseCleanup', 'backupRestore', 'versionsAndPackageHash', 'UI-08', 'visualRegression'],
};

export function validateMilestone(report, id) {
  const errors = [];
  if (!gates[id]) return [`Unknown milestone: ${id}`];
  if (!report || report.milestone !== id) errors.push('Milestone identity mismatch');
  for (const check of gates[id]) {
    if (report?.checks?.[check] !== true) errors.push(`Missing, failed, or unrun check: ${check}`);
  }
  if (!Array.isArray(report?.evidence) || !report.evidence.length) errors.push('Evidence is required');
  if (gates[id].some(k => k === 'visualReview' || k.startsWith('UI-') || k === 'visualRegression')) {
    if (report?.visualReview?.status !== 'passed' || !report.visualReview.screenshots?.length || !report.visualReview.findings) {
      errors.push('Actual screenshots and a visual review conclusion are required');
    }
  }
  return errors;
}
