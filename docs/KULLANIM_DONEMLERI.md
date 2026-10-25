# Kullanım dönemleri (dönemlik hak kotası)

İşletme sahibinin açıp kapatabildiği bir özelliktir: bir paketin hakları dönemlere (ay, hafta veya gün sayısı) bölünür. Her dönemin kendi kotası vardır ve dönem içinde kullanılmayan hak ya yanar ya da yalnızca kullanım üst sınırı olarak kalır. Örnek: 8 seanslık bir üyeliğin haftada en fazla 2 seansla, ayda 8 hak olarak kullanılması.

Kod: `packages/shared/src/usage-periods.ts` (kural şeması ve saf dönem hesabı), `apps/api/src/modules/usage-periods/` (servis, kontrolcü, günlük iş), uygulama noktaları `schedules.service.ts` ve `events/event-seats.service.ts`. Ekranlar (web paneli ve mobil uygulama) "Ekranlar" bölümünde anlatılır; ortak metin üretimi `packages/shared/src/usage-periods-labels.ts` içindedir.

## Kavramlar

- **Katman (tier)**: tek bir dönem birimi. `MONTH` (1-12), `WEEK` (1-8) veya `DAYS` (1-366) uzunluğunda; `quota` (en az 1) bir dönemde kullanılabilecek hak sayısıdır (SESSION_COUNT için seans birimi, CREDIT için kredi, süre bazlı sınırsız paket için ziyaret).
- **Hakkı yak (`expireUnused`)**: `true` ise dönem bitince kullanılmayan kota yanar (paketin `remainingUnits` değeri düşer). `false` ise katman yalnızca üst sınırdır, hiçbir şey yanmaz.
- **Kural (`UsageRule`)**: `version: 1`, 1 veya 2 katman (farklı birimlerde; kısa dönemin kotası uzun dönemin kotasını aşamaz, kısa dönem uzundan kısa olmalıdır) ve `reminderDaysBefore` (0-14, varsayılan 3, 0 = hatırlatma kapalı).
- **Ay modu**: `CALENDAR` (bir sonraki ayın aynı günü; ay sonuna sıkıştırılır, çapa günü korunur: 31 Ocak, 28/29 Şubat, 31 Mart) veya `FIXED_DAYS` (sahibin seçtiği 30 ya da 31 gün; birden fazla ay için gün sayısı ayla çarpılır).
- Sınırsız (TIME_UNLIMITED) paketlerde yalnızca `expireUnused: false` kabul edilir ("haftada en fazla 2 ziyaret"); her rezervasyon 1 ziyaret sayılır.

## Örnekler

1. **3 aylık 24 seanslık paket**: ayda 8 hak (kullanılmayan yanar) ve haftada en fazla 2 seans (yalnızca üst sınır).

   ```json
   { "version": 1, "reminderDaysBefore": 3, "tiers": [
     { "unit": "MONTH", "length": 1, "monthMode": "CALENDAR", "quota": 8, "expireUnused": true },
     { "unit": "WEEK", "length": 1, "quota": 2, "expireUnused": false } ] }
   ```

2. **Aylık abonelik, 8 seans, haftada en fazla 2**: tek bir yenileme dönemi için aynı kural; abonelik her yenilendiğinde yeni satış sayılır ve kural yeniden kopyalanır.

3. **Sınırsız üyelik, haftada en fazla 3 ziyaret**: tek `WEEK` katmanı, `quota: 3`, `expireUnused: false`.

## Dönemler nasıl hesaplanır

