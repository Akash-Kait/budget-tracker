import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ecasParsedSchema, type EcasParsed } from './types';

// I/O boundary for the Python eCAS parser (pdfplumber). Separate from lib/cas/sidecar.ts. Sends the
// PDF over STDIN (password first line — never argv/env), in-memory; never logs the PDF/password/PII.

const SCRIPT = path.join(process.cwd(), 'scripts', 'ecas_parse.py');
const VENV_PY = path.join(process.cwd(), 'scripts', '.venv', 'bin', 'python');
const TIMEOUT_MS = 30_000;

export type EcasErrorCode =
  | 'PYTHON_MISSING'
  | 'PDFPLUMBER_MISSING'
  | 'BAD_PASSWORD'
  | 'PARSE_ERROR'
  | 'TIMEOUT'
  | 'BAD_OUTPUT';

export class EcasError extends Error {
  constructor(public code: EcasErrorCode, message: string) {
    super(message);
    this.name = 'EcasError';
  }
}

function fromExit(code: number | null, out = ''): EcasError {
  let detail = '';
  try {
    const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
    const j = JSON.parse(line) as { detail?: unknown };
    if (typeof j.detail === 'string' && j.detail) detail = ` (${j.detail})`;
  } catch {
    /* no structured detail */
  }
  switch (code) {
    case 4:
      return new EcasError('PDFPLUMBER_MISSING', 'pdfplumber is not installed');
    case 2:
      return new EcasError('BAD_PASSWORD', 'Incorrect password or unreadable eCAS');
    case 3:
      return new EcasError('PARSE_ERROR', `Could not parse the eCAS PDF${detail}`);
    default:
      return new EcasError('PARSE_ERROR', `eCAS parser exited with code ${code}${detail}`);
  }
}

export function runEcasParser(pdf: Buffer, password: string): Promise<EcasParsed> {
  const py = existsSync(VENV_PY) ? VENV_PY : 'python3';
  return new Promise<EcasParsed>((resolve, reject) => {
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
        reject(new EcasError('TIMEOUT', 'eCAS parse timed out'));
      });
    }, TIMEOUT_MS);

    child.on('error', (e: NodeJS.ErrnoException) => {
      done(() =>
        reject(
          e.code === 'ENOENT'
            ? new EcasError('PYTHON_MISSING', 'Python 3 is not available')
            : new EcasError('PARSE_ERROR', 'Failed to start the eCAS parser'),
        ),
      );
    });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {}); // swallow — never logged

    child.on('close', (code) => {
      done(() => {
        if (code !== 0) return reject(fromExit(code, out));
        let json: unknown;
        try {
          json = JSON.parse(out);
        } catch {
          return reject(new EcasError('BAD_OUTPUT', 'eCAS parser returned invalid output'));
        }
        const parsed = ecasParsedSchema.safeParse(json);
        if (!parsed.success) return reject(new EcasError('BAD_OUTPUT', 'Unexpected eCAS parser output'));
        resolve(parsed.data);
      });
    });

    // child may exit before draining our write → EPIPE; swallow (real failure comes via close/error).
    child.stdin.on('error', () => {});
    child.stdin.write(password + '\n');
    child.stdin.write(pdf);
    child.stdin.end();
  });
}
