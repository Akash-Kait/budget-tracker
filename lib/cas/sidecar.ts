import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { casParsedSchema, type CasParsed } from './types';

// I/O boundary for the Python CAS parser — analogous to lib/market/amfi.ts for the AMFI feed.
// Sends the PDF over STDIN (password first line, bytes after) so nothing hits disk on the Node side
// and the password never lands in argv/env. Never logs the PDF, password, or parsed contents.

const SCRIPT = path.join(process.cwd(), 'scripts', 'cas_parse.py');
const VENV_PY = path.join(process.cwd(), 'scripts', '.venv', 'bin', 'python');
const TIMEOUT_MS = 30_000;

export type CasErrorCode =
  | 'PYTHON_MISSING'
  | 'CASPARSER_MISSING'
  | 'BAD_PASSWORD'
  | 'PARSE_ERROR'
  | 'TIMEOUT'
  | 'BAD_OUTPUT';

export class CasError extends Error {
  constructor(public code: CasErrorCode, message: string) {
    super(message);
    this.name = 'CasError';
  }
}

// Map the sidecar's structured exit codes to typed errors.
function fromExit(code: number | null): CasError {
  switch (code) {
    case 4:
      return new CasError('CASPARSER_MISSING', 'casparser is not installed');
    case 2:
      return new CasError('BAD_PASSWORD', 'Incorrect password or unrecognized CAS');
    case 3:
      return new CasError('PARSE_ERROR', 'Could not parse the CAS PDF');
    default:
      return new CasError('PARSE_ERROR', `CAS parser exited with code ${code}`);
  }
}

export function runCasParser(pdf: Buffer, password: string): Promise<CasParsed> {
  const py = existsSync(VENV_PY) ? VENV_PY : 'python3';
  return new Promise<CasParsed>((resolve, reject) => {
    const child = spawn(py, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      done(() => {
        child.kill('SIGKILL');
        reject(new CasError('TIMEOUT', 'CAS parse timed out'));
      });
    }, TIMEOUT_MS);

    child.on('error', (e: NodeJS.ErrnoException) => {
      done(() =>
        reject(
          e.code === 'ENOENT'
            ? new CasError('PYTHON_MISSING', 'Python 3 is not available')
            : new CasError('PARSE_ERROR', 'Failed to start the CAS parser'),
        ),
      );
    });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {}); // swallow — may contain diagnostics, never logged

    child.on('close', (code) => {
      done(() => {
        if (code !== 0) return reject(fromExit(code));
        let json: unknown;
        try {
          json = JSON.parse(out);
        } catch {
          return reject(new CasError('BAD_OUTPUT', 'CAS parser returned invalid output'));
        }
        const parsed = casParsedSchema.safeParse(json);
        if (!parsed.success) return reject(new CasError('BAD_OUTPUT', 'Unexpected CAS parser output'));
        resolve(parsed.data);
      });
    });

    // The child may exit (bad password, casparser missing) before draining our ~15MB write — that
    // raises EPIPE on stdin. Swallow it; the real failure surfaces via the child 'close'/'error'
    // handlers above. Without this listener an unhandled stream error can crash the whole process.
    child.stdin.on('error', () => {});
    // Password on the first line, then raw PDF bytes. (A newline in a PDF password is unsupported —
    // not a realistic CAS password.)
    child.stdin.write(password + '\n');
    child.stdin.write(pdf);
    child.stdin.end();
  });
}
