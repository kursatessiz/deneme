# Deneme Süresi, Etkinleştirme ve İşletmeden İşletmeye Tavsiye (G5c-1)

Bu belge, platformun kendi satışını (işletmelerin platforma abone olmasını) anlatır: yeni işletmenin deneme süresi, "Hesabı etkinleştir" akışı, süresi dolan denemenin kısıtlı moda geçmesi ve bir işletmenin başka bir işletmeyi platforma getirmesiyle kazandığı abonelik kredisi. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.2 ve 3.11'dir.

Buradaki "müşteri" kiracının kendisidir (işletme); kiracının üyeleriyle ilgili hiçbir şey bu modülde değildir.

## 1. Veri modeli

Migration: `20261010000000_trial_activation` (yalnızca genişletme; hiçbir sütun silinmez veya yeniden adlandırılmaz).

### Faturalama durumu neden `Studio` üzerinde?
`Subscription` tablosu zaten plan ve dönem geçmişini tutuyor (birden çok satır, iptal edilenler dahil) ve durum listesinde `RESTRICTED` yok. Kısıtlı mod her yazma isteğinde kontrol edilmek zorunda; `StudioTenantGuard` her istekte `Studio` satırını zaten okuyor. Bu yüzden kapı (gate) bilgisi `Studio` üzerindedir, ayrı bir `StudioBilling` tablosu her isteğe bir birleştirme (join) eklerdi:

| Sütun | Anlamı |
|---|---|
| `billing_status` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `RESTRICTED`, `CANCELLED` (`STUDIO_BILLING_STATUSES`, `packages/shared/src/billing.ts`). Varsayılan `ACTIVE`, veritabanında CHECK kısıtı var. |
| `trial_started_at`, `trial_ends_at` | Deneme başlangıcı ve bitişi. |
| `activated_at` | İlk başarılı etkinleştirme (ilk ödeme veya süper admin zorlaması). |
| `billing_status_changed_at` | Son durum değişikliği. |
| `trial_reminder_sent_days` | Mevcut deneme bitişi için gönderilmiş en küçük hatırlatma eşiği (7, 3, 1). Deneme uzatılınca sıfırlanır. |
| `platform_referral_code` | İşletmenin platform düzeyindeki tavsiye kodu (benzersiz, ilk kullanımda üretilir). |

`Subscription` eskisi gibi plan ve dönem kaydıdır: yeni işletmede `TRIALING` satırının dönem sonu deneme bitişidir; etkinleştirmede eski satır `CANCELLED` olur ve yeni `ACTIVE` satırı açılır.

**Geriye dönük doldurma:** migration'daki varsayılan sayesinde mevcut bütün işletmeler `ACTIVE` olur, `activated_at` alanı `created_at` ile doldurulur. Hiçbir veri silinmez.

### Yeni tablolar
- `platform_billing_payments`: işletmenin platforma yaptığı ödeme (etkinleştirme veya sonraki dönem). Liste tutarı, kullanılan kredi (tutar ve ay), sağlayıcıdan çekilen tutar, para birimi, sağlayıcı ve referansı, durum (`PENDING`, `COMPLETED`, `FAILED`). Kiracının kendi `payments` tablosuna yazılmaz; çünkü ödeyen kiracı, alan platformdur.
- `studio_referrals`: tavsiye eden ve edilen işletme, kod, kaynak (`TOUCHPOINT` veya `MANUAL`), temas noktası, durum (`SIGNED_UP`, `REWARDED`, `REJECTED`) ve ret nedeni. `referred_studio_id` benzersizdir: bir işletme yalnızca bir kez tavsiye edilmiş sayılır.
- `platform_credit_ledger`: yalnızca ekleme yapılan kredi defteri. `REFERRAL_REWARD` (+), `APPLIED` (-), `ADJUSTMENT` (iade/ters kayıt). Her satırın benzersiz `idempotency_key` alanı var; bakiye satırların toplamıdır. Uygulama satırları asla güncellemez veya silmez.
- `platform_billing_settings`: tek satırlık platform ayarı (`id = 'platform'`): tavsiye ödülü türü ve değeri.

