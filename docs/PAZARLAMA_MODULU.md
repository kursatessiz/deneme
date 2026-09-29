# Pazarlama Modülü ve Pazarlama Yöneticisi Rolü (tasarım)

Durum: taslak, sahip onayı bekliyor. Bağlayıcı üst tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md`'dir; bu belge ona uyar ve yalnızca platform kiracısının (`Studio.isPlatform`) pazarlamasını tek bir panelden, yapay zeka desteğiyle ve ayrı bir "pazarlama yöneticisi" kullanıcısıyla yönetmeyi tanımlar. İnceleme tarihi: 2026-09-29, `origin/main` (`6d974e1`).

Sahibin isteği: projenin bütün pazarlamasını eşi yönetecek; bu kullanıcı "pazarlama yöneticisi" olacak; e-posta, SMS, WhatsApp, Meta, Google vb. ne gerekiyorsa eklenecek; Zapier, Meta, Google entegrasyonları hem pazarlama panelinden hem süper admin panelinden yönetilebilecek; süper admin paneli dışında yönetim yeri olmayacak (tek konsol); platformun kendi pazarlaması platform kiracısında yürür.

Özet karar:
- Yeni kod yazmak yerine mevcut büyüme çekirdeği (CRM, segment, kampanya, akış, mesajlaşma, reklam, sayfa motoru, huni, yapay zeka) platform kiracısına **bağlanır**. Eksik olan şey özellik değil, **erişim yolu**: süper admin bugün bu ekranların çoğuna web'den ulaşamıyor (bölüm 1.2).
- `MARKETING_ADMIN` sabit bir enum değil, **platform izin kataloğu + platform rol şablonu** olarak tasarlanır (CLAUDE.md kural 5). Pazarlama yöneticisi platform kiracısında sistem tarafından yönetilen gerçek bir `Membership` alır; böylece bütün kiracı ekranları ve uçları değişmeden çalışır, kural 6 (kullanıcı global, `studioId` User'da yok) korunur.
- Tek web alanı `/pazarlama/*`: hem pazarlama yöneticisi hem süper admin aynı sayfaları kullanır; süper admin panelinde "Pazarlama" ve "Entegrasyonlar" girişleri bu sayfalara ve aynı API servislerine gider (tek servis, iki giriş, tek denetim kaydı).
- Yapay zeka her şeyi taslak olarak üretir; **hiçbir gönderim veya harcama onaysız yapılmaz**. Eşikler ayardır.

---

## 1. Mevcut durum

### 1.1 Platform kiracısında bugün var olan yetenekler

| Yetenek | Kod | Platform kiracısında durum |
|---|---|---|
| Platform kiracısı | `packages/database/prisma/schema.prisma` `Studio.isPlatform` (satır ~608), tekil kısmi index (`20260929000000_crm_attribution`), seed `packages/database/prisma/seed.ts` `seedCrm()` | Var, slug `platform`. Hiçbir kullanıcının bu kiracıda üyeliği yok |
| CRM kişileri, satış hattı, görevler, özel alanlar | `apps/api/src/modules/crm/*`, web `/kisiler`, `/kisiler/[id]`, `/kisiler/satis-hatti` | Veri modeli hazır; platform sitesi formları ve `studio_signup`/`studio_paid` burada kişi üretir |
| Atıf, temas noktası, dönüşüm olayları | `crm/tracking`, `crm/conversions/conversion.service.ts` (`PLATFORM_ONLY` olaylar, `recordStudioSignup`, `recordStudioPaid`) | Çalışıyor; `studio_signup`, `studio_paid`, `pw_ref` tavsiye atfı yalnızca platform kiracısında |
| Segmentler | `apps/api/src/modules/growth/segments`, web `/segmentler` | Hazır, kural dili `packages/shared` |
| Kampanyalar | `growth/campaigns/campaigns.controller.ts` (`studios/:studioId/campaigns`: liste, oluştur, güncelle, `schedule`, `cancel`, `test-send`, `recipients`) | Hazır; A/B varyantı ve alıcı yerel saatine göre gönderim **yok** (`docs/KAMPANYA_VE_AKISLAR.md` satır 64, 141); onay adımı **yok** |
| Akışlar (journeys) | `growth/journeys`, web `/akislar` | Hazır; webhook adımı ve görsel tuval yok |
| Mesajlaşma motoru | `messaging/engine/messaging.service.ts` (`MessagingService.send()`), `compliance/compliance.service.ts` (`canSend`), `packages/shared/src/messaging-engine.ts` (STOP/HELP, bölge anahtar kelimeleri), şablonlar, izleme, `/m/u` abonelikten çıkma, `List-Unsubscribe` | Hazır. E-posta **tek global gönderen** (`SES_FROM_ADDRESS`, `docs/MESAJLASMA.md` satır 170); kiracı/marka başına gönderen alan adı ve SPF/DKIM/DMARC durumu **yok** |
| Gelen kutusu | `messaging/inbox`, web `/gelen-kutusu`, yapay zeka cevap önerisi (`ai/ai-tenant.controller.ts`) | Hazır; atama `Membership` ister |
| Reklam bağlantıları, CAPI, harcama, rapor | `apps/api/src/modules/ads/*` (`AdConnection`, `ConversionDeliveryDispatcherService`, `AdSpendSyncService`, `naming-check`), web `/ayarlar/reklam`, `/reklam-performansi` | Meta/Google/TikTok için dönüşüm gönderimi ve harcama çekme var; **kampanya oluşturma/düzenleme, Lead Ads, organik gönderi yok**; kimlik bilgisi elle yapıştırılır (OAuth akışı yok, `docs/REKLAM_ENTEGRASYONU.md` bölüm 3) |
| UTM oluşturucu | `packages/shared` `buildCampaignName()`, `AD_URL_TEMPLATES`, web `/ayarlar/reklam` | `docs/REKLAM_ENTEGRASYONU.md` bölüm 7 "süper admin panelinde platform kiracısı için" diyor, ancak `apps/web/src/app/admin` altında reklam/UTM ekranı **yok** (belge-kod uyuşmazlığı) |
| Sayfa motoru, açılış sayfaları, formlar | `apps/api/src/modules/sites/*`, web `/admin/web-sitesi` (`SiteEditor variant="platform"`), `dns.service.ts` | Süper admin **yalnızca bu modüle** web'den erişebiliyor (`GET /admin/company-info/platform-studio-id`) |
| Huniler | `docs/HUNILER.md`, web `/raporlar` "Huniler" sekmesi | Hazır huniler kiracı odaklı (aday -> deneme -> üye); platform için "ziyaretçi -> aday -> `studio_signup` -> `studio_paid`" hazır hunisi **yok** |
| Yapay zeka çekirdeği | `apps/api/src/modules/ai/*`: `AiService.run()`, `AnthropicAiAdapter`, `FakeAiAdapter`, `ai-writing.service.ts`, `prompts.ts`; görevler `AI_TASKS = ['TRANSLATION','COPYWRITING','REPLY_SUGGESTION']` (`packages/shared/src/ai/models.ts`), taslak türleri `AI_DRAFT_KINDS = ['CAMPAIGN','EMAIL','SMS','PAGE_BLOCK']` (`packages/shared/src/ai/api.ts`) | `POST /studios/:studioId/ai/draft` ve cevap önerisi var; marka kiti, varyant, segment önerisi, gönderim zamanı, haftalık özet, araştırma **yok**. Bütçe `studios.ai_monthly_budget_cents` -> plan -> platform varsayılanı |
| Deneme, etkinleştirme, B2B tavsiye | `apps/api/src/modules/billing/*` (`platform-billing.service.ts`, `studio-referrals.service.ts`), web `/admin/referrals` | Hazır; tavsiye ayarları süper admin sayfasında |
| Zapier / Make / n8n | `apps/api/src/modules/public-api/hooks-public.controller.ts`, `webhooks/*`, `api-keys/*`, olay kataloğu `packages/shared/src/open-platform.ts` `WEBHOOK_EVENTS` | REST hook aboneliği hazır; platforma özgü olaylar (`studio.signup`, `studio.paid`, `trial.expiring`) **yok**; web `/ayarlar/entegrasyonlar` üyelik ister |
| Hata raporlama | `docs/HATA_RAPORLAMA.md`, `/admin/hatalar` | Dönüşüm gönderim ve form hataları burada |

### 1.2 Süper admin bu yeteneklere bugün nasıl ulaşıyor

API katmanı:
- `/admin/*` uçları `SuperAdminOnly()` = `JwtAuthGuard` + `SuperAdminGuard` (`apps/api/src/modules/auth/decorators/super-admin-only.decorator.ts`, `guards/super-admin.guard.ts`); guard yalnızca `request.user.isSuperAdmin`'e bakar.
- Kiracı uçları `@StudioScoped()` = `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` + `BillingWriteGuard` (`decorators/require-permission.decorator.ts`). `StudioTenantGuard` (`guards/studio-tenant.guard.ts`) süper admin için üyelik aramadan, var olan **her** kiracıya `ALL_PERMISSIONS` ve `membershipId: null` ile bağlam kurar. Yani API düzeyinde süper admin platform kiracısının bütün pazarlama uçlarını çağırabilir.

Web katmanı:
- `(dashboard)` grubu `getServerSession()` (`apps/web/src/lib/session/server-session.ts`) ile yalnızca kullanıcının `memberships` listesindeki bir kiracıyı etkin yapabilir; `AuthService.sessionUser()` (`apps/api/src/modules/auth/auth.service.ts` satır ~168) yalnızca gerçek `Membership` satırlarını döner. Süper adminin platform kiracısında üyeliği olmadığından `/kisiler`, `/segmentler`, `/kampanyalar`, `/akislar`, `/gelen-kutusu`, `/reklam-performansi`, `/raporlar`, `/ayarlar/reklam`, `/ayarlar/mesaj-sablonlari`, `/ayarlar/entegrasyonlar` ekranları platform kiracısı için **açılamaz**.
- `/admin` grubu (`apps/web/src/app/admin/layout.tsx`, `getAdminSession()`), menü `apps/web/src/components/admin/AdminNav.tsx`: kiracılar, planlar, tavsiye, işletme türleri, feature flag, SMS paketleri, içerik, web sitesi, diller, yapay zeka, benchmark, sağlık, hatalar. Platform kiracısına dokunan tek ekran `/admin/web-sitesi`.
- Kiracı sayfaları etkin kiracıyı `useDashboardSession()` (`apps/web/src/components/session/DashboardSessionProvider.tsx`) üzerinden alır ve BFF'ye `x-studio-id` gönderir (`apps/web/src/lib/session/client.ts`, `app/api/bff/[...path]/route.ts`). Bu, sayfaların başka bir kabukta farklı bir `activeStudioId` ile yeniden kullanılmasına izin veren doğru bir dikiş noktasıdır.

### 1.3 "Tek yerden bütün pazarlama" için boşluklar (dosya/rota düzeyinde)

1. **Web erişimi yok**: platform kiracısının CRM, segment, kampanya, akış, gelen kutusu, reklam, huni, şablon ve entegrasyon ekranları süper admin veya başka bir platform kullanıcısı için açılamıyor (bölüm 1.2). `apps/web/src/lib/nav.ts` `NAV_ITEMS` kiracı menüsüdür, platform bağlamı yok.
2. **Rol yok**: süper admin dışında platform düzeyinde bir kullanıcı tipi yok. `User.isSuperAdmin` tek bayraktır; `SuperAdminGuard` bilerek izin kontrolü yapmaz. Pazarlama yöneticisine süper admin bayrağı vermek kiracı CRUD, planlar, faturalama, yedek, sağlık, diğer kiracıların verisi dahil her şeyi açar.
3. **Sistem rol şablonu kilidi yok**: `RoleTemplate.isSystem` alanı var ama `apps/api/src/modules/role-templates/role-templates.service.ts` bu alana göre düzenlemeyi engellemiyor.
4. **`membershipId: null` sorunu**: süper admin kiracı adına işlem yaptığında `Campaign.createdByMembershipId`, kişi sahibi, görev atanan, gelen kutusu ataması gibi `Membership` referansları boş kalıyor; kim yaptı bilgisi yalnızca `AuditLog.userId`'de.
5. **Entegrasyon merkezi yok**: yapay zeka anahtarı `/admin/ai`'da, reklam bağlantıları kiracı `/ayarlar/reklam`'da, API anahtarı ve webhook'lar kiracı `/ayarlar/entegrasyonlar`'da, SMS/WhatsApp sağlayıcıları ortam değişkeni ve `messagingSettings`'te, SES ortam değişkeninde. Tek görünüm ve tek denetim akışı yok.
6. **E-posta alan adı doğrulaması yok**: `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 2.2 "Alan adı doğrulama (SPF, DKIM, DMARC)" diyor; kodda gönderen alan adı modeli ve DNS durum ekranı yok. `sites/dns.service.ts` TXT/CNAME sorgusu için yeniden kullanılabilir.
7. **Onay akışı yok**: kampanya `schedule` doğrudan gönderime gider; reklam tarafında harcama değiştiren bir işlem zaten yok ama eklenecekse onay gerekecek.
8. **Kampanya eksikleri**: A/B varyantı, alıcı yerel saatine göre gönderim, gönderim zamanı önerisi yok.
9. **Çift onay (double opt-in) yok**: `grep doubleOptIn` boş. AB (özellikle Almanya) için rıza ispatı eksik.
10. **Platform KPI panosu yok**: MQL/SQL, CAC, deneme -> ücretli dönüşüm, kanal ROI tek ekranda değil; parçalar `/reklam-performansi`, `/raporlar`, `/admin/referrals` içinde dağınık ve çoğu platform kiracısı için açılamıyor.
11. **Yapay zeka pazarlama görevleri yok**: marka kiti, ürün gerçekleri (grounding), varyant üretimi, segment önerisi, haftalık özet, araştırma asistanı.
12. **Organik sosyal ve Lead Ads yok**: Meta sayfa/Instagram gönderisi, LinkedIn şirket sayfası, Meta Lead Ads senkronu yok.
13. **Belge uyuşmazlığı**: `docs/REKLAM_ENTEGRASYONU.md` bölüm 7'deki "süper admin panelinde UTM oluşturucu" kodda yok; M1'de ya ekran eklenmeli ya belge düzeltilmeli (öneri: `/pazarlama/reklam` altında gelir, belge güncellenir).

---

## 2. Rol tasarımı

### 2.1 Seçenekler

| Seçenek | Artı | Eksi |
|---|---|---|
| A. `User.platformRole` enum (`SUPER_ADMIN`, `MARKETING_ADMIN`, null) | Basit, tek sütun | Kural 5'e aykırı (sabit rol); yeni bir platform rolü (ör. destek, muhasebe) her seferinde enum + guard değişikliği ister; ince ayar (ör. "reklam görsün ama bütçe değiştirmesin") yapılamaz |
| B. Pazarlama yöneticisine yalnızca platform kiracısında normal bir `Membership` + "Pazarlama" rol şablonu vermek | Sıfır guard değişikliği, bütün ekranlar çalışır | Platform düzeyindeki şeyler (entegrasyon merkezi, yapay zeka ayarları görünümü, onaylar, marka kiti, platform KPI'ları) kiracı izin kataloğunda yok; rolü kimin verdiği ve geri aldığı denetlenemez; kiracı izin kataloğuna platforma özgü anahtar eklemek kataloğu kirletir |
| C. **Önerilen**: `PlatformRoleTemplate` + `PlatformMembership` (platform izin kataloğu) **ve** bunun sistem tarafından senkron tutulan platform kiracısı `Membership`'i | Kural 5 (izin tabanlı), kural 6 (kullanıcı global; platform yetkisi ayrı tabloda, `User`'da `studioId` yok); kiracı ekranları değişmeden çalışır; `membershipId` referansları dolu; yeni platform rolleri veriyle eklenir | İki kaydın senkron tutulması gerekir (tek servis ve tek işlem ile çözülür) |

Gerekçe: kural 5 "sabit rollere değil izinlere" der; A bunu ihlal eder. B tek başına platform düzeyindeki yetkileri ifade edemez. C, platform yetkisini kendi kataloğunda tutar ve kiracı düzeyindeki işi mevcut `Membership` mekanizmasına bırakır.

`User.isSuperAdmin` olduğu gibi kalır ve kök yetkidir: süper admin bütün platform izinlerine örtük olarak sahiptir, `PlatformMembership` satırı gerekmez, tablo üzerinden süper adminlik **verilemez** (kiracı sahibinin düşürülemez olması kuralının platform karşılığı).

### 2.2 Platform izin kataloğu (`packages/shared/src/platform-permissions.ts`)

Kiracı kataloğundan (`permissions.ts`) ayrı dosya, aynı desen: `PLATFORM_PERMISSIONS`, `PlatformPermissionKey`, `isPlatformPermissionKey`, `PLATFORM_PERMISSION_AREAS`, `DEFAULT_PLATFORM_ROLE_TEMPLATES`. Etiketler Türkçe kalır (mevcut katalog gibi), UI metinleri i18n anahtarıyla gösterilir (`platformPermissions` ad alanı, tr + en).

| Anahtar | Anlamı |
|---|---|
| `platform.marketing.view` | Pazarlama panelini, KPI panosunu ve raporları görme |
| `platform.marketing.manage` | Platform kiracısında CRM, segment, kampanya, akış, şablon, site, huni taslağı hazırlama ve düzenleme |
| `platform.marketing.send` | Onay eşiğinin altındaki gönderimleri kendi onayıyla başlatma (eşik üstü her zaman onay ister) |
| `platform.marketing.approve` | Başkasının gönderim/harcama talebini onaylama (varsayılan: yalnızca süper admin) |
| `platform.inbox.reply` | Platform gelen kutusunda cevap yazma |
| `platform.ads.view` | Reklam performansı ve harcama |
| `platform.ads.manage` | Reklam bağlantıları, UTM, adlandırma, Lead Ads eşlemesi, reklam durdurma |
| `platform.ads.spend` | Bütçe değiştirme, kampanya etkinleştirme talebi (onaya tabi) |
| `platform.social.publish` | Organik sosyal gönderi planlama (onaya tabi) |
| `platform.integrations.manage` | Pazarlama entegrasyonları: reklam, sosyal, Zapier/webhook, API anahtarı, e-posta gönderen alan adı |
| `platform.ai.use` | Yapay zeka stüdyosu (platform kiracısının yapay zeka bütçesinden) |
| `platform.brand.manage` | Marka kiti ve ürün gerçekleri |
| `platform.contacts.export` | Platform kişi listesini dışa aktarma (varsayılan kapalı) |
| `platform.referrals.view` | B2B tavsiye programı raporu (salt okunur) |
| `platform.users.manage` | Platform kullanıcılarını davet etme ve rol verme (varsayılan: yalnızca süper admin; tabloyla verilemez) |

Kasıtlı olarak katalogda **olmayanlar** (yalnızca `isSuperAdmin`): kiracı CRUD, askıya alma, plan ve fiyatlar, faturalama durumu değişikliği ve zorla etkinleştirme, feature flag, SMS paketi ve kredi yükleme, yapay zeka anahtarı ve modeller, diller, sistem sağlığı, zamanlayıcı tetikleyicileri, hata ayrıntıları, yedek/deploy, benchmark (kiracı kırılımı). Bu uçlar `SuperAdminOnly()` ile kalır ve hiç değişmez.

Varsayılan platform rol şablonu `marketing_admin` ("Pazarlama Yöneticisi"): `platform.marketing.view`, `.manage`, `.send`, `platform.inbox.reply`, `platform.ads.view`, `.manage`, `.spend`, `platform.social.publish`, `platform.integrations.manage`, `platform.ai.use`, `platform.brand.manage`, `platform.referrals.view`. `approve`, `contacts.export`, `users.manage` yok.

### 2.3 Platform izninden kiracı iznine eşleme

`packages/shared/src/platform-permissions.ts` içinde tek eşleme `PLATFORM_TENANT_GRANTS: Record<PlatformPermissionKey, readonly PermissionKey[]>`:

- `platform.marketing.view` -> `crm.view`, `segments.view`, `campaigns.view`, `journeys.view`, `inbox.view`, `reports.view`, `site.view`
- `platform.marketing.manage` -> `crm.manage`, `segments.manage`, `campaigns.manage`, `journeys.manage`, `funnels.manage`, `site.manage`, `notifications.manage` (mesaj şablonları ve mesajlaşma ayarları)
- `platform.inbox.reply` -> `inbox.reply`, `inbox.manage`
- `platform.ads.view` -> `ads.view`; `platform.ads.manage` -> `ads.manage`
- `platform.integrations.manage` -> `integrations.manage`
- `platform.ai.use` -> `ai.use`
- `platform.contacts.export` -> `crm.export`

Hiçbir platform izni `roles.manage`, `staff.manage`, `studio.settings.manage`, `billing.manage`, `finance.*`, `payouts.*` üretmez. `resolvePlatformTenantPermissions(platformPerms)` saf fonksiyondur ve birim testlidir.

### 2.4 Platform kiracısındaki üyelik (senkron)

`PlatformAccessService` (`apps/api/src/modules/platform-access/`) tek yazıcıdır:
1. Platform kiracısında sistem rol şablonu `platform:<platformRoleKey>` (`isSystem = true`) oluşturur/günceller; izinleri `PLATFORM_TENANT_GRANTS` ile türetilir.
2. `PlatformMembership` ACTIVE olduğunda aynı işlemde platform kiracısında `Membership` (ACTIVE, bu rol şablonu) yazar; PASSIVE/iptal olduğunda aynı işlemde `Membership.status = PASSIVE`.
3. Platform rol şablonunun izinleri değişince bağlı sistem rol şablonunu yeniden türetir.

Guard değişiklikleri (savunma derinliği):
- `StudioTenantGuard`: çözümlenen kiracı `isPlatform` ise ve üyeliğin rol şablonu `isSystem` + `platform:` önekliyse, kullanıcının ACTIVE bir `PlatformMembership`'i olmalı; yoksa 403. (Senkron bozulsa bile erişim platform kaydına bağlı kalır.) Sorgu mevcut `membership.findUnique` include'una eklenir, ek gidiş yok.
- `RoleTemplatesService`: `isSystem = true` şablonların düzenlenmesi, silinmesi ve bu şablonla davet oluşturulması reddedilir (bugün engellenmiyor, bölüm 1.3 madde 3). `InvitesService` platform kiracısına personel davetini reddeder; platform kullanıcıları yalnızca bölüm 2.6 akışıyla eklenir.
- `BillingWriteGuard`: değişiklik yok (platform kiracısı `billingStatus = ACTIVE`, faturalama işleri `isPlatform: false` filtreli).

Pazarlama yöneticisinin başka kiracılarda yetkisi yoktur: `StudioTenantGuard` süper admin atlamasını yalnızca `isSuperAdmin` için yapar; pazarlama yöneticisinin tek personel üyeliği platform kiracısındadır. Kişisel olarak bir stüdyonun üyesiyse o üyelik ayrı ve normal kurallarla çalışır (kural 6).

### 2.5 Platform düzeyi uçlar için guard

- `PlatformPermissionGuard` (`apps/api/src/modules/auth/guards/platform-permission.guard.ts`) + dekoratörler `RequirePlatformPermission(...keys)` ve `PlatformScoped()` = `JwtAuthGuard` + `PlatformPermissionGuard`. Kural: `user.isSuperAdmin` ise geç; değilse ACTIVE `PlatformMembership` yükle (her istekte veritabanından, `StudioTenantGuard` gibi), rol şablonunun izinleri gerekenlerin hepsini içermeli. Hiçbir izin beyan etmeyen handler reddedilir (mevcut `PermissionGuard` ile aynı güvenli varsayılan).
- `request.platform = { userId, isSuperAdmin, permissions, platformStudioId }` (`tenant-context.ts`'e `PlatformContext` tipi). `platformStudioId` sunucuda çözülür (`isPlatform: true`), istemciden alınmaz.
- `AuthUser`/`/auth/me`: `SessionUserDTO`'ya `platformAccess: { permissions: PlatformPermissionKey[] } | null` eklenir (yalnızca ekleme). Web `/pazarlama` kabuğu bununla menüyü çizer.
- `SuperAdminGuard` değişmez.

### 2.6 Süper admin rolü nasıl verir ve geri alır

Süper admin paneli: `/admin/platform-kullanicilari` (yeni sayfa, `AdminNav`'a eklenir).
1. Telefon (E.164) ve ad soyad girilir, platform rol şablonu seçilir (`marketing_admin`).
2. `POST /admin/platform-users/invites` (`SuperAdminOnly`) mevcut `InviteToken` akışını yeniden kullanır: kullanıcı yoksa telefon OTP ile hesap açar (kural 6: kullanıcı telefonla globaldir). `InviteToken`'a `platformRoleTemplateId` (nullable) eklenir; `studioId` platform kiracısıdır. Kabulde `PlatformAccessService.activate()` çağrılır.
3. Liste: ad, telefon (maskeli), rol, durum, son giriş, 2FA durumu. İşlemler: rol değiştir, pasifleştir (anında: aynı işlemde `Membership` PASSIVE, `refreshTokenHash = null` ile oturum düşürülür), yeniden etkinleştir.
4. Her işlem `AuditLog` (`studioId: null`, `entityType: 'platform_membership'`, `action: platform_user.invited|activated|role_changed|deactivated`, `metadata`: eski/yeni rol, çağıran).
5. İsteğe bağlı: platform rol şablonu düzenleyicisi `/admin/platform-kullanicilari/roller` (izin kutuları `PLATFORM_PERMISSION_AREAS`'tan). Faz 1'de tek varsayılan şablon yeterlidir.

---

## 3. Pazarlama paneli

### 3.1 Kabuk ve erişim

- Yeni rota grubu `apps/web/src/app/pazarlama/` (URL `/pazarlama/*`). `layout.tsx` sunucu tarafında `/auth/me`'den `isSuperAdmin || platformAccess` kontrol eder, platform kiracısı kimliğini `GET /platform/context` ile alır ve `DashboardSessionProvider`'ı `{ activeStudioId: platformStudioId, permissions: <türetilmiş kiracı izinleri>, isOwner: false, currency: <platform kiracısı para birimi> }` ile sarar. Böylece `(dashboard)` sayfaları değişmeden bu kabukta çalışır.
- Tema: süper admin paneli gibi nötr tokenlar (`AdminTheme` deseni), gradyan yok (kural 10); platform kiracısının marka rengi yalnızca önizlemelerde.
- Menü `apps/web/src/lib/marketing-nav.ts` içinde `MARKETING_NAV_ITEMS` (platform izin anahtarlarıyla), `filterNavByPermissions` ile aynı mantık. Süper admin hepsini görür.
- Süper admin paneli: `AdminNav`'a "Pazarlama" (`/pazarlama`) ve "Entegrasyonlar" (`/admin/entegrasyonlar`) eklenir. Böylece sahip için tek konsol `/admin` olarak kalır; pazarlama yöneticisi yalnızca `/pazarlama`'yı görür (`/admin` layout'u onu `/pazarlama`'ya yönlendirir).
- Sayfa yeniden kullanımı: `/pazarlama/kisiler/page.tsx` gibi dosyalar `(dashboard)` sayfa bileşenini yeniden dışa aktarır. Sayfaların içindeki sabit `href="/kisiler/..."` bağlantıları (şu an ~18 yerde) `useAreaHref()` yardımcısına çevrilir: kabuk bir `basePath` (`''` veya `/pazarlama`) sağlar. Bu tek mekanik PR'dır.

### 3.2 Bilgi mimarisi

| Bölüm | Rota | Kaynak | İzin |
|---|---|---|---|
| Pano | `/pazarlama` | Yeni (bölüm 3.3) | `platform.marketing.view` |
| Onaylar | `/pazarlama/onaylar` | Yeni | `.send` veya `.approve` (kendi talepleri / onay kuyruğu) |
| İçerik takvimi | `/pazarlama/takvim` | Yeni | `platform.marketing.manage` |
| Yapay zeka stüdyosu | `/pazarlama/yapay-zeka` (M2'de `yz-studyo` yerine bu ad) | Yeni | `platform.ai.use` |
| Kişiler, satış hattı | `/pazarlama/kisiler`, `/pazarlama/kisiler/satis-hatti` | Mevcut `(dashboard)/kisiler` | `.view` |
| Segmentler | `/pazarlama/segmentler` | Mevcut | `.view` |
| Kampanyalar | `/pazarlama/kampanyalar` | Mevcut + A/B + onay | `.view` |
| Akışlar | `/pazarlama/akislar` | Mevcut | `.view` |
| Gelen kutusu | `/pazarlama/gelen-kutusu` | Mevcut | `.view` |
| Mesaj şablonları | `/pazarlama/sablonlar` | Mevcut `ayarlar/mesaj-sablonlari` | `.manage` |
| Web sitesi ve açılış sayfaları | `/pazarlama/site` | Mevcut `SiteEditor variant="platform"` (süper admin `/admin/web-sitesi` ile aynı bileşen) | `.manage` |
| Reklam | `/pazarlama/reklam` (performans + UTM + adlandırma + bağlantılar) | Mevcut `reklam-performansi` + `ayarlar/reklam` | `platform.ads.view` |
| Sosyal | `/pazarlama/sosyal` | Yeni (M4) | `platform.social.publish` |
| Huniler ve raporlar | `/pazarlama/raporlar` | Mevcut `raporlar` Huniler sekmesi + platform hazır hunisi | `.view` |
| B2B tavsiye | `/pazarlama/tavsiye` | Mevcut admin raporunun salt okunur görünümü | `platform.referrals.view` |
| Entegrasyonlar | `/pazarlama/entegrasyonlar` | Yeni merkez (bölüm 5) | `platform.integrations.manage` |
| Marka kiti | `/pazarlama/marka` | Yeni | `platform.brand.manage` |

Mobil: faz 1'de yok. Tek istisna ucuz olduğu için önerilir: mevcut mobil resepsiyon gelen kutusu platform kiracısı üyeliğiyle zaten çalışır (üyelik gerçek olduğu için başlıktaki kiracı değiştiricide "Platform" görünür). Onay bildirimi push olarak M3'te eklenebilir.

### 3.3 Pazarlama panosu (`/pazarlama`)

Tek API: `GET /platform/marketing/dashboard?from&to&compare=previous` (`PlatformScoped`, `platform.marketing.view`). Tümü toplu sayılardır, kişi verisi dönmez.

- Huni kartları: ziyaretçi -> aday (`lead`) -> MQL -> SQL -> `studio_signup` (deneme) -> `studio_paid`; adım dönüşüm oranı ve medyan süre (mevcut huni sorgusu, yeni hazır huni `platform_b2b`).
- MQL/SQL tanımı veridir: `MarketingSettings.mqlRule` ve `sqlRule` segment kural dilinde (ör. MQL = form doldurdu + işletme türü seçti; SQL = satış hattında "demo" aşaması). Sabit kod yok.
- CAC = dönem reklam harcaması (`AdSpendDaily`, para birimi başına) / dönemde `studio_paid` sayısı; CPL; deneme -> ücretli oranı ve medyan süre (`studios.billingStatus` geçişleri + `studio_paid`); kanal ROI = atfedilen `studio_paid` değeri / harcama (mevcut atıf raporu `groupBy=source|campaign`).
- MRR etkisi: yalnızca `platform.referrals.view` veya süper admin görürse, plan fiyatlarından (açık karar, bölüm 9).
- Kanal sağlığı: e-posta bounce/şikâyet oranı (son 7/30 gün, `NotificationLog` durumlarından), SMS teslim oranı, yapay zeka bütçesi kullanımı, bekleyen onaylar, bağlantı hataları (`AdConnection.lastError`, dönüşüm gönderim `FAILED` sayısı).
- Para tutarları `Intl.NumberFormat` ile, para birimi ayrı ayrı (farklı para birimleri toplanmaz, kural 8).

### 3.4 İçerik takvimi (`/pazarlama/takvim`)

Ay/hafta görünümü; öğeler: kampanya (planlı), akış başlangıcı, sosyal gönderi, açılış sayfası yayını, reklam kampanyası başlangıç/bitişi (senkrondan), elle not. Sürükle bırak tarih değiştirme yalnızca `DRAFT`/`PENDING_APPROVAL` öğelerde. Her öğe bir "brief"e ve yapay zeka taslaklarına bağlanabilir. Bölge saat dilimi seçilebilir (hedef pazar).

---

## 4. Yapay zeka destekli özellikler

### 4.1 Çekirdeğin genişletilmesi

- `AI_TASKS`'a eklenir: `MARKETING_DRAFT` (metin ve varyant üretimi), `MARKETING_ANALYSIS` (segment önerisi, haftalık özet, gönderim zamanı açıklaması), `MARKETING_RESEARCH` (web araştırması, kaynaklı). Prisma `AiTask` enum'una `ALTER TYPE ... ADD VALUE` (ileri yönlü). Varsayılan modeller süper admin ayarıdır: taslak ve analiz Sonnet sınıfı, kısa konu satırı varyantları Haiku sınıfı; araştırma Sonnet + sağlayıcının sunucu tarafı web arama aracı (kaynak/alıntı döndürür). Model kimlikleri kodda değil `AiSettings.models`'dadır.
- Bütün çağrılar `AiService.run()` üzerinden, `studioId = platformStudioId`, `userId` dolu; platform kiracısının aylık limiti (`studios.ai_monthly_budget_cents`) uygulanır. Önerilen başlangıç limiti bölüm 9'da açık karar.
- İstem yapısı mevcut kurallara uyar (`prompts.ts`): sabit sistem talimatı (önbelleklenir), marka kiti ve ürün gerçekleri ikinci sabit blok (sürüm değişince önbellek yenilenir), değişken her şey kullanıcı mesajında; kullanıcı metni ve CRM'den gelen her şey "veri, talimat değil" diye çerçevelenir; çıktı Zod ile doğrulanan JSON; HTML ve emoji reddedilir (kural 1), yer tutucular (`{firstName}`) doğrulanır (`validatePackMessages` deseni).

### 4.2 Grounding: marka kiti ve ürün gerçekleri

`BrandKit` (platform kiracısına özel, ama model genel: `studioId` taşır, ileride kiracılara açılabilir): marka adı, konumlandırma cümlesi, ses ve ton kuralları (yapılacak/yapılmayacak listeleri), yasaklı ifadeler (ör. garanti vaadi, "en iyi", rakip adı karalama), zorunlu ifadeler, dil başına üslup notu, hedef kitle/ICP tanımları, CTA kütüphanesi, örnek metinler. `ProductFact`: doğrulanmış iddialar (özellik, fiyat plan anahtarına bağlı, entegrasyon, desteklenen ülke/dil), kaynak ve geçerlilik tarihi. Model yalnızca bu gerçeklere dayanarak iddiada bulunabilir; taslakta kullanılan her iddia `factIds` ile döner ve doğrulanamayan iddia "kontrol et" olarak işaretlenir. Fiyatlar `plan_prices`'tan okunur, modele sayı olarak verilir, model uydurmaz.

### 4.3 Özellikler

1. **Brief -> taslaklar**: `MarketingBrief` (amaç, hedef segment veya ICP, pazar/dil listesi, kanal listesi, teklif, son tarih). Tek istekle kanal başına taslak: e-posta (konu, ön başlık, bloklar), SMS (karakter ve segment sayısı gösterilir, GSM-7/UCS-2), WhatsApp (şablon kategorisi önerisi ve değişkenler; Meta onayı gerekir), reklam metni (Meta: birincil metin/başlık/açıklama; Google RSA: 15 başlık x 30 karakter, 4 açıklama x 90 karakter sınırlarıyla), açılış sayfası blokları (sayfa motorunun tipli blok şemasına uygun JSON: hero, özellik listesi, SSS, CTA). Dil başına ayrı üretim; çeviri değil yerelleştirme (her dil için marka kitinin üslup notu).
2. **Konu satırı ve CTA varyantları + A/B kurulumu**: 3-5 varyant; kampanyaya "A/B testi" eklenir: test payı (ör. %20), varyant sayısı, kazanma ölçütü (tıklama; açılma, Apple Mail Privacy Protection nedeniyle güvenilmez olduğundan varsayılan değil), bekleme süresi, sonra kalan kitleye kazanan. Mevcut kampanya kümesi ve `campaign:<id>:<kişi>` tekilleştirmesi korunur; `CampaignVariant` tablosu (bölüm 7).
3. **Segment önerisi**: model kişi satırı görmez; `SegmentInsightService` platform kiracısında toplu istatistik çıkarır (yaşam döngüsü, kaynak, ülke, dil, işletme türü özel alanı, son etkileşim aralığı başına sayılar, dönüşüm oranları; 5'ten küçük hücreler bastırılır, benchmark'taki k-anonimlik deseni). Model segment kural dilinde (paylaşılan Zod şeması) öneri + gerekçe döner; kural sunucuda doğrulanır ve önizleme sayısı gösterilir; kaydetmek kullanıcı işidir. Bu, `docs/BUYUME_VE_GLOBAL_MIMARI.md` 3.10'daki "segment tarifinden kural üretme" kalan maddesini de kapatır.
4. **En iyi gönderim zamanı**: iki katman. (a) Deterministik: kişi başına son 90 gündeki açılma/tıklama saatleri (alıcının yerel saat diliminde) ile saat-gün histogramı; yeterli veri (ör. en az 3 etkileşim) yoksa segment ortalaması, o da yoksa bölge varsayılanı. Kampanyada "alıcı yerel saatine göre" ve "kişiye özel en iyi saat" seçenekleri; sessiz saat ve sıklık sınırı yine `canSend`'de. (b) Yapay zeka yalnızca histogramı açıklar ve kampanya düzeyinde öneri yazar; kişi başına tahmin modelle yapılmaz (maliyet ve PII).
5. **Haftalık performans özeti**: her pazartesi (zamanlayıcı kalp atışı, platform saat dilimi) toplu KPI'lar (bölüm 3.3 verisi, önceki hafta karşılaştırmalı) modele verilir; çıktı: 5-8 maddelik özet, en fazla 5 önerilen eylem (her biri bir ekrana derin bağlantı: "şu segmente şu kampanyayı taslakla"). Pazarlama yöneticisine ve süper admine uygulama içi bildirim + e-posta (TRANSACTIONAL, mesajlaşma motoru). `MarketingInsight` satırı olarak saklanır; önerilen eylem taslak üretir, asla gönderim yapmaz.
6. **Rakip ve ICP araştırma asistanı**: soru -> web arama aracıyla kaynaklı cevap; her iddia kaynak URL'siyle; sonuçlar `ResearchNote` olarak kaydedilir ve marka kitine "gerçek" olarak yalnızca insan onayıyla taşınır. Rakip adı reklam veya içerikte kullanılmaz (marka kiti kuralı). Web içeriği veri olarak ele alınır.
7. **SEO açılış sayfası taslağı**: sektör x dil x teklif için başlık, meta açıklama, H yapısı, SSS (FAQPage), iç bağlantı önerileri, `hreflang` eşleri; çıktı sayfa motoru bloklarına dönüştürülüp **taslak** sayfa olarak kaydedilir (yayın insan işi). URL yapısı `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 5'e uyar.
8. **Gelen kutusu**: mevcut cevap önerisi aynen (platform kiracısında `inbox.reply` + `ai.use` türetilmiş izinleriyle).

### 4.4 Korkuluklar

- **İnsan onayı**: yapay zeka çıktısı her zaman `AiDraft` (durum `DRAFT`); kampanyaya/şablona/sayfaya aktarım kullanıcı eylemidir; gönderim ve harcama bölüm 6 onayından geçer.
- **Bütçe**: platform kiracısı limiti + görev başına günlük üst sınır (`MarketingSettings.aiDailyCapCents`), araştırmada istek başına arama sayısı sınırı. Limit dolunca mevcut `AI_MONTHLY_LIMIT_REACHED` kodu.
- **Kişisel veri**: modele kişi adı, telefon, e-posta, serbest not gönderilmez. Kişiselleştirme yer tutucuyla yapılır (`{firstName}`), değer gönderimde motor tarafından doldurulur. Gelen kutusu önerisi (mevcut) konuşma metnini gönderir; bu tek istisna zaten belgelenmiş durumdadır ve telefon/e-posta desenleri gönderimden önce maskelenir (yeni: `redactPii()` shared yardımcısı). Toplu istatistiklerde küçük hücre bastırma.
- **Uyum ön kontrolü** (`MarketingPreflightService`): gönderim onayına gitmeden önce kampanya kitlesi `ComplianceService.canSend` kurallarıyla **kuru çalıştırılır** (yeni `dryRun` modu; gerçek gönderim yolunda değişiklik yok): bölge başına alıcı sayısı, izinsiz/İYS reddi/abonelikten çıkmış/bastırılmış sayısı, sessiz saate düşecek sayı ve erteleme, sıklık sınırına takılacak sayı. Ticari e-postada fiziksel adres ve abonelikten çıkma bağlantısı (CAN-SPAM, motor zaten ekliyor) doğrulanır; SMS'te gönderen kimliği ve çıkış talimatı (TCPA/İYS) kontrol edilir. AB alıcıları için rıza kaydı yoksa (veya çift onay istenen ülkelerde onay tamamlanmamışsa) alıcı kitleden düşülür.
- **Ton ve marka kontrolü**: deterministik kurallar (yasaklı ifadeler, zorunlu ifadeler, uzunluk, büyük harf/ünlem yoğunluğu, emoji yok) + isteğe bağlı model incelemesi ("marka kitine uygun mu", gerekçeli); sonuç onay ekranında gösterilir, engelleyici olan yalnızca deterministik kurallardır.
- **Kötüye kullanım**: kişiye/rakibe karalama, sağlık vaadi gibi iddialar marka kiti yasak listesinde; model reddi (`AI_REFUSED`) kullanıcıya gösterilir.

---

## 5. Kanallar ve entegrasyonlar

### 5.1 Tek servis, iki giriş

- API: `apps/api/src/modules/platform-marketing/integrations/` içinde `IntegrationHubService` ve `PlatformIntegrationsController` (`/platform/integrations/*`, `PlatformScoped` + `platform.integrations.manage`; süper admin örtük geçer). Servis kendi tablosunu yazmaz; mevcut servisleri platform kiracısı kimliğiyle çağırır: `AdConnectionsService`, `ApiKeysService`, `WebhooksService`, `MessagingSettings`, yeni `SocialConnectionsService`, yeni `EmailDomainsService`. Tek özet uç: `GET /platform/integrations` (her bağlantının durumu, son senkron, son hata, kimlik bilgisinin son 4 karakteri, sahibi olan kullanıcı).
- Web: bileşen `apps/web/src/components/integrations/IntegrationHub.tsx`; `/pazarlama/entegrasyonlar` ve `/admin/entegrasyonlar` aynı bileşeni aynı uçlarla kullanır. Süper admin sayfası ek olarak yalnızca süper admine ait platform düzeyi kartları gösterir (yapay zeka anahtarı -> `/admin/ai`, SMS sağlayıcı bakiyesi -> `/admin/health`, Stripe/iyzico -> ortam) salt okunur durum olarak.
- Denetim: her yazma `AuditLog` (`studioId = platformStudioId`, `userId`, `action: integration.<tür>.<işlem>`, `metadata.via: 'marketing'|'admin'`). Kimlik bilgisi hiçbir yanıtta ve logda dönmez (mevcut `CredentialCipher`, `INTEGRATION_ENCRYPTION_KEY`, AES-256-GCM).
- Kiracı uçları (`/studios/:id/ads/connections`, `/integrations/api-keys`, `/integrations/webhooks`) aynen kalır; hub bunların üstünde bir birleştiricidir, ikinci bir doğruluk kaynağı değildir.

### 5.2 Kanal kanal

| Kanal | Bugün | Faz 1 (M1-M3) | Sonra (M4-M5) | Kimlik doğrulama | Kimlik bilgisi yeri |
|---|---|---|---|---|---|
| E-posta (Amazon SES) | Global `SES_FROM_ADDRESS`, SNS bounce/şikâyet, bastırma, `List-Unsubscribe` | `EmailSenderDomain`: platform kiracısı için pazarlama alt alan adı (ör. `news.<alan>`), SES kimliği oluşturma talimatı, **DNS durum ekranı**: SPF (`include:amazonses.com` veya özel MAIL FROM), Easy DKIM 3 CNAME, DMARC TXT (`_dmarc`, en az `p=none`, hedef `quarantine`), özel MAIL FROM MX/TXT; kontrol `sites/dns.service.ts` ile; ticari gönderim ancak üçü de geçerliyse açılır. Ayrı SES configuration set (pazarlama/işlemsel ayrımı). Isınma planı: günlük gönderim tavanı ayarı (ör. 200 ile başlayıp 2 katına), bounce > %2 veya şikâyet > %0,08 olunca kampanyaları otomatik duraklatma | SES v2 API ile kimlik oluşturmayı otomatikleştirme (AWS kimlik bilgisi yine sunucu rolünden) | AWS SDK varsayılan zinciri (kodda sır yok) | Ortam + `EmailSenderDomain` (sır yok, yalnızca DNS kayıtları) |
| SMS | `ProviderRegistry` (TR Netgsm/İleti Merkezi, diğer Twilio), İYS, STOP/HELP, kredi yalnızca gönderilince düşer | Pano ve onay; B2B hedef kitle için gönderen başlığı (alfanümerik) durumu hub'da | ABD için 10DLC marka/kampanya kaydı durumu (Twilio) | Sağlayıcı API anahtarı | Mevcut ortam/`messagingSettings` |
| WhatsApp | Cloud API, şablon onay durumu, gelen kutusu, 24 saat kuralı | Yapay zeka şablon taslağı -> Meta onayına gönderim talimatı; onay durumu hub'da | Şablonların Graph API ile doğrudan gönderilmesi | Sistem kullanıcısı token'ı | Mevcut |
| Meta reklam (FB/IG) | CAPI + Pixel, harcama/yapı senkronu, test modu | Hub'da durum + "bağlantıyı test et"; UTM/adlandırma `/pazarlama/reklam`'da; **reklam durdurma** (yalnızca harcamayı azaltan işlem, onaysız izinli) opsiyonel | **Lead Ads**: sayfa `leadgen` webhook'u + `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata` izinleri, App Review gerekir; gelen aday -> `Contact` + `lead` dönüşümü (form tüketimi, rıza metni eşlemesi). **Kampanya oluşturma**: M5, onaya bağlı, `PAUSED` durumda oluşturup insan etkinleştirir | M4'te OAuth (Meta Business Login, sistem kullanıcısı token'ı tercih); bugün yapıştırılan token | `AdConnection.encryptedCredentials` |
| Meta organik (Sayfa + Instagram) | Yok | - | M4: `SocialConnection` + `SocialPost`; Sayfa gönderisi (`pages_manage_posts`), Instagram içerik yayınlama (`instagram_content_publish`, hesap başına 24 saatlik kayan pencerede sınırlı yayın, canlı sınır `content_publishing_limit` ucundan okunur); App Review | OAuth | `SocialConnection.encryptedCredentials` |
| Google Ads | Çevrimdışı tıklama + gelişmiş dönüşüm, harcama/yapı senkronu | Hub'da durum; dönüşüm eylemi eşleme kontrolü (her `ConversionEventType` için), "kaydediliyor" durumu uyarısı | M5: bütçe değiştirme ve durum (pause/enable) onaylı; kampanya oluşturma yalnızca ihtiyaç kanıtlanırsa. Geliştirici token erişim düzeyleri (Explorer/Basic/Standard) ve günlük işlem sınırları nedeniyle önce raporlama | OAuth 2.0 (refresh token) + developer token; M4'te panelden OAuth akışı | `AdConnection` |
| TikTok | Events API + harcama | Hub'da durum | Kampanya yönetimi için Marketing API uygulama incelemesi gerekir; ihtiyaç halinde M5 | OAuth (reklamveren yetkilendirmesi) | `AdConnection` |
| LinkedIn | Atıf parametresi (`li_fat_id`), sabit URL'li UTM | Conversions API adaptörü (mimari belgede "ihtiyaçta açılır"); B2B için en değerli ücretli kanal olabilir | M4: şirket sayfası gönderisi Community Management API (geliştirme -> standart katman, ortaklık onayı, `w_organization_social`); reklam raporlama Advertising API | OAuth 3-legged | `AdConnection` (platform `LINKEDIN` eklenir) / `SocialConnection` |
| Zapier / Make / n8n | REST hook (`/v1/public/hooks`), API anahtarı, imzalı teslimat, SSRF koruması | Platform olayları kataloğa eklenir: `studio.signup`, `studio.paid`, `studio.trial_expiring`, `contact.lifecycle_changed`, `campaign.sent` (yalnızca platform kiracısında yayınlanır); hub'da platform kiracısının API anahtarları ve abonelikleri; Make "instant trigger" için aynı REST hook uçları (attach = `POST /v1/public/hooks`, detach = `DELETE`) belgelenir | Gelen yön: "kişi oluştur/güncelle" ve "etiket ekle" herkese açık eylem uçları (`crm.write` kapsamı), idempotency anahtarıyla | API anahtarı (Bearer) | Mevcut `ApiKey` (hash), `WebhookEndpoint.secret` |
| Genel webhook | Personel webhook uçları | Hub'da görünür | Akışta webhook adımı (mimari belgede kalan iş) | HMAC imza | Mevcut |

Kimlik bilgisi girişi faz 1'de mevcut "yapıştır" düzeniyle kalır (en az kod); OAuth akışları M4'te bir `OAuthConnectService` ile (durum parametresi + PKCE, geri dönüş `/platform/integrations/oauth/:provider/callback`, token'lar şifreli, yenileme arka planda) eklenir. Giden HTTP izin listesi (`AD_PLATFORM_ALLOWED_HOSTS`) yeni host'larla genişletilir (`api.linkedin.com`, `graph.instagram.com` gerekiyorsa), başka host'a çıkış yok.

---

## 6. Onay ve güvenlik

### 6.1 Onay akışı

`ApprovalRequest` (bölüm 7) her "dışarı çıkan" eylem için:

| Eylem | Kendi onayıyla (yalnızca `platform.marketing.send` / `.ads.spend`) | Süper admin onayı gerekir |
|---|---|---|
| E-posta kampanyası | Kitle <= `selfApproveEmailMax` (öneri 1.000) **ve** ön kontrol temiz **ve** alan adı doğrulaması tam | Eşik üstü, ilk kez kullanılan segment, yeni bir ülke/bölge, ön kontrol uyarısı olan her gönderim |
| SMS / WhatsApp kampanyası | Kitle <= `selfApproveSmsMax` (öneri 100) ve tahmini kredi <= `selfApproveSmsCredits` | Eşik üstü; ABD alıcısı içeren her SMS |
| Akış etkinleştirme | Yalnızca TRANSACTIONAL adımlı veya günlük tahmini hacmi eşik altı | Ticari mesaj adımı olan her yeni akış |
| Organik sosyal gönderi | Evet (marka kontrolü temizse) | Ayar ile hepsi onaya alınabilir |
| Açılış sayfası yayını | Evet | Fiyat bloğu veya yasal sayfa değişikliği |
| Reklam bütçesi / etkinleştirme | Hiçbir zaman | Her artış ve her etkinleştirme; durdurma ve azaltma onaysız |
| Kişi dışa aktarma | - | Her zaman (izin varsayılan kapalı) |

Kurallar:
- Onaylayan talep edenle aynı kişi olamaz (dört göz). Süper admin kendi talebini onaylayabilir (tek sahip olduğu için), bu `self_approved_by_super_admin` olarak işaretlenir.
- Onay, talep anındaki içeriğin özetine (`contentHash`: şablon sürümü, segment anlık görüntüsü sayısı, zamanlama) bağlıdır; onaydan sonra içerik değişirse onay düşer.
- Onay süresi (öneri 72 saat) dolarsa talep `EXPIRED`.
- Bildirim: süper admine uygulama içi + e-posta (işlemsel), onay/ret sonucu talep edene.
- Kampanya durum makinesine `PENDING_APPROVAL` eklenir (yalnızca platform kiracısında zorunlu; diğer kiracılar için `MarketingSettings` olmadığından davranış değişmez; ileride kiracılara açılabilir).

### 6.2 Tavanlar ve hız sınırları (`MarketingSettings`, süper admin düzenler)

- Günlük/haftalık ticari e-posta tavanı (ısınma planıyla artan), günlük SMS kredi tavanı, aylık reklam harcama tavanı (para birimi başına; senkrondan gelen gerçek harcama tavanı aşarsa panoda kırmızı uyarı ve süper admine bildirim; M5'te otomatik durdurma seçeneği), aylık yapay zeka bütçesi (platform kiracısı limiti).
- Otomatik sigortalar: son 24 saatte bounce > %2 veya şikâyet > %0,08 -> e-posta kampanyaları `PAUSED` ve süper admine uyarı (SES, bounce %5 ve şikâyet %0,1 üstünde hesabı incelemeye alır; Gmail/Yahoo toplu gönderici kuralı spam oranını %0,3 altında ister, hedef %0,1).
- API hız sınırları: yapay zeka uçları kullanıcı başına dakikada 10 (mevcut `AdsRateLimitGuard` deseni), test gönderimi saatte 20, dışa aktarma günde 3.

### 6.3 Denetim ve kimlik

- Her platform pazarlama yazması `AuditLog` (`studioId = platformStudioId`, `userId`); onaylar ayrıca `ApprovalRequest` geçmişi. Süper admin panelinde `/admin/denetim` filtreli görünüm (kullanıcı, eylem, tarih) önerilir (M3).
- 2FA: platform kullanıcıları için zorunlu öneri. Bugün kodda 2FA yok (giriş telefon OTP + PIN/parola). Öneri: M1'de TOTP (uygulama tabanlı) platform kullanıcıları ve süper admin için zorunlu; M3'te passkey/WebAuthn (kimlik avına dayanıklı; NIST SP 800-63B-4 AAL2 bunu bir seçenek olarak sunmayı ister, OTP kimlik avına dayanıklı değildir). Uygulama: `User.totpSecretEncrypted` (`CredentialCipher`), `PlatformPermissionGuard` ve `SuperAdminGuard` oturum JWT'sinde `mfa: true` bayrağı arar; yoksa 403 `MFA_REQUIRED`. SMS OTP ikinci faktör olarak sayılmaz (zaten birinci faktör).
- Oturum: platform kullanıcıları için erişim token'ı mevcut 1 saat; yenileme 30 gün yerine 7 gün (ayar).
- Kişi verisi görünürlüğü: pazarlama yöneticisi platform kiracısının kişilerini (işletme sahipleri, adaylar) görür; bu kişiler için KVKK aydınlatma metninde "pazarlama ekibi" işleme amacı olmalı (bölüm 9). Diğer kiracıların üyelerinin verisini hiçbir şekilde görmez.

### 6.4 Uyum notları (platformun B2B pazarlaması için)

- **TR (KVKK/İYS)**: tacir ve esnafa gönderilen ticari iletiler için önceden onay şartı yoktur ancak ret hakkı kullanılabilir ve adreslerin İYS'ye yüklenmesi gerekir. Öneri: yine de açık onayı varsayılan tutmak (kitle nitelikli olur), İYS kaydını mevcut `tr-consent-registry.adapter.ts` üzerinden yapmak, `ContactConsent`'e `legalBasis` (`CONSENT` | `TR_MERCHANT_EXEMPTION` | `EXISTING_CUSTOMER`) eklemek; muafiyet yalnızca kişi "işletme" olarak işaretliyse ve süper admin ayarı açıksa kullanılır.
- **AB/UK (GDPR + ePrivacy/UWG)**: Almanya'da UWG §7 B2B için de önceden açık rıza ister ve çift onay fiili standarttır. Öneri: platform sitesi formlarında AB/UK ziyaretçisi için **çift onay** (onay e-postası, tıklanınca `ContactConsent` `confirmedAt`, IP saklanmaz, zaman ve form sürümü saklanır); doğrulanmamış AB kişisi ticari kitleye girmez. Mevcut müşteri için "soft opt-in" (benzer ürün, her mesajda çıkış) `legalBasis = EXISTING_CUSTOMER`.
- **ABD (CAN-SPAM, TCPA)**: e-postada fiziksel posta adresi ve çıkış (motor ekliyor; çıkış en geç 10 iş gününde uygulanmalı, bizde anında). SMS'te önceden yazılı açık rıza; çıkış "makul her yolla" ve standart anahtar kelimelerle (`STOP, QUIT, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE, END`) 10 iş günü içinde uygulanmalı; `packages/shared/src/messaging-engine.ts` `REGION_OPT_OUT.US` bunları zaten kapsıyor. Tekli satıcı (one-to-one) rıza kuralı 2025'te iptal edildi, ancak rıza formunda platform adının açıkça yazılması yine önerilir.
- **Gmail/Yahoo toplu gönderici**: SPF + DKIM + DMARC, RFC 8058 tek tık abonelikten çıkma (motor ekliyor), spam oranı %0,3 altı. Bölüm 5.2'deki alan adı ekranı bunun için vardır.

---

## 7. Veri modeli ve migration'lar

Tüm migration'lar yalnızca ileri yönlü; yalnızca yeni tablo/sütun/enum değeri eklenir (önce genişlet). Kiracıya özgü yeni tablolar `studioId` taşır (kural 4) ve pratikte yalnızca platform kiracısı için yazılır; bu, ileride aynı özellikleri kiracılara açmayı şema değişikliği olmadan mümkün kılar.

### 7.1 Platform rolü (M1, migration `platform_access`)

- `platform_role_templates`: `id`, `key` (benzersiz), `name`, `isSystem`, `createdAt`, `updatedAt`.
- `platform_role_template_permissions`: `roleTemplateId`, `permissionKey` (`PLATFORM_PERMISSIONS` anahtarı), birincil anahtar ikisi.
- `platform_memberships`: `id`, `userId` (benzersiz; bir kullanıcının tek platform rolü), `roleTemplateId`, `status` (`INVITED` | `ACTIVE` | `PASSIVE`), `invitedByUserId`, `activatedAt`, `deactivatedAt`, `platformStudioMembershipId` (senkron tutulan `Membership`, nullable), `createdAt`, `updatedAt`. `studioId` yoktur (platform düzeyi).
- `invite_tokens.platform_role_template_id` (nullable).
- `users.totp_secret_encrypted` (nullable), `users.mfa_enabled_at` (nullable).
- Seed/`ensure-platform-defaults`: `marketing_admin` platform rol şablonu.

### 7.2 Entegrasyon ve kanal (M1-M4)

- `email_sender_domains` (M1): `id`, `studioId`, `domain`, `purpose` (`MARKETING` | `TRANSACTIONAL`), `mailFromDomain`, `dkimTokens` (JSON, SES'ten elle girilen veya M5'te API'den), `spfStatus`, `dkimStatus`, `dmarcStatus`, `dmarcPolicy`, `lastCheckedAt`, `lastError`, `warmupStartedAt`, `dailyCap`, `createdAt`, `updatedAt`; benzersiz `(studioId, domain)`.
- `ad_connections.platform` değer listesine `LINKEDIN` (shared sabiti; sütun zaten `VarChar`).
- `social_connections` (M4): `id`, `studioId`, `network` (`META_PAGE` | `INSTAGRAM` | `LINKEDIN_ORG`), `externalId`, `displayName`, `status`, `encryptedCredentials`, `credentialLast4`, `scopes`, `tokenExpiresAt`, `lastError`, zaman damgaları.
- `social_posts` (M4): `id`, `studioId`, `connectionId`, `status` (`DRAFT` | `PENDING_APPROVAL` | `SCHEDULED` | `PUBLISHED` | `FAILED` | `CANCELLED`), `locale`, `text`, `mediaUploadIds` (JSON), `linkUrl` (UTM'li), `scheduledAt`, `publishedAt`, `externalPostId`, `aiDraftId`, `approvalRequestId`, `createdByUserId`.
- `lead_ads_forms` (M4, tasarım): `id`, `studioId`, `connectionId`, `externalFormId`, `fieldMapping` (JSON), `consentTextVersion`, `isActive`. M4c'de bunun yerine `lead_ad_form_mappings` uygulandı (aşağıdaki M4c notları ve `docs/DATABASE_ERD.md`).
- `lead_ad_events`, `lead_ad_form_mappings`, `public_api_idempotency_keys`, `platform_integration_settings` ve `ad_connections.lead_ads_page_id` / `lead_ads_subscribed_at` (M4c, migration `20261027000000_lead_ads_automation`).

### 7.3 Yapay zeka ve içerik (M2)

- `ai_task` enum'una `MARKETING_DRAFT`, `MARKETING_ANALYSIS`, `MARKETING_RESEARCH`.
- `brand_kits`: `id`, `studioId` (benzersiz), `version` (her kayıtta artar; önbellek anahtarı), `positioning`, `voiceRules` (JSON: do/dont), `bannedPhrases` (JSON), `requiredPhrases` (JSON), `localeNotes` (JSON, dil -> not), `icps` (JSON), `ctaLibrary` (JSON), `examples` (JSON), `logoUploadId`, `updatedByUserId`, `updatedAt`.
- `product_facts`: `id`, `studioId`, `key`, `statement` (dil -> metin JSON), `category`, `sourceUrl`, `validUntil`, `isActive`, `updatedByUserId`.
- `marketing_briefs`: `id`, `studioId`, `title`, `goal`, `segmentId` (nullable), `icpKey`, `locales` (JSON), `channels` (JSON), `offer`, `dueAt`, `status`, `createdByUserId`, zaman damgaları.
- `ai_drafts`: `id`, `studioId`, `briefId` (nullable), `kind` (`EMAIL` | `SMS` | `WHATSAPP` | `AD_META` | `AD_GOOGLE_RSA` | `AD_LINKEDIN` | `PAGE_BLOCKS` | `SOCIAL_POST` | `SUBJECT_LINES` | `SEO_OUTLINE`), `locale`, `content` (Zod'lu JSON), `factIds` (JSON), `brandCheck` (JSON), `status` (`DRAFT` | `ACCEPTED` | `DISCARDED`), `aiUsageId`, `createdByUserId`, `createdAt`. Kabul edilen taslak hedef nesneye (şablon, sayfa, gönderi) kopyalanır; taslak değişmez kalır (iz).
- `content_calendar_items`: `id`, `studioId`, `kind` (`CAMPAIGN` | `JOURNEY` | `SOCIAL_POST` | `PAGE` | `AD_FLIGHT` | `NOTE`), `refId` (nullable), `title`, `startsAt`, `endsAt`, `timezone`, `locale`, `briefId`, `ownerUserId`, `status`. Kampanya/gönderi kendi tablosundan okunur; bu tablo yalnızca notlar ve bağlantılar içindir (tekrar veri yok).
- `research_notes`: `id`, `studioId`, `question`, `answer`, `citations` (JSON: url, başlık, alıntı), `aiUsageId`, `createdByUserId`, `createdAt`.

### 7.4 Kampanya, onay, ayarlar ve içgörü (M3)

- `campaign_status` enum'una `PENDING_APPROVAL` ve `PAUSED`.
- `campaigns`: `abTest` (JSON: test payı, ölçüt, bekleme), `sendTimeMode` (`FIXED` | `RECIPIENT_LOCAL` | `BEST_TIME`), `sendTimeLocal` (M3c, "SS:dd"), `approvalRequestId` (nullable), `createdByUserId` (nullable; `membershipId` yanında).
- `campaign_variants`: `id`, `studioId` (M3c: kiracı izolasyonu kuralı gereği eklendi), `campaignId`, `key` (`A`, `B`, ...), `templateKey` veya `templateOverrides` (konu/ön başlık/metin), `aiDraftId`, `isWinner`, `stats` önbelleği.
- `campaign_recipients.variant_key` (nullable).
- `approval_requests`: `id`, `studioId`, `targetType` (`CAMPAIGN` | `JOURNEY` | `SOCIAL_POST` | `PAGE_PUBLISH` | `AD_BUDGET` | `AD_ACTIVATE` | `EXPORT`), `targetId`, `contentHash`, `summary` (JSON: kitle, bölge dağılımı, maliyet tahmini, ön kontrol sonucu), `status` (`PENDING` | `APPROVED` | `REJECTED` | `EXPIRED` | `CANCELLED` | `SELF_APPROVED`), `requestedByUserId`, `decidedByUserId`, `decisionNote`, `expiresAt`, `createdAt`, `decidedAt`.
- `marketing_settings`: `studioId` (birincil), `selfApproveEmailMax`, `selfApproveSmsMax`, `selfApproveSmsCredits`, `requireApprovalForSocial`, `dailyEmailCap`, `dailySmsCreditCap`, `monthlyAdSpendCaps` (JSON: para birimi -> tutar, `Decimal` metin), `aiDailyCapCents`, `bounceAutoPausePct`, `complaintAutoPausePct`, `mqlRule`, `sqlRule` (segment kural JSON'u), `weeklySummaryEnabled`, `weeklySummaryRecipients` (userId listesi), `approvalTtlHours`, `updatedByUserId`, `updatedAt`.
- `marketing_insights`: `id`, `studioId`, `periodStart`, `periodEnd`, `kpis` (JSON), `summary`, `actions` (JSON), `aiUsageId`, `createdAt`.
- `contact_consents`: `legal_basis`, `confirmed_at` (çift onay), `form_version` (nullable sütunlar). M3e'de ek olarak `confirmation_requested_at`, `contacts.is_business`, `contact_consent_confirmations` tablosu ve `marketing_settings.double_opt_in_regions` / `tr_merchant_exemption_enabled` eklendi (M3e notları).

### 7.5 Değişmeden yeniden kullanılanlar

`Studio`, `Contact`/`ContactActivity`/`PipelineStage`/`ContactTask`, `Visitor`/`Touchpoint`/`ConversionEvent`/`ConversionDelivery`, `Segment`/`SegmentMember`, `Journey*`, `MessageTemplate`, `NotificationLog`, `Conversation*`, `AdConnection`/`AdEntity`/`AdSpendDaily`, `Site`/`Page`/`Block`/`PageVersion`, `Funnel`, `AiSettings`/`AiUsage`, `ApiKey`/`WebhookEndpoint`/`WebhookDelivery`, `AuditLog`, `Membership`/`RoleTemplate` (yalnızca `isSystem` kilidi davranışı eklenir).

---

## 8. Uygulama planı

Her madde ayrı PR'dır (CLAUDE.md: backlog öğesi başına bir PR), her PR `pnpm turbo run build typecheck test`, API e2e ve ilgili web e2e ile gelir; i18n tr + en aynı PR'da; belge güncellemesi (`docs/PAZARLAMA_MODULU.md`, gerekirse `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 6 tablosuna "G6" satırı) aynı PR'da.

### M1: Rol, guard, panel kabuğu, entegrasyon merkezi

Durum: uygulandı (M1a-M1d tek dalda, `feat/m1-platform-marketing-role`); uygulama notları ve sapmalar `docs/SUPER_ADMIN.md` "Platform kullanıcıları ve pazarlama paneli" bölümünde.

| PR | Kapsam | Kabul ölçütleri ve testler | Katman | Tahmini efor |
|---|---|---|---|---|
| M1a | Platform izin kataloğu (`packages/shared/src/platform-permissions.ts`, `PLATFORM_TENANT_GRANTS`, testler), migration `platform_access`, `PlatformAccessService`, `PlatformPermissionGuard`, `PlatformScoped()`, `StudioTenantGuard` platform kontrolü, `RoleTemplatesService` sistem şablonu kilidi, `InvitesService` platform kiracısı reddi, `/auth/me` `platformAccess` | Birim: eşleme yalnızca izinli kiracı anahtarlarını üretir, `roles.manage`/`billing.manage` asla; guard: süper admin geçer, PASSIVE platform üyeliği 403, izin eksikse 403, beyan yoksa 403. E2E: pazarlama yöneticisi platform kiracısında `/crm/contacts` 200, başka kiracıda 403, `/admin/tenants` 403, sistem rol şablonu düzenleme 403, pasifleştirmeden sonraki istek 403 | Opus (yetkilendirme/şema) | 3-4 gün |
| M1b | Süper admin "Platform kullanıcıları" (davet, rol, pasifleştir, denetim), TOTP 2FA zorunluluğu (platform kullanıcıları + süper admin) | E2E: telefonla davet -> OTP -> TOTP kurulumu -> ACTIVE; `mfa` olmadan platform uçları 403 `MFA_REQUIRED`; her işlem `AuditLog` | Opus (kimlik) | 3 gün |
| M1c | `/pazarlama` kabuğu, `MARKETING_NAV_ITEMS`, `useAreaHref()` ile mevcut sayfaların yeniden kullanımı (kişiler, segmentler, kampanyalar, akışlar, gelen kutusu, şablonlar, site, reklam, raporlar), `AdminNav`'a "Pazarlama"; UTM oluşturucu `/pazarlama/reklam` altında, `docs/REKLAM_ENTEGRASYONU.md` bölüm 7 düzeltmesi | Web e2e: pazarlama yöneticisi girişinde `/pazarlama/kisiler` platform kişilerini listeler, `/admin` -> `/pazarlama` yönlendirmesi; süper admin aynı sayfaları açar; kiracı paneli bağlantıları değişmemiş (regresyon) | Sonnet | 3 gün |
| M1d | Entegrasyon merkezi: `IntegrationHubService`, `/platform/integrations/*`, `IntegrationHub` bileşeni iki sayfada, `EmailSenderDomain` + DNS kontrolü, platform webhook olayları (`studio.signup`, `studio.paid`, `studio.trial_expiring`, `contact.lifecycle_changed`) | E2E: iki girişten yapılan değişiklik aynı kaydı değiştirir ve `metadata.via` farklı; kimlik bilgisi yanıtta yok; DNS kontrolü sahte çözümleyiciyle SPF/DKIM/DMARC durumlarını doğru hesaplar; doğrulanmamış alan adıyla ticari e-posta kampanyası planlanamaz; yeni olaylar örnek kataloğuyla eşit (`accounting.spec.ts` deseni) | Sonnet | 4 gün |

### M2: Yapay zeka stüdyosu, marka kiti, içerik takvimi

Durum: uygulandı (M2a-M2d tek dalda, `feat/m2-marketing-ai-studio`); uygulama notları ve tasarımdan sapmalar tablonun altında.

| PR | Kapsam | Kabul ölçütleri ve testler | Katman | Efor |
|---|---|---|---|---|
| M2a | Marka kiti + ürün gerçekleri (model, API `platform.brand.manage`, ekran) | E2E CRUD, sürüm artışı, denetim | Sonnet | 2 gün |
| M2b | Yeni AI görevleri, `MarketingAiService` (brief -> çok kanallı taslak, konu/CTA varyantları, SEO taslağı), `redactPii()`, deterministik marka kontrolü, `ai_drafts`, `marketing_briefs`, stüdyo ekranı | Birim: istem oluşturucu kişi verisi içermez (sahte kişilerle test), çıktı Zod doğrulaması, karakter sınırları (RSA 30/90), yer tutucu koruma, yasaklı ifade yakalama. E2E `FakeAiAdapter` ile: taslak kaydı, bütçe aşımında 429, hiçbir mesaj gönderilmez | Sonnet (istem tasarımı incelemesi Opus'a danışılabilir) | 4 gün |
| M2c | İçerik takvimi | E2E: kampanya ve notlar aynı görünümde, yalnızca taslak sürüklenebilir | Sonnet | 2 gün |
| M2d | Segment önerisi (`SegmentInsightService`, k-anonim toplu istatistik) ve araştırma asistanı (web arama, kaynaklı) | Birim: 5'ten küçük hücre bastırılır; model çıktısı kural şemasından geçmezse reddedilir; araştırma kaynaksız iddia döndürmez (sahte adaptör) | Sonnet | 3 gün |

M2 uygulama notları ve sapmalar:

- **Modeller** (migration `20261020000000_marketing_studio`): `BrandKit` + `BrandKitLocale` (dil başına ses, yasaklı ifade ve kanal başına zorunlu ifade; bağlantılar, gönderen kimliği ve hedef kitleler kitte) + `ProductFact`; `MarketingDraft` + `MarketingDraftVariant` (tasarımdaki `ai_drafts` ve `marketing_briefs` yerine: brief taslakta JSON, durum DRAFT/REVIEWED/ARCHIVED); `ContentCalendarItem` (tasarımdaki `kind/refId/startsAt/endsAt` yerine kanal, tarih, durum PLANNED/DRAFTED/APPROVED/SENT/CANCELLED, bağlı taslak ve kampanya, sorumlu, not; kampanyalar takvimde kendi tablosundan salt okunur gelir); araştırma notu ayrı tablo değil `RESEARCH_NOTE` türünde taslak. `ai_task` enum'u üç değer aldı; `ai_settings.marketing_ai_monthly_budget_cents` eklendi.
- **İzinler**: yeni anahtar eklenmedi. Marka kiti okuma `platform.marketing.view`, yazma `platform.brand.manage`; yapay zeka stüdyosu `platform.ai.use`; "Kampanyaya aktar" `platform.ai.use` + `platform.marketing.manage`; takvim okuma `platform.marketing.view`, yazma `platform.marketing.manage` (tasarım takvimi zaten `.manage` altına koyuyordu; ayrı `platform.calendar.manage` gerekmedi). `marketing_admin` şablonu bunların hepsine M1'den beri sahip; süper admin örtük.
- **Bütçe**: `marketingAiMonthlyBudgetCents` (varsayılan 5000, süper admin `/admin/ai`) her `MARKETING_*` çağrıdan önce `AiService.run()` içinde denetlenir; dolunca HTTP **402** `MARKETING_AI_BUDGET_EXCEEDED` (tasarım metni 429 diyordu; genel işletme limiti hâlâ 429 `AI_MONTHLY_LIMIT_REACHED`). Bu görevler platform kiracısının genel işletme limitine ayrıca takılmaz, aksi halde 5 USD varsayılanı 50 USD'lık pazarlama bütçesini anlamsız kılardı.
- **Araştırma**: AI çekirdeğinde web arama/çekme olmadığı için "kaynaklı notlar" modu uygulandı (kullanıcı kaynak yapıştırır, alıntılar sunucuda doğrulanır). Ayrıntı `docs/YAPAY_ZEKA.md`.
- **Segment önerisi**: model yalnızca k-anonim sayıları görür (k = 5); kurallar mevcut segment kural dilinde doğrulanır, boyut 5'ten küçükse gösterilmez; kaydetme kullanıcı işidir (mevcut segment ucu).
- **Uygulanmayanlar** (sonraki fazlar veya açık karar): taslak içindeki her iddia için `factIds` ile "kontrol et" işaretlemesi (bugün yalnızca kullanılan `factKeys` saklanır), fiyatların `plan_prices`'tan okunması (fiyat gerçeği elle girilir), isteğe bağlı model tabanlı marka incelemesi, WhatsApp şablon kategorisinin Meta'ya gönderilmesi, `MarketingSettings.aiDailyCapCents` (görev başına günlük tavan; yalnızca aylık limit var), sayfa motoruna SEO/açılış bloğu aktarımı ("Kampanyaya aktar" yalnızca e-posta, SMS ve WhatsApp içindir), sürükle-bırak dışında takvimde saat dilimi seçimi. A/B kurulumu taslakta saklanır; M3c ile "Kampanyaya aktar" bu kurulumu ve varyantları kampanyanın A/B testine taşır (aşağıdaki M3c notları).
- **Web**: `/pazarlama/marka`, `/pazarlama/yapay-zeka`, `/pazarlama/takvim` (ay ve hafta görünümü, sürükle-bırak yalnızca PLANNED/DRAFTED/APPROVED öğelerde, tarih alanıyla da taşınır). i18n ad alanları `brandKit`, `marketingStudio`, `contentCalendar` (tr + en). Playwright: `apps/web/e2e/marketing-studio.e2e.ts`.

### M3: Pano, haftalık özet, onaylar, kampanya geliştirmeleri, uyum

Durum: M3a uygulandı (`feat/m3a-marketing-dashboard`); M3b-M3e planlandı.
Durum: M3b uygulandı (`feat/m3b-marketing-approvals`); M3a, M3c, M3d, M3e planlandı. M3b uygulama notları ve sapmalar tablonun altında.
Durum: M3e uygulandı (`feat/m3e-consent-double-opt-in`). M3e uygulama notları ve sapmalar M3b notlarının altında.
Durum: M3c uygulandı (`feat/m3c-campaign-ab-send-time`, M3b üzerine kurulu). M3c uygulama notları ve sapmalar M3b notlarının altında.

| PR | Kapsam | Kabul ölçütleri ve testler | Katman | Efor |
|---|---|---|---|---|
| M3a (yapıldı) | Platform KPI panosu, `platform_b2b` hazır hunisi, MQL/SQL adımları (kural ayarı M3b'de) | E2E kurgulanmış senaryoda CAC, CPL, deneme -> ücretli sayıları; para birimleri ayrı; önceki dönem karşılaştırması | Sonnet | 3 gün |
| M3b | Onay akışı (`approval_requests`, `marketing_settings`, kampanya `PENDING_APPROVAL`/`PAUSED`, ön kontrol `canSend` dry-run, dört göz, içerik özeti, süre dolumu, bildirimler) | E2E: eşik altı kendi onayı; eşik üstü süper admin onayı olmadan gönderilmez; onaydan sonra şablon değişince onay düşer; talep eden kendi talebini onaylayamaz; ABD SMS her zaman onay | Opus (yetkilendirme ve gönderim yolu) | 4 gün |
| M3c (yapıldı) | Kampanya A/B testi, alıcı yerel saati ve en iyi saat modu | Birim: varyant dağılımı deterministik ve tekil; kazanan seçimi; histogram yedeklemesi. E2E: test payı gönderimi, bekleme sonrası kalan kitleye kazanan, sessiz saat korunur | Sonnet | 4 gün |
| M3d | Haftalık özet (`marketing_insights`), otomatik sigortalar (bounce/şikâyet duraklatma), günlük tavanlar, denetim görünümü | E2E: kalp atışı pazartesi tek özet üretir (tekil), eşik aşımında kampanya `PAUSED` ve süper admin bildirimi | Sonnet | 3 gün |
| M3e (yapıldı) | Çift onay (AB/UK formları), `legalBasis`, İYS tacir muafiyeti ayarı | E2E: AB kişisi onay tıklamasına kadar ticari kitlede değil; TR işletme kişisi muafiyet kapalıyken kitlede değil | Opus (hukuki etkili gönderim kuralı) | 3 gün |

M3a uygulama notları ve sapmalar:

- **Uç**: `GET /platform/marketing/dashboard?from&to&compare=previous`, `PlatformScoped` + `platform.marketing.view` (süper admin örtük). `from` ve `to` birlikte verilir (ISO tarih-saat, en fazla 366 gün); ikisi de yoksa son 30 gün. Yanıt yalnızca toplu sayılardır; kişi, telefon, e-posta veya mesaj metni dönmez. Şemalar `packages/shared/src/marketing/dashboard.ts` (`DashboardQuerySchema`, `MarketingDashboardSchema`); oran, delta ve uyarı eşiği matematiği aynı dosyada saf fonksiyonlardır (birim test: `dashboard.spec.ts`). Kod: `apps/api/src/modules/platform-marketing/dashboard/`.
- **Yanıt**: `current` bloğu (`funnel`, `acquisition`, `trial`, `channels`), `previous` ve `deltas` (yalnızca `compare=previous`; önceki dönem aynı uzunlukta, `previousPeriodWindow` ile; delta alan figürler: huni adımları, aday, ücretli işletme, harcama, değer, CAC, CPL, ROI para birimi başına, deneme sayıları ve oranı), `mrr` (yalnızca `platform.referrals.view` veya süper admin; başkasında anahtar hiç yoktur) ve `health`. Tutarlar `{ amount, currency }` dizileridir, para birimleri asla toplanmaz.
- **Huni**: hazır huni `ready.platform_b2b` (`docs/HUNILER.md`), mevcut huni sorgu motoruyla (`FunnelsService.reportForStudio`, `studioId` platform kiracısı). Adımlar `visit`, `lead`, `stage:MQL`, `stage:SQL`, `studio_signup`, `studio_paid`. MQL ve SQL veridir: huni tanımı satış hattı aşama anahtarlarına (`stage:<anahtar>`) bakar ve platform kiracısı bu iki aşamayı `ensurePlatformTenant` ile alır (migration yok; `pnpm db:seed` ve üretim `bootstrap` komutu idempotent ekler). `MarketingSettings.mqlRule/sqlRule` kural dili bu PR'da yoktur; M3b'de ayar modeliyle birlikte gelirse adım tanımı kuraldan türetilebilir. Huni katıdır (sıralı): MQL ve SQL aşamalarından geçmeden kaydolan ve ödeyen bir işletme huninin `studio_paid` adımında sayılmaz; CAC ve ücretli sayısı bu yüzden huniden değil dönüşüm olaylarından (`studio_paid` sayısı) hesaplanır.
- **CAC / CPL / ROI**: harcama `AdSpendDaily` kampanya düzeyi satırlarının para birimi başına toplamıdır (reklam seti ve reklam satırları kampanya harcamasını tekrar saymamak için hariç, atıf raporuyla aynı kural). Ücretli işletme ve aday sayıları mevcut atıf raporundan (`LAST_TOUCH`, `groupBy=source|campaign`) gelir; `CAC = harcama / studio_paid sayısı`, `CPL = harcama / aday`, `ROI = studio_paid değeri / harcama` (aynı para biriminde; harcaması olmayan para birimi için ROI yok). Sıfıra bölme durumunda değer yoktur (boş liste veya `null`). Kanal tablosu kaynağa ve kampanyaya göre ücretli sayısı, harcama, değer ve ROI verir; harcaması olup ücretlisi olmayan kampanya ROI 0 ile görünür; kampanya adı `AdEntity`'den gelir. Platform kiracısında değer taşıyan tek dönüşüm `studio_paid` olduğu için atıf raporundaki gelir ücretli değeri sayılır.
- **Deneme -> ücretli**: dönemde `trialStartedAt` olan işletmeler (platform kiracısı hariç); `activatedAt` dolu olanlar ücretli sayılır, medyan süre `activatedAt - trialStartedAt`. Etkinleştirme akışı (`PlatformBillingService`) `billingStatus` geçişini, `activatedAt` alanını ve `studio_paid` olayını birlikte yazar; ayrı bir geçiş günlüğü tablosu yoktur.
- **MRR etkisi**: `activeMrr` (etkinleştirilmiş, `ACTIVE` işletmelerin güncel planının liste fiyatı, işletmenin faturalama para biriminde) ve `newMrr` (dönemde ücretli olanlar); planın o para biriminde fiyatı yoksa işletme `unpricedStudios` sayılır ve toplamlara girmez. İndirim, kredi ve ücretsiz ay dikkate alınmaz (liste fiyatı; açık karar bölüm 9).
- **Kanal sağlığı**: e-posta bounce ve şikâyet oranı son 7 ve 30 gün (seçilen dönemin bitişinden geriye), payda sağlayıcının kabul ettiği e-postalardır (SENT, DELIVERED, BOUNCED, COMPLAINED; FAILED ve PENDING sayılmaz); uyarı bounce > %2 ve şikâyet > %0,08 (eşikler `EMAIL_BOUNCE_WARNING_RATE`, `EMAIL_COMPLAINT_WARNING_RATE`; sınırın kendisi uyarı değildir). SMS teslim oranı = teslim edilen / PENDING olmayan denemeler. Yapay zeka bütçesi bu ayın pazarlama harcaması / `marketingAiMonthlyBudgetCents` (%80'den uyarı, dolunca aşıldı, bütçe 0 ise kapalı). Bekleyen onaylar: onay modeli M3b'de geldiği için `{ available: false, pending: 0 }` döner (ekranda "henüz etkin değil"). Bağlantı hataları: `lastError` dolu `AdConnection` sayısı ve listesi (metin, kişi bilgisi ve belirteç benzeri değerler maskelenip 200 karaktere kesilerek verilir, `sanitizeConnectionError`) ve dönemde oluşan `FAILED` dönüşüm gönderimi sayısı.
- **Web**: `/pazarlama` (`apps/web/src/components/marketing/dashboard/MarketingDashboard.tsx`): dönem seçici (7/30/90 gün ve özel aralık, UTC gün sınırları), önceki dönemle karşılaştırma anahtarı, huni, edinme maliyeti ve getiri (para birimi başına), deneme -> ücretli, MRR (izne bağlı), kanal ve kampanya tablosu, kanal sağlığı (uyarılar renkle birlikte metindir, yapay zeka bütçe çubuğu düz renk). Bölümler düz yüzeylerdir (kartın içinde kart yok, gradyan yok). i18n ad alanı `marketingDashboard` (tr + en), huni adımı adları `funnels.step.stage.MQL/SQL`. Yer tutucu `marketing.placeholder.dashboard.*` anahtarları kaldırıldı.
- **Testler**: birim `packages/shared/src/marketing/dashboard.spec.ts` ve `funnels.spec.ts`; API e2e `apps/api/test/e2e/marketing-dashboard.e2e-spec.ts` (sabit tarihli senaryo: mart 2025, önceki dönem 29 ocak - 28 şubat 2025; iki para biriminde harcama ve ücretli işletme, test kişisi, reklam seti satırı, bounce ve şikâyet, deneme kohortu, MRR izni, 401/403/400, kişi verisi yok, `compare=previous` deltaları); Playwright `apps/web/e2e/marketing-dashboard.e2e.ts` (yalnızca tip denetimi yapıldı, tarayıcı yerelde yok).
- **Şema**: değişmedi (migration yok); `docs/DATABASE_ERD.md` güncellenmedi.
- **Uygulanmayanlar**: `MarketingSettings.mqlRule/sqlRule` (M3b), bekleyen onay sayısı (M3b), otomatik duraklatma (M3d), haftalık özet (M3d), kanal tablosu için önceki dönem deltası (yalnızca üst düzey figürler karşılaştırılır).
M3b uygulama notları ve sapmalar:

- **Model** (migration `20261022000000_marketing_approvals`, yalnızca ekleme): `campaign_status` enum'una `PENDING_APPROVAL` ve `PAUSED`; `campaigns.approval_request_id` ve `campaigns.created_by_user_id`; `approval_requests` ve `marketing_settings` bölüm 7.4'teki alanlarla (ayrıntı `docs/DATABASE_ERD.md`). `approval_requests.target_id` ve `campaigns.approval_request_id` düz kimliktir (FK yok, M2'deki `exportedCampaignId` gibi). `marketing_insights` (M3d) ve `contact_consents` değişiklikleri (M3e) bu PR'da yok. Paylaşılan tipler `packages/shared/src/marketing/approvals.ts` ve `settings.ts`.
- **Yalnızca platform kiracısı**: kurallar `studios.is_platform` olan kiracıda uygulanır. Diğer kiracılarda `POST /studios/:id/campaigns/:id/schedule` eskisi gibi doğrudan planlar, onay satırı oluşmaz (E2E ile doğrulandı).
- **Kampanya durum makinesi** (platform kiracısı):
  - `DRAFT` -> `request-approval` -> kendi onayıyla `SCHEDULED` ya da `PENDING_APPROVAL`.
  - `PENDING_APPROVAL` -> onay -> `SCHEDULED` (başlamış bir kampanyada `SENDING`); ret, geri çekme veya süre dolumu -> `DRAFT`.
  - `SCHEDULED` / `SENDING` -> `pause` -> `PAUSED` -> `resume` -> `SCHEDULED` / `SENDING`. Duraklatılmış kampanya hiçbir koşulda göndermez; gönderim sırasında iki parti arasında durum yeniden okunur.
  - Onaydan sonra içerik değişirse (düzenleme, şablon değişikliği, segment sayısı değişimi) kampanya `PENDING_APPROVAL`'a döner; eski talep `CANCELLED` olur ve özetine `invalidated: { reason: 'CONTENT_CHANGED', replacedByRequestId }` yazılır, yerine yeni `PENDING` talep açılır. Aynı kampanya için yeniden onay istenirse eski talep `RESUBMITTED` nedeniyle kapanır.
  - Platform kiracısında kiracı `schedule` ucu her zaman 409 `CAMPAIGN_APPROVAL_REQUIRED` döner; gönderimi yalnızca onay (veya kendi onayı) planlar.
- **Gönderim yolu**: `CampaignsService.processCampaign` alıcı anlık görüntüsünü almadan önce `CampaignApprovalService.verifyForSend()` çağırır: kampanya `APPROVED`/`SELF_APPROVED` bir talebe bağlı olmalı ve `contentHash` tutmalı. Talep yoksa (ör. M3b öncesi planlanmış platform kampanyası) kampanya `DRAFT`'a döner ve `marketing.approval.missing` denetim kaydı yazılır.
- **`contentHash`**: şablon sürümleri (anahtara ait etkin kiracı ve global şablon satırlarının gövde, konu, e-posta blokları, WhatsApp adı ve onay durumu), segment kimliği ve anlık üye sayısı, istenen zamanlama, kanal (boşsa işletmenin kanal sırası) ve şablon anahtarının kanonik JSON'unun SHA-256 özeti (`apps/api/src/modules/growth/campaigns/approval/content-hash.ts`). Yerleşik (kodla gelen) şablon metinleri yalnızca sürümle değiştiğinden özete girmez. Dinamik segmentin üye sayısı onay ile gönderim arasında değişirse onay düşer (bilinçli olarak katı).
- **Ön kontrol** (`CampaignPrecheckService`, gerçek gönderim yolu değişmeden kuru çalıştırma): kitle, ülke ve uyum bölgesi dağılımı, motorun kanal sırasıyla ulaşılabilir kişi ve kanal başına beklenen mesaj, SMS kredisi tahmini (kabul edilen her SMS bir kredi), bulgular. Uyarı (kendi onayını engeller): boş segment, gönderilebilir kişi yok, şablon yok, WhatsApp şablonu onaysız, ticari e-posta için işletme adresi yok, doğrulanmış pazarlama e-posta alan adı yok (SPF, DKIM, DMARC hepsi `VALID`), SMS kredisi yetersiz, SMS kitlesinde ABD alıcısı. Bilgi: izinsiz, abonelikten çıkmış/bastırılmış, adressiz, sessiz saate denk gelen ve sıklık sınırına takılan kişi sayıları.
- **Kendi onayı matrisi** (`decideSelfApproval`, paylaşılan saf fonksiyon, birim testli): e-posta kitlesi <= `selfApproveEmailMax` ve alan adı doğrulanmış; SMS/WhatsApp kitlesi <= `selfApproveSmsMax` ve tahmini kredi <= `selfApproveSmsCredits`; bunlara ek olarak her zaman süper admin gerektirenler: segment ilk kez (daha önce onaylanmış/kendi onaylı bir talepte yok), kitlede daha önce onaylanan taleplerde görülmemiş bir ülke, ön kontrolde herhangi bir uyarı, ABD alıcısı içeren SMS, PUSH/IN_APP kanalı. Nedenler özet içinde saklanır ve onay ekranında gösterilir.
- **Dört göz**: onay ve ret yalnızca süper admindedir (`SuperAdminGuard` platform guard'ından sonra). Onaylayan talep eden olamaz; süper admin kendi talebini onaylarsa `SELF_APPROVED` ve `summary.selfApprovedBySuperAdmin = true` yazılır. Geri çekme talep edene veya süper admine açıktır. Onay anında içerik yeniden özetlenir; değiştiyse 409 `APPROVAL_CONTENT_CHANGED` ve yeni talep.
- **Süre dolumu**: `expiresAt = createdAt + approvalTtlHours` (varsayılan 72). 15 dakikalık kalp atışı (`GrowthHeartbeatService`, kampanya gönderiminden önce) süresi dolan `PENDING` talepleri `EXPIRED` yapar ve kampanyayı `DRAFT`'a döndürür; süresi dolmuş talebe karar 409 döner.
- **Bildirimler**: mesajlaşma motoru üzerinden işlemsel e-posta + uygulama içi (`IN_APP`, platform kiracısında `notification_logs`): yeni veya yeniden açılan talepte talep eden dışındaki süper adminlere `MARKETING_APPROVAL_REQUESTED`, karar talep edene `MARKETING_APPROVAL_APPROVED` / `MARKETING_APPROVAL_REJECTED`. Metinler `msgTpl` ad alanında tr + en; onay nedenleri alıcının dilinde çevrilir. Bağlantı `PUBLIC_APP_URL/pazarlama/onaylar?id=<talep>`.
- **Denetim**: her karar ve durum değişikliği platform kiracısında `AuditLog`: `marketing.approval.requested`, `.self_approved`, `.approved`, `.self_approved_by_super_admin`, `.rejected`, `.cancelled`, `.invalidated`, `.expired`, `.missing`; `marketing.campaign.paused`, `.resumed`; ayarlar `marketing.settings.updated`.
- **Uçlar**:

  | Uç | Yetki |
  |---|---|
  | `GET /platform/marketing/approvals?status=&targetId=&limit=` | `platform.marketing.view` |
  | `GET /platform/marketing/approvals/:id` | `platform.marketing.view` |
  | `POST /platform/marketing/approvals/:id/approve` (`{ note? }`) | `platform.marketing.approve` + süper admin |
  | `POST /platform/marketing/approvals/:id/reject` (`{ note }` zorunlu) | `platform.marketing.approve` + süper admin |
  | `POST /platform/marketing/approvals/:id/cancel` (`{ note? }`) | `platform.marketing.send`; talep eden veya süper admin |
  | `POST /platform/marketing/campaigns/:id/request-approval` (`{ scheduledAt? }`) | `platform.marketing.send` |
  | `POST /platform/marketing/campaigns/:id/pause`, `/resume` | `platform.marketing.send` |
  | `GET` / `PATCH /admin/marketing/settings` | `SuperAdminOnly()` |

  Kararlı hata kodları (`MARKETING_APPROVAL_ERROR_CODES`, web BFF çevirir): `CAMPAIGN_APPROVAL_REQUIRED`, `CAMPAIGN_NOT_REQUESTABLE`, `CAMPAIGN_NOT_PAUSABLE`, `CAMPAIGN_NOT_RESUMABLE`, `APPROVAL_NOT_PENDING`, `APPROVAL_EXPIRED`, `APPROVAL_FOUR_EYES`, `APPROVAL_CONTENT_CHANGED`, `APPROVAL_CANCEL_FORBIDDEN`.
- **Web**: `/pazarlama/onaylar` (durum filtresi, bekleyen sayısı, ayrıntı çekmecesi: kitle, bölge ve ülke dağılımı, maliyet, bulgular, nedenler; onay/ret yalnızca süper admine, geri çekme talep edene), kampanya ekranında pazarlama panelinde "Onaya gönder" (doğrudan "Şimdi gönder" yerine), `Onay bekliyor` / `Duraklatıldı` rozetleri, duraklat/sürdür, bekleyen talepte gönderim düğmesi devre dışı. Süper admin `/admin/pazarlama-ayarlari`. i18n ad alanları `marketingApprovals`, `adminMarketingSettings` (tr + en). Playwright `apps/web/e2e/marketing-approvals.e2e.ts` (yerelde yalnızca tip denetimi).
- **Tasarımdan sapmalar ve açık noktalar**:
  - `platform.marketing.approve` izni katalogda duruyor, ancak M3b'de onay/ret ayrıca `SuperAdminGuard` ister (tasarımdaki "varsayılan: yalnızca süper admin" katı uygulandı). Bu izni süper admin olmayan bir role vermek bugün onay yetkisi açmaz; açılması istenirse guard kaldırılıp dört göz kuralı (zaten serviste) yeterli olur.
  - Menüdeki "Onaylar" öğesi ve sayfa `platform.marketing.view` ile de açılır (liste ucu bu izni ister); tasarım tablosu `.send` veya `.approve` diyordu.
  - Maliyet tahmini para birimi başına boş döner: bugün para birimiyle fiyatlanan bir kanal yok (`sms_packages.price` para birimi taşımıyor), SMS maliyeti kredi olarak gösterilir. Kanal fiyatları para birimiyle tutulunca `cost.byCurrency` doldurulacak.
  - "Yeni bölge" ülke düzeyinde değerlendirilir (bilinmeyen ülke sayılmaz); "ilk kez kullanılan segment" daha önce onaylanmış veya kendi onaylı bir talebin segmenti olmamasıdır.
  - Talep süresi dolduğunda talep edene bildirim gönderilmez (yalnızca denetim kaydı).
  - Otomatik bounce/şikâyet duraklatması, günlük tavanların uygulanması ve haftalık özet M3d'dedir; bu PR yalnızca ayarları saklar ve `pause`/`resume` uçlarını sağlar.

M3e uygulama notları ve sapmalar:

- **Model** (migration `20261024000000_consent_legal_basis`, yalnızca ekleme): `ConsentLegalBasis` enum'u (`CONSENT`, `TR_MERCHANT_EXEMPTION`, `EXISTING_CUSTOMER`); `contact_consents.legal_basis`, `confirmed_at`, `confirmation_requested_at`, `form_version` (boş olabilir; mevcut satırlar `CONSENT` ve onaylanmış sayılır); `contacts.is_business` (varsayılan `false`; kodda şirket/kişi türü bayrağı yoktu); `contact_consent_confirmations` (`token_hash`, `contact_consent_id`, `expires_at`, `confirmed_at`, `studio_id`, `created_at`); `marketing_settings.double_opt_in_regions` (JSON, varsayılan `["EU", "UK"]`) ve `tr_merchant_exemption_enabled` (varsayılan `false`). Ayrıntı `docs/DATABASE_ERD.md`.
- **Kurallar tek yerde** (`packages/shared/src/marketing/consent.ts`, saf ve birim testli): `evaluateCommercialEligibility` bölge x kanal x dayanak x onay x çıkış matrisine karar verir; `REGION_CONSENT_RULES` bölge başına veridir (soft opt-in kanalları: AB/UK e-posta, SMS ve WhatsApp; ABD yalnızca e-posta, çünkü SMS için TCPA önceden yazılı onay ister; TR, Kanada ve diğerleri yok. Tacir muafiyeti yalnızca TR bölgesinde ve ayar açıkken). Gönderim yolunda hiçbir ülke kodu yazılmaz. AB/EEA ülke listesi `EU_EEA_COUNTRIES` olarak bölge tablosunun yanında veridir. Sıra: çıkış (bastırma) her zaman kazanır, sonra açık geri alma; politika yoksa (ayarı olmayan kiracı) M3e öncesi davranış; kayıtlı izinde dayanağına göre; kayıt yoksa işletme için muafiyet, mevcut müşteri için soft opt-in.
- **Kim uygular**: `ContactConsentService.commercialFacts` / `batch` gerçekleri toplar (kişinin izin satırı ve üyenin kendi izni, işletme bayrağı, mevcut müşteri: kiracıda `ACTIVE` üyelik veya platform kiracısında faturalama durumu `ACTIVE` olan bir işletmenin sahibiyle aynı telefon ya da e-posta), `ComplianceService.canSend` kuralı uygular. Mesajlaşma motoru her ticari denemede ve M3b ön kontrolü her alıcıda aynı yolu kullanır; kampanya alıcıları gerçek gönderimde `DOUBLE_OPT_IN_PENDING`, `NO_LEGAL_BASIS`, `TR_EXEMPTION_DISABLED` neden koduyla `SKIPPED` olur. Segment kuralı `consent.commercialAllowed` onay bekleyen form iznini saymaz.
- **Politika**: kiracının `marketing_settings` satırı; platform kiracısında satır yoksa varsayılanlar (AB ve UK çift onay, muafiyet kapalı). Diğer kiracılarda satır olmadığından politika yoktur ve davranış değişmez (E2E ile doğrulandı); bir kiracıya satır yazılırsa aynı kurallar onun için de çalışır.
- **Çift onay**: sayfa motorunun `lead_form` bloğu `config.marketingConsent: true` ile ayrı, isteğe bağlı ve işaretsiz başlayan bir pazarlama izni kutusu gösterir (metin `text.<dil>.marketingConsentText`, yoksa `sites.leadForm.marketingConsent`); platform sitesinin varsayılan sayfasında açık (yalnızca yeni kurulumlarda; mevcut sayfada düzenleyiciden açılır). Form sürümü `leadFormConsentVersion(dil, metin)`: dil ve metnin FNV-1a özeti (`lf-tr-1a2b3c4d`), metin değişince kendiliğinden değişir. `POST /public/studios/:slug/leads` gövdesine `marketingConsent`, `formVersion`, `locale` eklendi. İzin e-posta (adres varsa) ve SMS kanalına `CONSENT` olarak yazılır. Bölge: kişinin ülkesi, yoksa isteğin kenar başlığındaki ülke (`CF-IPCountry` / `X-Country-Code`, temas noktası kaydıyla aynı), yoksa telefonun ülkesi; hiçbiri yoksa bölge `DEFAULT` (listeye `DEFAULT` eklenerek çift onay istenebilir). Bölge listedeyse satır `confirmation_requested_at` ile bekler ve işlemsel `CONSENT_CONFIRMATION` e-postası (tr + en; platform adı, form sürümü, 7 gün) gider. Bağlantı `PUBLIC_APP_URL/onay/<belirteç>`: 32 rastgele bayt (base64url), veritabanında yalnızca SHA-256 özeti; 7 gün geçerli ve tek kullanımlık (eşzamanlı çift tıklama da tek onay). Sayfa açılınca onaylamaz, düğmeye basılınca `POST /public/consent/confirm/:token` çağrılır (e-posta tarayıcılarının bağlantıyı önceden açması onay sayılmaz). Yanıt nötrdür: `CONFIRMED` veya `INVALID` (bilinmeyen, süresi dolmuş, kullanılmış). Onayda kişinin bekleyen tüm izin satırlarına `confirmed_at` yazılır (tek e-posta aynı formdaki SMS iznini de onaylar); IP, cihaz ve kullanıcı ajanı saklanmaz (model saklamıyordu). Bekleyen izin İYS'ye gönderilmez; onaydan sonra gönderilir. Bağlantı mesaj günlüğüne yazılmaz (`sensitive`).
- **Yeniden gönderim**: `POST /platform/marketing/contacts/:id/resend-confirmation` (`platform.marketing.manage`): bekleyen izin yoksa 409 `CONSENT_CONFIRMATION_NOT_PENDING`, e-posta yoksa 409 `CONSENT_CONFIRMATION_NO_EMAIL`, kişi başına son 24 saatte 3 e-posta (ilk gönderim dahil) dolmuşsa 429 `CONSENT_CONFIRMATION_RATE_LIMITED`; her gönderim `marketing.consent.confirmation_resent` denetim kaydı. Eski bağlantılar süreleri dolana kadar geçerli kalır. Herkese açık onay ucu IP başına dakikada 20 istekle sınırlı (Redis, yoksa bellek içi; aday formu korumasıyla aynı desen).
- **TR tacir muafiyeti**: süper admin anahtarı kapalıdan açığa getirince platform kiracısındaki `is_business` kişilere, kararı olmayan her adresli kanal için `TR_MERCHANT_EXEMPTION` izni yazılır ve mevcut İYS adaptörüyle (`IysClient.syncConsent`, yeni `recipientType: 'MERCHANT'`; gerçek istemcide `TACIR`) kaydedilir; `marketing.consent.merchant_exemption_applied` denetim kaydı. Sonradan işletme olarak işaretlenen kişi için satır ilk ticari gönderimden hemen önce yazılır ve kaydedilir. Anahtar kapanınca bu satırlar `TR_EXEMPTION_DISABLED` ile sayılmaz. Mevcut bir karar (geri alma dahil) asla ezilmez; çıkış her zaman geçerlidir.
- **Denetim izi**: her izin durum değişikliği (personel, form, onay bekliyor, onay e-postası istendi, onaylandı, muafiyet, abonelikten çıkma/STOP) kişinin etkinlik geçmişine `CONSENT` türüyle (kanal, durum, dayanak, form sürümü) yazılır; ayar değişikliği, yeniden gönderim ve toplu muafiyet yazımı ayrıca `AuditLog`.
- **Ön kontrol**: bulgulara bilgi düzeyinde `DOUBLE_OPT_IN_PENDING`, `NO_LEGAL_BASIS`, `TR_EXEMPTION_DISABLED` sayıları; özete gönderilebilir alıcıların dayanak dağılımı `legalBases` (yalnızca toplu sayılar). Onay ekranı dayanak dağılımını gösterir.
- **Web**: `/admin/pazarlama-ayarlari`'na "Ticari ileti izni" bölümü (çift onay bölge/ülke listesi düzenleyicisi, tacir muafiyeti anahtarı ve açıklaması); kişi kartında izin dayanağı, "Çift onay bekleniyor" rozeti, onay zamanı ve form sürümü, işletme işareti; pazarlama panelinde onay e-postasını yeniden gönder düğmesi; herkese açık `/onay/[token]` sayfası (tema belirteçleri, dil seçici). i18n: yeni `consentConfirm` ad alanı, `adminMarketingSettings.consent.*`, `crm.card.consent.*`, `crm.card.business*`, `crm.activity.CONSENT`, `campaigns.reason.*`, `marketingApprovals.finding.*`, `marketingApprovals.detail.legalBases`, `msgTpl.CONSENT_CONFIRMATION.*`, `sites.leadForm.marketingConsent` (tr + en).
- **Testler**: birim `packages/shared/src/marketing/consent.spec.ts` (uygunluk matrisi, bölge listesi, form sürümü, neden kodları ve çeviriler), `apps/api/src/modules/notifications/consent/consent-confirmation.tokens.spec.ts` (belirteç özeti, süre, sınır), `compliance.service.spec.ts` (M3e yolu); API e2e `apps/api/test/e2e/consent-double-opt-in.e2e-spec.ts`. Web için Playwright testi eklenmedi.
- **Tasarımdan sapmalar ve açık noktalar**:
  - `contact_consents.confirmation_requested_at` tasarımda yoktu: "çift onay bekliyor" durumu bununla açıkça tutulur; böylece M3e öncesi satırlar ve personelin kanıtlı girişi onay beklemez. Bölge listesi yakalama anında uygulanır (liste sonradan değişirse eski satırlar yeniden sınıflanmaz).
  - Personelin kanıt notuyla kaydettiği izin açık onay sayılır ve çift onay beklemez (form dışı kanıt).
  - Soft opt-in kanal bazındadır (ABD'de yalnızca e-posta); tasarım bölge düzeyinde "ABD evet" diyordu.
  - Mevcut müşteri için satır yazılmaz, dayanak gönderim anında türetilir (kayıt siciline bildirilecek bir şey yok); müşteri olmaktan çıkınca yeniden açık izin gerekir.
  - Yalnızca telefonla doldurulan bir AB formunda (e-posta yok) SMS izni onay bekler ama onay e-postası gidemez; kişiye e-posta eklenince yeniden gönderim yapılabilir. SMS ile onay seçeneği yok.
  - Abonelikten çıkmış bir adres formu yeniden doldurursa bastırma kaydı kalır (çıkış kazanır); bastırmayı kaldırmak mevcut davranıştaki gibi ayrı bir işlemdir.
  - Ön kontrol kişi başına ilk ulaşılabilir kanalın dayanağını sayar; kişi, telefon veya e-posta dönmez.
M3c uygulama notları ve sapmalar:

- **Model** (migration `20261023000000_campaign_variants`, yalnızca ekleme): `campaigns.ab_test` (JSON, boş olabilir), `campaigns.send_time_mode` (`CampaignSendTimeMode`: FIXED varsayılan, RECIPIENT_LOCAL, BEST_TIME), `campaigns.send_time_local` (`VARCHAR(5)`, boş olabilir), `campaign_recipients.variant_key` (boş olabilir) ve `campaign_variants` tablosu (`studio_id` eklendi; `(campaign_id, key)` benzersiz; `ai_draft_id` yalnızca köken, düz kimlik). Mevcut satırlar değişmez. Paylaşılan kod `packages/shared/src/growth/campaign-ab.ts` (şemalar, atama, kazanan seçimi) ve `send-time.ts` (saat dilimi çözümü, gönderim penceresi, histogram, planlayıcı), ikisi de saf ve birim testli.
- **Herkes için**: A/B testi ve gönderim saati modları kampanya özelliğidir; her kiracıda çalışır. Onay kapısı (M3b) yalnızca platform kiracısında kalır ve değişmedi; diğer kiracılarda `schedule` doğrudan planlar ve onay satırı oluşmaz (E2E ile doğrulandı).
- **A/B kurulumu** (`abTest`): `testShare` (yüzde, 5-50), `metric` (`OPEN_RATE` | `CLICK_RATE` | `CONVERSION`), `waitMinutes` (1-10080). Varyant 2-5 adet (`A`-`E`): her biri kampanyanın şablonunu kullanır ya da ayrı bir `templateKey` ile ve e-posta için konu/ön başlık/metin, SMS için metin geçersiz kılmasıyla (`overrides`; yalnızca `{firstName}` ve `{studioName}`) farklılaşır. WhatsApp onaylı şablonu asla yeniden yazılmaz: geçersiz kılmalar WhatsApp'ta yok sayılır ve WhatsApp kanalında geçersiz kılma tek başına 400'dür (varyant ayrı şablon kullanmalı). Kurulum yalnızca gönderim başlamadan düzenlenir (mevcut `PATCH` kuralı); `abTest: null` varyantları da siler.
- **Atama**: alıcılar `hash(kampanyaId:kişiId)` ile sıralanır (`stableHash`, `Math.random` yok; eşitlikte kişi kimliği), ilk `max(yuvarlak(kitle x pay), varyant sayısı)` kişi teste girer ve varyantları sırayla alır (bölüm en fazla bir kişi farkla eşit), kalanı bekletilir. Her kişi tam bir kez atanır; aynı kampanya ve kitle her seferinde aynı atamayı verir. Bekletilenler `variant_key = null`, `PENDING`, `next_attempt_at = null` olarak yazılır ve kazanan seçilene kadar gönderim sorgusu (`variant_key is not null`) onları görmez.
- **Kazanan**: son test mesajının `sent_at` zamanı + `waitMinutes` dolduğunda (test alıcılarından hâlâ bekleyen yokken) 15 dakikalık kalp atışı, ya da gönderim sırasında kuyruk işi, oranı en yüksek varyantı seçer (oran = ölçüt sayısı / gönderilen, kesir olarak tam karşılaştırılır; eşitlikte ilk varyant). `is_winner` ve önbellek `stats` (`sent`, `opened`, `clicked`, `converted`) yazılır, `campaign.ab.winner` denetim kaydı düşer ve bekletilenler kazanan varyantla bırakılır (`variant_key` atanır, gönderim saati moduna göre `next_attempt_at` yazılır). Kampanya kazanan seçilene kadar `SENDING` kalır. Koşullu güncelleme sayesinde iki işçi ya da elle seçim yarışsa bile tek kazanan vardır.
- **Elle seçim**: `POST /studios/:studioId/campaigns/:campaignId/pick-winner` (`campaigns.manage`; gövde `{ variantKey? }`, verilmezse ölçüt karar verir). Yalnızca `SENDING` ve kazananı henüz olmayan kampanyada; aksi 409, bilinmeyen varyant 400. Denetim kaydında `manual: true`.
- **Ölçüm**: varyant başına gönderilen, açılan (`notification_logs.opened_at`), tıklanan (`clicked_at`) ve dönüşen (kampanya istatistiğiyle aynı atıf penceresi ve olay türleri) `campaign_recipients.variant_key` üzerinden hesaplanır. Makine açılmaları (Apple Mail Gizlilik Koruması) `opened_at`'e yazılmadığı için sayılmaz; yine de açılma ölçütü gizlilik korumalı istemcilerde eksik ölçer, arayüz tıklamayı önerir.
- **Gönderim saati**: `FIXED` bugünkü davranıştır. `RECIPIENT_LOCAL`: her alıcı `sendTimeLocal` saatinde kendi saat diliminde planlanır. Saat dilimi sırası: kişinin `timezone` alanı, kişinin (yoksa telefonunun) ülkesinin varsayılan dilimi (`COUNTRY_DEFAULT_TIMEZONES`, çok dilimli ülkelerde temsilî dilim: ABD `America/Chicago`, Kanada `America/Toronto`, Brezilya `America/Sao_Paulo`, Avustralya `Australia/Sydney`), işletmenin dilimi, UTC. Planlanan an "başlangıç anından itibaren ilk yerel SS:dd"dir; başlangıç anının kendisi de uygundur.
- **Sessiz saat ve sıklık sınırı**: planlayıcı, ticari gönderim penceresinin (`COMMERCIAL_SEND_WINDOW`, 08:00-21:00 yerel; artık `ComplianceService` de aynı sabiti okur) dışına düşen bir anı bir sonraki pencere başlangıcına (08:00) taşır. Mesajlaşma motoru gönderim anında yine alıcı başına sessiz saati, izni ve sıklık sınırını değerlendirir: sessiz saate denk gelirse alıcı bir sonraki 08:00'e ertelenir (48 saate kadar, mevcut kural), sıklık sınırında `SKIPPED / FREQUENCY_CAP` (mevcut davranış; ertelenmez). Motorun kişi saat dilimi de artık aynı sırayı izler (kişi, ülke varsayılanı, işletme); önceden ülke varsayılanı yoktu ve işletme dilimine düşüyordu.
- **`BEST_TIME`**: kişinin son 90 gündeki (başlangıç anına kadar) insan açılma ve tıklama olayları (`message_tracking_events`, `OPEN`/`CLICK`, `is_machine = false`) kişinin saat diliminde 24 saatlik histograma dökülür; en az 3 etkileşim varsa en yoğun saat (eşitlikte en erken) kullanılır. Yoksa işletmenin genel histogramı (en az 10 etkileşim; her açan kişi kendi `timezone` alanıyla, yoksa işletme dilimiyle okunur), o da yoksa `RECIPIENT_LOCAL` gibi yedek yerel saat. Histogram hesabı saf fonksiyonlardır (`buildHourHistogram`, `bestHourOf`, `resolveBestHour`, `planRecipientSend`) ve birim testlidir; eşikler `BEST_TIME_MIN_*` sabitleridir.
- **Yedek saat veri olarak**: yedek yerel saat sırası kampanyanın `sendTimeLocal` alanı, yoksa işletmenin mesajlaşma ayarı `defaultSendTimeLocal` (`Studio.messagingSettings`, Ayarlar > Mesaj şablonları'ndan düzenlenir), o da yoksa paylaşılan platform varsayılanı `DEFAULT_CAMPAIGN_SEND_TIME_LOCAL` ("10:00"). Tasarımdaki "ayarlarda veri" ifadesi için `MarketingSettings` kullanılmadı: o tablo yalnızca platform kiracısına aittir, oysa gönderim saati her kiracıda çalışır (sapma).
- **Toplu planlama**: alıcı satırları 1000'lik gruplar halinde, kendi `next_attempt_at` değerleriyle yazılır; kişi başına iş açılmaz. Gönderim mevcut döngüdür (200'lük gruplar, `next_attempt_at <= now`); her turun sonunda en erken bekleyen an için tek bir kuyruk işi konur (Redis yokken kalp atışı). Kazanan sonrası bırakılan alıcılar gönderim anına göre gruplanıp anlık başına tek `UPDATE` ile yazılır.
- **Onay ve içerik özeti**: `contentHash` artık A/B kurulumunu (pay, ölçüt, bekleme), varyantları (anahtar, şablon anahtarı, geçersiz kılmalar ve kendi şablon satırları) ve `FIXED` dışı gönderim saati modunu (mod ve yerel saat) kapsar; değişiklik M3b'deki geçersiz kılma akışıyla `PENDING_APPROVAL`'a döner (E2E ile doğrulandı). Bu alanlar yalnızca doluyken özete girdiği için A/B'siz ve `FIXED` kampanyaların özeti (ve mevcut onayları) değişmedi. Kazanan ve istatistik özete girmez (gönderim sırasında belirlenirler). Ön kontrolün (`canSend` kuru çalıştırma) sessiz saat tahmini hâlâ tek bir gönderim anına bakar; alıcı başına planı yansıtmaz.
- **Motor**: `SendMessageInput.overrides` (`subject`, `preheader`, `body`) e-posta ve SMS için çözümlenen şablonun üzerine yazar (değişkenler aynı katı kuralla render edilir); ön başlık ilk kez e-postaya geçirilir. Kampanyaya bağlı `NotificationLog.type` varyantın şablon anahtarıdır.
- **AI stüdyosu**: "Kampanyaya aktar" (`ExportToCampaignSchema.withAbTest`, verilmezse kayıtlı kurulum etkinse) kayıtlı A/B kurulumunu kampanyanın `abTest` alanına (`CLICK` -> `CLICK_RATE`, `CONVERSION` -> `CONVERSION`, saat x 60 = dakika) ve seçili taslak varyantlarını her biri kendi `MKT_...` şablonuyla kampanya varyantlarına (`ai_draft_id` dolu) taşır; marka kontrolü her varyant için yeniden çalışır. `storedOnly` alanı kaldırıldı. Kampanya yine `DRAFT` doğar; gönderim ve onay akışı değişmedi.
- **Web**: kampanya düzenleyicisinde "Gönderim saati" (sabit, alıcının yerel saati + saat girişi, en iyi saat + yedek saat) ve "A/B testi" (varyantlar, pay, ölçüt, bekleme) bölümleri; gönderim başlayınca "Varyant sonuçları" (evre, varyant başına sayılar ve oran, kazanan rozeti, "Kazananı şimdi seç"); alıcı listesinde varyant ve planlanan an; AI stüdyosunda dışa aktarırken "kayıtlı A/B kurulumunu aktar" seçeneği; `messaging.settings.defaultSendTime`. i18n anahtarları `campaigns.ab.*`, `campaigns.sendTime.*` (tr + en). Playwright kapsamı eklenmedi (tarayıcı yerelde yok; yalnızca tip denetimi).
- **Testler**: birim `packages/shared/src/growth/campaign-ab.spec.ts` ve `send-time.spec.ts` (deterministik ve tekil atama, kazanan ve eşitlik, histogram yedekleme zinciri, planlayıcı, sessiz saat), `content-hash.spec.ts` (varyant ve kurulum değişince özet değişir, A/B'siz özet sabit); API e2e `apps/api/test/e2e/campaign-ab-send-time.e2e-spec.ts` (test payı gönderimi, bekleme sonrası kazananın kalana gitmesi, elle seçim, eşitlikte ilk varyant, iptal, sabit 2030 anıyla RECIPIENT_LOCAL ve BEST_TIME planı ve yedek zinciri, gerçek saatte sessiz saatte motorun tutması, platform onayının varyantlara bağlanması, doğrulama ve kiracı yalıtımı) ve `marketing-studio.e2e-spec.ts` (dışa aktarma A/B'yi taşır). Gönderim testlerinde kişilerin yerel saati gerçek saate göre gündüz seçilir (motor sessiz saati gerçek saatle değerlendirir), planlama testleri sabit an ve sabit dilimlerle çalışır ve hiçbir mesajı vadesine getirmez.
- **Açık noktalar ve sapmalar**: (1) `campaign_variants.studio_id` tasarım tablosunda yoktu, kiracı izolasyonu kuralı için eklendi. (2) `testShare` yüzde tam sayıdır (5-50), AI stüdyosundaki `testSharePercent` ile aynı birim; ölçüt adları kampanya tarafında oran (`OPEN_RATE`, `CLICK_RATE`), stüdyodakiler `CLICK`/`CONVERSION` kalır ve dışa aktarmada eşlenir. (3) Bir A/B kampanyası yalnızca kazanan seçilince biter; bekletilen alıcı test bitmeden hiç gönderilmez. (4) İşletme genel histogramı ülke varsayılanını değil kişi alanını ya da işletme dilimini kullanır (SQL tarafında ülke tablosu yok). (5) Sıklık sınırı alıcı başına ertelenmez (mevcut davranış). (6) Test alıcısı sessiz saate takılırsa bekleme süresi son gönderimden sayıldığı için kazanan gecikir. (7) Ülke varsayılan dilimi tablosu sınırlı bir liste (yaklaşık 70 ülke); listede olmayan ülke işletme dilimine düşer.

### M4: Kanal genişletmeleri

Durum: planlandı. Bu tabloda Lead Ads satırı `M4b`, organik sosyal `M4c` adını taşır; paralel çalışmada adlandırma ters kullanıldı: **`feat/m4c-lead-ads-zapier` dalı tablodaki `M4b` (Meta Lead Ads) satırını ve M5'ten çekilen gelen Zapier eylemlerini uygular**, organik sosyal ayrı bir dalda yürür. Tablo iki dalın birleşiminde yeniden numaralanmalı (çakışmayı önlemek için burada değiştirilmedi). M4c (Lead Ads + gelen otomasyon) uygulama notları tablonun altındadır.

| PR | Kapsam | Kabul ölçütleri | Katman | Efor |
|---|---|---|---|---|
| M4a | `OAuthConnectService` (Meta, Google, LinkedIn, TikTok), token yenileme | Durum parametresi doğrulaması, şifreli saklama, süresi dolan token uyarısı | Opus (güvenlik) | 4 gün |
| M4b | Meta Lead Ads senkronu (webhook + çekme, alan eşleme, rıza metni) | İmzalı webhook doğrulaması, tekil aday, `lead` dönüşümü, izinsiz kişi ticari kitleye girmez | Sonnet | 3 gün |
| M4c | Organik sosyal: Meta Sayfa + Instagram gönderisi, planlama, onay | Yayın sınırı kontrolü, başarısızlıkta `FAILED` ve yeniden deneme, UTM'li bağlantı | Sonnet | 4 gün |
| M4d | LinkedIn: Conversions API adaptörü, şirket sayfası gönderisi (erişim onayı alındıysa) | Adaptör sözleşme testleri, izin listesi host'ları | Sonnet | 3 gün |

M4c uygulama notları ve sapmalar (Meta Lead Ads, gelen Zapier/Make/n8n eylemleri, platform olayları, hub blokları):

- **Durum**: uygulandı (`feat/m4c-lead-ads-zapier`, migration `20261027000000_lead_ads_automation`, yalnızca ekleme). Yeni ortam değişkeni yok: doğrulama belirteci ayardadır, uygulama sırrı şifreli bağlantı kimlik bilgisindedir.
- **Meta Lead Ads webhook'u** (`apps/api/src/modules/lead-ads`): `GET /webhooks/meta/leadgen` el sıkışması (`hub.verify_token` platform ayarındaki belirteçle sabit zamanlı özet karşılaştırması, `hub.challenge` yalnızca tam sayı olarak yankılanır); `POST /webhooks/meta/leadgen` ham gövde üzerinde `X-Hub-Signature-256` (mevcut `verifyMetaSignature`, WhatsApp webhook'uyla aynı desen; `body-parsers.ts`'e ham gövde yolu eklendi). Bildirim sayfa kimliğiyle `ad_connections.lead_ads_page_id` üzerinden Meta bağlantısına yönlendirilir, imza o bağlantının şifreli `appSecret`'ıyla doğrulanır; hiçbir bağlantı doğrulamazsa veya başlık eksik/bozuksa 401 ve hiçbir şey saklanmaz. Bağlantısı olmayan sayfanın bildirimi atlanır.
- **Alım**: her `leadgen` değişikliği bir `lead_ad_events` satırı açar ((studio_id, leadgen_id) benzersiz; tekrar teslimat yok sayılır ve yeniden işlenmez), sonra lead, bağlantının belirteciyle izin listeli Graph istemcisinden (`graph.facebook.com`, `AdsHttpClient`; belirteç URL'de değil `Authorization` başlığında) çekilir. Form sorularının kişi alanına eşlemesi form başına veridir (`lead_ad_form_mappings`, hub'dan düzenlenir); eşleme yoksa Meta'nın standart anahtarları (`full_name`, `email`, `phone_number`, `company_name`, `country`) tanınır, eşlenmeyen yanıtlar `lead_ad_events.attributes` ve kişinin `FORM` etkinliğinde (en fazla 50 anahtar, kırpılmış) kalır. Kişi mevcut `ContactsService.resolveOrCreate` ile (telefon, yoksa e-posta) oluşturulur veya bulunur, `sourceChannel = META_LEAD_AD`, satış hattı `NEW`; kampanya, reklam kümesi ve reklam kimlikleriyle sentetik bir ziyaretçi ve `touchpoint` (kimlikler `leadgen_id`'den türetilir, yeniden denemede çoğalmaz; `pw_cid/asid/adid`, `adPlatform = META`) yazılır, `lead` dönüşümü kaynak `meta_lead_ad:<leadgen_id>` ile kaydedilir (mevcut atıf ve reklam platformu teslim hattı olduğu gibi çalışır) ve yeni kişi için `lead.created` webhook'u yayınlanır. Telefon, kiracının ülkesine göre E.164'e çevrilir; ne geçerli telefon ne e-posta varsa olay kalıcı `FAILED` olur.
- **İzin (6.4, M3e)**: formun izin sorusu (`consent_question_key`) işaretliyse e-posta (adres varsa) ve SMS (telefon varsa) için pazarlama izni yazılır, `formVersion` = form kimliği, mevcut `ConsentConfirmationService.afterFormConsent` ile: kişinin ülkesi (formdaki ülke sorusu, yoksa telefonun ülkesi) kiracının çift onay bölgelerindeyse (platformda varsayılan AB + UK) izin `confirmation_requested_at` ile bekler ve onay e-postası gider. İzin sorusu yoksa veya işaretlenmediyse hiçbir ticari izin yazılmaz (yalnızca işlemsel mesaj). Ülkesi bilinmeyen kişi M3e'deki gibi `DEFAULT` bölgesidir (çift onay listeye `DEFAULT` eklenmedikçe istenmez).
- **Yeniden deneme**: geçici hata (ağ, 5xx, 429, Graph hız sınırı kodları) `RETRY` olur ve 15 dakikalık kalp atışında (`JobsService`, `leadAds` sonucu) 1 dk, 5 dk, 15 dk, 1 sa, 4 sa arayla en çok 6 denemeyle tekrarlanır; kalıcı hata (400/401/403/404, kimlik bilgisi okunamıyor, bağlantı silinmiş) hemen `FAILED` olur ve hub'dan "Yeniden dene" ile kuyruğa geri alınır. Aynı anda iki işleyici aynı olayı almaz (`next_attempt_at` kira süresi).
- **Hub** (`GET /platform/integrations`, ekleme): `leadAds` (bağlantı başına sayfa kimliği, uygulama sırrı var/yok, durum `NOT_CONFIGURED`/`CONFIGURED`/`RECEIVING`/`ERROR`, abonelik zamanı, son aday, başarısız sayısı, son hata; form eşlemeleri; bekleyen ve başarısız sayıları; `verifyToken` yalnızca süper admine), `smsSender` (sağlayıcı başına gönderici kimliği ve kayıt durumu, Twilio 10DLC marka ve kampanya durumu), `automation` (her platform olayının etkin abonelik sayısı, `crm.write` yetkili etkin anahtar sayısı). Yeni uçlar (`platform.integrations.manage`, hepsi `AuditLog`: `integration.lead_ads.*`, `integration.sms_sender.*`): `PUT /platform/integrations/lead-ads/:connectionId` (sayfa kimliği, uygulama sırrı), `POST .../check-subscription` (Graph `subscribed_apps`), `PUT|DELETE .../lead-ads/forms/:formId`, `GET .../lead-ads/events`, `POST .../lead-ads/events/:id/retry`, `PUT /platform/integrations/sms-sender`. Süper admin: `GET|PUT /admin/integrations/lead-ads/verify-token` (`SuperAdminOnly`; yalnızca SHA-256 özeti saklanır, düz metin üretilince veya girilince bir kez döner, `integration.lead_ads.verify_token_set`). Kimlik bilgisi ve sırlar hiçbir yanıtta dönmez; reklam ekranından belirteç değiştirilince uygulama sırrı korunur. Web: `IntegrationHub.tsx`'e `LeadAdsSection` (bağlantı, form eşleme düzenleyicisi, son olaylar, süper admin doğrulama belirteci kartı), `SmsSenderSection`, `AutomationSection`; API anahtarı formunda `webhooks.manage` ve `crm.write` seçimi; i18n `leadAds`, `smsSender`, `automationHub` (tr + en).
- **Gelen eylemler** (`/v1/public/contacts`, API anahtarı, yeni `crm.write` kapsamı, anahtar başına dakikada 120 istek, `docs/PUBLIC_API.md`): `POST /v1/public/contacts` e-posta veya telefonla kişi oluşturur ya da günceller (201 oluşturuldu, 200 güncellendi; telefon yanıtta maskeli), `POST /v1/public/contacts/:id/tags`, `POST /v1/public/contacts/:id/consents` (kanallar, `granted`, `legalBasis`, `formVersion`). `Idempotency-Key` başlığı (8-128 karakter) 24 saat saklanır: aynı anahtar ve aynı istek saklanan yanıtı `Idempotent-Replayed: true` ile yeniden verir, aynı anahtar başka istekle 422 `IDEMPOTENCY_KEY_REUSED`, işlem sürerken 409 `IDEMPOTENCY_IN_PROGRESS`, hata veren istek anahtarı serbest bırakır. İzin M3e kurallarıyla: `CONSENT` için form sürümü zorunlu, kişinin ülkesi kiracının çift onay bölgesindeyse onay e-postası beklenir (`doubleOptIn: true`); `TR_MERCHANT_EXEMPTION` yalnızca işletme işaretli TR kişisinde ve kiracı ayarı açıkken (aksi 409 `CONSENT_BASIS_NOT_ALLOWED`); `EXISTING_CUSTOMER` gönderim anında türetilir, kaydedilemez (422); geri alma (`granted: false`) her zaman geçer. Her yazma `AuditLog` (`public_api.contact.upsert|tags_add|consent`, anahtar kimliği metada). Başka kiracının kişisi 404'tür.
- **Platform olayları** (`WEBHOOK_EVENTS`'e eklendi, `PLATFORM_WEBHOOK_EVENTS`): `studio.signup` (`CrmHooksService.onStudioCreated`), `studio.paid` (`PlatformBillingService` etkinleştirme sonrası, ödeme ve zorla etkinleştirme), `studio.trial_expiring` (deneme kalp atışı, 7/3/1 gün eşiği başına bir kez), `contact.lifecycle_changed` (`ContactsService.applyLifecycle`, `moveToStage` ve `studio_signup`/`studio_paid` dönüşümlerindeki güncellemeler), `campaign.sent` (`CampaignsService` gönderim tamamlanınca). Hepsi `PlatformEventsService` üzerinden yalnızca platform kiracısının webhook uçlarına kuyruklanır (aynı çıkış kutusu, imza, yeniden deneme, SSRF); başka kiracı bu olaylara abone olamaz (400), başka kiracının kişisi veya kampanyası olay üretmez. Tenant arayüzündeki olay listesi platform olaylarını göstermez (`TENANT_WEBHOOK_EVENTS`).
- **Testler**: shared birim `marketing/lead-ads.spec.ts`; API birim `lead-ads.service.spec.ts` (imza, tekrar teslimat, alan eşleme, atıf, izin eşlemesi ve AB ülkesi, yeniden deneme), `idempotency.util.spec.ts`, `idempotency.service.spec.ts`; API e2e `lead-ads-automation.e2e-spec.ts` (el sıkışma, imzalı lead: kişi + `lead` dönüşümü + touchpoint + bekleyen AB izni, tekrar teslimat, kötü imza 401, yeniden deneme ve elle yeniden deneme, hub blokları ve yetkiler, SMS gönderici, `crm.write` kapsamı, `Idempotency-Key`, etiket, izin ve dayanaklar, hız sınırı, platform olaylarının imzalı teslimatı, diğer kiracıların etkilenmemesi). Playwright `lead-ads-hub.e2e.ts` yalnızca tip denetimi yapıldı.
- **Meta App Review izinleri** (başvuruyu kim ve hangi işletme hesabıyla yapacak: açık karar): bölüm 5.2'deki tasarıma göre `leads_retrieval` (lead okuma, bu PR'ın gerektirdiği asıl izin), `pages_manage_metadata` (sayfayı uygulamaya `leadgen` alanı için abone etmek) ve `pages_manage_ads`; ayrıca sayfa erişimi için `pages_show_list`. Bu PR sayfayı Meta'ya abone ETMEZ; abonelik Meta panelinden (Webhooks > Page > `leadgen`) veya Graph'tan yapılır, hub yalnızca `subscribed_apps` ile kontrol eder. İzin adları ve gereksinimler Meta'nın güncel belgesiyle başvuru sırasında doğrulanmalıdır (bu ortamda Meta'ya erişilemedi, gerçek bir lead ile denenmedi).
- **Kurulum sırası**: (1) süper admin `/admin/entegrasyonlar`'dan doğrulama belirteci üretir; (2) Meta uygulamasında Webhooks > Page > `leadgen` için geri çağrı adresi `<API adresi>/webhooks/meta/leadgen` ve o belirteç; (3) hub'da Meta reklam bağlantısına sayfa kimliği ve uygulama sırrı girilir; (4) sayfa uygulamaya abone edilir, "Sayfa aboneliğini kontrol et"; (5) formun eşlemesi ve izin sorusunun anahtarı girilir.
- **Tasarımdan sapmalar ve açık noktalar**:
  - `lead_ads_forms` tasarımdaki alanlarla değil `lead_ad_form_mappings` olarak uygulandı: bağlantıya bağlı değil (kiracı + form), `consentTextVersion` yok (form sürümü form kimliğidir), `isActive` yok (satır silinerek kapatılır).
  - `lead_ad_events.leadgen_id` benzersizliği (studio_id, leadgen_id) bileşiktir (Meta kimliği zaten küresel benzersizdir; kiracılar arası kimlik çakıştırma saldırısını önlemek için).
  - Yeni tabloların `studio_id`'sinde yabancı anahtar yoktur (Studio modeline geri ilişki eklenmedi, paralel PR'larla çakışmasın diye); `ad_connections` üzerindeki iki sütun mevcut tablodadır.
  - Şirket için `contacts` sütunu yok: şirket ve eşlenmeyen yanıtlar `lead_ad_events.attributes` ve `FORM` etkinliği meta verisindedir; özel alan tanımına yazılmaz.
  - Twilio 10DLC ve gönderici kimliği durumu "bağlantıda" değil platform kiracısının `messagingSettings` JSON'unda (SMS sağlayıcısı için bağlantı tablosu yok), elle girilir ve sağlayıcıdan okunmaz; kiracı kendi ayar ucundan yazamaz (`TenantMessagingSettingsSchema` bu iki anahtarı dışlar).
  - Doğrulama belirteci `platform_integration_settings` tablosundadır (ayar, ortam değişkeni değil); `marketing_settings` satırı M3d ile çakışmamak için kullanılmadı.
  - Herkese açık `POST /v1/public/contacts` kişiyi satış hattına almaz ve `lead` dönüşümü ya da `lead.created` üretmez; yalnızca kişi oluşturur/günceller (kaynak kanal `API`). İzinsiz kişi ticari kitleye girmez.
  - Herkese açık izin ucu, `marketing_settings` satırı olmayan kiracıda çift onay uygulamaz (M3e ile aynı: politika yoksa davranış değişmez); `TR_MERCHANT_EXEMPTION` kişinin adresli tüm kanallarına yazılır, yalnızca istenene değil.
  - `contact.lifecycle_changed` ham SQL ile çalışan `sweepLapsed` süpürmesinde yayınlanmaz (platform kiracısında paket olmadığı için).
  - `POST /webhooks/meta/leadgen` için IP hız sınırı yoktur (WhatsApp webhook'uyla aynı); imza ve sayfa eşleşmesi doğrulanmadan hiçbir kayıt yazılmaz.
  - OAuth ve token yenileme M4a'dadır; burada bağlantı belirteci yapıştırılır (uzun ömürlü sistem kullanıcısı belirteci önerilir).

Harici bağımlılıklar M4'ün takvimini belirler: Meta App Review (Lead Ads, sayfa yayını), LinkedIn Community Management erişimi, TikTok uygulama incelemesi. Başvurular M1 sırasında başlatılmalıdır.

### M5: Sonra

Durum: planlandı.

- Reklam bütçesi ve durum değişikliği (Meta/Google, onaylı; oluşturma `PAUSED`), harcama tavanında otomatik durdurma.
- SES kimliği ve DKIM'in API ile otomatik kurulumu; SES reputation metriklerinin CloudWatch'tan okunması.
- Akışta webhook adımı (gelen Zapier eylemleri, `crm.write`, M4c'de yapıldı).
- Mobil: onay bildirimi ve onay ekranı.
- Aynı pazarlama özelliklerinin (marka kiti, stüdyo, onay) kiracılara açılması (şema zaten `studioId`'li).

Toplam kaba efor: M1 ~13 gün, M2 ~11 gün, M3 ~17 gün, M4 ~14 gün (harici onaylar hariç).

---

## 9. Açık kararlar (sahip için)

- Kendi onayı eşikleri: e-postada 1.000 alıcı, SMS/WhatsApp'ta 100 alıcı önerisi uygun mu? Reklam bütçesinde her artış sizin onayınızla mı? (M3b bu varsayılanlarla uygulandı; SMS kredi eşiği varsayılanı 100 ve talep süresi 72 saat. `/admin/pazarlama-ayarlari`'ndan değiştirilebilir.)
- M3b: `platform.marketing.approve` iznine sahip, süper admin olmayan bir kullanıcı da onay verebilsin mi? (Bugün hayır; onay/ret yalnızca süper admin.)
- M3b: dinamik segmentin üye sayısı onay ile gönderim arasında değişince onay düşüyor; küçük bir tolerans (ör. %5) istenir mi?
- İlk kanallar: önerilen sıra e-posta (alan adı doğrulamasıyla) -> LinkedIn/Meta ücretli (mevcut atıfla) -> Lead Ads -> organik sosyal. Hedef pazarlar ve öncelik sırası nedir (TR, AB, ABD)?
- Pazarlama yöneticisi kiracılar arası anonim benchmark'ı (`/admin/benchmark`, k-anonim) görebilsin mi? Öneri: evet, salt okunur ve yalnızca toplu.
- B2B tavsiye programı ve gelir (MRR, plan dağılımı) görünürlüğü: salt okunur `platform.referrals.view` verilsin mi? Tavsiye ödül ayarları sizde mi kalsın? (Öneri: ayarlar sizde.)
- Platform kişi listesini dışa aktarma izni verilsin mi? (Öneri: hayır, gerekirse onaylı tek seferlik.)
- MRR etkisi (M3a) plan liste fiyatlarından hesaplanıyor (indirim, tavsiye kredisi ve ücretsiz ay yok sayılır); gerçek tahsilattan (`PlatformBillingPayment`) mı türetilsin?
- Pano huni katı olduğu için MQL/SQL aşamasına hiç girmeden kaydolan (self-servis) işletmeler `studio_paid` adımında görünmez: MQL ve SQL adımları isteğe bağlı mı sayılsın, yoksa kayıt sırasında aşama otomatik mi atansın?
- Yapay zeka aylık bütçesi (platform kiracısı): M2'de varsayılan 50 USD olarak uygulandı (`marketingAiMonthlyBudgetCents`, süper admin ayarı); panodan izleyip ayarlanacak. Bütçe dolunca 402 mi (uygulanan) 429 mu dönsün?
- Marka dilleri: tr ve en ile başlıyoruz; hangi diller ne zaman eklenecek? Her dil için ayrı marka tonu notu gerekir.
- 2FA: TOTP zorunluluğu hem sizin hem pazarlama yöneticisi için kabul mü? Passkey M3'te mi?
- İYS tacir/esnaf muafiyeti kullanılsın mı, yoksa her zaman açık onay mı? (Öneri: açık onay varsayılan. M3e: ayar olarak geldi, varsayılan kapalı.)
- AB formlarında çift onay tüm AB için mi, yalnızca Almanya/Avusturya için mi? (Öneri: tüm AB/UK. M3e: varsayılan AB + UK; `/admin/pazarlama-ayarlari`'ndan bölge veya ülke eklenip çıkarılabilir.)
- M3e: ülkesi bilinmeyen form ziyaretçisi (kenar başlığı ve telefon ülkesi yok) için çift onay istensin mi? (Bugün hayır; listeye `DEFAULT` eklenirse evet.)
- M3e: soft opt-in bölge tablosu (AB/UK e-posta, SMS ve WhatsApp; ABD yalnızca e-posta; TR ve Kanada yok) ve "mevcut müşteri" tanımı (platform kiracısında etkin üyelik veya faturalama durumu `ACTIVE` olan işletmenin sahibi) hukuk danışmanıyla doğrulanmalı; deneme sürümündeki işletme sahipleri de mevcut müşteri sayılsın mı?
- M3e: e-postası olmayan (yalnızca telefon) AB kişileri için SMS ile onay istenir mi?
- KVKK aydınlatma metnine "pazarlama ekibi" ve yapay zeka alt işleyeni (Anthropic) eklenmesi için hukuki metin güncellemesi kimde?
- Meta, Google Ads (geliştirici token erişim düzeyi), LinkedIn ve TikTok uygulama başvurularını kim yapacak ve hangi işletme hesabıyla?
- Pazarlama e-postaları için ayrı alt alan adı (ör. `news.<alan>`) kullanılacak mı? (Öneri: evet; işlemsel ve pazarlama itibarı ayrılır.)
- Haftalık özet kime gitsin: yalnızca pazarlama yöneticisi mi, siz de mi?
- M4c: Meta Lead Ads için formda ülke sorusu ve pazarlama izni kutusu zorunlu tutulsun mu? Ülkesi bilinmeyen (ne form ülkesi ne telefon ülkesi) bir kişi `DEFAULT` bölgesi sayılır ve çift onay istenmez; AB kişilerinin kaçmaması için forma ülke sorusu eklenmesi önerilir.
- M4c: `crm.write` anahtarları her kiracıda oluşturulabiliyor (yalnızca kendi kiracısının kişilerini yazar); yalnızca platform kiracısına mı kısıtlansın?
- M4c: Herkese açık kişi oluşturma kişiyi satış hattına ve `lead` dönüşümüne sokmuyor; Zapier ile gelen kişiler aday sayılsın mı (öneri: kaynak kanal `API` ile kişi kalsın, aday sayma ayrı bir bayrakla açılsın)?
- M4c: Meta App Review başvurusu (`leads_retrieval`, `pages_manage_metadata`, `pages_manage_ads`) ve sistem kullanıcısı belirteci için işletme hesabı hangisi?

---

## Kaynaklar

- Gmail/Yahoo toplu gönderici kuralları: [Mailgun](https://www.mailgun.com/state-of-email-deliverability/chapter/yahoogle-bulk-senders/), [Resend](https://resend.com/blog/gmail-and-yahoo-bulk-sending-requirements-for-2024)
- Amazon SES itibar eşikleri: [AWS SES FAQ](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html), [AWS re:Post](https://repost.aws/knowledge-center/ses-reputation-dashboard-bounce-rate), [SES başarı metrikleri](https://docs.aws.amazon.com/ses/latest/dg/success-metrics.html)
- CAN-SPAM: [FTC rehberi](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- TCPA: [Eleventh Circuit kararı, MoFo](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule), [Goodwin, FCC nihai kuralı](https://www.goodwinlaw.com/en/insights/blogs/2025/09/the-fcc-issues-final-rule-formally-eliminating-the-one-to-one-consent-requirement), [BCLP, iptal kuralları](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
- İYS tacir/esnaf: [İYS SSS](https://iys.org.tr/iys/sss), [Lexology](https://www.lexology.com/library/detail.aspx?g=1b39fa25-deb4-4090-ba3c-067bba5fbcba)
- Almanya UWG ve çift onay: [DLA Piper](https://www.dlapiperdataprotection.com/index.html?t=electronic-marketing&c=DE)
- Meta Lead Ads: [Meta, lead alma](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving), [leadgen webhook](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)
- Instagram yayın: [Meta içerik yayınlama](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- Google Ads API erişim düzeyleri: [Google](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
- LinkedIn Community Management: [Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-06), [erişim artırma](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-05)
- TikTok Marketing API: [TikTok](https://business-api.tiktok.com/portal/docs/marketing-api/v1.3)
- Make instant trigger ve webhook attach/detach: [Make](https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached)
- Gönderim zamanı optimizasyonu: [Iterable](https://support.iterable.com/hc/en-us/articles/360050923471-Send-Time-Optimization)
- Kimlik avına dayanıklı MFA: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
