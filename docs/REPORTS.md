# Raporlar (W13)

Bu doküman `reports` API modulunun ürettiği her metriği tam olarak tanımlar.
Uygulama: `apps/api/src/modules/reports`. Paylasilan tipler ve dogrulayicilar:
`packages/shared/src/types.ts` (rapor DTO'lari) ve
`packages/shared/src/validators.ts` (`ReportRangeSchema`, `ReportFiltersSchema`,
`RevenueGranularitySchema`).

## Ortak kurallar

- Tüm üç noktalar `GET /reports/studio/:studioId/<rapor>` altindadir, `reports.view`
  izni gerektirir ve `StudioScoped()` (JWT + `StudioTenantGuard` + `PermissionGuard`)
  ile korunur.
- Şube kısıtlı personel (`tenant.branchIds !== null`) yalnızca kendi şubelerinin
  ve şubesiz (studyo geneli) kayıtların verisini görür; bu, `branch-access.ts`
  ile aynı kuraldir (`apps/api/src/modules/branches/branch-access.ts`).
- `branchId` sorgu parametresi verilirse, çağıranın o subeye erişimi olmalıdır
  (aksi halde 403); erişimi varsa yalnızca o subenin verisi doner.
- Tarih aralığı `from`/`to` sorgu parametreleriyle verilir (`ReportRangeSchema`);
  verilmezse son 30 gün, aralık en fazla 1 yil olabilir, aksi halde 400.
- Para tutarları her zaman `Prisma.Decimal` ile toplanır ve ondalık dizgi
  (`"1234.56"`) olarak doner; kayan noktali (float) toplama kullanılmaz.
- Her rapor `?format=csv` ile UTF-8 BOM'lu, noktali virgulle ayrılmış, Türkçe
  basliklı bir CSV doner (Excel TR uyumlu). Aksi halde JSON doner.
- Zaman dilimi dönüşümleri her zaman `Studio.timezone` alanına göre yapilir ve
  SQL'de `AT TIME ZONE 'UTC' AT TIME ZONE <tz>` ile hesaplanır (veritabaninda
  saatler UTC'yi temsil eden `timestamp without time zone` olarak saklanır).
- Gelir brüt olarak raporlanır: tamamen iade edilmiş (REFUNDED) ödemeler de
  `total` içinde kalır. İade tutarları `refundTotal`, net gelir `netTotal`
  (`total - refundTotal`) alanındadır.

## 1. Doluluk (`GET /reports/studio/:studioId/occupancy`)

- **Güne göre (`byDay`)**: iptal edilmemis seanslar, studyo saatine göre gün
  bazinda gruplandır. `sessions` = seans sayısı, `capacity` = kapasitelerin
  toplami, `booked` = durumu `CONFIRMED`, `ATTENDED` veya `NO_SHOW` olan
  rezervasyon sayısı (yer kaplayan her rezervasyon), `attended` = durumu
  `ATTENDED` olanlar, `occupancy` = `booked / capacity` (kapasite 0 ise 0).
- **Hizmet türüne göre (`byServiceType`)**: aynı metrikler `ServiceType`
  bazinda.
- **İşi haritasi (`heatmap`)**: 7 (haftanın günü, 0 = Pazartesi .. 6 = Pazar,
  studyo saatine göre) x 24 (saat, studyo saatine göre) hücrelik tam matris;
  veri olmayan hücreler sıfırla doldurulur.

## 2. Gelir (`GET /reports/studio/:studioId/revenue`)

- Yalnizca `paymentStatus = COMPLETED` ödemeler sayılır.
- `granularity` sorgu parametresi `day` (varsayilan), `week` veya `month`
  olabilir; `byPeriod` bu aralıkta `paid_at` üzerinden `date_trunc` ile
  gruplandır (studyo saatine çevrilerek).
- `byMethod`: `Payment.paymentMethod` enum degerine göre toplam ve odeme
  sayısı.
- `byPackage`: odemenin bagli oldugu `MemberPackage.packageDefinitionId`'ye
  göre toplam; paketsiz ödemeler `packageDefinitionId: null`,
  `packageDefinitionName: "Paketsiz"` altinda toplanır.
- `total`: aralıktaki tüm tamamlanmış odemelerin toplami.

## 3. Üyeler (`GET /reports/studio/:studioId/members`)

- `activeMembers`: `Membership.status = ACTIVE` olan üye sayısı (sube
  filtresi varsa `MemberProfile.homeBranchId` üzerinden).
- `newMembers`: `Membership.joinedAt` aralık içinde olan aktif üyeler.
- `revenue`: aralıktaki tamamlanmış odemelerin toplami (aynı sube kapsami).
- `arpu`: `revenue / activeMembers` (aktif üye 0 ise "0.00").
- `churnedMembers`: bkz. "Kayıp (churn) ve yenileme tanımı" aşağıda.

## 4. Yenileme orani (`GET /reports/studio/:studioId/renewal`)

- **Taban kume**: her üyenin, `MemberPackage.endDate` değeri aralık içinde
  olan **en son biten** paketi (`DISTINCT ON (member_id) ... ORDER BY
  end_date DESC`). Bu kumenin büyüklüğü `expiredPackages`.
- **Yenilendi mi?**: o üyenin, bu paketin bitiminden **sonra** başlayan bir
  sonraki paketi var mi ve başlangıcı bitişten en fazla **14 gün** sonra mi?
  Evet ise yenilenmiş sayılır (`renewedPackages`).
- `renewalRate = renewedPackages / expiredPackages` (payda 0 ise 0).
- Saf hesaplama `apps/api/src/modules/reports/report-calculations.ts`
  icindeki `isRenewed` / `isChurned` / `computeRenewalRate` fonksiyonlarinda
  birim testlidir.

### Kayıp (churn) ve yenileme tanımı

Bir üye, yukarıdaki taban kümedeki paketi icin 14 gün içinde yeni bir paket
almamışsa (hiç almamış olsa da olur) **kaybedilmiş (churned)** sayılır.
`churnedMembers` bu kümedeki kaybedilen üye sayisidir (`isRenewed` false
olanlar = `isChurned` true olanlar).

## 5. Kohortlar (`GET /reports/studio/:studioId/cohorts`)

- Tarih aralığı almaz (`branchId` filtresi haric); her üyenin **ilk paket
  satın alma ayi** (`MIN(MemberPackage.startDate)`, aya yuvarlanmış) o
  üyenin kohortunu belirler.
- Her kohort icin, kohort ayindan itibaren en fazla 12 ay (dahil) icin
  "elde tutma (retention)" hesaplanır: bir üye o ay **aktif** sayılır eğer
  o ay iceren bir paketi varsa (`start_date <= ay <= end_date`, ay bazinda)
  **veya** o ay `ATTENDED` durumunda bir rezervasyonu varsa.
- `retention[0]` her zaman kohort ayının kendisidir (satın alma ayi, çoğu
  üye icin 1.0'a yakın olması beklenir; tanim gereği paketi olan herkes o ay
  aktiftir).
- Saf kohort insasi (gruplama + oran hesabi)
  `apps/api/src/modules/reports/report-calculations.ts` icindeki
  `buildCohorts` fonksiyonunda birim testlidir.

## 6. Egitmen performansi (`GET /reports/studio/:studioId/trainers`)

- `SessionSchedule.trainerId` dolu olan, iptal edilmemis, aralıktaki
  seanslar eğitmene göre gruplandır.
- `sessions`, `capacity`, `booked`, `attended`, `occupancy`: doluluk
  raporuyla aynı tanim, eğitmen bazinda.
- `noShows`: durumu `NO_SHOW` olan rezervasyon sayısı.
- `lateCancellations`: durumu `CANCELLED_LATE` olan rezervasyon sayısı.
- `substitutions`: `SessionSchedule.originalTrainerId` dolu ve o egitmenin
  kendi id'sinden farkli oldugu seans sayısı (yani bu eğitmen, planlanan
  baska bir egitmenin yerine derse girmis).

## CSV disa aktarma

`apps/api/src/common/csv.ts` (`toCsv`) her raporun kendi Türkçe basliklı
satirlarina donusturulmesiyle kullanilir (`apps/api/src/modules/reports/reports.csv.ts`).
Bicim: UTF-8 BOM onek, alanlar `;` ile ayrilir, satirlar `\r\n` ile biter,
`"`/`;`/satir sonu iceren alanlar RFC 4180'e göre tirnaklanir.

## Bilinen sinirlamalar / ileride yapilacaklar

- Buyuk veri hacimlerinde `member_packages(end_date)` ve
  `member_packages(start_date)` uzerinde ek indeks faydali olabilir; mevcut
  olcekte gerekli gorulmedi (bkz. `packages/database/prisma/migrations`,
  bu is icin ek migration eklenmedi).