### Plan
`plans` tablosuna `currency` (fiyatın para birimi) ve `trial_days` (deneme süresi, varsayılan 14) eklendi. Deneme süresi koddaki bir sabit değil, süper adminin plan başına girdiği veridir. Mevcut planların para birimi, varsa platform kiracısının para birimiyle doldurulur.

## 2. Deneme ve etkinleştirme akışı

1. Süper admin işletmeyi oluşturur (`POST /admin/tenants`). İşletme `TRIALING` olur, deneme bitişi `şimdi + plan.trialDays` gündür. Platform kiracısının CRM'i sahibin telefonunu biliyorsa `studio_signup` dönüşümü kaydedilir (G1b davranışı değişmedi).
2. Panelin üstünde kalan gün bandı görünür (`BillingBanner`, tasarım tokenları, i18n). Yalnızca sahipte "Hesabı etkinleştir" bağlantısı vardır; diğer personele "Hesabı işletme sahibi etkinleştirebilir" yazar.
3. Sahip `/abonelik` sayfasında plan seçer ve öder (`POST /studios/:studioId/billing/activate`). Ödeme, süreç genelindeki ödeme adaptörüyle (`PaymentProviderRegistry.default`, `PAYMENT_PROVIDER`) alınır. MOCK geliştirme ve testte hemen tamamlanır; üretimde MOCK devre dışıdır.
4. Önce kredi kullanılır (bölüm 5), kalan tutar sağlayıcıdan çekilir. Ödeme tamamlanınca tek işlemde: ödeme `COMPLETED`, işletme `ACTIVE`, `activated_at` (ilk kez), yeni `ACTIVE` abonelik dönemi, denetim kaydı `billing.activate`.
5. Ardından (başarısızlığı ödemeyi geri almaz): platform kiracısında `studio_paid` dönüşümü ve tavsiye ödülü.
6. Gerçek sağlayıcılarda (Stripe, iyzico, PayTR) ödeme sayfasına yönlendirme olur; onay, mevcut `POST /payments/webhook/:provider` adresine gelir. `PaymentsService.handleWebhook` imzayı bir kez doğrular, referans bir kiracı ödemesi değilse `PaymentWebhookRouter` üzerinden platform faturalamasına verir. Aynı webhook tekrar gelirse `alreadyProcessed` döner.

### `studio_paid` atfı
- Olay platform kiracısında, sahibin telefonuyla bulunan kişi (Contact) üzerine yazılır; kaynak `{ kind: 'studio_activation', id: <studioId> }` olduğu için **işletme başına bir kez** kaydedilir (tekrar ödeme, tekrar webhook veya yeniden deneme yeni olay üretmez).
- Değer, planın liste fiyatı ve para birimidir.
- Atıf her dönüşümdeki gibi ödeme anından geriye, atıf penceresi içindeki son temas noktasıdır. Pencere içinde temas yoksa (uzun deneme), `studio_signup` olayının atfedildiği temas noktasına düşülür; böylece işletmeyi getiren reklam ödemeyi de alır ve G2b reklam raporları ile Meta/Google gönderimleri ücretli dönüşümü görür.
- Sahibin telefonu platform CRM'inde yoksa (reklamsız, doğrudan süper admin kaydı) olay yazılmaz; bu G1b `studio_signup` kuralıyla aynıdır.

## 3. Süre dolumu, hatırlatmalar ve kısıtlı mod

### Kalp atışı
`BillingJobsService.run()` her 15 dakikada `JobsService.runAll()` içinden çalışır (Redis varsa BullMQ tekrarlayan işi, yoksa `POST /admin/scheduler/run`):
- Deneme bitişi geçmiş `TRIALING` işletmeler koşullu güncellemeyle `RESTRICTED` olur, `billing.trial_expired` denetim kaydı yazılır ve sahibe `TRIAL_RESTRICTED` gönderilir.
- Bitişe 7, 3 ve 1 gün kala sahibe `TRIAL_ENDING` gönderilir. Her eşik aynı deneme bitişi için bir kez: önce `trial_reminder_sent_days` koşullu güncellemeyle sahiplenilir, mesajlaşma idempotency anahtarı da çift gönderimi önler. Geç çalışan bir kalp atışı yalnızca en acil eşiği gönderir.
- Mesajlar mesajlaşma motorundan TRANSACTIONAL gider (sahibin kendi hesabıyla ilgili), `billing: 'EXEMPT'` olduğu için kiracının SMS kredisinden düşmez. Şablonlar `msgTpl.TRIAL_ENDING.*` ve `msgTpl.TRIAL_RESTRICTED.*` (tr ve en), kanal sırası kiracının ayarıdır. Sahip daveti henüz kabul etmemişse gönderim yapılmaz.

