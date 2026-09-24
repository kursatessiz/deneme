import Link from 'next/link';
import { DEFAULT_TENANT_THEME } from '@platform/shared';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { LandingFeature } from './landing-feature';

/**
 * Product landing page (no tenant context). Uses the default tenant theme
 * (see packages/shared/src/design) so the page reads as part of the
 * product without impersonating any single studio's brand.
 */
export default function RootLandingPage() {
  const features = [
    {
      title: 'Online rezervasyon',
      description: 'Üyeler seans ve randevularını kendi telefonlarından planlar, bekleme listesine katılır.',
    },
    {
      title: 'Paket ve kredi takibi',
      description: 'Seans sayısı, sınırsız süre veya kredi tabanlı paketler; dondurma ve transfer dahil.',
    },
    {
      title: 'Ödeme ve e-fatura',
      description: 'Tahsilat, iade, taksit ve otomatik fatura kesimi tek ekrandan yönetilir.',
    },
    {
      title: 'Raporlar',
      description: 'Doluluk, gelir, yenileme ve personel hakediş raporları şube bazında.',
    },
    {
      title: 'Mobil uygulama',
      description: 'Üye, eğitmen, resepsiyon ve işletme sahibi için tek uygulama, rol bazlı ekranlar.',
    },
  ];

  return (
    <ThemeRoot tenantTheme={DEFAULT_TENANT_THEME} appearance={{ themeFamily: null, colorScheme: 'SYSTEM' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <header
          style={{
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em' }}>Platform</span>
          <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Link href="/giris" style={{ color: 'var(--color-text-secondary)', fontSize: 14, textDecoration: 'none' }}>
              Giriş yap
            </Link>
          </nav>
        </header>

        <main style={{ flex: 1 }}>
          <section
            style={{
              maxWidth: 880,
              margin: '0 auto',
              padding: '72px 24px 48px',
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: 'clamp(28px, 5vw, 44px)',
                fontWeight: 800,
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              Üyelik ve randevu tabanlı işletmeniz için tek platform
            </h1>
            <p
              style={{
                marginTop: 18,
                fontSize: 17,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.6,
              }}
            >
              Stüdyolar, kişisel antrenörlük, fizyoterapi, kortlar, kurslar ve benzeri işletmeler için
              takvim, paket/kredi yönetimi, ödeme ve raporlama; kod değişikliği gerektirmeden
              işletmenize göre yapılandırılır.
            </p>

            <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                href="/giris"
                style={{
                  padding: '13px 26px',
                  borderRadius: 'var(--radius-button)',
                  fontWeight: 700,
                  fontSize: 15,
                  color: '#fff',
                  textDecoration: 'none',
                  backgroundImage: 'var(--gradient-brand)',
                }}
              >
                Giriş yap
              </Link>
              <a
                href="#iletisim"
                style={{
                  padding: '13px 26px',
                  borderRadius: 'var(--radius-button)',
                  fontWeight: 600,
                  fontSize: 15,
                  color: 'var(--color-text-primary)',
                  textDecoration: 'none',
                  border: '1px solid var(--color-border)',
                }}
              >
                İşletmenizi kaydedin
              </a>
            </div>
          </section>

          <section
            style={{
              maxWidth: 1040,
              margin: '0 auto',
              padding: '24px 24px 64px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
            }}
          >
            {features.map((f) => (
              <LandingFeature key={f.title} title={f.title} description={f.description} />
            ))}
          </section>

          <section id="iletisim" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>İşletmenizi kaydedin</h2>
              <p style={{ marginTop: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                İşletmenizi platforma taşımak için bizimle iletişime geçin, ihtiyaçlarınıza uygun planı birlikte
                belirleyelim.
              </p>
              <a
                href="mailto:iletisim@example.com"
                style={{ display: 'inline-block', marginTop: 16, color: 'var(--color-text-primary)', fontWeight: 600 }}
              >
                iletisim@example.com
              </a>
            </div>
          </section>
        </main>

        <footer
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: '20px 24px',
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            fontSize: 13,
            color: 'var(--color-text-muted)',
          }}
        >
          <span>Platform</span>
          <a href="/gizlilik" style={{ color: 'inherit' }}>
            KVKK ve gizlilik
          </a>
        </footer>
      </div>
    </ThemeRoot>
  );
}
