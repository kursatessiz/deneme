# Pilates Studio OS 🧘‍♀️✨
### Modern Çoklu Kiracılı (Multi-Tenant) Boutique Pilates Stüdyo Yönetim Sistemi

[![CI](https://github.com/pro-emtia/deneme/actions/workflows/ci.yml/badge.svg)](https://github.com/pro-emtia/deneme/actions/workflows/ci.yml)
[![Repository](https://img.shields.io/badge/GitHub-pro--emtia%2Fdeneme-blue?logo=github)](https://github.com/pro-emtia/deneme)

Birbirinden bağımsız çalışan pilates stüdyoları için randevu takvimi, kalan seans kredisi takibi, eğitmen hakedişleri, sağlık/fıtık uyarıları ve otomatik SMS bildirimlerini tek çatı altında toplayan TypeScript Monorepo platformu.

---

## 🏗️ Teknoloji Yığını (Tech Stack)

- **Monorepo:** Turborepo + pnpm Workspaces
- **Backend API (`apps/api`):** NestJS 11, Prisma ORM, BullMQ (Kuyruk & Cron), Passport JWT, Swagger
- **Web Paneli (`apps/web`):** Next.js 15 (App Router, Standalone mode), React 19, Tailwind CSS, Lucide Icons
- **Mobil Uygulama (`apps/mobile`):** Expo (React Native)
- **Veritabanı & Önbellek:** PostgreSQL 16 + Redis 7
- **Ters Proxy & SSL:** Caddy (Otomatik Let's Encrypt SSL, HTTP/3)
- **Sunucu Altyapısı:** Ubuntu 24.04 LTS (6 GB RAM / 4 vCPU / 60 GB SSD için optimize)
- **CI/CD & Dağıtım Seçenekleri:**
  - **Seçenek 1 (0 ₺ Maliyet - Self-Hosted):** Sunucu üzerinde gece 03:00'te sıralı derleme, otomatik yedekleme ve auto-rollback ([Rehber](docs/SELF_HOSTED_NIGHTLY_GUIDE.md)).
  - **Seçenek 2 (Cloud):** GitHub Actions Agentic Pipeline (Build offloading, Smoke Test, Auto-Rollback).

---

## 📁 Proje Yapısı

```
.
├── apps/
│   ├── api/                   # NestJS REST & WebSocket API, BullMQ servisleri
│   ├── web/                   # Next.js 15 Admin Paneli & Mobil Rezervasyon Sayfası
│   └── mobile/                # Expo React Native Üye & Eğitmen Uygulaması
├── packages/
│   ├── shared/                # Paylaşılan Tipler, Zod Validatörleri ve Enum'lar
│   └── database/              # Prisma Şeması, Migration'lar ve Başlangıç Verisi (Seed)
├── deploy/
│   ├── docker/                # Multi-stage production Dockerfile'ları
│   ├── docker-compose.prod.yml# Üretim Docker Compose ortamı
│   ├── docker-compose.dev.yml # Yerel geliştirme veritabanı (Postgres + Redis)
│   ├── caddy/                 # Caddyfile (Otomatik SSL Ters Proxy)
│   └── scripts/               # Sunucu hazırlama, yedekleme, rollback scriptleri
├── docs/                      # Detaylı Kurulum & Mimari Dokümantasyonu
│   ├── UBUNTU_24_04_SETUP.md  # Ubuntu 24.04 sunucu hazırlama ve güvenlik
│   ├── CICD_GUIDE.md          # GitHub Actions Agentic CI/CD ve Rollback
│   └── DATABASE_ERD.md        # Veritabanı şeması ve ERD diyagramı
├── .github/workflows/ci-cd.yml# Otomatik test, derleme ve dağıtım iş akışı
├── CLAUDE.md                  # Geliştirme standartları ve mimari kuralları
└── turbo.json                 # Turborepo yapılandırması
```

---

## 🚀 Yerel Geliştirme (Local Development)

### Gereksinimler
- Node.js 20+ veya 22 LTS
- pnpm veya npm
- Docker (yerel Postgres ve Redis için)

### Adım Adım Başlangıç

1. **Bağımlılıkları Yükleyin:**
   ```bash
   pnpm install
   ```

2. **Yerel Veritabanını Başlatın:**
   ```bash
   docker compose -f deploy/docker-compose.dev.yml up -d
   ```

3. **Veritabanı Şemasını ve Başlangıç Verilerini Yükleyin:**
   ```bash
   # Ortam değişkeni dosyasını hazırlayın
   cp .env.example .env

   # Prisma istemcisini derleyin ve veritabanını oluşturun
   pnpm turbo run db:generate
   pnpm turbo run db:migrate

   # Örnek stüdyo, eğitmen ve seans verilerini yükleyin
   pnpm turbo run db:seed
   ```

4. **Tüm Uygulamaları Geliştirme Modunda Çalıştırın:**
   ```bash
   pnpm dev
   ```

- **Web Yönetim Paneli:** [http://localhost:3000](http://localhost:3000)
- **API Swagger Dokümantasyonu:** [http://localhost:4000/api/docs](http://localhost:4000/api/docs)
- **API Sağlık Kontrolü:** [http://localhost:4000/health](http://localhost:4000/health)

---

## 🔐 Başlangıç Giriş Bilgileri (Seed Verisi)

| Kullanıcı Rolü | E-Posta | Şifre | Stüdyo |
| :--- | :--- | :--- | :--- |
| **Stüdyo Yöneticisi** | `elif@zenpilates.com` | `admin123` | Zen Reformer Pilates (Nişantaşı) |
| **Eğitmen** | `selin@zenpilates.com` | `admin123` | Zen Reformer Pilates |
| **Üye** | `ayse.demir@example.com` | `admin123` | 10 Seanslık Aktif Paketi Var |

---

## 🛡️ Ubuntu 24.04 Üretim Dağıtımı & CI/CD

Detaylı sunucu hazırlama ve dağıtım talimatları için dokümantasyon klasörünü inceleyin:
- Sunucu kurulumu ve Swap ayarları: [`docs/UBUNTU_24_04_SETUP.md`](docs/UBUNTU_24_04_SETUP.md)
- GitHub Actions CI/CD ve Auto-Rollback: [`docs/CICD_GUIDE.md`](docs/CICD_GUIDE.md)
- Veritabanı ve Multi-Tenant mimarisi: [`docs/DATABASE_ERD.md`](docs/DATABASE_ERD.md)
