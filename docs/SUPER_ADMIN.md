# Süper Admin (Platform Sahibi) Paneli

Backlog 4.1-4.3'ün uygulanmasını anlatır: kiracı yönetimi, planlar ve
limitler, işletme türü şablonları, feature flag'ler, SMS paketleri ve kredi
yükleme, sağlayıcı bakiye izleme, global şablon/belge yönetimi, benchmark
dashboard'u ve sistem sağlığı. Süper admin taklit etme (impersonation)
kapsam dışıdır.

## Güvenlik modeli

Her `/admin/*` uç noktası tek bir korumadan geçer:
`SuperAdminOnly()` dekoratörü (`apps/api/src/modules/auth/decorators/
super-admin-only.decorator.ts`), sırasıyla `JwtAuthGuard` ve
`SuperAdminGuard`'ı (`apps/api/src/modules/auth/guards/super-admin.guard.ts`)
uygular. `SuperAdminGuard`, `request.user.isSuperAdmin` dışında hiçbir
şeye bakmaz: süper adminlik `User` üzerinde global bir bayraktır, kiracı
izin kataloğunun bir parçası değildir (CLAUDE.md kural 6).

Daha önce her admin controller'ında elle tekrarlanan
`if (!user.isSuperAdmin) throw new ForbiddenException(...)` kontrolleri bu
tek guard'a taşındı (davranış değişmedi, sadece tekilleştirildi):
`ChurnAdminController`, `DunningController`, `SchedulerController`,
`FeedbackAdminController`, `SmsWalletAdminController`,
`StudiosController#findAll`.

Web tarafında `apps/web/src/app/admin/layout.tsx` sunucu bileşeninde
`getAdminSession()` (`apps/web/src/lib/session/admin-session.ts`) ile
ayrıca kontrol edilir; gerçek yetkilendirme sınırı yine API guard'ıdır, bu
sadece panel kabuğunun gösterilmemesi içindir. `middleware.ts` da `/admin`
için oturum çerezi kontrolü yapar (savunma derinliği).

