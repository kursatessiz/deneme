/**
 * The small "Powered by <product>" link on tenant public surfaces (docs/SEO.md). Deliberately a plain link:
 * `rel="noopener"` only, no `nofollow`, since the backlink and the attribution query are the point. The
 * label is already translated by the caller (server `getT` or client `useT`); renders nothing without a URL.
 */
export function PoweredByBadge({ href, label, className }: { href: string | null | undefined; label: string; className?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener" className={`ui-caption ui-text-muted${className ? ` ${className}` : ''}`} data-testid="powered-by-badge">
      {label}
    </a>
  );
}
