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

## Kapsam dışı / takip maddeleri

- Süper admin taklit etme (impersonation): görevin kendisi kapsam dışı
  bıraktı.
- `maxSmsPerMonth` plan limiti şemada var ama uygulanmıyor (yukarıya
  bakın).
- Sağlayıcı düşük bakiye uyarısı şu an yalnızca `AuditLog` + log; ayrı bir
  push/e-posta bildirim kanalı yok.
- Rol/yetki ekranı ve tema seçimi (backlog 2.3) ve finans (2.4) bu işten
  ayrıdır.
