# Eğitmen Hakediş Bordrosu (W14)

Bu doküman, dönemsel eğitmen hakedişinin nasıl hesaplandığını ve bir bordro
döneminin (`PayrollRun`) yaşam döngüsünü açıklar. Uygulama: `apps/api/src/modules/payroll`.

## Komisyon kuralı: kiracı verisi

CLAUDE.md kuralı gereği komisyon kuralları sabit kodlanmış değildir:
`CommissionRule` her stüdyonun kendi tablosudur (`name`, `type`, `value`).
Yalnızca kural *türü* (`CommissionType` enum'u) sistem genelinde sabittir,
çünkü hesaplama biçimi (sabit tutar mı, yüzde mi, maaş mı) koddur:

- `PER_SESSION_FIXED`: eğitmenin verdiği her seans için sabit bir tutar (`value`), katılımcı sayısından bağımsız.
- `PERCENTAGE`: seans gelirinin `value` yüzdesi (aşağıya bakınız).
- `MONTHLY_SALARY`: dönem başına sabit bir tutar; seans sayısından bağımsız, dönemde bir kez ödenir.

## Kural önceliği

Bir seansta uygulanacak kural şu sırayla belirlenir:

1. `ServiceType.commissionRuleId` (o seansın hizmet türüne özel kural) varsa **her zaman kazanır**.
2. Yoksa `TrainerProfile.commissionRuleId` (eğitmenin kendi varsayılan kuralı) kullanılır.
3. İkisi de yoksa o seans hakedişe hiçbir katkı yapmaz (0 TL), ama seans ve
   katılımcı sayaçlarına dahil edilir.

Bu, örneğin bir stüdyonun "EMS 20 dk" hizmetini her zaman sabit ücretle,
"Grup Reformer" hizmetini ise ciro yüzdesiyle ödemesine izin verir; aynı
eğitmen ikisini de verse bile.

## Eğitmen ikamesi (substitution)

`SessionSchedule.trainerId` seansı fiilen kim verdiyse odur; bir ikame
olduğunda planlanan eğitmen `originalTrainerId`'de saklanır ama hakedişi
**yalnızca `trainerId`** kazanır. Bordro hesaplaması `originalTrainerId`'i
hiçbir zaman okumaz.

## Yüzde bazlı kural: seans geliri (açık soru çözümü)

HANDOVER.md'de "yüzde bazlı hakediş için seans fiyat kaynağı tanımlanmalı"
açık sorusu şöyle çözülmüştür: gelir kaynağı, rezervasyonun **kullandığı üye
paketinin fiyatıdır**, seansın kendi bir fiyatı yoktur (seans türlerinin
fiyatı yoktur, yalnızca paketlerin fiyatı vardır).

Yüzde kuralı uygulanan bir seansta, dahil edilen her rezervasyon için:

```
birim fiyat = paket fiyatı / paketin toplam birimi        (SESSION_COUNT, CREDIT)
birim fiyat = paket fiyatı / geçerlilik gün sayısı         (TIME_UNLIMITED, 1 gün = 1 birim)
rezervasyon geliri = birim fiyat x tüketilen birim
seans geliri = rezervasyonların toplamı
hakediş = seans geliri x (value / 100)
```

`TIME_UNLIMITED` paketlerin birim sayısı yoktur (sınırsız giriş); bu yüzden
fiyat, paketin geçerlilik süresine (gün) bölünüp bir günlük değer birim
olarak kullanılır. Bu bir yaklaşıklamadır ve stüdyonun onayına açıktır;
farklı bir kural gerekiyorsa (örn. üyenin ayda ortalama katıldığı seans
sayısına bölmek) `unitPrice` hesaplaması `commission-calculator.ts`
içindeki tek yerden değiştirilebilir.

**Hangi rezervasyonlar dahil edilir:**

| Rezervasyon durumu | Tüketilen birim | Dahil mi? |
|---|---|---|
| `ATTENDED` | `unitsCharged` | Evet |
| `NO_SHOW` | `unitsCharged` | Evet (gelmeyen üye yine de birim/ücret öder) |
| `CANCELLED_LATE`, `penaltyUnits > 0` | `penaltyUnits` | Evet, yalnızca işletmenin kestiği ceza kadar |
| `CANCELLED_LATE`, `penaltyUnits = 0` | - | Hayır (birim tamamen iade edildi) |
| `CANCELLED_EARLY`, `CONFIRMED`, `WAITLIST` | - | Hayır |
| Paketsiz rezervasyon (`memberPackageId = null`) | - | Hayır, gelire 0 katkı |

## Yuvarlama

Ara toplamlar (birim fiyat, rezervasyon geliri, seans geliri) tam hassasiyetle
(`Prisma.Decimal`) taşınır; yuvarlama **yalnızca** bir bordro satırının nihai
brüt tutarında, yarıya-yukarı (half-up) kural ile iki ondalık basamağa
yapılır. Tutarlar API'den ondalık string olarak döner (örn. `"1500.00"`).

## Bordro dönemi yaşam döngüsü

```
DRAFT --generate (regenerate: satırları değiştirir)--> DRAFT
DRAFT --approve--> APPROVED (bundan sonra değiştirilemez)
APPROVED --mark-paid--> PAID
```

- Bir `PayrollRun`, `(studioId, branchId, periodStart, periodEnd)` için
  benzersizdir; `branchId` boşsa tüm stüdyoyu kapsar. Aynı anahtarla tekrar
  oluşturma isteği, çalıştırma hâlâ `DRAFT` ise satırları siler ve yeniden
  hesaplar (idempotent); `APPROVED`/`PAID` ise reddedilir.
- Onaylanmış (`APPROVED`/`PAID`) bir dönemle **çakışan** bir aralık için
  aynı şubede yeni bir çalıştırma oluşturmak veya onaylamak reddedilir
  (409), böylece aynı seans iki kez ödenmez.
- `APPROVED`/`PAID` bir çalıştırmanın satırları değişmez: düzeltme eklenemez,
  yeniden oluşturulamaz.
- `PAID` işaretlemek yalnızca `APPROVED` durumdaki bir çalıştırma için
  mümkündür.
- Manuel düzeltme (`adjustments`) yalnızca `DRAFT` durumda, bir açıklama
  (`note`) zorunluyla yapılabilir; satırın brüt tutarını değil netini
  değiştirir ve denetlenebilir (satırda saklanır).

## İzinler

- `commissions.view.all`: tüm bordro çalıştırmalarını okuma.
- `payroll.manage`: bordro oluşturma, düzeltme, onaylama, ödendi işaretleme.
- `commissions.view.own`: eğitmenin yalnızca kendi onaylanmış/ödenmiş
  satırlarını görmesi (`GET /payroll/studio/:studioId/me/lines`,
  `@SelfService`).

Varsayılan olarak yalnızca işletme sahibi rolü (`owner`) `payroll.manage` ve
`commissions.view.all` iznine sahiptir; stüdyo bunları başka rollere de
verebilir.

## Uç noktalar

Taban yol: `/payroll/studio/:studioId`.

| Yöntem ve yol | İzin | Açıklama |
|---|---|---|
| `POST /runs` | `payroll.manage` | Taslak oluştur/yeniden oluştur (`{ periodStart, periodEnd, branchId? }`) |
| `GET /runs` | `commissions.view.all` | Çalıştırmaları listele (`?branchId`, `?status`) |
| `GET /runs/:runId` | `commissions.view.all` | Çalıştırma ve satırları |
| `GET /runs/:runId/export.csv` | `commissions.view.all` | CSV dışa aktarım (UTF-8 BOM, `;` ayraç, Türkçe başlıklar) |
| `PATCH /runs/:runId/lines/:lineId/adjust` | `payroll.manage` | Manuel düzeltme (`{ amount, note }`) |
| `POST /runs/:runId/approve` | `payroll.manage` | Onayla |
| `POST /runs/:runId/mark-paid` | `payroll.manage` | Ödendi işaretle |
| `GET /me/lines` | `commissions.view.own` (`@SelfService`) | Kendi onaylı/ödenmiş satırları |

## CSV biçimi

UTF-8 BOM ile başlar, `;` ayraçlıdır, başlık satırı:
`Eğitmen;Seans;Katılımcı;Brüt;Düzeltme;Net`.
