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

Eksikler: canlı güvenlik senaryoları (23 senaryo, yerelde geçti) Jest e2e testine çevrilip CI'da Postgres ile koşmalı; web API'ye bağlı değil; mobil iskelet; SMS/WhatsApp sağlayıcı yok; süper-admin yok; test kapsamı düşük.

Sahibin yapması gereken GitHub ayarları: `docs/CICD_GUIDE.md` "Repository settings" bölümü.

Açık teknik sorular:
- Redis politikası `noeviction` olarak değiştirildi (W10): BullMQ kuyruk anahtarları silinmez; önbellek ve hız sınırı anahtarları TTL ile yazıldığı için bellek dolmaz.
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

### 0.9 Planlı major sürüm yükseltmeleri
Dependabot npm major sürümlerini önermez; bunlar kod değişikliği gerektiren planlı işlerdir. Her biri ayrı branch ve PR ile, CI ve e2e testleri yeşilken yapılır:
- TypeScript 7, NestJS 12 (tüm `@nestjs/*` birlikte), Prisma 7 (`prisma` ve `@prisma/client` birlikte, `datasource url` yapılandırması değişiyor), Zod 4 (`error.errors` yerine `error.issues`), Jest 30
- Next 16 ve Tailwind 4 (web API'ye bağlanırken, 2.1 ile birlikte)
- Expo SDK yükseltmeleri (`react`, `react-native` yalnızca Expo ile birlikte)

### 1. Şema ve çekirdek API
- 1.1 Bölüm 5'teki şema revizyonu, migration, yeni seed (iki stüdyo + bir PT + bir fizyoterapi örneği) (yapıldı: ilk migration, veritabanı seviyesinde ekipman çakışma kısıtı, tek sahip / tek aktif abonelik kısıtları, 4 işletmeli seed)
- 1.2 Permission kataloğu, `RoleTemplate`, `PermissionGuard`, `@RequirePermission` (yapıldı: varsayılan reddeden guard, her istekte üyelik ve izinlerin DB'den yüklenmesi, eğitmen telefon göremez; kalan: rol yönetimi uç noktaları)
- 1.3 Global `User` + `Membership` + telefon OTP auth + `InviteToken` uç noktaları (yapıldı: OTP ile giriş, PIN ve kilitleme, QR/SMS davet, KVKK ve sözleşme onayı; SMS şimdilik mock; WhatsApp gönderimi 1.6'da)
- 1.4 `ServiceType`, `Resource`, çakışma kontrolü kaynak bazlı; bekleme listesi; iptal politikası motoru; eğitmen yerine geçme (yapıldı: iptal politikası motoru (ücretsiz iptal süresi, geç iptal ve gelmeme için birim bazlı ceza, personel muafiyeti, eşzamanlı iptalde çifte iade engeli), gelmedi işaretleme, bekleme listesi (personel ve üye kendisi için katılır/ayrılır, iptalde sıradaki üye otomatik rezerve edilir, ödeyemeyen kayıt gerekçesiyle atlanır, push bildirimi), eğitmen değiştirme (yetkinlik ve çakışma kontrolü, planlanan eğitmenin saklanması, üyelere bildirim, audit log); W1 ile: hizmet türü, kaynak türü, kaynak ve iptal politikası yönetim uç noktaları (`catalog` modülü, tek varsayılan politika, pasifleştirme, başka işletmenin kayıtlarına karşı kontrol), seansın tamamını iptal etme (tam iade, bekleme listesinin kapatılması, bildirim, audit log); kalan: bekleme listesi için teklif süreli (onaylı) mod)
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

## 6b. Rekabet analizi ve endüstri lideri backlog'u (24 Eylül 2026)

İncelenen platformlar: Mindbody, Mariana Tek, Momence, Arketa, Glofox, WellnessLiving, bsport, Zenoti, TeamUp, Walla; Türkiye'de Stuvio, GymKod, BulutGym, piSEANS, Gymtekno ve klinik yazılımları.

Liderlerin şu anki üç farkı: (1) sahibin panelinde ayrılma riski tahmini, (2) uygulamayı günlük kullanılan bir ürüne çeviren içerik ve topluluk katmanı, (3) ürünün içine gömülü pazarlama otomasyonu ve CRM.

Bizim şimdiden önde olduğumuz yerler: ekipman seviyesinde çift rezervasyonun veritabanında engellenmesi, birden çok işletmede tek kimlik, izin tabanlı roller, sürümlü KVKK onayları, tek platformda çok sektör.

### P0: gelir çekirdeği ve Türkiye zorunlulukları
- Online ödeme, otomatik yenilenen üyelik, başarısız ödemeyi tekrar deneme (dunning), taksit; havale/IBAN tahsilat kaydı (5.1)
- Geç iptal ve gelmeme için otomatik ücret veya hak düşümü (1.4 iptal politikası motoru)
- Bekleme listesinden otomatik yer atama ve anında push/WhatsApp teklifi (1.4)
- Ekipman seçim ekranı ("reformer 3", "kort 2"): altyapı hazır, arayüz yok (3.3)
- WhatsApp Cloud API şablon mesajları, SMS'e düşme; İYS entegrasyonu ile kampanya izni kontrolü, işlemsel ve ticari mesaj ayrımı (1.6)
- e-Arşiv/e-Fatura entegratörü (5.3'ten öne alındı)
- Deneme dersi teklifi, promosyon kodu, hediye kartı

### P1: elde tutma ve büyüme
- Otomatik akışlar: kaybolan üyeyi geri kazanma, paket bitiyor, doğum günü, ilk dersten sonra takip
- Potansiyel müşteri hattı (web formu ve Instagram'dan gelen talep, deneme dersi, üyelik)
- Ayrılma riski skoru: önce kural tabanlı (katılım düşüşü, paket bitişi), sonra model
- Raporlar: doluluk, gelir, üye başına gelir, yenileme oranı, kohortlar, eğitmen performansı
- Eğitmen hakedişinin otomatik bordro çıktısı
- Ders sonrası puan ve Google yorumu yönlendirme; arkadaşını getir programı

### P2: fark yaratanlar
- Topluluk ve oyunlaştırma: seri, kilometre taşları (50. ders), rozetler, aylık hedefler
- Tablet check-in kiosku, QR, turnike ve kapı entegrasyonu
- Web sitesine gömülebilir rezervasyon widget'ı, herkese açık API ve webhook
- İsteğe bağlı video kütüphanesi ve canlı yayın
- Wellhub (Gympass) gibi toplayıcı entegrasyonları
- Apple Health / Health Connect ile ölçüm paylaşımı
- Çok şube ve franchise görünümü

### 6c. Uygulama sırası (sahibin onayı, 24 Eylül 2026)

Sahip, bölüm 6b'deki tüm maddelerin turnike ve kapı entegrasyonu hariç uygulanmasını istedi. Ek istekler: tüm tema aileleri sunulacak (işletme varsayılanı seçer, kullanıcı kendi cihazında değiştirebilir), çok şube yönetimi zorunlu, mobilde takvime ekleme ve ana ekran widget'ı olacak. Her madde ayrı PR'dır.

| No | Madde | Kapsam |
|----|-------|--------|
| W1 | Katalog yönetimi (1.4 kalanı) | Hizmet türü, kaynak türü, kaynak, iptal politikası uç noktaları; seansın tamamını iptal etme (iade ve bildirimle). Yapıldı |
| W2 | Çok şube | Şube CRUD, personelin erişebildiği şubeler, şubeye göre takvim/kaynak/üye filtresi, üyenin ana şubesi, şubeler arası özet; birden çok işletmenin sahibi için birleşik (franchise) görünüm. Yapıldı: `branches.manage` izni, personel şube kısıtı (guard seviyesinde, takvim, rezervasyon, yoklama, bekleme listesi, eğitmen değişimi ve seans iptalinde uygulanır), odanın şubesinden seansın şubesi, üyenin ana şubesi (personel ve üye kendisi), şube özeti (doluluk, katılım, gelmeme, gelir, üye), çoklu işletme portföyü, ödemelerde şube alanı, mobilde Ana şubem ve Şube özeti ekranları. Kalan: web paneli 2.1 ile |
| W3 | Tema aileleri | Stüdyo Noir, Nefes, Saha, Atölye token setleri; işletme varsayılanı, kullanıcı tercihi (tema ve açık/koyu), mobil ve web tema sağlayıcısı. Yapıldı: dört aile (yazı tipi, köşe, nötr renkler, beşer gradyan, açık ve koyu mod, WCAG testleri), `resolveTheme()` ve web için `themeCssVariables()`, işletme teması uç noktası (audit log), kullanıcı görünüm uç noktası, mobilde tema sağlayıcısı, fontlar, gradyanlı birincil buton ve başlık bandı, Hesabım altında Görünüm ve İşletme teması ekranları. Kalan: web panelinin temaya bağlanması 2.1 ile |
| W4 | Takvim ve widget | Rezervasyonu cihaz takvimine ekleme, kişisel ICS takvim aboneliği, iOS widget (`expo-widgets`) ve Android widget (`react-native-android-widget`): sıradaki seans ve kalan hak. Yapıldı: `GET /me/bookings/upcoming`, `GET /me/summary`, kişisel ICS aboneliği (yalnızca hash saklanır, döndürme ve iptal, IP bazlı hız sınırı), Takvime ekle, Hesabım > Takvim aboneliği, iOS ve Android widget'ları. Kurulum ve sahipten beklenenler: `docs/MOBILE_WIDGETS.md` |
| W5 | Ekipman seçim ekranı | Kaynak doluluk uç noktası, mobilde yerleşim planı üzerinden seçim. Yapıldı: `Resource` üzerinde opsiyonel `layoutX`/`layoutY`/`label` (katalog uç noktalarına eklendi), `GET /schedules/:scheduleId/spots` (üye ve personel, kaynak türüne göre gruplu; AVAILABLE/TAKEN/MAINTENANCE/MINE; kimin yer tuttuğu yalnızca `bookings.view` iznine sahip personele gösterilir), seçilebilir bir kaynak türü gerektiren hizmet için yer seçilmeden rezervasyonda 400, dolu yerde veritabanı dışlama kısıtından 409, `POST /schedules/bookings/:bookingId/spot` (personel ve `/self` üye varyantı, tek transaction içinde atomik değişim), üyenin kapsayan aktif paketleri için `GET /members/self/packages`, üyeler için hafif seans listesi `GET /schedules/self/week`. Mobilde `Seanslar` sekmesi, seans listesi ve `app/(app)/seans/[scheduleId].tsx` seans detay ve rezervasyon ekranı: yerleşim koordinatlarından yer haritası (koordinat yoksa etikete göre sıralı ızgaraya düşer), "Boş/Dolu/Bakımda/Sizin" lejantı, erişilebilir etiketler, 44pt dokunma hedefleri, "Rezerve et" birincil buton; 409'da harita yenilenip "Bu yer az önce doldu, başka bir yer seçin" mesajı gösterilir. Kalan: yok |
| W6 | Ödeme | Sağlayıcı soyutlaması (iyzico, PayTR; mock), kart saklama, otomatik yenilenen üyelik, dunning, taksit, havale/IBAN kaydı. Yapıldı: `PaymentProvider` arayüzü ve MOCK/iyzico/PayTR adaptörleri (iyzico ve PayTR birer iskelet, gerçek HTTP çağrıları bir sonraki PR'a kaldı), `StoredCard` (yalnızca sağlayıcı token'ı + son 4 hane), `MemberSubscription` + `PaymentAttempt` ile otomatik yenileme ve dunning (1., 3., 7. gün yeniden deneme, sonra iptal + bildirim), havale/EFT için beklemede ödeme + personel onayı, kısmi/tam iade (çift iadeye karşı koşullu güncelleme), sağlayıcı webhook'u (imza doğrulama, `providerReference` ile idempotent), personelin nakit/kart/havale/online satışı ve üyenin kendi kendine satın alması, mobilde "Ödemelerim" ekranı. Süper admin tetikleme uç noktası (`POST /admin/dunning/run`) yerinde duruyor; W10 ile BullMQ kurulduğu için `DunningService.runDueRenewals()` artık zamanlayıcı sarmalayıcısı `JobsService.runAll()` içinden de 15 dakikada bir çağrılıyor (bkz. W10 satırı). Detaylar: `docs/PAYMENTS.md`, `docs/DATABASE_ERD.md` |
| W7 | Mesajlaşma | WhatsApp Cloud API şablonları, SMS'e düşme, İYS izin kontrolü, işlemsel ve ticari mesaj ayrımı. Yapıldı: `MessageChannel` arayüzü ve WhatsApp Cloud/Netgsm/İleti Merkezi adaptörleri (kimlik bilgisi yoksa MOCK), `NotificationsService.send()` (kanal sırası/fallback, kullanıcı tercihi, İYS onay kontrolü, başarılı SMS'te tek kredi düşümü, her deneme için NotificationLog), `sendSms`/`notifyUser` değişmeden çalışıyor, `MessageTemplate` (küresel + kiracı override, {{ad}} yer tutucu render), `CommunicationConsent` ve `IysClient` (MOCK + gerçek API iskeleti, `syncPendingConsents()`), stüdyo bildirim ayarları ve SMS cüzdanı uç noktaları, süper admin manuel kredi yükleme, üye onay self-servisi ve personel dışa aktarma. W10 ile `syncPendingConsents()` artık `JobsService.runAll()` üzerinden 15 dakikada bir çağrılıyor. Kalan: mevcut hatırlatma/iptal/bekleme listesi bildirim çağrı noktalarının şablon tabanlı `send()`'e taşınması, `send()` içinde push bildiriminin de tetiklenmesi |
| W8 | e-Arşiv / e-Fatura | Entegratör soyutlaması (mock), ödeme sonrası belge kesme. Yapıldı: `InvoiceSettings` (unvan, vergi dairesi, vergi no, e-fatura modu, sağlayıcı, KDV oranı, seri kodu, otomatik kesim), `BillingProfile` (bireysel TCKN veya şirket VKN; TCKN/VKN checksum doğrulaması `packages/shared/src/tax-id.ts`), `Invoice` (alıcı ve kalem anlık görüntüsü, stüdyo başına atomik seri+yıl+sıra numaralandırma, KDV dahil fiyattan geriye bölme, durum DRAFT/ISSUED/CANCELLED/FAILED), `EInvoiceProvider` arayüzü ve MOCK/Paraşüt/eLogo/Foriba/Uyumsoft adaptörleri (dördü iskelet, gerçek çağrılar bir sonraki PR'a kaldı; MOCK ödemelerdeki gibi üretimde devre dışı), ödeme `COMPLETED` olduğunda otomatik ve idempotent fatura kesimi (satış, self-checkout, havale onayı, webhook), sağlayıcı hatasında ödeme geri alınmadan fatura `FAILED` + yeniden deneme uç noktası, tam iadede otomatik fatura iptali (kısmi iadeler ve GİB'in aynı gün penceresi dışındaki iptaller yalnızca kaydedilir, gerçek iade faturası TODO), personel ve üye self-servis uç noktaları, muhasebeci için CSV dışa aktarımı, mobilde Hesabım > Faturalarım. Detaylar: `docs/INVOICING.md`. Kalan: gerçek entegratör HTTP/SOAP çağrıları, iade faturası kesimi, stüdyo başına farklı entegratör kimlik bilgisi, web paneli ekranları |
| W9 | Satış araçları | Deneme dersi teklifi, promosyon kodu, hediye kartı. Yapıldı: `PackageDefinition.isTrial`/`trialLimitPerUser` ve global kullanıcı bazlı deneme limiti (`redemption_counters` üzerinde atomik `INSERT ... ON CONFLICT ... WHERE count < limit`), herkese açık `GET /studios/public/:slug/trial-offers`; `PromoCode`/`PromoRedemption` (yüzde/sabit tutar/ücretsiz hak, geçerlilik aralığı, toplam ve kullanıcı başına limit, minimum tutar, uygulanabilir paketler, yalnızca yeni üyeler), self-servis önizleme (`GET /promotions/promo-codes/validate/self`), satış işlemine (transaction) gömülü atomik kullanım (toplam limit `redeemedCount < maxRedemptions` koşullu güncelleme, kullanıcı limiti aynı sayaç deseniyle); `GiftCard`/`GiftCardTransaction` (kod sha256 özeti + son 4 hane olarak saklanır, gerçek kod yalnızca oluşturulduğunda bir kez döner, 16 karakterlik karışıklığa kapalı alfabe), kısmi/tam harcama (koşullu bakiye düşümü), iadede orantılı bakiye iadesi, self-servis hız sınırlı bakiye sorgusu (`GET /promotions/gift-cards/check`) ve `GET /promotions/gift-cards/mine`; `promotions.manage` izni (sahip varsayılan, kullanım `packages.sell` üzerinden); `SellPackage`/`MemberCheckout` şemalarına `promoCode`/`giftCardCode`/`giftCardAmount`; mobilde Ödemelerim ekranına hediye kartlarım, bakiye sorgulama ve promosyon/hediye kartlı paket yenileme önizlemesi eklendi. Kalan: promosyon kodu/hediye kartı havale (BANK_TRANSFER) veya sonuçlanması bekleyen (PENDING) online checkout ile birlikte desteklenmiyor (bilinçli kapsam dışı, bkz. `docs/PAYMENTS.md`); web panelinde promosyon/hediye kartı yönetim ekranları yok |
| W10 | Otomatik akışlar | Kural motoru ve zamanlanmış işler: geri kazanma, paket bitiyor, doğum günü, ilk ders sonrası. Yapıldı: `AutomationRule`/`AutomationRun` (kiracı verisi, `params` şeması `packages/shared/src/automations.ts` içinde ayrık birleşim (discriminated union) olarak doğrulanır), altı kural türü için birer değerlendirici (`apps/api/src/modules/automations/evaluators`, sınırlı toplu sorgular, stüdyo saat dilimine duyarlı), `AutomationRun` üzerindeki `(ruleId, userId, targetRef)` tekil kısıtı ile "önce ekle, sonra gönder" desenine dayalı en-fazla-bir-kez teslimat, sessiz saatler (21:00-09:00 stüdyo saatiyle, 09:00'a ertelenir), `notifications.manage` izniyle kural CRUD/aç-kapa/önizleme (dry run, kayıt oluşturmadan aday sayısı)/geçmiş/son-30-gün istatistik uç noktaları, dört yeni küresel şablon (BIRTHDAY, WIN_BACK, FIRST_CLASS_FOLLOW_UP, NO_SHOW_FOLLOW_UP; kayıp üye kazanma ve doğum günü şablonları İYS onayı gerektirir, `isTransactional: false`), her kiracı için varsayılan altı kural (yalnızca BOOKING_REMINDER etkin) tohum verisi. `jobs` modülü: tek BullMQ kuyruğu ve 15 dakikada bir tekrar eden tek iş, yalnızca `REDIS_URL` gerçek bir süreç ortam değişkeni olarak tanımlıysa kaydedilir (üretimde zaten zorunlu); Redis yokken (yerel geliştirme, testler) aynı iş `JobsService.runAll()` servis metoduyla ve süper admin `POST /admin/scheduler/run` uç noktasıyla çağrılabilir. Bu tek 15 dakikalık nabız otomasyonları, W6'nın dunning'ini (`DunningService.runDueRenewals`) ve W7'nin İYS onay senkronunu (`ConsentService.syncPendingConsents`) birlikte çalıştırır; ayrı kuyruklara gerek kalmadı. Mobilde Hesabım > "Otomatik mesajlar" (yalnızca `notifications.manage` iznine sahip sahip/yönetici): kural listesi, aç/kapa anahtarı, son 30 gün gönderildi/atlandı/başarısız sayıları. Detaylar: `docs/AUTOMATIONS.md`, `docs/DATABASE_ERD.md`. Kalan: kural başına `channel` alanı şu an yalnızca saklanıyor (henüz `send()`'e iletilmiyor, kanal sırası hâlâ stüdyo geneli ayardan geliyor); doğum günü değerlendiricisi ayda/günde `EXTRACT` tabanlı bir SQL sorgusu yerine bellek içi filtreleme kullanıyor (büyük kiracılarda ölçeklenirlik notu kod içinde belirtildi) |
| W11 | Potansiyel müşteri hattı | Web formu uç noktası, aşamalar, deneme dersine ve üyeliğe dönüşüm. Yapıldı: `Lead`/`LeadActivity` modelleri (kaynak, aşama, sorumlu personel, takip tarihi, UTM alanları; açık adaylar için stüdyo+telefon üzerinde elle eklenmiş kısmi benzersiz index), `leads.view`/`leads.manage` izinleri (resepsiyon varsayılanına eklendi), personel uç noktaları (filtreli ve sayfalı liste, oluşturma, güncelleme, aşama değiştirme -- WON'dan çıkılamaz, LOST için sebep zorunlu --, sorumlu atama -- yalnızca personel üyeliğine --, not/arama/mesaj kaydı, üyeliğe dönüştürme -- telefonla eşleşen global kullanıcı varsa yeniden kullanılır --, paketsiz deneme dersi rezervasyonu), `POST /public/studios/:slug/leads` (JWT'siz, sabit 202 yanıt, honeypot, IP bazlı hız sınırı -- Redis varsa Redis, yoksa tek örnek bellek içi yedek --, açık adayda aynı telefon tekrar başvurursa yeni kayıt yerine geçmişe not eklenir), mobilde Hesabım > Potansiyel üyeler (aşamaya göre sayımlı liste, detay ekranında ara/not ekle/aşama değiştir/üyeye dönüştür). Kalan: web paneli |
| W12 | Ayrılma riski | Kural tabanlı skor, riskli üye listesi. Yapıldı: saf puanlama fonksiyonu (`apps/api/src/modules/churn/churn-scoring.ts`) -- katılım trendi (son 28 gün / önceki 28 gün), son katılımdan bu yana geçen gün, yenilenmemiş aktif paket bitişi/az kalan hak, dondurulmuş paket, son 28 günde geç iptal/gelmeme, başarısız ödeme denemesi (`PaymentAttempt`), ilk 60 gündeki üyeler için ayrı `onboarding` bayrağı (katılım/hareketsizlik sinyalleri o dönemde hesaplanmaz) --, her sinyal 0 ile kendi ağırlığı arasında puan katar, toplam 0-100'e sıkıştırılır, ağırlıklar `Studio.churnWeights` (kiracı ayarı, varsayılanlar `packages/shared/src/churn.ts`), `MemberRiskSnapshot` (üye başına tek satır, `previousScore`, gerekçeler JSON, görüşüldü/ertelendi durumu) ve `MemberRiskHistory` (haftalık trend için), `ChurnService.recomputeStudio`/`recomputeAll` stüdyo başına sınırlı toplu sorgularla çalışır, `GET /churn/studio/:studioId/{members,summary,members/:memberId}` (`reports.view`, şube kısıtı, telefon yalnızca `members.contact.view` ile, CSV dışa aktarım), `POST .../recompute` (`members.manage`, stüdyo başına 10 dakikada bir), `POST .../members/:memberId/{contacted,snooze}` (not + audit log, N gün gizleme), günlük hesaplama zamanlayıcı döngüsünden (`recomputeStale`, 20 saatten eski stüdyolar) çalışır, süper admin `POST /admin/churn/recompute-all` ile tümünü zorlayabilir, mobilde Hesabım > Riskli üyeler (HIGH sonra MEDIUM, ilk 2 gerekçe, hızlı "Görüşüldü"). Detaylar: `docs/CHURN.md`. Kalan: web paneli ekranı, ağırlık ayarı endpoint'i |
| W13 | Raporlar | Doluluk, gelir, üye başına gelir, yenileme oranı, kohort, eğitmen performansı. Yapıldı: `GET /reports/studio/:studioId/{occupancy,revenue,members,renewal,cohorts,trainers}` (`reports.view`, opsiyonel `branchId`, `from`/`to`, gelir için `granularity`), her rapor için `?format=csv` (UTF-8 BOM, noktalı virgül, Türkçe başlıklar), şube kısıtlı personel kendi şubesiyle sınırlı, para tutarları `Prisma.Decimal` ile toplanıp ondalık dizgi döner. Mobilde Hesabım > Raporlar (doluluk, son 30 gün gelir, yenileme oranı, en yoğun 5 eğitmen; grafik kütüphanesi yok, tema renkleriyle basit çubuklar). Metrik tanımları: `docs/REPORTS.md`. Kalan: `Payment.refundedAmount` sütunu W6 ile gelince gelir raporundaki `refundTotal` otomatik dolacak (kod zaten savunmacı yazıldı); web paneli rapor ekranları ayrı bir işten (ileride) |
| W14 | Hakediş bordrosu | Dönemsel eğitmen hakedişi hesaplama ve CSV çıktısı. Yapıldı: saf hesaplayıcı (`apps/api/src/modules/payroll/commission-calculator.ts`, `CommissionType` enum'undaki üç kural türü, ServiceType kuralının TrainerProfile kuralını geçersiz kılması, ikame eğitmenin (trainerId) hakedişi kazanması, geç iptalde yalnızca kesilen ceza biriminin sayılması), `PayrollRun`/`PayrollLine` modelleri (taslak/onaylandı/ödendi, şube kapsamı opsiyonel, taslakken yeniden oluşturma satırları değiştirir, onaylı dönemle çakışma reddedilir), uç noktalar (oluştur, listele, görüntüle, CSV dışa aktarım, manuel düzeltme, onayla, ödendi işaretle, `commissions.view.own` ile eğitmenin kendi görünümü), mobilde Hesabım > Hakedişim (eğitmen) ve Hesabım > Bordro (sahip, onaylama). Yüzde bazlı hakedişin fiyat kaynağı sorusu çözüldü: bkz. `docs/PAYROLL.md`. Kalan: yok |
| W15 | Puan ve tavsiye | Ders sonrası puan, Google yorum yönlendirmesi, arkadaşını getir. Yapıldı: `SessionRating` (bookingId benzersiz, puanlayan üyenin sadece kendi ATTENDED rezervasyonu, seans bitişinden sonra 7 gün, tekrar puanlamada 409, ilk 24 saat içinde düzenlenebilir), eğitmenin kendi görünümü varsayılan olarak üye kimliğini gizler (`isAnonymousToTrainer`), sahip/yönetici `reports.view` ile filtreli tam liste ve ortalama görür, düşük puanda (<=2) aktif sahiplere `FEEDBACK` kategorisiyle push bildirimi. `Studio.googleReviewUrl` (yalnızca g.page/search.google.com/local/writereview/google.com/maps ile başlayan https bağlantı) ve puan >= 4 olduğunda API yanıtındaki `reviewPrompt`; puanlı yorum hiçbir zaman ödüllendirilmez veya zorunlu tutulmaz (bkz. `docs/FEEDBACK_REFERRAL.md`). Seans sonrası puanlama daveti `RatingPromptService.promptRecentAttendees()` (Booking.ratingPromptSentAt ile idempotent, BullMQ henüz kurulu olmadığından `POST /admin/feedback/rating-prompts/run` süper admin tetikleyicisi, W6/W7'deki aynı desen). `ReferralCode`/`Referral` (kiracı başına benzersiz kısa kod, üye oluşturma ve potansiyel üye formu `referralCode` alanı, kendine tavsiye ve aynı telefonun iki kez kaydı engellenir, hakediş -- referans olunan üyenin ilk tamamlanmış ödemesi veya ilk katıldığı ders -- ve ödül -- `EXTRA_UNITS`, koşullu güncelleme ile tam olarak bir kez, hediye kartı modülü ana dalda olmadığından tek ödül türü --), personel için liste/manuel ödül/iptal (`members.manage`), herkese açık `GET /public/referrals/:code` (yalnızca işletme adı ve teklif metni). Mobilde Hesabım > Arkadaşını getir (kod, paylaş, tavsiye durumları), ana ekranda değerlendirilmemiş son dersler için davet kartı, `seans/degerlendir/[bookingId]` puanlama ekranı (5 büyük dokunma hedefi). Kalan: web paneli; gerçek zamanlı hakediş tetikleyicisi (ödeme/yoklama anında) yerine `GET /referrals/.../me` ve liste uç noktaları her çağrıldığında yeniden değerlendirme yapılıyor (bkz. doküman) |
| W16 | Oyunlaştırma | Seri, kilometre taşı, rozet, aylık hedef. Yapıldı: `BadgeDefinition` veri olarak tanımlanır (`studioId` null olan küresel varsayılanlar + kiracının kendi rozetleri; `threshold` alanı, `kind`'a göre değişen paylaşılan bir Zod discriminated union ile doğrulanır; MILESTONE_SESSIONS, STREAK_WEEKS, MONTHLY_GOAL_MET, FIRST_SESSION, EARLY_BIRD, VARIETY), `MemberBadge` (üye+rozet üzerinde benzersiz -- kazanma her zaman idempotent), `MemberGoal` (aylık hedef; ilerleme her zaman katılımdan hesaplanır, hiç saklanmaz). Seri ve kilometre taşı hesaplamaları saf fonksiyonlardır (`apps/api/src/modules/gamification/gamification-calculations.ts`, stüdyo saat dilimine göre ISO hafta bazlı), birim testli (hafta/yıl sınırları, saat dilimleri, eşikler, çeşitlilik). `GamificationService.onAttendance(bookingId)`, `SchedulesService.checkIn()` sonrasında best-effort (try/catch, check-in'i asla düşürmez) çağrılır; stüdyo başına geri doldurma (`backfill`) uç noktası da var. Yeni rozet kazanıldığında `NotificationsService.notifyUser()` ile `ACHIEVEMENT` bildirim kategorisi (varsayılan açık, üye tercih ekranından kapatılabilir) üzerinden push gönderilir. Uç noktalar: `GET/PUT /gamification/studio/:studioId/settings` (oyunlaştırmayı aç/kapa, varsayılan açık), rozet tanımları CRUD (`reports.view` okuma, `studio.settings.manage` yazma; yalnızca kiracının kendi rozetleri düzenlenip silinebilir, küresel varsayılanlara dokunulamaz, kazanılmış rozet silinemez), personel başarı özeti (`GET .../achievements`, `reports.view`), üye kendi kendine: `GET .../me/stats` (toplam seans, güncel/en iyi seri, bu ayki hedef ilerlemesi, kazanılan ve bir sonraki rozetler ilerleme yüzdesiyle), `PUT .../me/goal`, `PUT .../me/leaderboard-opt-in` (gizlilik öncelikli, varsayılan kapalı), `GET .../leaderboard?month=YYYY-MM` (yalnızca katılımı açık üyeler, ad + soyadın ilk harfi, en fazla 20 kişi, stüdyo kapsamlı). Mobilde Hesabım ve ana ekrandan erişilen "Başarılarım" ekranı: seri sayacı, aylık hedef ilerleme çubuğu, kazanılan/kilitli rozet ızgarası (metin ve tema renkleriyle, grafik/ikon kütüphanesi yok), liderlik tablosu ve katılım anahtarı. Kalan: web paneli, rozet tanımları için mobil/web personel arayüzü (şimdilik yalnızca API) |
| W17 | Check-in kiosku | Tablet kiosk modu, statik işletme QR'ı ve üyenin dinamik QR'ı (turnike hariç). Yapıldı: `CheckInPoint` (şubeye bağlı statik poster QR'ı, tek seferlik ham kod, `rotate` ile eskisini geçersiz kılma), `POST /me/check-in/scan` (stüdyoyu token'dan çözer, çekirdek check-in mantığı `SchedulesService.checkInForMember` -- yeniden tarama idempotent, personelin elle check-in'inden ayrı --, stüdyo başına yapılandırılabilir pencere `checkInWindowBeforeMinutes`/`AfterMinutes`, net hata mesajları: rezervasyon yok/erken/geç/pasif nokta/başka işletme), dinamik üye QR'ı (`apps/api/src/modules/checkin/dynamic-qr-token.ts`: `JWT_SECRET`'ten ayrı amaç etiketiyle türetilmiş anahtarla HMAC-SHA256, JWT değil, 60 sn TTL, `membershipId`/`studioId`/`iat`/`nonce`), `POST /me/check-in/qr` (üye), `POST /studios/:studioId/check-in/member-qr` (`attendance.manage`, şube kısıtı uygulanır, belirsizlikte adaylar listesi döner), nonce tekrar-oynatma koruması (`DynamicQrNonceStore`: Redis `SET NX EX` veya bellek içi yedek), kiosk modu (`KioskDevice`: `studio.settings.manage` ile eşleştirme kodu oluşturma, `POST /kiosk/pair` ile uzun ömürlü `typ: kiosk` JWT alma, `KioskAuthGuard` bu token'ı yalnızca `/kiosk/*` uç noktalarında kabul eder ve her istekte iptali kontrol eder, `GET /kiosk/sessions/today`, `POST /kiosk/check-in`, her eşleştirme/iptal/check-in `AuditLog`'a yazılır), mobilde üye "QR ile giriş" ekranı (`react-native-qrcode-svg`, ~45 sn yenileme) ve "Stüdyo QR'ını tara" (`expo-camera`), personel "Üye QR tarama" ekranı, Hesabım > Kiosk modu (cihaz eşleştirme/iptal) ve tam ekran `/kiosk-mode` kiosk arayüzü (çıkış için personel PIN girişi). Kapsam dışı: turnike/kapı entegrasyonu; kiosk için telefon son 4 hane + PIN yedek girişi (güvenli hız sınırlama PIN kilitleme mantığıyla aynı olmalı, bu PR'da uygulanmadı). Detaylar: `docs/CHECKIN.md`, `docs/DATABASE_ERD.md` |
| W18 | Açık platform | Gömülebilir rezervasyon widget'ı, API anahtarlı herkese açık API, webhook |
| W19 | Video | İsteğe bağlı video kütüphanesi, canlı yayın bağlantıları, paketle erişim |
| W20 | Toplayıcılar | Wellhub benzeri toplayıcılar için adaptör arayüzü ve mock |
| W21 | Sağlık verisi | Apple Health / Health Connect ile ölçüm paylaşımı (üye izniyle) |

Kapsam dışı: turnike ve kapı entegrasyonu.

## 7. Sahibin sağlayacağı girdiler (henüz gelmedi)
- Tasarım referans ekran görüntüleri (3–4 ekran: ana, takvim, üye kartı, rezervasyon)
- İki stüdyonun gerçek hizmet türü / paket / eğitmen ücret / iptal kuralı listesi
- Ürün adı ve domain
- SMS sağlayıcı ve WhatsApp Cloud API hesap bilgileri (env olarak, repoya değil)

## 8. Claude Code'a başlangıç komutu

> Bu repo üyelik ve randevu tabanlı işletmeler için multi-tenant bir SaaS platformudur. Önce `CLAUDE.md`, sonra `HANDOVER.md` dosyalarını oku. HANDOVER.md bölüm 3'teki kararlar kesindir, bölüm 5 şema hedefidir, bölüm 6 sıralı backlog'dur. Backlog 0.1'den başla; her madde için ayrı branch ve PR aç, her PR'da testleri çalıştır. Emoji kullanma. Pilates'e özel bir kural görürsen genelleştir, belirsizse bana sor.
