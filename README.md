[![CI](https://github.com/kursatessiz/deneme/actions/workflows/ci.yml/badge.svg)](https://github.com/kursatessiz/deneme/actions/workflows/ci.yml)
[![Repository](https://img.shields.io/badge/GitHub-kursatessiz%2Fdeneme-blue?logo=github)](https://github.com/kursatessiz/deneme)

# Platform

Üyelik ve randevu tabanlı işletmeler için çok kiracılı (multi-tenant) bir SaaS platformu.
Seans, kapasite sınırlı kaynak ve seans veya kredi bazlı fiyatlandırma etrafında kurulmuş her
işe uyar: pilates ve reformer stüdyoları (ilk dikey), kişisel antrenörlük, fizyoterapi, yoga,
spa, dövüş sanatları, yüzme okulları, tenis ve padel kortları, müzik ve dil kursları, çocuk
aktivite merkezleri, ortak çalışma alanları. Yeni bir sektör kod değişikliği değil, süper
adminin tanımladığı bir iş türü şablonudur.

Kalıcı ürün adı henüz seçilmedi; depo ve dokümanlarda ürün "Platform" olarak anılır. Geliştirme
kuralları `CLAUDE.md`, devir notları ve backlog `HANDOVER.md` dosyasındadır. Dokümantasyonun
tamamı Türkçedir; kod, tanımlayıcılar ve commit mesajları İngilizcedir.

## Neler var

Üç uygulama ve iki paylaşılan paketten oluşan bir Turborepo monorepo'su. Tüm stack TypeScript'tir.

- **API (`apps/api`, NestJS 11)**: kimlik doğrulama (telefon OTP, PIN, şifre, TOTP 2FA), izin
  tabanlı yetkilendirme, çok şubeli işletme ve kaynak kataloğu, takvim ve rezervasyon (bekleme
  listesi, iptal politikası, eğitmen ikamesi, yer seçimi), üyeler ve paketler (seans, süre ve
  kredi bazlı haklar, dondurma, aile hesabı), ödemeler ve faturalama (Stripe, iyzico ve PayTR
  adaptörleri, banka havalesi, e-Arşiv entegratör soyutlaması, hakediş bordrosu, muhasebe dışa
  aktarımı, perakende ve stok), mesajlaşma motoru (e-posta, SMS, WhatsApp, push; kanal sırası ve
  fallback, bölgesel uyum ve İYS), CRM (kişiler, satış hattı, segmentler, kampanyalar, akışlar,
  reklam atıfı, dönüşüm hunileri), sadakat ve oyunlaştırma, etkinlikler, topluluk, video, sağlık
  entegrasyonu, herkese açık API ve webhook'lar, Zapier, partner platformları, yapay zeka
  çekirdeği, platform pazarlama modülü (marka kiti, yapay zeka stüdyosu, onaylar, sosyal yayın,
  Lead Ads, OAuth ile hesap bağlama), hata yakalama ve raporlama, yedek yönetimi, uygulama
  pazarı (ek modüller) ve süper admin uçları.
- **Web paneli (`apps/web`, Next.js 15 App Router)**: işletme paneli (takvim, üyeler, paketler,
  yoklama, finans, raporlar, CRM, kampanyalar, mağaza, etkinlikler, topluluk, ayarlar), süper
  admin paneli (`/admin`: kiracılar, planlar, iş türleri, feature flag'ler, içerik, SMS
  paketleri, benchmark, sistem sağlığı, hatalar, yedekler, pazarlama, entegrasyonlar, uygulama
  pazarı, denetim), platform sitesi ve kiracı siteleri (sayfa motoru), herkese açık rezervasyon
  ve gömülü widget. API'ye yalnızca BFF proxy üzerinden erişir.
- **Mobil uygulama (`apps/mobile`, Expo)**: üye, eğitmen, resepsiyon ve sahip için tek
  uygulama; navigasyon rol ve izinlerden üretilir, tablet için iki panelli düzen, QR ile üye
  kaydı ve check-in, takvim aboneliği ve ana ekran widget'ları, EAS build profilleri.
- **`packages/shared`**: tipler, Zod şemaları, enum'lar, izin kataloğu, Perfect UI tasarım
  token'ları (`docs/TASARIM.md`), i18n mesajları (Türkçe ve İngilizce), saf iş kuralları.
- **`packages/database`**: Prisma şeması, yalnızca ileri yönlü migration'lar, geliştirme seed'i.

Ayrıntılı işleyiş her modülün kendi dokümanındadır (aşağıdaki liste).

## Monorepo yapısı

```
.
├── apps/
│   ├── api/                    # NestJS 11 REST API, BullMQ, WebSocket, Swagger
│   ├── web/                    # Next.js 15 (App Router): işletme paneli, süper admin, siteler
│   └── mobile/                 # Expo (React Native), Expo Router: tek uygulama, tüm roller
├── packages/
│   ├── shared/                 # Tipler, Zod şemaları, enum'lar, izinler, tasarım, i18n
│   └── database/               # Prisma şeması, migration'lar, seed
├── deploy/
│   ├── docker/                 # Çok aşamalı üretim Dockerfile'ları
│   ├── docker-compose.prod.yml # Üretim compose yığını
│   ├── docker-compose.dev.yml  # Yerel geliştirme için Postgres ve Redis
│   ├── caddy/                  # Caddyfile (otomatik Let's Encrypt)
│   └── scripts/                # Sunucu kurulumu, deploy, yedek, rollback, kaynak haritası yükleme
├── docs/                       # Tüm modül ve işletim dokümanları (Türkçe)
├── .github/workflows/          # CI, release, güvenlik ve ajan workflow'ları
├── CLAUDE.md                   # Geliştirme standartları ve mimari kurallar
├── HANDOVER.md                 # Devir notları, kararlar ve backlog
└── turbo.json                  # Turborepo yapılandırması
```

## Yerel geliştirme

Gereksinimler: Node.js 22, pnpm ve yerel Postgres ile Redis için Docker.

```bash
# 1. Bağımlılıkları kur
pnpm install --frozen-lockfile

# 2. Yerel Postgres ve Redis'i başlat
docker compose -f deploy/docker-compose.dev.yml up -d

# 3. API ortam değişkenlerini hazırla
cp apps/api/.env.example apps/api/.env

# 4. Migration'ları uygula ve geliştirme verisini yükle
#    (packages/database DATABASE_URL'i ortamdan okur; apps/api/.env ile aynı değer)
export DATABASE_URL="postgresql://app_user:dev_password@localhost:5432/app_dev?schema=public"
pnpm db:migrate
pnpm db:seed

# 5. Tüm uygulamaları geliştirme modunda çalıştır
pnpm dev
```

- Web paneli: http://localhost:3000
- API Swagger dokümantasyonu: http://localhost:4000/api/docs
- API sağlık kontrolü: http://localhost:4000/health

Seed verisi iki örnek işletme, platform kiracısı ve demo kullanıcılar oluşturur; demo giriş
bilgileri `packages/database/prisma/seed.ts` içindedir. Mobil uygulama için `docs/MOBILE_APP.md`.

## Ortak scriptler

| Komut | Açıklama |
| --- | --- |
| `pnpm dev` | Tüm uygulamaları geliştirme modunda çalıştırır (Turborepo) |
| `pnpm build` | Tüm uygulama ve paketleri derler |
| `pnpm typecheck` | Tüm workspace'lerde tip denetimi |
| `pnpm test` | Birim testleri |
| `pnpm --filter @platform/api test:e2e` | API uçtan uca testleri (Postgres gerekir) |
| `pnpm --filter @platform/web test:e2e` | Web paneli tarayıcı testleri (Playwright) |
| `pnpm db:generate` | Prisma istemcisini üretir |
| `pnpm db:migrate` | Migration'ları uygular (geliştirme) |
| `pnpm db:seed` | Geliştirme verisini yükler |
| `pnpm audit --audit-level high` | Bağımlılık zafiyet denetimi |

Her değişiklik push edilmeden önce `pnpm install --frozen-lockfile`, `pnpm turbo run build
typecheck test`, taze bir veritabanında migration ve seed, API e2e paketi ve `pnpm audit`
yerelde geçmelidir (`CLAUDE.md`).

## CI/CD ve güvenlik

- `ci.yml`: build, typecheck, birim testleri, API e2e (Postgres servisi), web Playwright e2e,
  Docker imaj derlemesi, script ve workflow lint'i.
- `release.yml`: imajlar CI'da derlenip GHCR'ye push edilir (`sha-<commit>`), sunucu yalnızca
  imaj çeker; `deploy/scripts/deploy.sh` yedek, migration, smoke test ve otomatik rollback yapar.
- Güvenlik: CodeQL, dependency review, gizli bilgi taraması, zizmor, actionlint, OpenSSF
  Scorecard, Dependabot. Tüm GitHub Action'ları commit SHA'sına sabitlidir.
- Ajan workflow'ları (`claude-*.yml`) maliyet kademelidir ve `CLAUDE_AGENTS_ENABLED`
  değişkeni açılana kadar pasiftir. Ayrıntılar: `docs/CICD_GUIDE.md`.

## Durum

Backlog'daki tüm planlı modüller (`HANDOVER.md` bölüm 6, 6b, 6c ve büyüme, pazarlama, hata
raporlama, ön üretim maddeleri) main'de birleşmiş durumdadır. Bekleyenler:

- Sahibin kararına bağlı maddeler: nihai ürün adı ve tema, sunucu ve alan adı, sağlayıcı
  hesapları ve uygulama başvuruları (Meta, Google Ads, LinkedIn, TikTok, iyzico, PayTR, SES,
  Netgsm), Apple ve Google mağaza hesapları, GitHub Environments sırları. Liste `HANDOVER.md`
  bölüm 7'dedir.
- Gerçek sağlayıcı hesabı olmadan doğrulanamayan adaptörler (e-fatura entegratörleri, partner
  platformları, OAuth ile hesap bağlama, SES kimlik kurulumu) yerelde sahte sağlayıcılarla test
  edilmiştir; canlı doğrulama ön üretim ortamında yapılır.

## Dokümantasyon

Kurulum ve işletim
- Sunucu kurulumu ve ilk deploy: [`docs/UBUNTU_24_04_SETUP.md`](docs/UBUNTU_24_04_SETUP.md)
- CI/CD, ortamlar, sırlar, ön üretim ve ajan workflow'ları: [`docs/CICD_GUIDE.md`](docs/CICD_GUIDE.md)
- Veritabanı yedekleri: [`docs/YEDEKLER.md`](docs/YEDEKLER.md)
- Hata yakalama ve raporlama: [`docs/HATA_RAPORLAMA.md`](docs/HATA_RAPORLAMA.md)
- Güvenlik politikası: [`SECURITY.md`](SECURITY.md)

Mimari
- Veritabanı şeması: [`docs/DATABASE_ERD.md`](docs/DATABASE_ERD.md)
- Web paneli mimarisi: [`docs/WEB_PANEL.md`](docs/WEB_PANEL.md)
- Mobil uygulama: [`docs/MOBILE_APP.md`](docs/MOBILE_APP.md), takvim ve widget'lar: [`docs/MOBILE_WIDGETS.md`](docs/MOBILE_WIDGETS.md)
- Süper admin paneli: [`docs/SUPER_ADMIN.md`](docs/SUPER_ADMIN.md)
- Çoklu dil: [`docs/I18N.md`](docs/I18N.md)
- Büyüme ve global mimari (bağlayıcı tasarım): [`docs/BUYUME_VE_GLOBAL_MIMARI.md`](docs/BUYUME_VE_GLOBAL_MIMARI.md)

İşletme modülleri
- Ödemeler: [`docs/PAYMENTS.md`](docs/PAYMENTS.md), banka ödemeleri ve mutabakat: [`docs/BANKA_ODEMELERI.md`](docs/BANKA_ODEMELERI.md)
- e-Arşiv ve e-Fatura: [`docs/INVOICING.md`](docs/INVOICING.md), muhasebe dışa aktarımı: [`docs/MUHASEBE.md`](docs/MUHASEBE.md)
- Eğitmen hakediş bordrosu: [`docs/PAYROLL.md`](docs/PAYROLL.md)
- Perakende ve stok: [`docs/PERAKENDE.md`](docs/PERAKENDE.md)
- Etkinlikler, atölyeler ve kurslar: [`docs/ETKINLIKLER.md`](docs/ETKINLIKLER.md)
- Check-in kiosku ve QR: [`docs/CHECKIN.md`](docs/CHECKIN.md)
- Raporlar: [`docs/REPORTS.md`](docs/REPORTS.md), dönüşüm hunileri: [`docs/HUNILER.md`](docs/HUNILER.md)
- Ayrılma riski: [`docs/CHURN.md`](docs/CHURN.md)
- Sadakat puanı: [`docs/SADAKAT.md`](docs/SADAKAT.md), oyunlaştırma: [`docs/GAMIFICATION.md`](docs/GAMIFICATION.md)
- Puan, Google yorumu ve arkadaşını getir: [`docs/FEEDBACK_REFERRAL.md`](docs/FEEDBACK_REFERRAL.md)
- Topluluk ve erişim katmanları: [`docs/TOPLULUK.md`](docs/TOPLULUK.md)
- Video: [`docs/VIDEO.md`](docs/VIDEO.md), sağlık entegrasyonu: [`docs/HEALTH_INTEGRATION.md`](docs/HEALTH_INTEGRATION.md)
- Partner platformları: [`docs/PARTNERS.md`](docs/PARTNERS.md)
- Deneme süresi, etkinleştirme ve işletmeden işletmeye tavsiye: [`docs/DENEME_VE_ETKINLESTIRME.md`](docs/DENEME_VE_ETKINLESTIRME.md)
- Uygulama pazarı (ek modüller): [`docs/UYGULAMA_PAZARI.md`](docs/UYGULAMA_PAZARI.md)

Mesajlaşma, CRM ve pazarlama
- Mesajlaşma motoru: [`docs/MESAJLASMA.md`](docs/MESAJLASMA.md) (W7 kanal notları: [`docs/MESSAGING.md`](docs/MESSAGING.md))
- CRM ve atıf: [`docs/CRM_VE_ATIF.md`](docs/CRM_VE_ATIF.md)
- Segmentler, kampanyalar ve akışlar: [`docs/KAMPANYA_VE_AKISLAR.md`](docs/KAMPANYA_VE_AKISLAR.md)
- Reklam entegrasyonu: [`docs/REKLAM_ENTEGRASYONU.md`](docs/REKLAM_ENTEGRASYONU.md)
- Sayfa motoru (platform ve kiracı siteleri): [`docs/SAYFA_MOTORU.md`](docs/SAYFA_MOTORU.md)
- Teknik SEO (dizinleme, metadata, Open Graph, JSON-LD): [`docs/SEO.md`](docs/SEO.md)
- Yapay zeka çekirdeği: [`docs/YAPAY_ZEKA.md`](docs/YAPAY_ZEKA.md)
- Pazarlama modülü ve pazarlama yöneticisi rolü: [`docs/PAZARLAMA_MODULU.md`](docs/PAZARLAMA_MODULU.md)

Açık platform
- API anahtarları, herkese açık API ve webhook'lar: [`docs/PUBLIC_API.md`](docs/PUBLIC_API.md)
- Zapier ve REST hook araçları: [`docs/ZAPIER.md`](docs/ZAPIER.md)

Kullanımdan kaldırılan dokümanlar (yalnızca geçmiş için): [`docs/AUTOMATIONS.md`](docs/AUTOMATIONS.md) (yerine akışlar), [`docs/LEADS.md`](docs/LEADS.md) (yerine CRM).
