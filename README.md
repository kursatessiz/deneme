[![CI](https://github.com/kursatessiz/deneme/actions/workflows/ci.yml/badge.svg)](https://github.com/kursatessiz/deneme/actions/workflows/ci.yml)
[![Repository](https://img.shields.io/badge/GitHub-kursatessiz%2Fdeneme-blue?logo=github)](https://github.com/kursatessiz/deneme)

# Platform

Üyelik ve randevu tabanlı işletmeler için çok kiracılı (multi-tenant) bir SaaS platformu. İlk
müşteriler iki bağımsız pilates/reformer stüdyosu olsa da platform pilatese özgü değildir: seans,
kapasite sınırlı kaynaklar ve seans veya kredi bazlı fiyatlandırma etrafında kurulmuş her türlü
işe uyacak şekilde tasarlanmıştır (kişisel antrenörlük, fizyoterapi, yoga, spa, dövüş sanatları,
yüzme okulları, tenis/padel kortları, müzik ve dil kursları, çocuk aktivite merkezleri, ortak
çalışma alanları). Kalıcı bir ürün adı henüz seçilmedi; bu depo ve dokümanlarında ürün "Platform"
olarak anılır. Ürünün tam tanımı ve iş listesi (backlog) için `HANDOVER.md` dosyasına
bakın.

## Monorepo yapısı

```
.
├── apps/
│   ├── api/                    # NestJS 11 REST API, BullMQ queues, WebSocket
│   ├── web/                    # Next.js 15 (App Router) admin panel and booking pages
│   └── mobile/                 # Expo (React Native) client - currently a skeleton
├── packages/
│   ├── shared/                 # Shared TypeScript types, Zod schemas, enums
│   └── database/               # Prisma schema, migrations, seed
├── deploy/
│   ├── docker/                 # Multi-stage production Dockerfiles
│   ├── docker-compose.prod.yml # Production compose stack
│   ├── docker-compose.dev.yml  # Local Postgres + Redis for development
│   ├── caddy/                  # Caddyfile (automatic Let's Encrypt SSL)
│   └── scripts/                # Server bootstrap, deploy, backup, rollback scripts
├── docs/
│   ├── UBUNTU_24_04_SETUP.md   # Server bootstrap and first deploy
│   ├── CICD_GUIDE.md           # CI/CD pipeline, secrets, agentic workflows
│   └── DATABASE_ERD.md         # Database schema overview
├── .github/workflows/          # CI, release, security and agentic workflows
├── CLAUDE.md                   # Development standards and architecture rules
└── turbo.json                  # Turborepo configuration
```

## Yerel geliştirme

Gereksinimler: Node.js 20+ (22 önerilir), pnpm ve yerel Postgres/Redis için Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start local Postgres and Redis
docker compose -f deploy/docker-compose.dev.yml up -d

# 3. Configure the API environment
cp apps/api/.env.example apps/api/.env

# 4. Push the Prisma schema to the local database
pnpm --filter @platform/database exec prisma db push

# 5. Run every app in development mode
pnpm dev
```

- Web admin paneli: http://localhost:3000
- API Swagger dokümantasyonu: http://localhost:4000/api/docs
- API health check: http://localhost:4000/health

## Ortak scriptler

| Command | Description |
| --- | --- |
| `pnpm dev` | Run all apps in development mode (Turborepo) |
| `pnpm build` | Build all apps and packages |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm test` | Run unit tests |
| `pnpm db:generate` | Generate the Prisma client |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed the database |

## Durum

- `apps/web` mock veriden render ediliyor ve henüz API'ye bağlanmadı.
- `apps/mobile` bir iskelet (tek bir `App.tsx`), henüz çalışan bir istemci değil.
- `apps/api` çekirdek modülleri dışında test kapsamı düşük.

Planlanan çalışmalar için `HANDOVER.md` (backlog, bölüm 6) dosyasına bakın; bu, `SessionType`
gibi pilatese özgü alanları kiracı tarafından yapılandırılabilir hizmet türleri lehine
kaldıracak şema revizyonunu da içerir. 

## Dokümantasyon

- Sunucu kurulumu ve ilk deploy: [`docs/UBUNTU_24_04_SETUP.md`](docs/UBUNTU_24_04_SETUP.md)
- CI/CD pipeline, secret'lar ve agentic workflow'lar: [`docs/CICD_GUIDE.md`](docs/CICD_GUIDE.md)
- Veritabanı şeması genel bakışı: [`docs/DATABASE_ERD.md`](docs/DATABASE_ERD.md)
- Potansiyel müşteri hattı ve web formu: [`docs/LEADS.md`](docs/LEADS.md)
- Güvenlik politikası ve zafiyet bildirimi: [`SECURITY.md`](SECURITY.md)
