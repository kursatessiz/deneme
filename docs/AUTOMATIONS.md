# Otomatik Pazarlama ve Yaşam Döngüsü Akışları (W10)

Bu doküman, kiracıların tanımladığı otomasyon kurallarını, bu kuralları
15 dakikada bir değerlendiren zamanlayıcıyı ve at-most-once (en fazla bir kez)
teslimat garantisini anlatır. Her gönderim `NotificationsService.send()`
üzerinden gider (CLAUDE.md kural 8); İYS onayı hiçbir zaman atlanmaz (bkz.
`docs/MESSAGING.md`).

## Kural türleri

`packages/shared/src/automations.ts` içindeki `AutomationRuleParamsSchema`
(Zod ayrık birleşimi) altı türü doğrular. Kural 7 gereği bunlar enum değil,
her kiracının kendi `AutomationRule` satırlarıdır; şablon `templateKey`,
parametreler ve aktif/pasif durumu kiracı verisidir.

| Tür | Anlamı | Örnek `params` | İşlemsel mi? |
|-----|--------|-----------------|----------------|
| `WIN_BACK` | N gündür katılım yok ve aktif paket yok | `{ noAttendanceDays: 30, requireNoActivePackage: true }` | Hayır (pazarlama, İYS onayı gerekir) |
| `PACKAGE_EXPIRING` | Paket N gün içinde bitiyor veya kalan hak <= M | `{ daysBefore: 7 }` veya `{ remainingUnitsAtMost: 2 }` | Evet |
| `BIRTHDAY` | Üyenin doğum günü (N gün öncesinden) | `{ daysBefore: 0 }` | Hayır (pazarlama, İYS onayı gerekir) |
| `FIRST_CLASS_FOLLOW_UP` | Üyenin ilk ATTENDED rezervasyonundan N saat sonra | `{ hoursAfter: 24 }` | Evet |
| `BOOKING_REMINDER` | Rezervasyon başlamadan N saat önce | `{ hoursBefore: 2 }` | Evet |
| `NO_SHOW_FOLLOW_UP` | NO_SHOW olarak işaretlenen seanstan N saat sonra | `{ hoursAfter: 2 }` | Evet |

`isTransactional`, kural oluşturulurken türden türetilir
(`isTransactionalRuleType()`); yalnızca `WIN_BACK` ve `BIRTHDAY` pazarlama
mesajı sayılır ve `MessageTemplate.isTransactional=false` gerektirir. Diğer
dört tür üyenin kendi rezervasyon/paket deneyimiyle ilgilidir ve işlemsel
kabul edilir; İYS onayından bağımsız gönderilir.

## Mimari

```
JobsService.runAll(now)                       (her 15 dakikada bir, veya POST /admin/scheduler/run)
  -> AutomationRunnerService.runDueRules(now)
       her aktif AutomationRule için:
         -> stüdyonun saat dilimindeki now sessiz saatler içindeyse (21:00-09:00) tüm kural bu döngü için atlanır
         -> RuleEvaluator.findCandidates(studioId, params, now)  (sınırlı toplu sorgu, bkz. AUTOMATION_BATCH_LIMIT)
         -> her aday için:
              1. AutomationRun satırı INSERT edilir (ruleId, userId, targetRef, status=SKIPPED "processing")
                 -> unique (ruleId, userId, targetRef) ihlali: bu hedef daha önce işlendi, atla (en-fazla-bir-kez)
              2. NotificationsService.send({ studioId, userId, category, template: templateKey, params })
                 -> send() kendi içinde kanal sırası, kullanıcı tercihi ve (işlemsel değilse) İYS onayını uygular
              3. AutomationRun UPDATE edilir: SENT / SKIPPED (onay yok, tercih kapalı, şablon yok...) / FAILED (sağlayıcı hatası)
  -> DunningService.runDueRenewals(now)         (W6)
  -> ConsentService.syncPendingConsents()       (W7)
```

"Insert-first, then send" deseni idempotency garantisinin temelidir: bir
hedefi (`targetRef`, örn. bir `bookingId` veya `memberPackageId`) iki kez
işlemeye çalışan iki döngü (veya eşzamanlı iki çalıştırma), ikincisinde
unique kısıt ihlaliyle karşılaşır ve `NotificationsService.send()`'i hiç
çağırmaz.

### `targetRef` seçimi

- `BOOKING_REMINDER`, `NO_SHOW_FOLLOW_UP`, `FIRST_CLASS_FOLLOW_UP`: ilgili
  `bookingId`. Doğal olarak tek seferliktir.
- `PACKAGE_EXPIRING`: `memberPackageId`. Paket başına tek seferliktir.
- `BIRTHDAY`: `"<memberProfileId>:<yıl>"`. Yılda bir kez tekrarlanabilir.
- `WIN_BACK`: `"<memberProfileId>:<ISO hafta>"`. Koşul sürdüğü sürece haftada
  en fazla bir kez tekrarlanabilir (sonsuza dek susturmak yerine).

### Sessiz saatler