### Kısıtlı mod (RESTRICTED ve CANCELLED)
Uygulama: `BillingWriteGuard` (`apps/api/src/modules/auth/guards/billing-write.guard.ts`), `@StudioScoped()` zincirinin son halkasıdır; yani işletme kapsamlı her uç noktada otomatik çalışır ve **varsayılan olarak yazmayı reddeder**:
- `GET`, `HEAD`, `OPTIONS` her zaman geçer: personel giriş yapar, görüntüler, dışa aktarır.
- Bir yazma isteği yalnızca uç noktanın istediği **bütün** izinler `RESTRICTED_MODE_ALLOWED_WRITE_PERMISSIONS` listesindeyse geçer: `billing.manage` (etkinleştirme, plan, tavsiye sayfası), `studio.settings.manage`, `roles.manage`, `staff.manage` (ayrılan personelin erişimini kaldırmak güvenlik işlemidir), `crm.export`, `accounting.export`.
- Ya da işleyici açıkça `@AllowWhenRestricted()` ile işaretlidir. Bu liste yalnızca üyenin kendi verisi ve KVKK/GDPR işlemleridir: seans iptali ve bekleme listesinden çıkma, çevrim içi seansa katılma, KVKK iletişim izni, sağlık verisi ayarları/onayı/silme/senkron, fatura bilgisi, ev şubesi, hedef ve liderlik tablosu tercihi, seans puanlama, gelen kutusu mesajı ve okundu, kayıtlı kart ekleme, abonelik iptali, video izleme, etkinlik kaydı iptali, davet oluşturma (üye daveti serviste ayrıca engellenir, personel daveti serbesttir).
- Diğer her yazma `403` ve gövdede `code: "BILLING_RESTRICTED"` döner: yeni rezervasyon ve seans, satış ve ödeme, perakende, kampanya ve akış, üye ekleme ve davet, üyenin kendi rezervasyonu, paket satın alması, etkinlik kaydı ve ödül kullanımı. Yeni eklenen bir yazma uç noktası da, listeye eklenmedikçe, kısıtlı modda kapalıdır.
- `@StudioScoped()` dışından gelen iki yazma ayrıca kontrol edilir: API anahtarıyla herkese açık API'den rezervasyon (`POST /v1/public/bookings`) ve herkese açık etkinlik kaydı. Partner (toplayıcı) webhook'ları sözleşme gereği etkilenmez.
- Hiç engellenmeyenler: süper admin (her durumda), kimlik doğrulama (`/auth`, `/me`), faturalama ve etkinleştirme, `/admin/*`, dışa aktarımlar, KVKK/GDPR istekleri.
- Hata metni istemcide çevrilir: web BFF (`translateApiError`) ve mobil `apiRequest`, `TRANSLATED_API_ERROR_CODES` eşlemesiyle `billing.error.BILLING_RESTRICTED` anahtarını kullanıcının dilinde gösterir; ekranların kodu bilmesi gerekmez.
- `PAST_DUE` şu an bir yumuşak durumdur (yazma serbest, bant uyarır); otomatik `PAST_DUE` geçişi yapan bir yenileme motoru henüz yok (bölüm 7).

### Durum geçişleri
`canTransitionBillingStatus` (shared) dışındaki geçişler API'de reddedilir:
- `TRIALING` -> `ACTIVE`, `RESTRICTED`, `CANCELLED`
- `RESTRICTED` -> `ACTIVE`, `TRIALING` (süper admin denemeyi uzattı), `CANCELLED`
- `ACTIVE` -> `PAST_DUE`, `RESTRICTED`, `CANCELLED`
- `PAST_DUE` -> `ACTIVE`, `RESTRICTED`, `CANCELLED`
- `CANCELLED` -> `ACTIVE`

