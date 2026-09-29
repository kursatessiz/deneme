# CRM ve Atıf (G1b)

Bu belge, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.1 (CRM), 3.2 (atıf), 3.3 (giden kuyruk tablosu) ve 5 (platform kiracısı) maddelerinin G1b fazında nasıl uygulandığını anlatır. Bağlayıcı tasarım o belgedir; bu belge uygulamanın ayrıntısıdır.

## 1. Özet

- Aday (`Lead`) ve üye artık tek bir **Kişi** (`Contact`) satırında birleşir. Kiracı başına her tanınan kişi bir satırdır.
- Satış hattı aşamaları enum değil, kiracı verisidir (`PipelineStage`). Her kiracı altı sistem aşamasıyla başlar.
- Web sitesi ziyaretleri birinci taraf çerezleriyle (`pw_vid`, `pw_sid`) ve **yalnızca izin verildikten sonra** temas noktası (`Touchpoint`) olarak kaydedilir.
- Form, deneme, üyelik ve ödeme gibi olaylar **dönüşüm olayı** (`ConversionEvent`) olarak idempotent biçimde yazılır ve son temas noktasına atfedilir.
- Reklam platformlarına geri bildirim için giden kuyruk (`ConversionDelivery`) hazırdır; gönderim işi G2b'dedir.
- Platformun kendi pazarlaması, `isPlatform = true` işaretli ve slug'ı `platform` olan kiracının içinden aynı modüllerle yapılır.
- Eski `/leads` uç noktaları, aynı istek/yanıt biçimleri ve izinlerle kişiler üzerinde çalışan **kullanımdan kaldırılmış (deprecated)** sarmalayıcılar olarak kalır.

## 2. Veri modeli

| Model | Açıklama |
|---|---|
| `Contact` | Ad, soyad, telefon (E.164), e-posta, dil, ülke, saat dilimi, yaşam döngüsü (`LEAD`, `TRIAL`, `MEMBER`, `LAPSED`, `LOST`), satış hattı aşaması, sorumlu personel, şube, etiketler (GIN index), özel alanlar (JSON), bağlı üyelik (`membershipId`, üyelik başına tek kişi), ilk/son temas noktası ve hızlı raporlama için ilk/son kaynak özeti (`firstSource`, `firstMedium`, `firstCampaignName`, `firstCampaignId`, `firstAdsetId`, `firstAdId` ve `last*` karşılıkları), elle girilen kanal (`sourceChannel`: WEB_FORM, INSTAGRAM, WALK_IN, REFERRAL, PHONE, OTHER...), eski aday alanları (ilgi duyulan hizmet, kayıp nedeni, takip tarihi, tavsiye kodu, notlar), `isTest`, `mergedIntoId` |
| `ContactActivity` | Zaman çizelgesi: NOTE, CALL, MESSAGE, STAGE_CHANGE, TRIAL_BOOKED, LIFECYCLE, MERGE, FORM, TASK, CONVERSION |
| `ContactFieldDefinition` | Kiracının özel alanı: anahtar, dile göre etiket (`{ "tr": "Hedef", "en": "Goal" }`), tür (`string`, `number`, `date`, `boolean`, `enum`; segment kural dilindeki türlerin alt kümesi), seçenekler |
| `PipelineStage` | Anahtar, isteğe bağlı ad, tür (`OPEN`, `WON`, `LOST`), sıra, sistem işareti. Sistem aşamaları: NEW, CONTACTED, TRIAL_BOOKED, TRIAL_DONE, WON, LOST. Adı boş bir sistem aşaması arayüzde `crm.stage.<anahtar>` çevirisiyle gösterilir; sistem aşamaları silinemez |
| `ContactTask` | Başlık, not, bitiş zamanı, atanan personel üyeliği, durum (OPEN, DONE, CANCELLED) |
| `Visitor` | `(studioId, id)` birincil anahtarı; `id` = `pw_vid` çerezi. İlk/son görülme, tanındıysa kişi |
| `Touchpoint` | Ziyaretçi, oturum, zaman, açılış host'u ve **yalnızca yolu** (sorgu dizesi ve parça atılır), yönlendiren **yalnızca host**, UTM kolonları, reklam platformu, `pw_cid`/`pw_asid`/`pw_adid`/`pw_plc`, tıklama kimlikleri ve `fbp`/`fbc` (**yalnızca reklam izniyle**), dil, kaba ülke kodu (**IP saklanmaz**), cihaz türü, sayfa varyantı, etiketsiz ücretli trafik işareti, kişi |
| `ConversionEvent` | Tür, zaman, kişi, tutar (`Decimal`) + para birimi, `eventId` (işletme başına benzersiz), `sourceKind` + `sourceId` (işletme başına benzersiz; idempotency anahtarı), `isTest`, atfedilen temas noktası |
| `ConversionDelivery` | Giden kuyruk: olay, hedef (`META_CAPI`, `GOOGLE_ADS`, `TIKTOK_EVENTS`, `LINKEDIN_CAPI`), durum, deneme sayısı, sonraki deneme zamanı, son hata |
| `Studio.isPlatform` | Platform kiracısı; en fazla bir satır `true` olabilir |

