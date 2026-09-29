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
| Feature flag'ler | `GET /admin/feature-flags`, `GET /admin/feature-flags/catalog`, `POST /admin/feature-flags` | Çözümleme: TENANT > BUSINESS_TYPE > GLOBAL (`FeatureFlagsService.isFeatureEnabled`) |
| SMS paketleri | `GET /admin/sms-packages`, `POST /admin/sms-packages`, `POST /admin/sms-packages/:key/activate`, `POST /admin/sms-packages/:key/deactivate` | |
| Manuel SMS kredi yükleme | `POST /sms-wallet/top-up` (mevcut uç nokta, artık `SuperAdminOnly()`) | Her yükleme `AuditLog`'a yazılır |
| Global şablon/belge | `GET/POST /admin/content/message-templates`, `GET/POST /admin/content/document-versions` | `studioId: null` küresel varsayılanı, bir uuid ise kiracı geçersiz kılmasını hedefler |
| Benchmark | `GET /admin/benchmark?businessTypeTemplateKey=` | Aşağıya bakın |
| Sistem sağlığı | `GET /admin/health` | DB, Redis, kuyruk derinliği, son heartbeat zamanı, başarısız webhook teslimatı sayısı, SMS sağlayıcı bakiye durumu |
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
kaynağıdır; başka hiçbir modül kendi flag mantığını yazmamalıdır.
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

## Web paneli

`/admin` route grubu (`apps/web/src/app/admin/`), yalnızca oturum
kullanıcısı `isSuperAdmin` olduğunda görünür. Kiracı temasını kullanmaz
(CLAUDE.md kural 10: süper admin bir kiracı değildir); `packages/shared/
src/design`'daki nötr semantik renkleri ve ölçüleri doğrudan okur
(`AdminTheme` bileşeni), gradyan içermez. Sayfalar: `/admin/tenants`,
`/admin/plans`, `/admin/business-types`, `/admin/feature-flags`,
`/admin/sms-packages`, `/admin/content`, `/admin/benchmark`,
`/admin/health`. Tarayıcı yalnızca `/api/bff/*` üzerinden konuşur
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

## Kapsam dışı / takip maddeleri

- Süper admin taklit etme (impersonation): görevin kendisi kapsam dışı
  bıraktı.
- `maxSmsPerMonth` plan limiti şemada var ama uygulanmıyor (yukarıya
  bakın).
- Sağlayıcı düşük bakiye uyarısı şu an yalnızca `AuditLog` + log; ayrı bir
  push/e-posta bildirim kanalı yok.
- Rol/yetki ekranı ve tema seçimi (backlog 2.3) ve finans (2.4) bu işten
  ayrıdır.
