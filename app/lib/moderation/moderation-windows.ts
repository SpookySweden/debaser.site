import { createWindowSlot } from '../ui/window-slot';
import type { ReportContextKind } from './types';

/**
 * Moderation's two windows (SPEC-moderation.md), each in its own small store so opening one re-renders only that window:
 * REPORT (the form, opened from a profile or from the menu beside a line) and REPORTS (the moderators' list, log and moderators).
 */

export type ReportTarget = {
  accountId: string;
  name: string;
  /** The line it was opened from, which the report carries (the database copies it itself). */
  context?: { kind: ReportContextKind; id: string; text: string; private?: boolean };
};

export type ReportWindowState = { target: ReportTarget | null };

const NO_REPORT: ReportWindowState = { target: null };
const reportSlot = createWindowSlot<ReportWindowState>(NO_REPORT);

export const reportWindowState = reportSlot.state;
export const reportWindowServerState = (): ReportWindowState => NO_REPORT;
export const subscribeToReportWindow = reportSlot.subscribe;

export function openReport(target: ReportTarget): void {
  reportSlot.set({ target });
}

export function closeReport(): void {
  if (reportSlot.state().target !== null) reportSlot.set(NO_REPORT);
}

export type ReportsWindowState = { open: boolean };

const SHUT: ReportsWindowState = { open: false };
const reportsSlot = createWindowSlot<ReportsWindowState>(SHUT);

export const reportsWindowState = reportsSlot.state;
export const reportsWindowServerState = (): ReportsWindowState => SHUT;
export const subscribeToReportsWindow = reportsSlot.subscribe;

export function openReports(): void {
  if (!reportsSlot.state().open) reportsSlot.set({ open: true });
}

export function closeReports(): void {
  if (reportsSlot.state().open) reportsSlot.set(SHUT);
}

export function toggleReports(): void {
  if (reportsSlot.state().open) closeReports();
  else openReports();
}