Prisma şemasında ifade edilemeyen kısıtlar migration SQL'indedir: `(studio_id, phone)` ve `(studio_id, lower(email))` üzerinde, birleştirilmemiş kişilerle sınırlı kısmi benzersiz index'ler ve tek platform kiracısı index'i. Drift kontrolü (`prisma migrate diff --exit-code`) kısmi ve ifade index'lerini yok saydığı için temiz geçer.

Paylaşılan sözleşmeler `packages/shared` içindedir: `src/growth` (G0: `TouchpointInputSchema`, `parseTrackingParams`, `detectAdPlatform`, `isUntaggedPaidTraffic`, `CONVERSION_EVENT_TYPES`, `ConversionEventSchema`, `LIFECYCLE_STAGES`, çerez adları) ve `src/crm.ts` (G1b: kişi, alan, aşama, görev şemaları, `DEFAULT_PIPELINE_STAGES`, atıf raporu sorgusu ve DTO'ları).

## 3. Veri taşıma (migration `20260929000000_crm_attribution`)

Tek, yalnızca ileri yönlü bir migration:

1. Yeni tablolar, enum'lar ve index'ler; `studios.is_platform`.
2. İzinler: `leads.view` iznine sahip her rol şablonuna `crm.view`, `leads.manage` iznine sahip her rol şablonuna `crm.manage` eklenir. `crm.export` yalnızca işletme sahibinde (sahip her izne zaten sahiptir).
3. Platform kiracısı: `platform` slug'ı veya işaretli bir kiracı yoksa `Platform` adıyla eklenir. Aynı slug'ı kullanan başka bir kiracı varsa satır eklenmez (elle çözülmesi gerekir).
4. Veri: `crm_backfill_contacts()` SQL fonksiyonu oluşturulur ve çalıştırılır. Fonksiyon idempotenttir; seed de aynı fonksiyonu çağırır, e2e testleri de onu doğrular.
   - Her kiracıya altı sistem aşaması.
   - Her `Lead` -> `Contact`: aynı işletme + telefon için tek kişi. Açık aday (yoksa en son güncellenen) kazanır ve **kişi, adayın kimliğini (id) korur**; böylece eski bağlantılar çalışmaya devam eder. Aynı telefondaki diğer adaylar kişiye MERGE notu olarak eklenir. Aşama aynı anahtarlı `PipelineStage`'e, kaynak `sourceChannel`'a, UTM alanları ilk ve son kaynak kolonlarına taşınır. Yaşam döngüsü: WON -> MEMBER, LOST -> LOST, TRIAL_BOOKED/TRIAL_DONE -> TRIAL, diğerleri -> LEAD. Dönüştürülmüş adayın `converted_membership_id` değeri `membershipId` olur. Aynı e-posta ikinci kişide boş bırakılır (benzersizlik).
   - Her `LeadActivity` -> `ContactActivity` (id korunur).
   - Üye profili olan her üyelik (partner misafirleri hariç) -> kişi. Telefonu bir aday kişisiyle eşleşirse o kişiye bağlanır, yoksa yeni kişi açılır. Yaşam döngüsü MEMBER; **daha önce paketi olup hiçbiri artık aktif olmayan** üyeler LAPSED. Hiç paket almamış üyeler MEMBER kalır (canlı akışta yeni üye de MEMBER olarak açıldığı için tutarlılık gereği; bkz. bölüm 10).
5. `leads` ve `lead_activities` tabloları **yerinde ve değişmeden** kalır, uygulama artık onlara yazmaz. Daraltma (contract) adımı bir sonraki sürümdür: bu iki tablo, `LeadSource`/`LeadStage`/`LeadActivityType` enum'ları, `leads.*` izinleri, `/leads` sarmalayıcıları ve `crm_backfill_contacts()` fonksiyonu birlikte kaldırılır.

Geri alma (rollback) güvenliği: önceki sürüm `leads` tablosunu okumaya devam eder, ancak bu sürüm sonrasında açılan adayları göremez. Otomatik rollback yalnızca yayın hatasında birkaç dakika içinde tetiklendiği için bu pencere kabul edilmiştir.

## 4. API

Tüm CRM uçları `crm/studios/:studioId` altındadır, `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` ile korunur ve servisler her sorguyu `tenant.studioId` ile filtreler (birleştirilmiş kişiler her yerde gizlidir).

| Uç nokta | İzin |
|---|---|
| `GET contacts` (filtre: `stage`, `lifecycleStage`, `ownerMembershipId`, `branchId`, `tag`, `source`, `search`, `includeTest`, sayfalama; en fazla 100) | `crm.view` |
| `GET contacts/:contactId` (etkinlikler, görevler, temas noktaları, dönüşümler) | `crm.view` |
| `POST contacts`, `PATCH contacts/:contactId` (aşama taşıma LOST için neden ister, yaşam döngüsünü türetir; özel alanlar tanımlara göre doğrulanır) | `crm.manage` |
| `POST contacts/:contactId/tags` (`add`, `remove`), `GET tags` (kullanım sayılarıyla) | `crm.manage` / `crm.view` |
| `POST contacts/:contactId/activities` (NOTE, CALL, MESSAGE) | `crm.manage` |
| `POST contacts/merge` (`survivorId`, `mergedId`; denetim kaydına `contact.merge` yazılır) | `crm.manage` |
| `GET contacts/export` (CSV, UTF-8 BOM, noktalı virgül, formül enjeksiyonuna karşı korumalı, en fazla 50.000 satır) | `crm.export` |
| `GET/POST/PATCH/DELETE pipeline-stages` | `crm.view` / `crm.manage` |
| `GET/POST/PATCH/DELETE fields` | `crm.view` / `crm.manage` |
| `GET tasks` (`status`, `assigneeMembershipId`, `overdue`), `POST contacts/:contactId/tasks`, `PATCH tasks/:taskId` | `crm.view` / `crm.manage` |
| `GET attribution?model=&from=&to=&groupBy=` | `crm.view` |

Birleştirme kuralları: kalan kişi kendi değerlerini korur, boş alanlarını birleştirilen kişiden doldurur; etiketler birleşir; özel alanlarda kalan kişi kazanır; etkinlik, görev, ziyaretçi, temas noktası ve dönüşümler kalan kişiye taşınır; yaşam döngüsü ikisinden daha ileride olanıdır (MEMBER > LAPSED > TRIAL > LEAD > LOST). İki kişinin de üyelik hesabı varsa birleştirme reddedilir (409).

Herkese açık uçlar:
- `POST /track/:studioSlug/touchpoint` (bölüm 5).
- `POST /public/studios/:slug/leads` (web formu; artık kişi oluşturur, `lead` dönüşümü yazar ve ziyaretçiyi tanır).

Herkese açık bir `identify` ucu **yoktur**: tanımlama yalnızca sunucu tarafında, kişi oluşturan veya bulan bir form, rezervasyon ya da kayıt isteği ziyaretçi kimliğini taşıdığında olur.

### `/leads` uyumluluk katmanı (kullanımdan kaldırıldı)

`/leads/*` uçları aynı istek ve yanıt biçimleri ve aynı izinlerle (`leads.view`, `leads.manage`) çalışır; mevcut web `/adaylar` ve mobil `potansiyel-uyeler` ekranları değişmeden kullanır. Bir "aday", bir satış hattı aşamasındaki kişidir; `stage` aşama anahtarı, `source` `sourceChannel`, `utm*` ilk kaynak kolonları, `convertedMembershipId` kişi WON aşamasındayken bağlı üyeliktir. Eski ileri yönlü aşama kuralları (`canTransitionLeadStage`) korunur. Aynı telefonla açık bir kişi varsa yeni başvuru not olarak eklenir (`deduplicated: true`); kişi satış hattında değilse veya kaybedildiyse NEW aşamasına geri alınır. Yeni istemciler `/crm` uçlarını kullanır.

## 5. Ziyaret takibi

**İstemci** (`apps/web/src/lib/tracking`, `apps/web/src/components/consent`): ürün sayfası `/` (slug `platform`), gömülü widget `/embed/<slug>` ve herkese açık rezervasyon sayfaları `/<slug>/...` üzerinde çalışır.

- `pw_vid`: anonim ziyaretçi kimliği, 13 ay (395 gün). `pw_sid`: oturum, 30 dakika hareketsizlikte biter (her sayfa görüntülemede uzar).
- İki çerez de yalnızca analiz izni verildiğinde yazılır; izin reddedilir veya geri alınırsa silinir. Tercihin kendisi zorunlu çerez `pw_consent` (180 gün) içinde tutulur.
- Temas noktası her oturumun ilk sayfasında ve URL takip parametresi taşıdığında gönderilir.
- Formlar ve rezervasyonlar ziyaretçi kimliğini `X-PW-VID` başlığıyla gönderir (API farklı kökende olduğu için çerez oraya gitmez; API aynı alan adındaysa `pw_vid` çerezi de okunur).

**Sunucu** (`apps/api/src/modules/crm/tracking`):

- Gövde `TouchpointInputSchema` ile doğrulanır; geçerli her istek 204 döner (bilinmeyen slug, bot, izin yokluğu ve başarılı kayıt dışarıdan ayırt edilemez).
- `consent.analytics` false ise hiçbir şey saklanmaz. `consent.advertising` false ise tıklama kimlikleri ve `fbp`/`fbc` atılır; kampanya kimlikleri ve UTM değerleri saklanır.
- Açılış URL'sinden yalnızca host ve yol saklanır; yönlendirenden yalnızca host (aynı site ise boş).
- User-Agent'a göre bot filtresi (bilinen tarayıcı botları, önizleme ve izleme servisleri, komut satırı istemcileri, eski headless mod; boş User-Agent da bot sayılır).
- Ülke yalnızca kenar vekil başlığından (`CF-IPCountry` veya Caddy'nin ayarlayabileceği `X-Country-Code`) alınır; IP adresi hiçbir yerde saklanmaz.
- Hız sınırı: IP başına dakikada 60, ziyaretçi başına dakikada 20 istek (Redis; Redis yoksa tek örnek bellek içi sayaç).

**Tanımlama ve atıf**: bir form, deneme, davet kabulü veya kayıt bir kişi oluşturduğunda ya da bulduğunda, istek ziyaretçi kimliğini taşıyorsa ziyaretçi kişiye bağlanır, ziyaretçinin kişisiz temas noktaları kişiye eklenir ve kişinin özeti yenilenir: ilk temas = kişinin en eski temas noktası, son temas = atıf penceresi (`DEFAULT_ATTRIBUTION_WINDOW_DAYS`, 30 gün) içindeki en yeni temas noktası. Pencere içinde temas yoksa son temas kolonları değişmez. Tanınmış bir ziyaretçinin sonraki ziyaretleri de kişinin son temasını günceller.

## 6. Çerez izni bandı

Bölge sırasıyla şuradan çözülür: `CF-IPCountry` / `X-Country-Code` başlığı, `Accept-Language` içindeki bölge alt etiketi (`tr-TR` -> TR), hiçbiri yoksa **en katı davranış (AB)**.

| Bölge | Davranış |
|---|---|
| AB/AEA, Birleşik Krallık, Kanada | Açık rıza: Tümünü kabul et / Tümünü reddet / Tercihleri seç (analiz, reklam). İzinden önce hiçbir takip çerezi yazılmaz, hiçbir istek gönderilmez. Google Consent Mode v2 varsayılanı `denied` |
| Türkiye | KVKK aydınlatma metni, kabul ve ret (ve tercih seçimi); izinden önce hiçbir şey yazılmaz ve gönderilmez |
| ABD ve diğerleri | Bilgilendirme bandı; takip hemen başlar. Global Privacy Control sinyali reklam iznini her durumda kapatır; bant reklam çerezlerini kapatma seçeneği sunar |

Reklam izni analiz izni olmadan verilemez. GPC, kaydedilmiş bir tercihten bile önce gelir. Tüm metinler `consent.*` i18n anahtarlarıdır (tr + en). Bant, varsayılan kiracı temasının tasarım token'larıyla çizilir.

## 7. Yaşam döngüsü ve iş kancaları

`apps/api/src/modules/crm/lifecycle.ts` kuralları: üyelik ve ödeme her zaman MEMBER yapar; yalnızca MEMBER olan LAPSED olur; deneme yalnızca LEAD veya LOST kişiyi TRIAL yapar; yeni başvuru yalnızca LOST kişiyi LEAD yapar; kayıp yalnızca LEAD veya TRIAL kişiyi LOST yapar. Her değişiklik bir LIFECYCLE etkinliği yazar.

Mevcut servislere eklenen küçük, açık kancalar (`CrmHooksService`; olay veri yolu çerçevesi yok). Kancalar iş işlemi tamamlandıktan sonra çalışır, hataları yalnızca loglar ve **iş işlemini asla engellemez veya başarısız kılmaz**:

| Nerede | Ne olur |
|---|---|
| Personel üye oluşturur (`MembersService.createMember`), davet kabul edilir (üye rolü), aday üyeliğe dönüştürülür | Kişi telefon/e-postayla bulunur veya açılır, üyeliğe bağlanır, MEMBER |
| Aday için deneme seansı ayarlanır (`/leads/:id/trial`) | TRIAL, `trial_booked` |
| Rezervasyona giriş yapılır (personel, QR, kiosk) | Kişi TRIAL ise `trial_attended`; TRIAL_BOOKED aşamasındaki kart TRIAL_DONE'a geçer |
| Ödeme COMPLETED olur (paket satışı, online ödeme, havale onayı, ödeme webhook'u, üye paketi atama) | `purchase` (tutar ve para birimiyle); deneme paketi TRIAL, diğerleri MEMBER |
| Abonelik tahsilatı (dunning) | İlk tahsilat `subscription_started`, sonrakiler `subscription_renewed` |
| Zamanlayıcı (15 dakikalık kalp atışı) | Aktif veya dondurulmuş, süresi dolmamış paketi ve çalışan aboneliği kalmayan MEMBER kişiler LAPSED |
| Süper admin kiracı oluşturur | Varsayılan aşamalar; platform kiracısında sahibin telefonu biliniyorsa `studio_signup` |

Herkese açık bir rezervasyon kayıt akışı henüz yoktur (gömülü widget rezervasyon yapmaz, ilk kez gelen ziyaretçiyi web formuna yönlendirir); bu akış eklendiğinde aynı `onMemberJoined` kancası ve ziyaretçi kimliği kullanılır.

## 8. Dönüşümler

`ConversionService.record()` `(studioId, sourceKind, sourceId)` üzerinde idempotenttir: aynı kaynağın ikinci kaydı (tekrar denenen kanca, iki kez gönderilen form, yeniden gelen webhook, eşzamanlı istekler) mevcut satırı döndürür. `eventId` verilmezse kaynaktan kararlı biçimde türetilir (`<tür>.<sha256>`), böylece tarayıcı pikseli aynı kimliği kullanabilir.

| Tür | `sourceKind` / `sourceId` |
|---|---|
| `lead` | `lead_contact` / kişi kimliği (kişi başına bir kez) |
| `trial_booked` | `trial_booking` / rezervasyon |
| `trial_attended` | `trial_attendance` / rezervasyon |
| `purchase` | `payment` / ödeme |
| `subscription_started`, `subscription_renewed` | `subscription_payment` / ödeme |
| `studio_signup` (yalnızca platform kiracısı) | `studio` / yeni kiracı |
| `studio_paid` (yalnızca platform kiracısı) | çağıranın verdiği fatura referansı |

- Olay yazılırken atıf penceresi içindeki son temas noktası `attributedTouchpointId` olarak saklanır.
- `isTest` kişi test ise otomatik true olur; test olayları raporlara girmez ve kuyruğa yazılmaz. Bir kişi `PATCH .../contacts/:id` ile `isTest: true` işaretlenebilir.
- `recordSafely()` hiçbir zaman hata fırlatmaz; iş akışları bunu kullanır.
- `recordStudioSignup(newStudioId, ownerPhone)` ve `recordStudioPaid(studioId, reference, value)` platform kiracısı içindir. `studio_signup` süper admin kiracı oluşturduğunda çağrılır; `studio_paid` platform faturalaması eklendiğinde bağlanacaktır.

**Giden kuyruk**: olay yazıldıktan sonra `ConversionOutboxService.enqueue()` kiracının bağlı reklam platformlarını `AdConnectionResolver` üzerinden sorar ve her biri için bir PENDING `ConversionDelivery` yazar. Henüz hiçbir kiracının bağlantısı olmadığından (G2b `AdAccount` modelini ve gerçek çözücüyü ekleyecek) şu an hiç satır yazılmaz; fonksiyon ve testleri hazırdır.

## 9. Atıf raporu

`GET /crm/studios/:studioId/attribution?model=FIRST_TOUCH|LAST_TOUCH|LINEAR&from=<ISO>&to=<ISO>&groupBy=source|campaign|adset|ad`

- Varsayılanlar: `model=LAST_TOUCH`, `groupBy=source`. `from` < `to` zorunlu; aralık `[from, to)`.
- Test kişileri ve test olayları hariç tutulur.
- **FIRST_TOUCH**: kişinin olaydan önceki en eski temas noktası (pencere uygulanmaz).
- **LAST_TOUCH**: olaydan önceki 30 gün içindeki en yeni temas noktası.
- **LINEAR**: pencere içindeki her temas noktası eşit pay alır; sayılar kesirli olabilir (dört ondalık), gelir de aynı oranda bölünür.
- Uygun temas yoksa olay `(direct)` (kaynak) veya `(none)` (kampanya, reklam seti, reklam) altına yazılır. Hiç temas noktası olmayan kişiler (ör. taşınan adaylar) kişideki ilk/son kaynak özetine düşer.
- Gruplama anahtarları: kaynak = `utm_source`, yoksa reklam platformu, yoksa yönlendiren host; kampanya = `pw_cid`, yoksa `utm_id`, yoksa `utm_campaign`; reklam seti = `pw_asid`; reklam = `pw_adid`. Kimlikler kullanıldığı için reklam adı değişse bile rapor bozulmaz.
- Yanıt: her anahtar için tür başına dönüşüm sayısı ve para birimi başına gelir (ondalık dizge), toplamlar ve aralıktaki etiketsiz ücretli trafik (tıklama kimliği var ama `pw_cid` + `pw_asid` yok) sayısı.

## 10. Kararlar ve sınırlar

- **Tekilleştirme**: işletme başına telefon başına tek kişi. Eski "WON veya LOST sonrası aynı telefonla yeni aday" davranışı yerine mevcut kişi yeniden satış hattına alınır.
- **LAPSED**: hiç paket almamış üye MEMBER sayılır; paketleri olup hepsi bitmiş üye LAPSED olur (hem taşımada hem zamanlayıcıda aynı kural).
- **Partner misafirleri** gerçek üyeliğe geçene kadar kişi olarak açılmaz (pazarlama dışı tutulurlar).
- **Kişi başına tek üyelik**: `membershipId` global benzersizdir (üyelik zaten tek işletmeye aittir).
- **Atıf penceresi** şimdilik sabit 30 gündür; kiracı ayarı olarak açılması G2b ile birlikte ele alınacaktır.
- **API hata mesajları** mevcut API kalıbıyla Türkçe dizgedir; kullanıcıya görünen web metinleri (izin bandı, aşama, yaşam döngüsü, alan türü ve görev durumu etiketleri) i18n anahtarlarıdır.
- **Tam CRM arayüzü** (kişi listesi, kart, satış hattı panosu) G2a ile geldi: `/kisiler`, `/kisiler/[id]`, `/kisiler/satis-hatti` (bkz. `docs/WEB_PANEL.md` ve `docs/KAMPANYA_VE_AKISLAR.md`). Eski "Adaylar" ekranı `/leads` uyumluluk uçlarıyla çalışmaya devam eder.
- **Kişi düzeyinde ticari izin** (G2a): `contact_consents`; `GET/PUT /crm/studios/:studioId/contacts/:contactId/consents` (`crm.view` / `crm.manage`, izin verirken kanıt notu zorunlu); kişi detayı `consents` alanını da döndürür. Gönderimde kişi kaydı ile üyenin kendi kaydının en son kararı geçerlidir.
- **Akış olayları** (G2a): `ConversionService` her yeni dönüşümü, rezervasyon kancaları (`CrmHooksService.onBookingEvent`) oluşturma/iptal/gelmeme/katılımı, etiket ekleme ve gelen cevaplar `GrowthEventsService` üzerinden akış motoruna iletilir; hatalar yutulur, iş akışını asla bozmaz.

## 11. Nasıl test edilir

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test          # birim testleri (shared, api, web, mobile)

# Postgres + Redis çalışırken
export DATABASE_URL=postgresql://u:pw@localhost:5432/g1b_test
cd packages/database
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm db:seed                                 # aşamalar, kişiler, platform kiracısı dahil

cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js

cd ../web
pnpm exec playwright test --reporter=list
```

İlgili testler:

- Birim: `apps/api/src/modules/crm/**/*.spec.ts` (yaşam döngüsü, atıf pencereleri ve modelleri, takip yardımcıları, izin denetimi, idempotent dönüşümler ve giden kuyruk, birleştirme kuralları, satış hattı varsayılanları, `/leads` sarmalayıcıları), `packages/shared/src/crm.spec.ts`, `apps/web/src/lib/tracking/tracking.spec.ts` (bölge, izin durumu, gönderim kuralları).
- API e2e: `crm.e2e-spec.ts` (tüm CRM uçlarında kiracı izolasyonu ve izinler, kişi işlemleri, birleştirme, CSV, görevler, kancalar, idempotency, form üzerinden tanımlama, kurgulanmış senaryoda atıf raporu sayıları), `tracking.e2e-spec.ts` (izin denetimi, yol temizleme, bot, platform slug'ı, hız sınırları), `crm-migration.e2e-spec.ts` (seed verisi üzerinde taşıma sonuçları ve yeni eski-kayıtlarla fonksiyonun yeniden çalıştırılması), `leads.e2e-spec.ts` (HTTP istek ve yanıt beklentileri değişmedi; yalnızca doğrudan veritabanı kontrolleri artık `contacts` tablosunu okuyor).
- Web e2e: `apps/web/e2e/consent.e2e.ts` (AB kabul/ret/tercih, TR KVKK, ABD + GPC).

Test paketleri oluşturdukları her şeyi siler; art arda iki kez geçer.
