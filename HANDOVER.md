# Proje Devir Dokümanı (Handover)

Bu dosya, projeyi Claude Code cloud session ile kaldığı yerden devam ettirmek için hazırlanmıştır. Önce `CLAUDE.md`, sonra bu dosya okunur. Bu dosya önceki Antigravity devir dokümanının yerine geçer; Antigravity artık kullanılmıyor.

Depo: https://github.com/kursatessiz/deneme (repo adı kalıcı isme taşınacak, bkz. Backlog 0.1)

---

## 1. Ürün tanımı

Üyelik ve randevu tabanlı işletmeler için çok kiracılı (multi-tenant) SaaS platformu. İlk müşteriler: iki bağımsız pilates stüdyosu (biri EMS alanı da olan). Hedef: pilates, PT, fizyoterapi, wellness/spa, yoga, dövüş sporları, yüzme okulu, tenis/padel kortu, müzik/dil kursu, çocuk aktivite merkezi, coworking oda kiralama gibi tüm sektörlerin kod değişmeden "işletme tipi şablonu" ile kurulabilmesi.

Referans alınan rakipler: Stuvio (TR), Momence, Mariana Tek, Mindbody, Glofox, WellnessLiving.

Ortak çekirdek: Seans + kapasiteli Kaynak + Hak (seans/süre/kredi) + Eğitmen + Ödeme. Bu beşli konfigüre edilebildiği sürece yeni sektör = yeni şablon.

## 2. Katmanlar

1. **Süper-admin paneli** (yalnızca platform sahibi): tenant yönetimi, plan/limit, işletme tipi şablonları, feature flag, global sözleşme/mesaj şablonları, SMS paketleri ve kredi yükleme, sağlayıcı SMS bakiyesi, benchmark, sistem sağlığı.
2. **İşletme paneli** (web, Next.js): takvim, üye, paket, finans, CRM, bildirim, sözleşme, rol/yetki, tema (logo + ana renk + gradient preset seçimi; başka özelleştirme yok).
3. **Tek mobil uygulama** (Expo): üye, eğitmen, resepsiyon ve sahip tüm yetenekleriyle aynı uygulamada; rol ve izinlere göre navigasyon; tablet için iki panelli düzen.

## 3. Bu oturumda alınan kesin kararlar

- Stack yalnızca TypeScript: Next.js (web), Expo/React Native (mobil), NestJS (API), Prisma, Postgres, Redis, BullMQ. Ek dil yok.
- Emoji hiçbir yerde kullanılmaz (kod, UI, commit, doküman, bildirim, seed).
- Ürün pilates'e özel değil; isim ve README değişecek.
- Kullanıcı kimliği global ve telefon numarası bazlı; işletmeye bağ `Membership` tablosu ile. Aynı kişi birden fazla işletmede farklı rollerde olabilir.
- Yetkilendirme izin tabanlı: sahip, eğitmen ve resepsiyon için `RoleTemplate` tanımlar, hangi ekranı/veriyi görebileceklerini belirler (örn. eğitmen üye telefonunu göremez ama yoklama alır). Sahip tüm izinlere sahiptir.
- Seans türleri, kaynak türleri, paket kuralları, iptal politikası, hakediş kuralı ve ölçüm formları tenant verisidir; enum değildir.
- Ekipman bazlı rezervasyon (üye "3 numaralı reformer"ı seçer; EMS cihazı çift rezervasyona kapalı).
- Bildirim: WhatsApp Cloud API öncelikli, SMS yedek (fallback). SMS platform tarafından kredi paketi olarak satılır; işletme kredi satın alır, sadece fiilen giden SMS'te kredi düşer. Süper-admin sağlayıcı bakiyesini (Netgsm / İleti Merkezi bakiye API'si) saatlik job ile görür.
- QR ile üye kaydı: sahip mobilde ad + telefon girer, QR anında oluşur, ekranda gösterilir veya WhatsApp/SMS ile gönderilir; üye okutur, OTP + PIN + KVKK onayı ile aktifleşir. Token 72 saat geçerli.
- QR ayrıca check-in için kullanılır.
- Tasarım: tasarım token'ları `packages/shared/src/design` altında; gradient yalnızca belirlenmiş yerlerde; jenerik "AI dashboard" görünümünden kaçınılır. Sahip referans ekran görüntülerini `docs/design-refs/` altına koyacak (Mobbin, Refero, Mariana Tek / Momence üye uygulamaları).
- Build sunucuda değil CI'da; sunucu (Ubuntu 24.04, 6 GB / 4 vCPU / 60 GB) yalnızca image çeker.

