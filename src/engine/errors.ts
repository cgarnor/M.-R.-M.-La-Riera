/**
 * Errors with a stable code, so the interface can show a translated message.
 * The message format is `MRM_ERR:<CODE>[:<detail>]`; it survives worker and IPC boundaries.
 */
export type MrmErrorCode =
  | 'NO_FACES' | 'BAD_INDEX' | 'BAD_COORDS' | 'FORMAT' | 'TOO_SMALL' | 'ZERO_AREA'
  | 'PLY_HEADER' | 'PLY_NO_VERTEX' | 'PLY_TYPE' | 'PLY_TRUNCATED'
  | 'POISSON_UNAVAILABLE' | 'POISSON_EMPTY' | 'POISSON_FAILED' | 'POISSON_TIMEOUT'
  | 'MEMORY' | 'CANCELLED' | 'PROJECT_INVALID' | 'PROJECT_VERSION' | 'BAD_ARGS' | 'FORBIDDEN' | 'FIGURE_ENCODE'
  | 'READ_FAILED' | 'WRITE_FAILED' | 'FILE_TOO_LARGE';

export class MrmError extends Error {
  constructor(readonly code: MrmErrorCode, detail?: string) {
    super(`MRM_ERR:${code}${detail ? `:${detail}` : ''}`);
    this.name = 'MrmError';
  }
}

/** Extracts `{ code, detail }` from any error message containing `MRM_ERR:` (null otherwise). */
export function parseErrorCode(message: string | undefined): { code: string; detail?: string } | null {
  const m = /MRM_ERR:([A-Z_]+)(?::([\s\S]*))?/.exec(message ?? '');
  return m ? { code: m[1], detail: m[2]?.trim() || undefined } : null;
}

/** Normalises an unknown thrown value into a message (out-of-memory errors get their own code). */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Text files larger than the maximum JavaScript string length (≈ 512 MB) cannot be decoded.
  if (/invalid string length/i.test(msg)) return 'MRM_ERR:FILE_TOO_LARGE';
  if (/allocation failed|array buffer allocation|invalid (typed )?array length|out of memory/i.test(msg)) return 'MRM_ERR:MEMORY';
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'NotReadableError') return 'MRM_ERR:READ_FAILED:NotReadableError';
  return msg;
}
