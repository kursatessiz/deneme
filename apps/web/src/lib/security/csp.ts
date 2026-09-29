/**
 * Per-request Content-Security-Policy for the authenticated dashboard and
 * super-admin panel (protected routes, `/giris`), defense in depth against
 * stored XSS. Follows the Next.js App Router nonce pattern: the same nonce
 * is set on the request header `x-nonce` (read by Server Components that
 * need it, e.g. to nonce a manually-injected script) and on the response's
 * `Content-Security-Policy` header. Next.js itself reads the CSP off the
 * incoming request headers and nonces its own inline bootstrap scripts
 * automatically, so no other wiring is required.
 *
 * This is intentionally a stricter, separate policy from `publicAdsCsp` in
 * `middleware.ts`: the dashboard never loads third-party ad pixels, so it
 * gets no allowance for them. Dashboard fonts are self-hosted via
 * `@fontsource` (served from `self`) and images come from `next/image`
 * with `remotePatterns: [{ protocol: 'https', hostname: '**' }]` (tenant
 * logos, member/measurement photos on arbitrary https hosts), which is why
 * `img-src` allows `https:` broadly while everything else stays locked to
 * `'self'`.
 */

/** A cryptographically random, base64-encoded nonce (16 bytes, matching the Next.js docs example). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Builds the dashboard/admin CSP for a given nonce. `isDevelopment` mirrors
 * the existing public CSP's convention: Next dev needs `'unsafe-eval'` to
 * evaluate modules; production builds never do.
 */
export function dashboardCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDevelopment ? ["'unsafe-eval'"] : [])];
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}