- Dönemler takvim haftasına veya ayına değil, `MemberPackage.startDate` (satın alma veya yenileme başlangıcı) tarihine çıpalıdır.
- **Saat dilimi**: takvim ayı hesabı işletmenin saat diliminde (`studios.timezone`, IANA) yapılır; böylece "ayın aynı günü" üyenin satın alma anında gördüğü gündür ve saat korunur. Sabit uzunluklu katmanlar (hafta, gün, sabit gün ayı) 24 saatin katlarıdır. Bir dönemin hangi dönem olduğunu seansın başlangıç saati belirler (rezervasyon zamanı değil).
- **Sınır tam anında**: tam sınır anı yeni döneme aittir (dönem sonu dışlayıcıdır).
- **Dondurma**: dondurulan süre dönem süresinden sayılmaz. Hesap "etkin zaman" üzerinden yapılır: duvar saati eksi dondurulan süre. Dondurma kayıtları `package_freeze_history` tablosundan okunur (erken çözülen dondurmada bitiş çözme anına çekilmiştir). Dondurma başlangıcından sonraki her sınır dondurma süresi kadar ileri kayar; tam dondurma başlangıcına denk gelen sınır dondurmadan önce kalır.

## Tüketim nasıl sayılır

Bir seans veya etkinlik kaydının dönem içindeki tüketimi, gerçekten `remainingUnits` değerinden çıkan miktardır (`netUnitsConsumed`):

- Canlı (CONFIRMED) ve katıldı (ATTENDED) rezervasyonlar: `unitsCharged`.
- İptal (erken veya geç) ve gelmedi: yalnızca `penaltyUnits` (kalanı iptal politikasına göre iade edilmiştir; ücretsiz iptal kotayı geri verir).
- Sınırsız paket: canlı, katıldı veya gelmedi rezervasyon 1; iptal 0.
- Etkinlik kayıtları (kredi biletleri): `unitsCharged - refundedUnits`, etkinliğin başlangıç tarihine göre.
- Daha kısa bir katmanın yaktığı hak, içinde bittiği daha uzun dönem için tüketilmiş sayılır: ay yakımı = `max(0, kota - tüketim - içindeki haftalık yakımlar)`; yakım hiçbir zaman paketin kalan hakkını aşmaz. Kısa dönemin yakımı, bitiş anı uzun dönemin `(başlangıç, bitiş]` aralığına düşüyorsa o döneme sayılır.
- Kapsam dışı: video içerikleri (`video_views` hangi paketten kredi düşüldüğünü saklamaz); video kredi harcamaları ne kota kontrolüne ne tüketime girer, yakım ise yine kalan hakla sınırlıdır.

## Şalter ve paket başına kural

- **Stüdyo şalteri** `studios.usage_periods_enabled` (varsayılan kapalı). Yalnızca işletme sahibi değiştirir: `PUT /studios/:studioId/usage-periods` gövde `{ "enabled": true }`; sahip olmayan, `studio.settings.manage` iznine sahip olsa bile 403 alır (`apiErrors.studios.onlyOwnerCanChangeUsagePeriods`). Okuma: `GET` aynı yol, `studio.settings.view`. Her değişiklik `studio.usagePeriods.enable` veya `studio.usagePeriods.disable` denetim kaydı yazar.
- **Paket tanımı kuralı** `package_definitions.usage_rule`: `PATCH /catalog/package-definitions/:id/usage-rule` gövde `{ "usageRule": {...} | null }` (`catalog.manage`). Şalter kapalıyken de saklanır ama etkisi yoktur. Doğrulama paylaşılan Zod şemasıyla (`UsageRuleSchema`) yapılır; sınırsız pakette yakan katman 400 verir.
- **Şalter kapalıyken** her kural çalışma anında yok sayılır: kota yok, yakım yok, hatırlatma yok; daha önce satılmış paketler için de. Şalter yeniden açılınca anlık kopyası olan paketlerde kural yeniden etkin olur; şalterin en son açıldığı andan (`studios.usage_periods_enabled_at`) önce biten dönemler geriye dönük yakılmaz. Dönemin kotasındaki tüketim şalter kapalıyken yapılanları da kapsar (açılınca mevcut dönemde kota dolu çıkabilir).

## Yalnızca yeni satış ve yenileme (anlık kopya)

Kural, satış veya yenileme anında `member_packages.usage_rule` alanına kopyalanır (yalnızca şalter açıkken ve tanımın kuralı varsa): `members.assignPackage`, çevrimiçi satın alma (`payments`) ve abonelik yenileme (`dunning`). Daha önce satılmış paketler özgün koşullarını korur; tanım kuralının sonradan değiştirilmesi satılmış paketleri etkilemez. Şalter kapalıyken yapılan satış anlık kopya taşımaz.