## 4. Mevcut kod durumu (24 Eylül 2026)

Var olanlar: Turborepo + pnpm monorepo (`@platform/*`), NestJS API (auth, schedules, trainers, members, notifications, health; Zod ile env doğrulama; `/health` PostgreSQL + Redis kontrolü), Next.js paneli (dashboard, takvim, üyeler, eğitmenler, paketler, `[studioSlug]/book`) mock veriyle, Prisma şeması + iki stüdyolu seed, Expo SDK 57 iskeleti.

CI/CD ve güvenlik (çalışır ve yerelde uçtan uca test edildi):
- `ci.yml`, `release.yml` (GHCR image, SBOM, provenance, SSH deploy), `deploy/scripts/deploy.sh` (yedek, migrate, smoke test, otomatik rollback), `nightly-deploy.sh` (cron ile pull tabanlı alternatif). Sunucuda build yok.
- CodeQL, dependency review, TruffleHog, zizmor, actionlint, OpenSSF Scorecard, Dependabot (7 gün bekleme, major'lar ayrı PR). Tüm action'lar SHA ile sabitli.
- Ajan workflow'ları (maliyet kademeli): Haiku issue etiketleme ve CI hata teşhisi; Haiku/Sonnet PR inceleme (diff boyutuna göre); `@claude` Sonnet, `/opus` ile Opus. `CLAUDE_AGENTS_ENABLED` değişkeni ve API anahtarı eklenene kadar pasif.

Eksikler: canlı güvenlik senaryoları (23 senaryo, yerelde geçti) Jest e2e testine çevrilip CI'da Postgres ile koşmalı; yüzde bazlı hakediş için seans fiyat kaynağı tanımlanmalı; web API'ye bağlı değil; mobil iskelet; SMS/WhatsApp sağlayıcı yok; süper-admin yok; test kapsamı düşük.

Sahibin yapması gereken GitHub ayarları: `docs/CICD_GUIDE.md` "Repository settings" bölümü.

Açık teknik sorular:
- Redis `allkeys-lru` politikası BullMQ ile uyumsuz (kuyruk anahtarları silinebilir). BullMQ devreye girerken (1.6) ya `noeviction` ya da kuyruk için ayrı Redis gerekecek.
- `NEXT_PUBLIC_API_URL` build anında gömülür; web API'ye bağlanırken (2.1) runtime config veya BFF proxy kararı verilmeli.

## 5. Şema değişiklikleri (mevcut `schema.prisma` üzerinde)

Kaldır:
- `SessionType` enum'u ve ona bağlı tüm alanlar (`PackageDefinition.sessionType`, `MemberPackage.sessionType`, `SessionSchedule.sessionType`, `TrainerProfile.specialties`)
- `User.studioId`, `@@unique([studioId, phone])`, `@@unique([studioId, email])`
- `Room` + `Equipment` ayrımı (tek `Resource` + `ResourceType` olur)
- `Studio.primaryColor/secondaryColor` (yerine `themePrimary`, `gradientPresetKey`, `logoUrl`)

Ekle:
- `BusinessTypeTemplate`, `Plan`, `Subscription`, `FeatureFlag`
- `Membership`, `RoleTemplate`, `RoleTemplatePermission` (izin anahtarları `packages/shared` sabit listesinden)
- `InviteToken`, `Consent`, `DocumentVersion`
- `ResourceType`, `Resource`
- `ServiceType` (name, durationMin, capacity, requiredResourceTypes, minRepeatIntervalDays, prerequisiteFormId, allowedEntitlementKinds, commissionRule, requiredQualification)
- `TrainerQualification` (trainerProfileId, serviceTypeId)
- `EntitlementKind` enum: SESSION_COUNT, TIME_UNLIMITED, CREDIT
- `PackageDefinitionService` (paket hangi hizmette kaç kredi düşer), `PackageTransfer`, `FamilyGroup`
- `BookingResource` (booking-kaynak ataması), `Waitlist`
- `MeasurementFormTemplate`, `MeasurementEntry`
- `SmsPackage`, `SmsWallet`, `SmsTransaction`
- `Expense`, `CommissionRule`
- `User.phone` global unique; `Membership` üzerinde `@@unique([userId, studioId])`

## 6. Backlog (öncelik sırasıyla)

### 0. Temizlik
- 0.1 Ürün adını seç, repo/README/package adlarını değiştir, tüm emojileri kaldır, pilates'e özel metinleri genelleştir (yapıldı: emoji temizliği, `@platform/*` kapsamı, nötr metinler; kalan: nihai ürün adı ve repo adı)
- 0.2 CLAUDE.md'yi bu dosyadaki kararlarla güncelle (yapıldı)
- 0.3 `docs/design-refs/` klasörü ve `packages/shared/src/design/tokens.ts` iskeleti (yapıldı)

### 1. Şema ve çekirdek API
- 1.1 Bölüm 5'teki şema revizyonu, migration, yeni seed (iki stüdyo + bir PT + bir fizyoterapi örneği) (yapıldı: ilk migration, veritabanı seviyesinde ekipman çakışma kısıtı, tek sahip / tek aktif abonelik kısıtları, 4 işletmeli seed)
- 1.2 Permission kataloğu, `RoleTemplate`, `PermissionGuard`, `@RequirePermission` (yapıldı: varsayılan reddeden guard, her istekte üyelik ve izinlerin DB'den yüklenmesi, eğitmen telefon göremez; kalan: rol yönetimi uç noktaları)
- 1.3 Global `User` + `Membership` + telefon OTP auth + `InviteToken` uç noktaları
- 1.4 `ServiceType`, `Resource`, çakışma kontrolü kaynak bazlı; bekleme listesi; iptal politikası motoru; eğitmen yerine geçme
- 1.5 Hak modeli (seans/süre/kredi), dondurma, devir, aile hesabı
- 1.6 Bildirim soyutlaması: kanal adaptörleri, şablonlar, fallback, SMS kredi düşümü, hatırlatma job'ları

### 2. Web panel
- 2.1 Mock verileri kaldır, API'ye bağla; izinlere göre menü
- 2.2 Takvim (gün/hafta/ay, kaynak ve eğitmen filtresi, sürükle-bırak), üye kartı, paket satışı, yoklama
- 2.3 Rol/yetki ekranı (sahip için), tema seçimi (gradient preset)
- 2.4 Finans: gelir-gider, hakediş, borç

### 3. Mobil (Expo)
- 3.1 Expo Router iskeleti, tasarım token'ları, rol bazlı navigasyon, tenant/rol değiştirici
- 3.2 QR üye kaydı akışı (oluştur, göster, gönder, okut, OTP, PIN, KVKK)
- 3.3 Üye: rezervasyon (kaynak seçimi), paket, bekleme listesi, ölçümler
- 3.4 Eğitmen: bugünün seansları, yoklama, notlar, hakediş
- 3.5 Sahip/resepsiyon: takvim, hızlı satış, QR check-in; tablet iki panel
- 3.6 Push bildirim, EAS Build, mağaza yayını

### 4. Süper-admin
- 4.1 Tenant CRUD, plan/limit, işletme tipi şablonları, feature flag
- 4.2 SMS paketleri, kredi yükleme, sağlayıcı bakiye job'ı, eşik uyarısı
- 4.3 Benchmark dashboard, sistem sağlığı, global şablonlar

### 5. Ödeme ve yasal
- 5.1 iyzico/PayTR online tahsilat, otomatik yenilenen üyelik
- 5.2 Sözleşme/KVKK versiyonlama ve dijital onay kaydı
- 5.3 e-Arşiv fatura (sonraki faz)

### 6. Canlıya alma
- 6.1 `deploy/scripts/server-init.sh` ile sunucu kurulumu, ilk dağıtım, yedek doğrulama
- 6.2 Gerçek Netgsm/İleti Merkezi ve WhatsApp Cloud API hesapları ile test

## 7. Sahibin sağlayacağı girdiler (henüz gelmedi)
- Tasarım referans ekran görüntüleri (3–4 ekran: ana, takvim, üye kartı, rezervasyon)
- İki stüdyonun gerçek hizmet türü / paket / eğitmen ücret / iptal kuralı listesi
- Ürün adı ve domain
- SMS sağlayıcı ve WhatsApp Cloud API hesap bilgileri (env olarak, repoya değil)

## 8. Claude Code'a başlangıç komutu

> Bu repo üyelik ve randevu tabanlı işletmeler için multi-tenant bir SaaS platformudur. Önce `CLAUDE.md`, sonra `HANDOVER.md` dosyalarını oku. HANDOVER.md bölüm 3'teki kararlar kesindir, bölüm 5 şema hedefidir, bölüm 6 sıralı backlog'dur. Backlog 0.1'den başla; her madde için ayrı branch ve PR aç, her PR'da testleri çalıştır. Emoji kullanma. Pilates'e özel bir kural görürsen genelleştir, belirsizse bana sor.