## 4. Süper admin

- Kiracı listesinde abonelik durumu ve deneme bitişi (`GET /admin/tenants` artık `billingStatus`, `trialEndsAt`, `activatedAt` döner).
- `POST /admin/tenants/:studioId/trial/extend` `{ days }`: yalnızca `TRIALING` veya `RESTRICTED`; yeni bitiş `max(bitiş, şimdi) + gün`, durum `TRIALING`, hatırlatmalar sıfırlanır. Denetim: `billing.trial_extend`.
- `POST /admin/tenants/:studioId/billing-status` `{ status: 'ACTIVE' | 'RESTRICTED', planKey?, reason? }`: ödemesiz etkinleştirme veya kısıtlama. Denetim: `billing.force_activate` / `billing.force_restrict`. Zorla etkinleştirme `studio_paid` yazmaz ve tavsiye ödülü vermez (ödeme yok).
- `GET /admin/tenants/:studioId/billing`: işletmenin abonelik özeti.
- `GET` / `PUT /admin/billing/settings`: tavsiye ödülü (tutar + para birimi veya ücretsiz ay). Denetim: `billing.settings_update`.
- `GET /admin/business-referrals`: tüm işletme tavsiyeleri, toplamlar ve ödül ayarı.
- Plan formunda para birimi ve deneme süresi (`POST /admin/plans` `currency`, `trialDays`).
- Web: `/admin/tenants` (Abonelik sütunu ve işlemler), `/admin/plans`, `/admin/referrals`.

## 5. İşletmeden işletmeye tavsiye

### Kod ve bağlantı
Her işletmenin tek bir platform düzeyi kodu vardır (`A-Z` ve `2-9`, karışan harfler yok, 8 karakter). Sahip `/tavsiye` sayfasında bağlantıyı (`<site>/<dil>?pw_ref=<KOD>`), kodu, kopyalama düğmesini, getirdiği işletmeleri ve kazandığı krediyi görür.

### Atıf
- Paylaşılan izleme sözleşmesine `pw_ref` parametresi eklendi (`REFERRAL_TRACKING_PARAM`, `TouchpointInput.ref`, `parseReferralParam`). Reklam kimliği değildir; UTM gibi analitik izinle saklanır (`touchpoints.ref_code`), hatalı kod sessizce atılır.
- Ziyaretçi platform sitesinde form doldurunca kişiye bağlanır (G1b). Süper admin işletmeyi aynı sahip telefonuyla oluşturduğunda, kişinin atıf penceresi içindeki son `pw_ref` temas noktası tavsiye eden işletmeyi belirler (kaynak `TOUCHPOINT`).
- Süper admin oluşturma formunda kodu elle de girebilir (kaynak `MANUAL`); bilinmeyen kod kayıt oluşturmaz, işletme oluşturmayı da engellemez.

### Ödül
- Yalnızca tavsiye edilen işletme **ödeme yaptığında** (etkinleştirme) yazılır; zorla etkinleştirmede yazılmaz.
- Tavsiye edilen işletme başına bir kez: `studio_referrals.referred_studio_id` benzersiz, `SIGNED_UP -> REWARDED` koşullu güncelleme ve defter satırı aynı işlemde, defter anahtarı `referral-reward:<referredStudioId>`.
- Değer süper admin ayarıdır: tutar + para birimi veya ücretsiz ay sayısı (varsayılan 1 ay).

### Kötüye kullanım önlemleri
- Kendi kendini tavsiye: aynı işletme, aynı sahip telefonu (kullanıcılar telefonla global ve tekildir) veya aynı sahip e-postası. Kayıtta ve ödeme anında (sahip daveti sonradan kabul etmiş olabilir) tekrar kontrol edilir; tavsiye `REJECTED` / `SELF_REFERRAL` olur ve ödül yazılmaz.
- Tavsiye eden işletme askıya alınmışsa (`isActive = false`) ödül yazılmaz (`REFERRER_INACTIVE`).
- Ödeme parmak izi (aynı kart): mevcut ödeme adaptörleri kart parmak izi döndürmediği için bu kontrol yapılamıyor; adaptörler parmak izi döndürmeye başladığında `platform_billing_payments` üzerine eklenmelidir.

