/// <reference lib="webworker" />

import { getDocumentDiagnostic } from './document-formats';
import type {
  DocumentDiagnosticWorkerRequest,
  DocumentDiagnosticWorkerResponse
} from './document-diagnostic-worker-protocol';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DocumentDiagnosticWorkerRequest>) => {
  const request = event.data;
  const startedAt = performance.now();
  try {
    const diagnostic = getDocumentDiagnostic(request.content, {
      pathOrName: request.pathOrName,
      featureSettings: request.featureSettings,
      locale: request.locale
    });
    workerScope.postMessage({
      requestId: request.requestId,
      diagnostic,
      durationMs: performance.now() - startedAt
    } satisfies DocumentDiagnosticWorkerResponse);
  } catch (error) {
    workerScope.postMessage({
      requestId: request.requestId,
      diagnostic: null,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    } satisfies DocumentDiagnosticWorkerResponse);
  }
};

export {};
