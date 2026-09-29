# Deneme Süresi, Etkinleştirme ve İşletmeden İşletmeye Tavsiye (G5c-1)

Bu belge, platformun kendi satışını (işletmelerin platforma abone olmasını) anlatır: yeni işletmenin deneme süresi, "Hesabı etkinleştir" akışı, süresi dolan denemenin kısıtlı moda geçmesi ve bir işletmenin başka bir işletmeyi platforma getirmesiyle kazandığı abonelik kredisi. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.2 ve 3.11'dir.

Buradaki "müşteri" kiracının kendisidir (işletme); kiracının üyeleriyle ilgili hiçbir şey bu modülde değildir.

## 1. Veri modeli

Migration: `20261012000000_trial_activation` (yalnızca genişletme; hiçbir sütun silinmez veya yeniden adlandırılmaz).

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
- `platform_referral_reward_amounts` (G5c-1b): tutar ödülünün para birimi başına değeri (para birimi birincil anahtar, tutar). Platform düzeyidir, kiracıya ait değildir.

### Plan
`plans` tablosuna `currency` (fiyatın para birimi) ve `trial_days` (deneme süresi, varsayılan 14) eklendi. Deneme süresi koddaki bir sabit değil, süper adminin plan başına girdiği veridir. Mevcut planların para birimi, varsa platform kiracısının para birimiyle doldurulur.

**G5c-1b ile fiyat para birimi başına tutulur** (bölüm 9): `plan_prices` (plan, para birimi, aylık fiyat; plan ve para birimi çifti benzersiz). `plans.price_monthly` ve `plans.currency` bir sürüm boyunca yerinde kalır (önce genişlet, sonra daralt): uygulama bunlara yalnızca bir fiyatın aynasını yazar, fiyat seçen hiçbir yol bunları okumaz; sonraki bir daraltma migration'ında silinecekler. `plans.currency` sütununun `'TRY'` varsayılanı kaldırıldı (kural 8).

## 2. Deneme ve etkinleştirme akışı

1. Süper admin işletmeyi oluşturur (`POST /admin/tenants`). İşletme `TRIALING` olur, deneme bitişi `şimdi + plan.trialDays` gündür. Platform kiracısının CRM'i sahibin telefonunu biliyorsa `studio_signup` dönüşümü kaydedilir (G1b davranışı değişmedi).
2. Panelin üstünde kalan gün bandı görünür (`BillingBanner`, tasarım tokenları, i18n). Yalnızca sahipte "Hesabı etkinleştir" bağlantısı vardır; diğer personele "Hesabı işletme sahibi etkinleştirebilir" yazar.
3. Sahip `/abonelik` sayfasında plan seçer ve öder (`POST /studios/:studioId/billing/activate`). Ödeme, süreç genelindeki ödeme adaptörüyle (`PaymentProviderRegistry.default`, `PAYMENT_PROVIDER`) alınır. MOCK geliştirme ve testte hemen tamamlanır; üretimde MOCK devre dışıdır.
4. Önce kredi kullanılır (bölüm 5), kalan tutar sağlayıcıdan çekilir. Ödeme tamamlanınca tek işlemde: ödeme `COMPLETED`, işletme `ACTIVE`, `activated_at` (ilk kez), yeni `ACTIVE` abonelik dönemi, denetim kaydı `billing.activate`.
5. Ardından (başarısızlığı ödemeyi geri almaz): platform kiracısında `studio_paid` dönüşümü ve tavsiye ödülü.
6. Gerçek sağlayıcılarda (Stripe, iyzico, PayTR) ödeme sayfasına yönlendirme olur; onay, mevcut `POST /payments/webhook/:provider` adresine gelir. `PaymentsService.handleWebhook` imzayı bir kez doğrular, referans bir kiracı ödemesi değilse `PaymentWebhookRouter` üzerinden platform faturalamasına verir. Aynı webhook tekrar gelirse `alreadyProcessed` döner.