### Kredinin kullanılması
Kredi, işletmenin bir sonraki platform ödemesinde otomatik düşülür (`applyCredits`, shared):
1. Önce ücretsiz aylar: her biri dönemin bir ayını tamamen karşılar.
2. Sonra ödemenin kendi para birimindeki tutar kredisi, kalan tutara kadar. Başka para birimindeki kredi çevrilmez, bakiyede kalır.
3. Kullanılan kredi ödeme oluşturulurken `APPLIED` satırıyla ayrılır; ödeme başarısız olursa `ADJUSTMENT` ters kaydıyla geri verilir. Böylece iki paralel ödeme aynı krediyi kullanamaz.
4. Kredi tüm tutarı karşılıyorsa sağlayıcı hiç çağrılmaz, ödeme doğrudan tamamlanır.

Bugün platformda yalnızca etkinleştirme ödemesi var (dönemsel yenileme motoru yok, bölüm 7). Zaten `ACTIVE` olan bir işletmenin kazandığı kredi bakiyede görünür ve yenileme motoru eklendiğinde aynı `PlatformBillingService` ödeme yolundan (`applyCredits` + `APPLIED` satırı) tüketilmelidir.

## 6. Uç noktalar ve izinler

| Uç nokta | Koruma |
|---|---|
| `GET /studios/:studioId/billing` | `billing.manage` |
| `GET /studios/:studioId/billing/payments` | `billing.manage` |
| `POST /studios/:studioId/billing/activate` | `billing.manage` |
| `GET /studios/:studioId/business-referrals` | `billing.manage` |
| `POST /admin/tenants/:studioId/trial/extend` | süper admin |
| `POST /admin/tenants/:studioId/billing-status` | süper admin |
| `GET /admin/tenants/:studioId/billing` | süper admin |
| `GET`, `PUT /admin/billing/settings` | süper admin |
| `GET /admin/business-referrals` | süper admin |

`billing.manage` yeni izindir ve **yalnızca sahibe** aittir (`OWNER_ONLY_PERMISSIONS`): `resolvePermissions` sahip olmayan rollerde bu anahtarı düşürür, rol düzenleyicisi göstermez, API rol şablonuna eklenmesini reddeder. Oturum (`/auth/me`) her üyelikte `billing: { status, trialEndsAt }` döner; web bandı buradan çizilir.

## 7. Kalan işler

- Dönemsel yenileme (aylık tahsilat, `PAST_DUE`, tahsilat hatasında yeniden deneme) ve fatura kesimi; kredinin yenilemede tüketilmesi bu motorla bağlanacak.
- Kart parmak iziyle kendi kendini tavsiye kontrolü (adaptör desteği gerekiyor).
- Mobil uygulamada deneme bandı ve etkinleştirme ekranı (mobil şimdilik yalnızca kısıtlı mod hatasını çevrilmiş gösterir).
- Kendi kendine kayıt (self-serve signup): bugün işletmeyi süper admin oluşturuyor; herkese açık kayıt eklendiğinde `startTrial` ve `recordSignup` aynı şekilde çağrılmalı.

## 8. Testler

- Shared: `packages/shared/src/billing.spec.ts` (kalan gün, durum geçişleri, hatırlatma eşikleri, kısıtlı mod izin listesi, ödül ve kredi hesabı, kendi kendini tavsiye, `pw_ref`).
- API birim: `billing-write.guard.spec.ts`, `conversion.service.spec.ts` (`studio_paid` atıf geri düşüşü).
- API e2e: `trial-activation.e2e-spec.ts`, `b2b-referral.e2e-spec.ts`.
- Web: `lib/billing/banner.spec.ts`, `lib/bff/translate-error.spec.ts`, Playwright `e2e/billing-trial.e2e.ts` (bant, etkinleştirme, tavsiye sayfası; tohum durumunu değiştirdiği için CI'da her taze tohumda bir kez çalışır).
- Tohum: demo işletmeler `ACTIVE`; ek demo işletme "Nova Hareket Merkezi" 10 gün kalmış `TRIALING` (sahip `+905329900001`), Zen'in `ZENREF23` koduyla gelmiş.