## Kota denetimi

Üye paketi aktif kurala sahipse, ücret düşen her yol aynı denetimden geçer: her katmanda (seansın dönemi için) `tüketim + yakılan + birim maliyeti <= kota` olmalıdır.

- Seans rezervasyonu (personel, üye, bekleme listesi terfisi): paket adı verilmediğinde otomatik seçimde kotası dolu paket kullanılamaz sayılır (`packageUnusableReason` = `periodQuota`) ve üyenin başka paketi seçilir. Başka uygun paket yoksa `apiErrors.schedules.periodQuotaReached` hatası döner: "Bu paketin {dönem} hakkı doldu; {tarih} tarihinde yenilenir." Paket adı verilmişse aynı hata döner.
- Yarış güvenliği: denetim ve birim düşümü aynı işlemde yapılır; kuralı olan pakette önce `member_packages` satırı `SELECT ... FOR UPDATE` ile kilitlenir (`studio_id` ile). Kuralı olmayan pakette kilit alınmaz.
- Bekleme listesi terfisinde kotası dolu üye atlanır ve listede kalır (`WAITING`), sıradaki denenir.
- Etkinlik kredi biletleri (kayıt ve bekleme listesi terfisi) aynı denetimden geçer; adı verilmemişse kotası dolu paket atlanır, terfide kota dolu ise normal "kredi yok" akışı işler.
- Sınırsız pakette her rezervasyon 1 ziyaret olarak denetlenir.

## Günlük yakım işi

`JobsService` kalp atışında `usagePeriods` adımı (`UsagePeriodsJobsService`), `trackingRetention` gibi günlük kapılıdır: bir tur boşalınca 23 saat bekler (bellek içi; yeniden başlatmada bir kez daha çalışması zararsızdır, iş idempotenttir). Şalteri açık işletmelerde `ACTIVE` ve kuralı olan paketler 100'lük sayfalarla, bir kalp atışında en fazla 10 sayfa işlenir; kalan sonraki kalp atışında devam eder.

Her paket için tek işlemde (paket satırı kilitli): yakan katmanlar önce kısa dönemden uzuna; bitmiş (`end <= şimdi`, paket bitiş tarihini aşmayan) ve henüz kaydı olmayan her dönem için `units = clamp(kota - tüketim - kısa yakımlar, 0, kalan)` hesaplanır, `package_unit_expiries` satırı yazılır (0 birimli dönem de yazılır; böylece yeniden değerlendirilmez) ve `remaining_units` aynı işlemde düşer. Kalan 0 olursa durum `DEPLETED` olur. Benzersiz anahtar `(member_package_id, tier_unit, period_start)` işi idempotent yapar. Paket bitiş tarihine denk gelen son (kırpılmış) dönem için yakım satırı yazılmaz; orada normal süre dolumu işler. Yakım satırları değişmezdir: sonradan yapılan bir iade yakılmış hakkı geri getirmez, yalnızca iade edilen birimi bakiyeye döndürür. `used_units` yakımda değişmez (yakım kullanım değildir); toplam yakılan miktar `expiredUnits` olarak sunulur.

## Üye hatırlatması

Aynı günlük adımda: yakan bir katmanın mevcut dönemi `reminderDaysBefore` gün içinde bitiyorsa, dönem paket bitişinden önce bitiyorsa ve kullanılmayan (yanacak) hak 0'dan büyükse üyeye `USAGE_PERIOD_EXPIRY_REMINDER` şablonuyla (tr ve en, `msgTpl` ad alanı; değişkenler `packageName`, `units`, `periodEnd`) mesaj gider. Mesaj işlemseldir (pazarlama izni ve sessiz saat uygulanmaz), mesajlaşma motoru üzerinden `IN_APP` ve `PUSH` kanallarıyla gönderilir (SMS yok) ve üyenin `PACKAGE` bildirim kategorisi tercihine uyar. Motor ilk başarılı kanalda durduğu için iki kanal ayrı gönderim olarak, `usage-reminder:<memberPackageId>:<tierUnit>:<periodStart ISO>:<IN_APP|PUSH>` idempotency anahtarıyla gönderilir; böylece paket, katman ve dönem başına bir kez gider.

