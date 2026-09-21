# Pilates Studio OS - Proje Oturum Devir & Durum Özeti (Handover)

Bu dosya, projeyi başka bir bilgisayarda Antigravity veya herhangi bir yapay zeka asistanı ile **kaldığı yerden hiçbir bilgi ve bağlam kaybı olmadan** devam ettirmek için hazırlanmıştır.

---

## 1. Projenin Mevcut Durumu

- **Depo:** [https://github.com/pro-emtia/deneme](https://github.com/pro-emtia/deneme)
- **Organizasyon:** `pro-emtia` | **Repo:** `deneme`
- **Mimari:** Full TypeScript Monorepo (Turborepo + pnpm)
- **Durum:** Temel mimari, veri modelleri, API, Web paneli, mobil iskelet, Ubuntu 24.04 üretim altyapısı ve gece 03:00 otomatik derleme/dağıtım scriptleri tamamlanıp Git'e aktarıldı (`main` branch).

---

## 2. Temel Bileşenler ve Konfigürasyon

| Alan | Teknoloji | Açıklama |
| :--- | :--- | :--- |
| **Web Panel** | Next.js 15 Standalone | Operasyon dashboard'u, reformer takvimi, üye listesi, sağlık notları, mobil rezervasyon (`apps/web`). |
| **Backend API** | NestJS 11 | Multi-tenant stüdyo koruması (`StudioTenantGuard`), çakışma önleyici takvim motoru, eğitmen hakediş bordrosu (`apps/api`). |
| **Mobil Uygulama**| Expo (React Native) | Üye seans kredisi sayacı, QR check-in ekranı (`apps/mobile`). |
| **Veritabanı** | PostgreSQL 16 + Prisma | İki stüdyo için tam izole veri modeli ve başlangıç verisi (`packages/database`). |
| **Sunucu** | Ubuntu 24.04 (6GB RAM / 4 vCPU) | 4GB Swap, UFW güvenlik duvarı, Caddy otomatik SSL (`deploy/`). |
| **CI/CD** | 100% Ücretsiz Self-Hosted | Gece 03:00'te çalışan sıralı derleme, otomatik yedekleme ve rollback (`deploy/scripts/nightly-deploy.sh`). |

---

## 3. İki Stüdyonun Başlangıç Verileri

- **Stüdyo 1:** Zen Reformer Pilates (Nişantaşı) • Yönetici: `elif@zenpilates.com` / `admin123`
- **Stüdyo 2:** Flow Boutique Pilates & Wellness (Bağdat Caddesi)
- **Örnek Üye:** `ayse.demir@example.com` / `admin123` (10 seanslık aktif paket, L4-L5 bel fıtığı uyarısı)
- **Örnek Eğitmen:** Selin Aydın (350 TL seans başı sabit ücret)

---

## 4. Sıradaki Öncelikli İşler (Backlog)

1. **Sunucu Kurulumu:** Ubuntu 24.04 sunucuya bağlanıp `deploy/scripts/server-init.sh` çalıştırmak ve ilk canlı dağıtımı yapmak.
2. **Web ve API Veri Bağlantısı:** Web dashboard ve takvim ekranlarının API mock durumundan canlı `/api/*` fetch çağrılarına bağlanması.
3. **SMS Entegrasyonu:** Netgsm kullanıcı adı/şifresi tanımlanarak gerçek SMS gönderiminin test edilmesi.
4. **Mobil Expo Testi:** `apps/mobile` klasöründe Expo Go ile mobil önizleme yapılması.

---

## 5. Yeni Bilgisayarda AI Asistanına Verilecek Başlatma Komutu

> "Bu repo Pilates Studio OS projesidir. Projenin mimarisini, kurallarını ve şu anki aşamasını `CLAUDE.md` ve `HANDOVER.md` dosyalarından oku. Bu oturumu önceki bilgisayarımdan devralıyorsun. Kaldığımız yerden devam edelim."
