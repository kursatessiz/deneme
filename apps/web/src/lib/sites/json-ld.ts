/**
 * Serializes structured data for an inline `<script type="application/ld+json">`.
 * Page text is tenant input, so `<`, `>` and `&` are escaped as JSON unicode
 * escapes: a value containing `</script>` can never close the tag early.
 * U+2028/U+2029 are escaped too, as older parsers treat them as line breaks.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
