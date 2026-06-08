import { NextRequest } from 'next/server';

/** A JSON-bodied NextRequest for route-handler tests. */
export function jsonReq(method: string, body?: unknown, url = 'http://localhost/api/x') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A request whose `.json()` rejects (malformed body) — exercises the 400 bad-JSON path. */
export function badJsonReq(method = 'POST', url = 'http://localhost/api/x') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

/** Wraps a params object as the Promise the dynamic `[id]` route handlers expect. */
export const params = <T extends Record<string, string>>(o: T) => Promise.resolve(o);