### `studio_paid` atfı
- Olay platform kiracısında, sahibin telefonuyla bulunan kişi (Contact) üzerine yazılır; kaynak `{ kind: 'studio_activation', id: <studioId> }` olduğu için **işletme başına bir kez** kaydedilir (tekrar ödeme, tekrar webhook veya yeniden deneme yeni olay üretmez).
- Değer, planın işletmenin faturalama para birimindeki liste fiyatı ve o para birimidir (G5c-1b, bölüm 9). Süper admin zorla etkinleştirmede `recordAsPaid` seçerse aynı kayıt aynı anahtarla yazılır (bölüm 4).
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
- Ya da işleyici açıkça `@AllowWhenRestricted()` ile işaretlidir. Bu liste üyenin kendi verisi ve KVKK/GDPR işlemleridir: seans iptali ve bekleme listesinden çıkma, çevrim içi seansa katılma, KVKK iletişim izni, sağlık verisi ayarları/onayı/silme/senkron, fatura bilgisi, ev şubesi, hedef ve liderlik tablosu tercihi, seans puanlama, gelen kutusu mesajı ve okundu, kayıtlı kart ekleme, abonelik iptali, video izleme, etkinlik kaydı iptali, davet oluşturma (üye daveti serviste ayrıca engellenir, personel daveti serbesttir).
- **Yoklama ve iptal (G5c-1b, sahip kararı):** daha önce alınmış rezervasyonların yoklaması ve iptali kısıtlı modda da açıktır, çünkü kısıtlama yeni iş almayı durdurmak içindir, müşteriye verilmiş sözü yarım bırakmak için değil. `@AllowWhenRestricted()` eklenen uç noktalar:
  - `PATCH /schedules/check-in/:bookingId` (geldi), `PATCH /schedules/no-show/:bookingId` (gelmedi), `POST /studios/:studioId/check-in/member-qr` (resepsiyonda üyenin QR'ı ile giriş);
  - `POST /schedules/cancel` (personelin rezervasyon iptali), `POST /schedules/waitlist/leave` (personelin bekleme listesinden çıkarması), `POST /schedules/:scheduleId/cancel-session` (seansın tamamını iptal);
  - etkinlikler: `POST /studios/:studioId/events/registrations/:registrationId/check-in`, `.../no-show`, `.../cancel` (personel) ve `POST /studios/:studioId/events/:eventId/cancel` (etkinliğin tamamını iptal).
  - Zaten açık olanlar değişmedi: üyenin kendi iptali (`POST /schedules/cancel/self`), bekleme listesinden kendi çıkması, etkinlik kaydını kendi iptali. Kiosk girişi (`POST /kiosk/check-in`), üyenin statik QR taraması (`POST /me/check-in/scan`) ve herkese açık API'den iptal (`POST /v1/public/bookings/:bookingId/cancel`) `@StudioScoped()` dışında olduğu için zaten engellenmiyordu.
  - Bu karar yalnızca `RESTRICTED` için alındı; ancak `BillingWriteGuard` `RESTRICTED` ve `CANCELLED` durumlarını aynı işler (`isWriteRestricted`), bu yüzden aynı uç noktalar `CANCELLED` işletmede de açıktır. Bilerek böyle bırakıldı: iptal edilmiş bir işletmenin de kalan seanslarını iptal edebilmesi ve yoklamayı kapatabilmesi gerekir.
  - Bir iptal bekleme listesini otomatik doldurabilir (mevcut davranış); bu yeni satış değil, zaten kuyruğa girmiş bir talebin karşılanmasıdır.
- Diğer her yazma `403` ve gövdede `code: "BILLING_RESTRICTED"` döner: yeni rezervasyon ve seans, bekleme listesine ekleme, yer değiştirme, eğitmen ikamesi, satış ve ödeme, perakende, kampanya ve akış, üye ekleme ve davet, üyenin kendi rezervasyonu, paket satın alması, etkinlik oluşturma/yayımlama ve kaydı, ödül kullanımı. Yeni eklenen bir yazma uç noktası da, listeye eklenmedikçe, kısıtlı modda kapalıdır.
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
- `POST /admin/tenants/:studioId/billing-status` `{ status: 'ACTIVE' | 'RESTRICTED', planKey?, reason?, recordAsPaid? }`: ödemesiz etkinleştirme veya kısıtlama. Denetim: `billing.force_activate` / `billing.force_restrict`.
  - `recordAsPaid` (G5c-1b, varsayılan `false`): süper admin zorla etkinleştirmenin **ödeme yapan müşteri** sayılıp sayılmayacağını seçer (ör. havaleyle veya sözleşmeyle platform dışında ödeyen işletme). `true` ise normal etkinleştirmeyle aynı kod (`PlatformBillingService.recordPaidActivation`) çalışır: `studio_paid` dönüşümü aynı kaynak anahtarıyla (`studio_activation:<studioId>`), planın işletmenin faturalama para birimindeki liste fiyatı ve para birimiyle, aynı atıf kurallarıyla yazılır; tavsiye ödülü de aynı yoldan (`onReferredStudioActivated`) işletme başına bir kez verilir. İkinci bir çağrı (zaten etkin, ya da kısıtlayıp yeniden zorlama) ikinci bir dönüşüm veya ödül üretmez. Planın o para biriminde fiyatı yoksa istek `400 PLAN_PRICE_UNAVAILABLE` ile reddedilir ve durum değişmez. `false` ise eski davranış: `studio_paid` yazılmaz, ödül verilmez. `RESTRICTED` ile `recordAsPaid: true` gönderilirse `400`. Seçim denetim kaydında `recordAsPaid` ve `paidValue` (tutar, para birimi) olarak durur. Ödeme satırı (`platform_billing_payments`) oluşmaz.
- `PUT /admin/tenants/:studioId/billing-currency` `{ currency: 'TRY' | 'USD' | 'EUR' | 'GBP' | null, reason? }` (G5c-1b): işletmenin faturalama para birimini sabitler; `null` ülkeden türetmeye döner. Tamamlanmış ödemeden sonra da yapılabilir (sahibin yapamadığı geçersiz kılma budur); bekleyen ödeme varken para birimi değişmez (`409`). Denetim: `billing.currency_override` (önceki/yeni para birimi, `hadCompletedPayment`).
- `GET /admin/tenants/:studioId/billing`: işletmenin abonelik özeti.
- `GET` / `PUT /admin/billing/settings`: tavsiye ödülü (para birimi başına tutar veya ücretsiz ay). Süper admin panelinde `/admin/referrals` sayfasının "Tavsiye ödülü" bölümünden düzenlenir: tür seçimi, ücretsiz ayda ay sayısı, tutarda her faturalama para birimi için bir alan. Denetim: `billing.settings_update` (önceki ve yeni ayar).
- `GET /admin/business-referrals`: tüm işletme tavsiyeleri, toplamlar ve ödül ayarı.
- Plan formunda para birimi başına fiyat ve deneme süresi (`POST /admin/plans` `prices: [{ currency, priceMonthly }]`, `trialDays`). `prices` verilirse tam kümedir: listede olmayan para biriminin fiyatı silinir ve plan o para biriminde sunulmaz. Eski `priceMonthly` + `currency` girdisi bir sürüm boyunca kabul edilir (yalnızca o para biriminin fiyatını yazar/günceller); para birimi olmadan fiyat reddedilir. Yeni plan en az bir fiyat ister. `GET /admin/plans` her planı `prices` listesiyle döner.
- `GET /admin/tenants` her işletme için `countryCode`, `billingCurrency` (etkin) ve `billingCurrencyOverride` döner.
- Web: `/admin/tenants` (Abonelik sütunu: durum, faturalama para birimi ve kaynağı, işlemler; ödemesiz etkinleştirmede "Ödeme yapan müşteri olarak say" kutusu, para birimi değiştirme), `/admin/plans` (her para birimi için bir fiyat alanı), `/admin/referrals`.

## 5. İşletmeden işletmeye tavsiye

### Kod ve bağlantı
Her işletmenin tek bir platform düzeyi kodu vardır (`A-Z` ve `2-9`, karışan harfler yok, 8 karakter). Sahip `/tavsiye` sayfasında bağlantıyı (`<site>/<dil>?pw_ref=<KOD>`), kodu, kopyalama düğmesini, getirdiği işletmeleri ve kazandığı krediyi görür.

### Atıf
- Paylaşılan izleme sözleşmesine `pw_ref` parametresi eklendi (`REFERRAL_TRACKING_PARAM`, `TouchpointInput.ref`, `parseReferralParam`). Reklam kimliği değildir; UTM gibi analitik izinle saklanır (`touchpoints.ref_code`), hatalı kod sessizce atılır.
- Ziyaretçi platform sitesinde form doldurunca kişiye bağlanır (G1b). Süper admin işletmeyi aynı sahip telefonuyla oluşturduğunda, kişinin atıf penceresi içindeki son `pw_ref` temas noktası tavsiye eden işletmeyi belirler (kaynak `TOUCHPOINT`).
- Süper admin oluşturma formunda kodu elle de girebilir (kaynak `MANUAL`); bilinmeyen kod kayıt oluşturmaz, işletme oluşturmayı da engellemez.

### Ödül
- Yalnızca tavsiye edilen işletme **ödeme yaptığında** (etkinleştirme) yazılır; zorla etkinleştirmede yalnızca süper admin `recordAsPaid` seçerse yazılır (bölüm 4).
- Tavsiye edilen işletme başına bir kez: `studio_referrals.referred_studio_id` benzersiz, `SIGNED_UP -> REWARDED` koşullu güncelleme ve defter satırı aynı işlemde, defter anahtarı `referral-reward:<referredStudioId>`.
- Değer süper admin ayarıdır: ücretsiz ay sayısı veya para birimi başına tutar. **Varsayılan 1 ücretsiz aydır; bu sahip kararıdır (G5c-1b), kod değişikliği gerekmedi** (`DEFAULT_REFERRAL_REWARD`, tohumdaki ayar satırı da 1 ay).
- Tutar ödülü (G5c-1b) her platform faturalama para birimi için ayrı girilir (`amounts: [{ currency, amount }]`, tablo `platform_referral_reward_amounts`; gönderilen liste tam kümedir); tavsiye eden işletme ödülü **kendi faturalama para biriminde** alır. Ayarda o para birimi için tutar yoksa para çevrilmez ve ödül atlanmaz: o işletmeye varsayılan ödül (1 ücretsiz ay) yazılır ve sunucu günlüğüne nedeni yazılır. Bu daha güvenli seçenek olarak seçildi: atlamak, tavsiye edenin hak ettiği ödülü sessizce kaybettirirdi; ay kredisi ise para birimine bağlı değildir ve kötüye kullanım riski tutar ödülünden fazla değildir. Sahibin `/tavsiye` sayfası ödülü kendi para biriminde gösterir. G5c-1'de girilmiş tek tutarlı ayar migration ile tabloya tek satır olarak kopyalandı.

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
| `PUT /admin/tenants/:studioId/billing-currency` | süper admin |
| `GET /admin/tenants/:studioId/billing` | süper admin |
| `GET`, `PUT /admin/billing/settings` | süper admin |
| `GET /admin/business-referrals` | süper admin |

`billing.manage` yeni izindir ve **yalnızca sahibe** aittir (`OWNER_ONLY_PERMISSIONS`): `resolvePermissions` sahip olmayan rollerde bu anahtarı düşürür, rol düzenleyicisi göstermez, API rol şablonuna eklenmesini reddeder. Oturum (`/auth/me`) her üyelikte `billing: { status, trialEndsAt }` döner; web bandı buradan çizilir.

## 7. Kalan işler

- Dönemsel yenileme (aylık tahsilat, `PAST_DUE`, tahsilat hatasında yeniden deneme) ve fatura kesimi; kredinin yenilemede tüketilmesi bu motorla bağlanacak.
- Kart parmak iziyle kendi kendini tavsiye kontrolü (adaptör desteği gerekiyor).
- Mobil uygulamada deneme bandı ve etkinleştirme ekranı (mobil şimdilik yalnızca kısıtlı mod hatasını çevrilmiş gösterir).
- Kendi kendine kayıt (self-serve signup): bugün işletmeyi süper admin oluşturuyor; herkese açık kayıt eklendiğinde `startTrial` ve `recordSignup` aynı şekilde çağrılmalı.
- Daraltma migration'ı (bir sürüm sonra): `plans.price_monthly`, `plans.currency`, `platform_billing_settings.referral_reward_amount` ve `referral_reward_currency` sütunlarının silinmesi (kod artık yalnızca aynalama için yazıyor ve eski ayar satırını okuma geri düşüşü olarak kullanıyor; silmeden önce bu iki yer de kaldırılmalı).
- Platform sitesindeki fiyat bloğu fiyatları platform kiracısının faturalama para biriminde gösterir; ziyaretçinin ülkesine göre para birimi seçimi yok (bölüm 10, açık kararlar).
- Zaten etkin bir işletmeyi sonradan "ödeme yapan müşteri" olarak işaretlemek için ayrı bir işlem yok: süper admin kısıtlayıp `recordAsPaid` ile yeniden etkinleştirir (kayıt ve ödül yine en fazla bir kez).

## 8. Testler

- Shared: `packages/shared/src/billing.spec.ts` (kalan gün, durum geçişleri, hatırlatma eşikleri, kısıtlı mod izin listesi, ödül ve kredi hesabı, kendi kendini tavsiye, `pw_ref`; G5c-1b: ülke -> faturalama para birimi eşlemesi, süper admin seçimi, para birimi başına plan fiyatı ve ödül, varsayılan 1 ay ödül, `recordAsPaid` ve yeni hata kodları).
- API birim: `billing-write.guard.spec.ts` (G5c-1b: yoklama ve iptal uç noktaları işaretli, yeni rezervasyon uç noktaları işaretsiz), `platform-billing.service.spec.ts` (G5c-1b: `recordAsPaid` açık/kapalı, para birimi seçimi, fiyatı olmayan plan, tekrar çağrı), `conversion.service.spec.ts` (`studio_paid` atıf geri düşüşü).
- API e2e: `trial-activation.e2e-spec.ts` (G5c-1b: kısıtlı modda gelmedi, geldi, personel ve üye iptali, seans iptali gerçek rezervasyonlarla geçer, yeni rezervasyon ve bekleme listesi engelli kalır; TR işletmesi TRY, ABD işletmesi USD fiyatı olmayan planı göremez ve etkinleştiremez, süper admin EUR seçince EUR öder, DE işletmesi EUR türetir; ödemeden sonra sahibin ülke değişikliği `409 BILLING_CURRENCY_LOCKED`, süper admin geçersiz kılabilir), `b2b-referral.e2e-spec.ts` (G5c-1b: `recordAsPaid` olmadan dönüşüm ve ödül yok; `recordAsPaid` ile `studio_paid` ve EUR ödülü tam bir kez, tekrarlarda artmaz; kısıtlamada ve fiyatsız planda `400`), `admin.e2e-spec.ts` (plan fiyat listesi).
- Web: `lib/billing/banner.spec.ts`, `lib/bff/translate-error.spec.ts`, Playwright `e2e/billing-trial.e2e.ts` (bant, etkinleştirme, faturalama para birimi satırı, tavsiye sayfası; tohum durumunu değiştirdiği için CI'da her taze tohumda bir kez çalışır).
- Tohum: demo işletmeler `ACTIVE`; ek demo işletme "Nova Hareket Merkezi" 10 gün kalmış `TRIALING` (sahip `+905329900001`), Zen'in `ZENREF23` koduyla gelmiş. G5c-1b: Starter ve Pro planlarının üç para biriminde fiyatı var (Starter 1.490 TRY / 49 USD / 45 EUR / 39 GBP, Pro 3.490 TRY / 119 USD / 109 EUR / 95 GBP); demo işletmeler TR olduğu için TRY öder.

## 9. İşletmenin konumuna göre plan para birimi (G5c-1b)

Migration: `20261016000000_plan_prices` (yalnızca ileri ve yalnızca genişletme).

- **Tek liste:** `PLATFORM_BILLING_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP']` (`packages/shared/src/billing.ts`). Ülke eşlemesi veridir (`PLATFORM_BILLING_CURRENCY_BY_COUNTRY`): TR -> TRY, euro bölgesi üyeleri (AT, BE, BG, CY, DE, EE, ES, FI, FR, GR, HR, IE, IT, LT, LU, LV, MT, NL, PT, SI, SK) -> EUR, Birleşik Krallık ve Kraliyet bağımlılıkları (GB, GG, JE, IM) -> GBP, diğer her ülke -> USD (`platformBillingCurrencyOf`). Yeni bir para birimi eklemek: listeye bir eleman, eşlemeye o ülkeler ve süper adminin her plana o para biriminde fiyat girmesi; migration gerekmez.
- **İşletmenin faturalama para birimi:** `studioBillingCurrency({ billingCurrency, countryCode })`: süper adminin seçimi (`studios.billing_currency`) varsa o, yoksa ülkeden türetilen. Kiracının kendi `studios.currency` alanından (üyelerine sattığı para birimi) bağımsızdır.
- **Kilit:** tamamlanmış (veya bekleyen) bir platform ödemesi varken sahibin bölge ayarlarında ülkeyi değiştirmesi faturalama para birimini değiştirecekse istek `409` ve `code: "BILLING_CURRENCY_LOCKED"` ile reddedilir (web ve mobil `billing.error.BILLING_CURRENCY_LOCKED` ile çevirir). Para birimini değiştirmeyen ülke değişikliği serbesttir. Süper admin `PUT /admin/tenants/:studioId/billing-currency` ile her zaman geçersiz kılabilir. Özet (`GET /studios/:studioId/billing`) `billingCurrency` ve `billingCurrencyLocked` döner.
- **Fiyat seçen her yol `plan_prices` okur:** `/abonelik` plan listesi (yalnızca işletmenin para biriminde fiyatı olan planlar, fiyata göre sıralı; mevcut planın fiyatı yoksa `priceMonthly: null`), etkinleştirme ve ödeme (fiyat yoksa `400 PLAN_PRICE_UNAVAILABLE`), zorla etkinleştirmede `recordAsPaid` değeri, `TRIAL_ENDING` hatırlatmasına eklenen `{planPrice}` değişkeni (işletmenin dilinde `Intl` ile biçimlenir; hazır şablon metni WhatsApp onayı bozulmasın diye değişmedi, değişken kiracı/platform şablon düzenlemelerinde kullanılabilir), tavsiye tutar ödülü ve platform sitesindeki fiyat bloğu (platform kiracısının para birimi).
- **Kredi:** defter para birimi başına tutulur (G5c-1'deki gibi); para kredisi yalnızca aynı para birimindeki ödemeden düşülür, çevrilmez. Ücretsiz ay kredisi para biriminden bağımsızdır.
- **Plan listesi süper admin tarafında:** `/admin/plans` her para birimi için bir fiyat alanı gösterir; boş alan o para biriminde "sunulmuyor" demektir. `/admin/tenants` her işletmenin faturalama para birimini ve kaynağını (ülkeye göre veya elle seçildi) gösterir, "Para birimini değiştir" ile seçim yapılır.
- **Geriye dönük uyumluluk:** migration her mevcut plan için `plans.price_monthly` + `plans.currency` değerinden bir `plan_prices` satırı yazar; eski sürüm aynı sütunları okumaya devam edebilir, yeni sürüm bu sütunlara yalnızca bir fiyatın (listede ilk bulunan para birimi) aynasını yazar.

## 10. Sahip kararları (G5c-1b) ve açık kararlar

Karara bağlananlar:
1. **Tavsiye ödülünün varsayılanı 1 ücretsiz ay** olarak kalır (karar verildi; kod değişikliği yok).
2. **Kısıtlı modda yoklama ve rezervasyon iptali açıktır** (karar verildi; bölüm 3, uç nokta listesi). Yeni rezervasyon, bekleme listesine ekleme ve satış kapalı kalır. Kural `RESTRICTED` için alındı; guard `CANCELLED` durumunu aynı işlediği için orada da geçerlidir.
3. **Süper admin zorla etkinleştirmenin ödeme yapan müşteri sayılıp sayılmayacağını seçer** (`recordAsPaid`, varsayılan hayır; bölüm 4). Karar verildi.
4. **Plan fiyatı işletmenin ülkesine göre TRY, USD, EUR veya GBP** (bölüm 9). Karar verildi; GBP (GB ve GG, JE, IM) sahibin ek kararıyla eklendi.
6. **Tavsiye ödülü süper admin panelinden düzenlenir** (`/admin/referrals`, "Tavsiye ödülü"); tutar ödülü para birimi başınadır, tutarı olmayan para biriminde 1 ücretsiz ay yazılır (bölüm 5). Karar verildi.
5. `plans.currency` sütunundaki `'TRY'` varsayılanı kaldırıldı (G5c-1'de açık kalan madde).

**Açık karar: başka para birimleri.** Değerlendirme (uygulanmadı):
- Sağlayıcılar: Stripe (global) GBP, CHF, AED, SAR, PLN, SEK, NOK, DKK, CAD ve AUD dahil bu listenin tamamında tahsilat yapabilir; ancak her para biriminin ayrı fiyat bakımı, ödeme hesabına geçerken döviz çevirme maliyeti ve o ülkenin vergi/fatura yükü (KDV, GST) vardır. iyzico ve PayTR Türkiye içindir; TRY dışında yalnızca sınırlı sayıda döviz destekler (kesin liste üye iş yeri sözleşmesine bağlıdır), bu yüzden TR dışı faturalamada Stripe esastır.
- Hedef pazarlar (`docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 7'de sahibin öncelik sırası henüz gelmedi; bugünkü bölge varsayılanları TR, ABD, Kanada, Birleşik Krallık, Almanya, Fransa, İspanya, İtalya, Hollanda ve BAE'yi kapsıyor).
- Öneri:
  - **GBP:** sahip kararıyla eklendi (Birleşik Krallık zaten ayrı uyum bölgesi ve vergi rejimi: `UK`, `UK_VAT`).
  - **İsviçre ve euro dışı Avrupa (CHF, PLN, SEK, NOK, DKK, ayrıca CZK, HUF, RON):** kendi para birimini eklemek yerine bu ülkeleri USD yerine **EUR** ile faturalamak daha doğal görünüyor (Avrupa'daki küçük işletmeler EUR fiyata alışık); bu yalnızca eşleme tablosunda birkaç satırlık değişikliktir. Sahip karar verirse uygulanabilir.
  - **AED ve SAR:** ikisi de USD'ye sabitli; USD fiyatı bu pazarlarda kabul görür. Körfez'de yerel pazarlama başlayana kadar gerek yok.
  - **CAD ve AUD:** Kanada ve Avustralya'da yerel fiyat dönüşümü artırır, ancak yalnızca o pazara aktif olarak girilecekse (GST/HST kaydıyla birlikte) eklenmeli; o zamana kadar USD yeterli.
  - Kısaca: şimdilik TRY/USD/EUR/GBP yeterli; euro dışı Avrupa için EUR eşlemesi sahibin kararını bekliyor; CAD/AUD pazara girişle birlikte, AED/SAR gerekmiyor.
- Açık kalan diğer sorular:
  - Platform sitesindeki fiyat bloğu ziyaretçinin ülkesine göre para birimi seçsin mi? (Bugün platform kiracısının para birimi.)
  - Süper admin bir planın fiyatını değiştirdiğinde deneme veya etkin işletmelere bildirim gitsin mi, fiyat bir sonraki dönemden mi geçerli olsun? (Dönemsel yenileme motoru gelince karar gerekir.)