Her admin yazma işlemi `AuditLog`'a `userId: <süper adminin id'si>` ile
kaydedilir (`studioId` platform-geneli işlemler için null, kiracıya özgü
işlemler için ilgili kiracı).

Kiracı üyelerinin kişisel verisi (telefon, e-posta, ölçüm, ödeme detayı vb.)
hiçbir admin uç noktasından dönmez; tenant listesi/detayı yalnızca sayım
(şube, aktif üye, personel sayısı) döner. Kiracı verisine erişim yine
kiracının kendi izin sistemi üzerinden, `StudioTenantGuard` ile olur.

## Uç noktalar (`/admin/*`)

| Alan | Uç noktalar | Not |
| --- | --- | --- |
| Kiracılar | `GET /admin/tenants`, `GET /admin/tenants/:id`, `POST /admin/tenants`, `POST /admin/tenants/:id/suspend`, `POST /admin/tenants/:id/reactivate`, `POST /admin/tenants/:id/plan` | Oluşturma: stüdyo + varsayılan rol şablonları (`DEFAULT_ROLE_TEMPLATES`) + deneme aboneliği + sahip daveti (`InvitesService.createOwnerInvite`, mevcut davet/onboarding akışını yeniden kullanır) |
| Planlar | `GET /admin/plans`, `POST /admin/plans`, `POST /admin/plans/:key/activate`, `POST /admin/plans/:key/deactivate` | `limits`: `maxBranches`, `maxActiveMembers`, `maxStaff`, `maxSmsPerMonth` (JSON, `packages/shared` `PlanLimitsSchema`) |
| İşletme türü şablonları | `GET /admin/business-type-templates`, `POST /admin/business-type-templates`, `POST /admin/business-type-templates/:key/apply-to-tenant/:studioId` | `defaults.serviceTypeNames` / `defaults.resourceTypeNames` mevcut seed formatıyla aynı; "uygula" eksik olanları oluşturur, var olanı asla değiştirmez |
| Uygulama pazarı (G5c-2) | `GET /admin/add-ons`, `POST /admin/add-ons`, `PATCH /admin/add-ons/:id`, `PUT /admin/add-ons/:id/prices`, `GET /admin/add-ons/revenue` | Ek modül kataloğu (dil başına ad ve açıklama, video, ekran görüntüleri, açtığı bayrak, deneme günü, yayın, para birimi başına fiyat); fiyatsız yayınlanamaz; her yazma denetim kaydıyla (`add_on.create/update/prices`); gelir para birimi başına. `docs/UYGULAMA_PAZARI.md` |
| Feature flag'ler | `GET /admin/feature-flags`, `GET /admin/feature-flags/catalog`, `POST /admin/feature-flags` | Çözümleme: TENANT > BUSINESS_TYPE > GLOBAL (`FeatureFlagsService.isFeatureEnabled`) |
| SMS paketleri | `GET /admin/sms-packages`, `POST /admin/sms-packages`, `POST /admin/sms-packages/:key/activate`, `POST /admin/sms-packages/:key/deactivate` | |
| Manuel SMS kredi yükleme | `POST /sms-wallet/top-up` (mevcut uç nokta, artık `SuperAdminOnly()`) | Her yükleme `AuditLog`'a yazılır |
| Global şablon/belge | `GET/POST /admin/content/message-templates`, `GET/POST /admin/content/document-versions` | `studioId: null` küresel varsayılanı, bir uuid ise kiracı geçersiz kılmasını hedefler |
| Benchmark | `GET /admin/benchmark?businessTypeTemplateKey=` | Aşağıya bakın |
| Sistem sağlığı | `GET /admin/health` | DB, Redis, kuyruk derinliği, son heartbeat zamanı, başarısız webhook teslimatı sayısı, SMS sağlayıcı bakiye durumu, yedek durumu (son başarılı yedek, gecikme) |
| Yedekler (D2) | `GET /admin/backups`, `POST /admin/backups/run`, `PUT /admin/backups/settings`, `POST /admin/backups/verify`, `POST /admin/backups/download-url`, `POST /admin/backups/delete` | Veritabanı yedeklerinin tek yönetim ekranı: listeleme (uzak depo ve sunucu), şimdi yedek al, zamanlama ve saklama, doğrulama, kısa ömürlü indirme bağlantısı, onaylı silme. Ayrıntılar: `docs/YEDEKLER.md` |
| Denetim (M3d) | `GET /admin/audit?userId&action&from&to&page&limit` | Tüm kiracıların `AuditLog` satırları, en yeni önce; `action` eylemin kendisi ya da nokta ile devam eden öneki; metadata yerine kısa ve maskelenmiş özet |
| Pazarlama özeti (M3d) | `POST /admin/marketing/insights/generate` | Son tamamlanan haftanın özetini şimdi üretir (`{ at?, force?, notify? }`); deneme içindir |
| Zamanlayıcı/dunning/churn tetikleyicileri | `POST /admin/scheduler/run`, `POST /admin/dunning/run`, `POST /admin/churn/recompute-all`, `POST /admin/feedback/rating-prompts/run` | Önceden var olan uç noktalar, artık `SuperAdminOnly()` |

Tüm payload'lar `packages/shared/src/admin.ts` içindeki Zod şemalarıyla
doğrulanır (`CreateTenantSchema`, `UpsertPlanSchema`,
`UpsertBusinessTypeTemplateSchema`, `SetFeatureFlagSchema`,
`UpsertSmsPackageSchema`, `AdminUpsertMessageTemplateSchema`,
`PublishDocumentVersionSchema`, `BenchmarkQuerySchema`).

## Plan limitleri

`PlanLimitsService` (`apps/api/src/modules/admin/plan-limits.service.ts`,
kendi global `PlanLimitsModule`'ünde, admin modülüne bağımlı olmadan her
yerden enjekte edilebilir) üç basit, sayılabilir limiti zorunlu kılar:

- `maxActiveMembers`: `MembersService` üye oluştururken
- `maxStaff`: `InvitesService` personel daveti oluştururken (üye rolü
  `maxActiveMembers`'a sayılır)
- `maxBranches`: `BranchesService` şube oluştururken

Limit aşıldığında `402 Payment Required` döner (`{ message, limit,
current }`). Aktif aboneliği olmayan (deneme öncesi/plansız) bir kiracı
için hiçbir limit uygulanmaz. `maxSmsPerMonth` şemada tanımlıdır ama şu an
uygulanmıyor; SMS kredisi zaten stüdyo başına `SmsWallet` bakiyesiyle ayrıca
sınırlanıyor (bir SMS fiilen gönderildiğinde düşülüyor). Aylık kotayı ayrıca
uygulamak sonraki bir iş kalemidir.

## Feature flag çözümleyici

`FeatureFlagsService.isFeatureEnabled(studioId, key)` tek doğruluk
kaynağıdır (G5c-2: açık TENANT satırından sonra, işletmenin erişimi olan
bir ek modül satırı bayrağı açar; bkz. `docs/UYGULAMA_PAZARI.md` bölüm 4); başka hiçbir modül kendi flag mantığını yazmamalıdır.
`FEATURE_FLAGS` kataloğu (`packages/shared/src/admin.ts`) bilinen
anahtarları belgeler; `FeatureFlag.key` serbest metin olduğundan yeni bir
anahtar eklemek şema değişikliği gerektirmez.

## Benchmark ve k-anonimlik

`AdminBenchmarkService`, işletme türü şablonuna göre gruplanmış son 30
günlük ortalamaları hesaplar: doluluk oranı (`SessionSchedule.bookedCount /
capacity`), iptal oranı (`Booking` durumları), üye başına gelir
(`Payment.amount`, tamamlanmış), yenileme oranı (`MemberSubscription`
ACTIVE / (ACTIVE + CANCELLED)). `BENCHMARK_MIN_GROUP_SIZE = 5`'ten az
stüdyosu olan bir grup tamamen bastırılır (`suppressed: true`, tüm
ortalamalar `null`); hiçbir stüdyo adı, id'si veya üye-seviyesi veri
döndürülmez.

## SMS sağlayıcı bakiye izleme

`SmsProviderBalanceService` (`apps/api/src/modules/notifications/
sms-provider-balance.service.ts`), 15 dakikalık zamanlayıcı kalp atışına
(`JobsService.runAll`) eklendi ama kendi içinde saatlik bir kısıtlamaya
sahip (`checkIfDue`): art arda çağrılar, son kontrolden bir saatten az süre
geçtiyse önbellekteki sonucu döner. `SMS_PROVIDER=MOCK` (varsayılan) sabit,
sağlıklı bir bakiye (10.000 kredi) döner; `NETGSM`/`ILETI_MERKEZI`
yapılandırıldığında gerçek bakiye sorgusu API'lerini çağırır.
`SMS_PROVIDER_LOW_BALANCE_THRESHOLD` (varsayılan 500) altına düşen bakiye
bir `AuditLog` kaydı (`sms_provider.low_balance_alert`) ve bir log
uyarısı üretir; ayrı bir push/e-posta kanalı henüz yok, bu iş kaleminin
notlanan takip maddesidir. Son sonuç `GET /admin/health` üzerinden
görülebilir.

## Yedekler (D2)

Sahip, yedekleri süper admin paneli dışında yönetmek istemediği için `/admin/yedekler` yedeklerin
tek operasyon ekranıdır: API her gün (panelden ayarlanan UTC saatinde) ve istek üzerine
şifreli yedek alıp S3 uyumlu depoya yükler, hemen doğrular, saklama süresini uygular; sunucu
cron'unun (`backup.sh`) yedekleri de aynı listede görünür. Son başarılı yedek
`BACKUP_STALE_HOURS` (26) saatten eskiyse süper adminlere günde en fazla bir e-posta gider
(`BACKUP_STALE` şablonu). Panel veritabanını geri yüklemez; geri yükleme adımları
`docs/YEDEKLER.md` bölüm 6'dadır.

## Web paneli

`/admin` route grubu (`apps/web/src/app/admin/`), yalnızca oturum
kullanıcısı `isSuperAdmin` olduğunda görünür. Kiracı temasını kullanmaz
(CLAUDE.md kural 10: süper admin bir kiracı değildir); `packages/shared/
src/design`'daki nötr semantik renkleri ve ölçüleri doğrudan okur
(`AdminTheme` bileşeni), gradyan içermez. Sayfalar: `/admin/tenants`,
`/admin/plans`, `/admin/uygulama-pazari` (G5c-2), `/admin/business-types`, `/admin/feature-flags`,
`/admin/sms-packages`, `/admin/content`, `/admin/benchmark`,
`/admin/health`, `/admin/yedekler`, `/admin/denetim` (M3d). Tarayıcı yalnızca `/api/bff/*` üzerinden konuşur
(`docs/WEB_PANEL.md`), API'ye doğrudan erişmez.

## Platform kullanıcıları ve pazarlama paneli (M1)

Tasarım: `docs/PAZARLAMA_MODULU.md` (bölüm 2, 3.1-3.2, 5.1, 6.3, 7.1-7.2).
Bu bölüm uygulanan hali ve tasarımdan sapmaları anlatır.

### Rol modeli

- Platform izin kataloğu `packages/shared/src/platform-permissions.ts`
  (`PLATFORM_PERMISSIONS`, `PLATFORM_PERMISSION_AREAS`,
  `DEFAULT_PLATFORM_ROLE_TEMPLATES`, `PLATFORM_TENANT_GRANTS`,
  `resolvePlatformTenantPermissions`). `User.isSuperAdmin` kök yetkidir,
  bütün platform izinlerini örtük taşır ve hiçbir tablo üzerinden
  verilemez; `platform.users.manage` şablonda saklansa bile düşürülür.
- Tablolar: `platform_role_templates` (+ `_permissions`),
  `platform_memberships` (kullanıcı başına tek satır, INVITED/ACTIVE/PASSIVE),
  `platform_access_settings` (tek satır, `require_2fa_for_platform_roles`,
  varsayılan açık). Migration `20261019000000_platform_access` sistem şablonu
  `marketing_admin` ("Pazarlama yöneticisi") ve politika satırını da yazar.
- `PlatformAccessService` (`apps/api/src/modules/platform-access/`) tek
  yazıcıdır: her platform şablonunu platform kiracısında kilitli bir
  `RoleTemplate`'e (`platform:<anahtar>`, `isSystem`) aynalar, izinleri
  `PLATFORM_TENANT_GRANTS` ile türetir; ACTIVE üyelik için platform
  kiracısında `Membership` yazar, pasifleştirmede aynı işlemde PASSIVE yapar.
  Eşleme hiçbir zaman `roles.manage`, `staff.manage`,
  `studio.settings.manage`, `billing.manage`, finans, ödeme, bordro veya
  muhasebe anahtarı üretmez (birim testli).

### Pazarlama yöneticisi ne yapabilir, ne yapamaz

| Yapabilir | Yapamaz |
| --- | --- |
| Platform kiracısında kişi, satış hattı, segment, kampanya, akış, gelen kutusu, şablon, site, rapor, reklam ekranları (`/pazarlama/*`) | Başka bir kiracının hiçbir verisi (`StudioTenantGuard` 403) |
| Entegrasyon merkezi (`/pazarlama/entegrasyonlar`): reklam bağlantısı durumu, API anahtarı, webhook, gönderen alan adı ve DNS kontrolü | Kiracı CRUD, planlar, faturalama, feature flag, SMS paketi, yapay zeka anahtarı, diller, sağlık, hatalar, zamanlayıcı (tümü `SuperAdminOnly()`) |
| Kendi iki adımlı doğrulamasını kurma, kurtarma kodu yenileme | `/admin/*` sayfaları (layout `/pazarlama`'ya yönlendirir) |
| | Rol ve personel yönetimi (`roles.manage`, `staff.manage`), platform kiracısına davet, kişi dışa aktarma (`crm.export`, varsayılan kapalı), platform kullanıcılarını yönetme |

### Uçlar

| Uç | Koruma |
| --- | --- |
| `GET/POST/PUT /admin/platform-users[...]` (liste, rol şablonları, davet, rol değiştir, pasifleştir, yeniden etkinleştir, 2FA sıfırla, politika) | `SuperAdminOnly()` |
| `GET /platform/context` | `PlatformScoped()` + `PlatformAnyAccess()` |
| `GET/PATCH/POST/DELETE /platform/integrations[...]` | `PlatformScoped()` + `RequirePlatformPermission('platform.integrations.manage')` |
| `POST /auth/mfa/enroll`, `/enroll/confirm`, `/verify`, `/recovery-codes` | `JwtAuthGuard`; deneme sayısı giriş sınırlayıcısında (`mfa` türü, kullanıcı başına) |

`PlatformPermissionGuard` süper admini geçirir; diğerleri için her istekte
veritabanından ACTIVE `PlatformMembership` yükler. `StudioTenantGuard`,
üyelik platform sistem rolündeyse kullanıcının ACTIVE ve o üyeliği gösteren
`PlatformMembership`'ini ister (aynı sorguda); böylece pasifleştirme bir
sonraki istekte geçerlidir. Pasifleştirme ayrıca `refreshTokenHash`'i
siler; erişim token'ı en fazla 1 saat daha yaşar ama platform ve platform
kiracısı uçlarında işe yaramaz. Kiracı rol ekranları sistem şablonunu
düzenleyemez, silemez, atayamaz (`403 SYSTEM_ROLE_LOCKED`); normal davet
yolu platform kiracısını reddeder (`403 PLATFORM_TENANT_INVITE_FORBIDDEN`).

Her işlem `AuditLog`'a yazılır: `platform_user.invited|activated|role_changed|deactivated|reactivated|mfa_reset`
(`studioId` null, `userId` işlemi yapan, `entityId` hedef kullanıcı),
`platform_access.settings_updated`, `mfa.enabled`, `mfa.recovery_code_used`,
`mfa.recovery_codes_regenerated`; entegrasyon merkezi yazmaları
`integration.<tür>.<işlem>` (`studioId` platform kiracısı,
`metadata.via = admin|marketing`; süper admin olmayan çağıran her zaman
`marketing` kaydedilir).

### Davet ve onboarding

`POST /admin/platform-users/invites` telefonla kullanıcıyı bulur veya
oluşturur (kural 6), `PlatformMembership`'i INVITED yapar ve mevcut
`InviteToken` akışını `platform_role_template_id` ile kullanır. Web
tarafında `/j/<token>` sayfası (yeni) OTP, PIN ve onay adımlarını yürütür;
platform davetinde yalnızca KVKK aydınlatma metni istenir. Kabulde
`PlatformAccessService.activateInTx` aynı işlemde üyelikleri etkinleştirir.

### İki adımlı doğrulama (TOTP)

- RFC 6238 (HMAC-SHA1, 30 sn, 6 hane, +/-1 adım) kodda, bağımlılıksız
  (`apps/api/src/modules/auth/mfa/totp.ts`, RFC test vektörleri). Gizli
  anahtar `CredentialCipher` ile şifreli (üretimde anahtar yoksa kurulum
  reddedilir), 10 kurtarma kodu yalnızca SHA-256 özetiyle; bir TOTP adımı
  iki kez kabul edilmez.
- Adım yükseltme modeli: mevcut girişler (şifre, PIN, SMS kodu) oturum
  vermeye devam eder; `POST /auth/mfa/verify` `mfa` iddialı yeni token çifti
  verir (iddia `mfaEnabledAt` zamanına bağlıdır, 2FA sıfırlanınca geçersiz).
  Yenileme token'ı iddiayı korur.
- Zorlama: 2FA'sı olan her platform hesabı platform uçlarında ve süper admin
  uçlarında `mfa` iddiası ister (`403 MFA_REQUIRED`). Politika açıkken 2FA'sı
  olmayan platform üyeleri reddedilir (`403 MFA_ENROLLMENT_REQUIRED`).
  2FA'sı olmayan süper admin kilitlenmez (geçiş dönemi): giriş sonrası
  `/guvenlik/iki-adim` kurulum ekranına yönlendirilir ve `/admin` üstünde
  hatırlatma görünür.
- Süper admin bir platform üyesinin 2FA'sını sıfırlayabilir (denetimli);
  sıfırlama oturumu da düşürür.
- Platform hesaplarının yenileme token'ı 30 yerine 7 gün geçerlidir.

### Web

- `/admin/platform-kullanicilari`, `/admin/entegrasyonlar` ve AdminNav'da
  "Pazarlama" bağlantısı; sahip için tek konsol `/admin` kalır.
- `/pazarlama/*` kabuğu (`apps/web/src/app/pazarlama/layout.tsx`): platform
  kiracısını `DashboardSessionProvider` ile bağlar, `(dashboard)`
  sayfalarını yeniden dışa aktarır, bağlantıları `useAreaHref()`
  (`components/session/AreaBase.tsx`) ile `/pazarlama` altında tutar.
  Menü `lib/marketing-nav.ts` (platform izinleriyle). Pano, onaylar, takvim,
  yapay zeka stüdyosu ve marka kiti M2/M3 için yer tutucudur.
- Entegrasyon merkezi tek bileşendir (`components/integrations/IntegrationHub.tsx`),
  iki sayfada aynı uçlarla kullanılır; kimlik bilgisi yalnızca son 4
  karakterle, webhook yalnızca host ile gösterilir.
- M4c: Meta leadgen webhook doğrulama belirteci yalnızca süper adminin görüp değiştirdiği bir ayardır (`GET|PUT /admin/integrations/lead-ads/verify-token`, `/admin/entegrasyonlar` kartı); yalnızca SHA-256 özeti saklanır, düz metin üretilince bir kez gösterilir, değişiklik `AuditLog`'a yazılır.
- M4a: OAuth istemci bilgileri (Meta, Google, LinkedIn için istemci kimliği ve sırrı; Meta için isteğe bağlı Business Login yapılandırma kimliği, Google için Ads API geliştirici anahtarı, izinli listeden kapsam daraltma) yalnızca süper admin ayarıdır: `GET /admin/integrations/oauth`, `PUT|DELETE /admin/integrations/oauth/:provider` (`meta`, `google`, `linkedin`) ve `/admin/entegrasyonlar`'daki "OAuth istemci bilgileri" kartı. Değerler `platform_integration_settings.oauth_clients` içinde şifreli saklanır, ortam değişkeni değildir, yanıtlarda yalnızca son 4 karakter görünür; boş bırakılan sır ve geliştirici anahtarı korunur. Kart, sağlayıcı uygulamasına kaydedilecek tam geri dönüş adresini gösterir. Değişiklikler `integration.oauth.client_set` / `client_removed` olarak denetlenir (değerler olmadan). Bağlantıyı başlatmak `platform.integrations.manage` izniyle hub'dan yapılır; süper admin dönüşte `/admin/entegrasyonlar`'a, diğer platform kullanıcıları `/pazarlama/entegrasyonlar`'a döner. Sağlayıcı tarafı kurulum: `docs/PAZARLAMA_MODULU.md` M4a notları.

### Tasarımdan sapmalar

- `RoleTemplate.isSystem` seed'deki varsayılan şablonlarda (resepsiyon,
  eğitmen) zaten `true` olduğundan kilit yalnızca `platform:` önekli sistem
  şablonlarına uygulanır; diğer varsayılan şablonlar eskisi gibi
  düzenlenebilir.
- 2FA girişte ayrı bir "ara token" adımı yerine adım yükseltme olarak
  uygulandı (mobil ve mevcut istemciler bozulmadan). SuperAdminGuard 2FA'sı
  olmayan süper admini geçirir (geçiş dönemi).
- `SocialConnection` tablosu tasarımda M4'e ait olduğu için eklenmedi.
- Pano KPI'ları, onay akışı, platform webhook olayları (`studio.signup`
  vb.) ve doğrulanmamış alan adıyla ticari e-posta engeli M1d/M3 kapsamında
  sonraki PR'lara bırakıldı; gönderen alan adı kaydı ve DNS durumu hazır.
  M3b ile onay akışı geldi: doğrulanmamış alan adıyla ticari e-posta artık
  kendi onayıyla gönderilemez, süper admin onayı ister (aşağıdaki M3b
  notları).

### M2 notları: yapay zeka ayarları

`/admin/ai` sayfasındaki **Görev başına model** bölümüne üç yeni görev (`MARKETING_DRAFT`, `MARKETING_ANALYSIS`, `MARKETING_RESEARCH`) ve **Pazarlama stüdyosu aylık limiti** alanı eklendi (`PATCH /admin/ai/settings` içinde `marketingAiMonthlyBudgetCents`, varsayılan 5000 = 50 USD, 0 stüdyoyu kapatır). Limit yalnızca süper admin tarafından değiştirilir; pazarlama yöneticisi bu ucu çağıramaz (403). Marka kiti, yapay zeka stüdyosu ve içerik takvimi `/pazarlama/marka`, `/pazarlama/yapay-zeka`, `/pazarlama/takvim` altındadır; süper admin hepsini pazarlama yöneticisiyle aynı uçlardan kullanır (`/platform/marketing/*`) ve her yazma platform kiracısında `AuditLog` satırıdır (`marketing.brand_kit.*`, `marketing.product_fact.*`, `marketing.draft.*`, `marketing.calendar.*`). Ayrıntılar: `docs/PAZARLAMA_MODULU.md` (M2 notları), `docs/YAPAY_ZEKA.md`.

### M3b notları: pazarlama ayarları ve onaylar

- **Sayfa** `/admin/pazarlama-ayarlari` (AdminNav'da `/admin/ai` gibi bağlı, "Pazarlama Ayarları"): kendi onayı eşikleri (e-posta en fazla kişi, SMS/WhatsApp en fazla kişi, en fazla tahmini SMS kredisi), onay talebinin geçerlilik süresi (saat), organik sosyal gönderilerin hepsinin onaya tabi olması, günlük ticari e-posta ve SMS kredi tavanı, günlük yapay zeka tavanı (sent), para birimi başına aylık reklam harcama tavanı (farklı para birimleri toplanmaz), otomatik duraklatma oranları ve haftalık özet (anahtar ve alıcılar; alıcılar yalnızca süper admin veya etkin platform kullanıcısı olabilir).
- **Uçlar** `GET /admin/marketing/settings` ve `PATCH /admin/marketing/settings` (`SuperAdminOnly()`; gövde paylaşılan `UpdateMarketingSettingsSchema`, bütün alanlar isteğe bağlı). Her değişiklik platform kiracısında `AuditLog` satırıdır (`marketing.settings.updated`, `metadata.changes` alan başına eski ve yeni değer). Pazarlama yöneticisi bu uçları çağıramaz (403).
- **Bugün davranışı olanlar**: eşikler ve TTL (onay akışı). Tavanlar, otomatik duraklatma ve haftalık özet saklanır, işleri M3d'dedir; MQL/SQL kuralları bu sayfada düzenlenmez (M3a panosu kullanır).
- **Onaylar**: süper admin onay kuyruğunu pazarlama panelinde `/pazarlama/onaylar` ekranında görür; onay ve ret yalnızca süper admindedir (`POST /platform/marketing/approvals/:id/approve|reject`, `PlatformScoped` + `SuperAdminGuard`). Süper admin kendi talebini onaylayabilir; bu `SELF_APPROVED` ve özet içinde `selfApprovedBySuperAdmin: true` olarak kaydedilir. Yeni talepte süper adminlere işlemsel e-posta ve uygulama içi bildirim gider (`MARKETING_APPROVAL_REQUESTED`), karar talep edene bildirilir (`MARKETING_APPROVAL_APPROVED` / `_REJECTED`). Akışın tamamı `docs/PAZARLAMA_MODULU.md` M3b notlarında.

### M3d notları: denetim görünümü ve pazarlama sigortaları

- **`/admin/denetim`** (AdminNav'da "Denetim"): `AuditLog` satırlarını tüm kiracılar için listeler; süzgeçler kullanıcı kimliği, eylem (önek eşleşir: `marketing.approval` altındaki tüm eylemler), başlangıç ve bitiş tarihi (UTC gün sınırları); tablo zaman, kullanıcı, eylem, hedef (tür ve kimlik) ve ayrıntı sütunlarından oluşur, sayfa başına 50 kayıt. Ayrıntı sütunu ham `metadata` değil, iletişim bilgisi maskelenmiş kısa özettir. Uç yalnızca süper adminindir (`SuperAdminOnly`; diğer herkese 403).
- **`/admin/pazarlama-ayarlari`** artık uygulanan alanları içerir: günlük e-posta ve SMS kredi tavanı ile e-posta ısınma planı (virgülle ayrılmış günlük tavanlar), günlük yapay zeka tavanı, para birimi başına aylık reklam tavanı (aşımda panoda kırmızı uyarı ve süper admin bildirimi; reklamlar durdurulmaz), otomatik duraklatma eşikleri (bounce ve şikâyet, son 24 saat) ve haftalık özet (anahtar, alıcılar, "şimdi oluştur").
- **Bildirimler**: e-posta sigortası tetiklenince (neden başına 24 saatte en fazla bir kez) ve reklam tavanı aşılınca (ay ve para birimi başına bir kez) her süper admine işlemsel e-posta ve uygulama içi bildirim gider. Duraklatılan kampanyalar pazarlama panelinden elle sürdürülür.

## Kapsam dışı / takip maddeleri

- Süper admin taklit etme (impersonation): görevin kendisi kapsam dışı
  bıraktı.
- `maxSmsPerMonth` plan limiti şemada var ama uygulanmıyor (yukarıya
  bakın).
- Sağlayıcı düşük bakiye uyarısı şu an yalnızca `AuditLog` + log; ayrı bir
  push/e-posta bildirim kanalı yok.
- Rol/yetki ekranı ve tema seçimi (backlog 2.3) ve finans (2.4) bu işten
  ayrıdır.

## Hata raporlama ekranları (H1-H3)

Hepsi `@SuperAdminOnly()`; ayrıntı `docs/HATA_RAPORLAMA.md`.

| Ekran | Ne yapar |
|-------|----------|
| `/admin/hatalar` | Hata grupları: kaynak, durum, sürüm, işletme filtresi; hata koduyla arama. Birleştirilmiş gruplar listelenmez |
| `/admin/hatalar/[id]` | Yığın (çözülmüşse kaynak bağlamı satırlarıyla), adımlar, kullanıcı geri bildirimi, sürümler, işletmeler, son uyarılar; çöz, yok say, yeniden aç, not, başka bir gruba birleştir (hedef grup kimliği) |
| `/admin/hatalar/uyarilar` | Ani artış, yeni grup ve regresyon uyarıları; tür ve onay filtresi, hedef teslimat durumu, onaylama |
| `/admin/hatalar/ayarlar` | Ani artış eşikleri, grup başına bekleme süresi, imzalı webhook (adres, imza anahtarı) ve Slack (gelen webhook adresi); değerler şifrelenir ve tekrar gösterilmez |

Tenant sahibi kendi işletmesi için `/ayarlar/hatalar` üstünden yeni grup ve ani artışta e-posta bildirimini açıp kapatır (varsayılan kapalı).
