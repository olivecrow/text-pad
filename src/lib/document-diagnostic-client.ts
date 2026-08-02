import type {
  DocumentDiagnosticWorkerRequest,
  DocumentDiagnosticWorkerResponse
} from './document-diagnostic-worker-protocol';

interface DiagnosticWorkerLike {
  onmessage: ((event: MessageEvent<DocumentDiagnosticWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: DocumentDiagnosticWorkerRequest): void;
  terminate(): void;
}

export class DocumentDiagnosticCancelledError extends Error {
  constructor() {
    super('Document diagnostic request was cancelled.');
    this.name = 'DocumentDiagnosticCancelledError';
  }
}

export class DocumentDiagnosticWorkerClient {
  private worker: DiagnosticWorkerLike | null = null;
  private rejectPending: ((reason: unknown) => void) | null = null;

  constructor(private readonly createWorker: () => DiagnosticWorkerLike) {}

  diagnose(request: DocumentDiagnosticWorkerRequest): Promise<DocumentDiagnosticWorkerResponse> {
    this.cancel();
    const worker = this.createWorker();
    this.worker = worker;

    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      worker.onmessage = (event) => {
        if (worker !== this.worker || event.data.requestId !== request.requestId) return;
        this.finishWorker(worker);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data);
        }
      };
      worker.onerror = (event) => {
        if (worker !== this.worker) return;
        this.finishWorker(worker);
        reject(new Error(event.message || 'Document diagnostic worker failed.'));
      };
      worker.postMessage(request);
    });
  }

  cancel() {
    const rejectPending = this.rejectPending;
    this.rejectPending = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    rejectPending?.(new DocumentDiagnosticCancelledError());
  }

  dispose() {
    this.cancel();
  }

  private finishWorker(worker: DiagnosticWorkerLike) {
    if (worker !== this.worker) return;
    worker.terminate();
    this.worker = null;
    this.rejectPending = null;
  }
}

export function createBrowserDocumentDiagnosticWorkerClient(): DocumentDiagnosticWorkerClient {
  return new DocumentDiagnosticWorkerClient(() => new Worker(
    new URL('./document-diagnostic.worker.ts', import.meta.url),
    { type: 'module', name: 'text-pad-document-diagnostic' }
  ));
}