`packages/shared/src/automations.ts` içindeki `isWithinQuietHours()` ve
`deferForQuietHours()`, stüdyonun `timezone` alanına göre 21:00-09:00 yerel
saat aralığını hesaplar (`Intl.DateTimeFormat` ile, ek bağımlılık yok). Bir
kural bu aralıkta değerlendirilirse o döngü için tamamen atlanır (aday
sorgusu bile çalışmaz); bir sonraki 15 dakikalık döngüde saat 09:00'ı geçmiş
olacağından otomatik olarak "ertelenmiş" gönderim gerçekleşir. Hiçbir
`AutomationRun` satırı oluşturulmadığından bu bir sonraki döngüde tekrar
denenir.

## Zamanlayıcı (BullMQ) ve Redis olmadan çalışma

`apps/api/src/modules/jobs` tek bir BullMQ kuyruğu (`scheduler`) ve 15
dakikada bir tekrar eden tek bir iş (`run-scheduled-jobs`, concurrency 1)
tanımlar. Kuyruk, yalnızca `REDIS_URL` gerçek bir süreç ortam değişkeni
olarak tanımlıysa (`process.env.REDIS_URL`, modül yüklenirken okunur)
kaydedilir; üretimde bu zaten zorunludur (`apps/api/src/config/env.ts`,
`deploy/docker-compose.prod.yml`). Redis yokken (yerel geliştirme, testler)
hiçbir kuyruk/worker oluşturulmaz; aynı iş şu iki yoldan çağrılabilir:

- `JobsService.runAll(now?)` servis metodu (testler bunu kullanır)
- `POST /admin/scheduler/run` (süper admin, gövdede opsiyonel `{ now }`)

`JobsService.runAll()`, W10 otomasyonlarına ek olarak W6'nın dunning
işini (`DunningService.runDueRenewals`) ve W7'nin İYS onay senkronunu
(`ConsentService.syncPendingConsents`) da çalıştırır; bu üçü tek bir 15
dakikalık nabızda birleştirildi, ayrı kuyruklara gerek kalmadı. Üçü de
kendi idempotency/koşullu güncelleme mantığına sahip olduğundan tekrar
tekrar çağrılmaları güvenlidir.

Üretim kısıtları (CLAUDE.md, 6 GB RAM / 4 vCPU): tek süreç içi worker,
concurrency 1, kural başına sınırlı toplu sorgu (`AUTOMATION_BATCH_LIMIT =
200`, önizlemede 500).

## Uç noktalar (izin: `notifications.manage`)

Tümü `studios/:studioId/automation-rules` altında, `@StudioScoped()`:

- `GET /` - kuralları listeler
- `GET /:id` - tek kural
- `POST /` - kural oluşturur (`CreateAutomationRuleSchema`)
- `PUT /:id` - kuralı günceller
- `PATCH /:id/toggle` - aktif/pasif
- `GET /:id/preview` - dry run: `AutomationRun` oluşturmadan ve hiçbir şey
  göndermeden aday sayısını döndürür
- `GET /runs` - çalıştırma geçmişi (`ruleId`, `status`, `take`/`skip` filtreleri)
- `GET /stats` - kural başına son 30 günün gönderildi/atlandı/başarısız sayıları

Süper admin: `POST /admin/scheduler/run` (bkz. yukarıda).

## Varsayılan tohum (seed) verisi

`packages/database/prisma/seed.ts`, her kiracı için altı varsayılan kural
oluşturur; yalnızca `BOOKING_REMINDER` etkindir (diğerleri pasif, işletme
sahibi bilinçli olarak açar). Dört yeni küresel şablon eklendi: `BIRTHDAY`,
`WIN_BACK`, `FIRST_CLASS_FOLLOW_UP`, `NO_SHOW_FOLLOW_UP` (Türkçe metin,
WhatsApp ve SMS kanalları için). `WIN_BACK` ve `BIRTHDAY` şablonları
`isTransactional: false` ile oluşturulur; diğerleri (ve mevcut W7
şablonları) işlemsel kalır.

## Mobil

Hesabım > "Otomatik mesajlar" (yalnızca `notifications.manage` iznine sahip
kullanıcılara görünür: işletme sahibi ve bu izne sahip roller). Kural
listesi, her kural için aç/kapa anahtarı ve son 30 günün
gönderildi/atlandı/başarısız sayıları. Ekran:
`apps/mobile/app/(app)/hesabim/otomatik-mesajlar.tsx`.

## Bilinen sınırlamalar / sonraki adımlar

- `AutomationRule.channel` alanı şu an yalnızca saklanır; `send()`'e henüz
  iletilmiyor (kanal sırası hâlâ `Studio.notificationSettings`'ten geliyor).
  Kural başına kanal zorlamak istenirse `NotificationsService.send()`'e bir
  `channelOverride` parametresi eklenmesi gerekir.
- `BirthdayEvaluator`, doğum tarihini veritabanından bellek içine çekip
  ay/gün eşleşmesini JavaScript'te yapar (bounded fetch, `AUTOMATION_BATCH_LIMIT`
  ile sınırlı). Çok büyük kiracılarda bunun yerine
  `EXTRACT(MONTH FROM birth_date)` / `EXTRACT(DAY FROM birth_date)` kullanan
  ham bir SQL sorgusu daha verimli olur.
- `WIN_BACK` yeniden tetiklenme sıklığı ISO hafta kovasıyla sınırlanmıştır
  (haftada en fazla bir gönderim); işletme ihtiyacına göre bu kovanın
  boyutu (`isoWeekKey`) ayarlanabilir.
