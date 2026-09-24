/** A single feature highlight card on the root landing page. */
export function LandingFeature({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
      <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>
        {description}
      </p>
    </div>
  );
}