## DTO ve uç noktalar

- `MemberPackageDTO.usagePeriods`: her katmanın mevcut dönemi (`unit`, `length`, `periodStart`, `periodEnd` (paket bitişine kırpılmış), `quota`, `used` (yakılanlar dahil), `remaining`, `expireUnused`); kural etkin değilse `null`. `MemberPackageDTO.expiredUnits`: yakım geçmişinin toplamı. Üye kendi paket listesinde (`GET /members/self/packages`) ve personel üye kartında (`GET /members/:memberId/studio/:studioId`) görür.
- `GET /members/packages/:packageId/unit-expiries` (`members.view`): paketin yakım geçmişi.

## Veri modeli

Bkz. `docs/DATABASE_ERD.md`: `studios.usage_periods_enabled`, `package_definitions.usage_rule`, `member_packages.usage_rule`, `package_unit_expiries`. Migration `20261107000000_usage_periods` yalnızca genişletir (ileri yönlü).

## Ekranlar

Metinler `usagePeriods` ad alanındadır (tr ve en); özet cümleleri ve dönem satırları `packages/shared/src/usage-periods-labels.ts` içinde üretilir, web ve mobil aynı yardımcıyı kullanır. Miktar adları iş türü kelime dağarcığından değil, hak türünden gelir (seans, kredi, giriş). Tarihler etkin dile göre `Intl` ile biçimlenir.

- **Web, işletme ayarları** (`/ayarlar/isletme`, `components/usage-periods/UsagePeriodsSwitchCard.tsx`): "Kullanım dönemleri" şalter kartı. `studio.settings.view` olan herkes görür; yalnızca sahip değiştirebilir, diğerleri şalteri kapalı (devre dışı) ve açıklama notuyla görür. Karttan paket tanımlarına bağlantı vardır.
- **Web, paket tanımları** (`/packages`, `components/usage-periods/UsageRuleEditor.tsx`): her tanımın altında kural özeti ve düzenleyici (`catalog.manage`). En fazla 2 katman; katman başına birim (Ay, Hafta, Gün), uzunluk, ay hesabı (takvim ayı, sabit 30, sabit 31), kota (etiketi hak türüne göre), "Kullanılmayan haklar dönem sonunda yansın" (sınırsız pakette kapalı ve devre dışı) ve hatırlatma günü (0-14). Canlı özet cümlesi yazılırken güncellenir; doğrulama paylaşılan `UsageRuleSchema` ile istemcide yapılır (`lib/usage-periods/rule-form.ts`), sunucu hataları mevcut hata eşlemesiyle gösterilir. Şalter kapalıyken kuralın yok sayıldığı notu görünür. Kural yalnızca yeni satış ve yenilemelere uygulanır.
- **Web, üye kartı** (`/members/[memberId]`, `UsagePeriodStatus.tsx`): kuralı etkin her paket kartında katman başına mevcut dönem (kullanılan/kota, yenilenme tarihi, "Yanar" veya "Üst sınır" rozeti), yakılacak hak yaklaşıyorsa (7 gün) uyarı satırı, toplam yanan hak ve `GET /members/packages/:id/unit-expiries` ile yüklenen yanma geçmişi açılır listesi.
- **Mobil**: `PackageCard` aynı satırları gösterir ("Bu ay: 5/8 kullanıldı. Yenilenme: 12 Kasım", rozet, yakın yanma ipucu, toplam yanan hak). Üye kendi paketlerini Hesabım > Ödemelerim ekranındaki "Paketlerim" bölümünde, personel üye kartında görür (`src/lib/usagePeriodLines.ts`).
- **Kota dolu hatası**: `apiErrors.schedules.periodQuotaReached` web (BFF çevirisi, `BffError.message`) ve mobilde (`ApiError.message`) rezervasyon formlarında mevcut hata alanında çevrilmiş olarak görünür.
