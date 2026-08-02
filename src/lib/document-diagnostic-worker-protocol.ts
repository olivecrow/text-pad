import type {
  DocumentDiagnostic,
  DocumentFeatureSettings
} from './document-formats';
import type { AppLocale } from './i18n';

export interface DocumentDiagnosticWorkerRequest {
  requestId: number;
  content: string;
  pathOrName: string;
  featureSettings: DocumentFeatureSettings;
  locale: AppLocale;
}

export interface DocumentDiagnosticWorkerResponse {
  requestId: number;
  diagnostic: DocumentDiagnostic | null;
  durationMs: number;
  error?: string;
}
