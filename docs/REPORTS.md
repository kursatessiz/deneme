# Raporlar (W13)

Bu dokuman `reports` API modulunun urettigi her metrigi tam olarak tanimlar.
Uygulama: `apps/api/src/modules/reports`. Paylasilan tipler ve dogrulayicilar:
`packages/shared/src/types.ts` (rapor DTO'lari) ve
`packages/shared/src/validators.ts` (`ReportRangeSchema`, `ReportFiltersSchema`,
`RevenueGranularitySchema`).

## Ortak kurallar

- Tum uc noktalar `GET /reports/studio/:studioId/<rapor>` altindadir, `reports.view`
  izni gerektirir ve `StudioScoped()` (JWT + `StudioTenantGuard` + `PermissionGuard`)
  ile korunur.
- Sube kisitli personel (`tenant.branchIds !== null`) yalnizca kendi subelerinin
  ve subesiz (studyo geneli) kayitlarin verisini gorur; bu, `branch-access.ts`
  ile ayni kuraldir (`apps/api/src/modules/branches/branch-access.ts`).
- `branchId` sorgu parametresi verilirse, cagiranin o subeye erisimi olmalidir
  (aksi halde 403); erisimi varsa yalnizca o subenin verisi doner.
- Tarih araligi `from`/`to` sorgu parametreleriyle verilir (`ReportRangeSchema`);
  verilmezse son 30 gun, aralik en fazla 1 yil olabilir, aksi halde 400.
- Para tutarlari her zaman `Prisma.Decimal` ile toplanir ve ondalik dizgi
  (`"1234.56"`) olarak doner; kayan noktali (float) toplama kullanilmaz.
- Her rapor `?format=csv` ile UTF-8 BOM'lu, noktali virgulle ayrilmis, Turkce
  basliklı bir CSV doner (Excel TR uyumlu). Aksi halde JSON doner.
- Zaman dilimi donusumleri her zaman `Studio.timezone` alanina gore yapilir ve
  SQL'de `AT TIME ZONE 'UTC' AT TIME ZONE <tz>` ile hesaplanir (veritabaninda
  saatler UTC'yi temsil eden `timestamp without time zone` olarak saklanir).
- `Payment.refundedAmount` sutunu su an semada yok; varsa (ileride odeme
  isiyle eklenirse) `revenue` raporu `refundTotal` alanini doldurur, yoksa
  `null` doner. Bu kontrol `information_schema.columns` uzerinden calisma
  zamaninda yapilir, koda sabit kodlanmaz.

## 1. Doluluk (`GET /reports/studio/:studioId/occupancy`)

- **Gune gore (`byDay`)**: iptal edilmemis seanslar, studyo saatine gore gun
  bazinda gruplanir. `sessions` = seans sayisi, `capacity` = kapasitelerin
  toplami, `booked` = durumu `CONFIRMED`, `ATTENDED` veya `NO_SHOW` olan
  rezervasyon sayisi (yer kaplayan her rezervasyon), `attended` = durumu
  `ATTENDED` olanlar, `occupancy` = `booked / capacity` (kapasite 0 ise 0).
- **Hizmet turune gore (`byServiceType`)**: ayni metrikler `ServiceType`
  bazinda.
- **Isi haritasi (`heatmap`)**: 7 (haftanin gunu, 0 = Pazartesi .. 6 = Pazar,
  studyo saatine gore) x 24 (saat, studyo saatine gore) hucrelik tam matris;
  veri olmayan hucreler sifirla doldurulur.

## 2. Gelir (`GET /reports/studio/:studioId/revenue`)

- Yalnizca `paymentStatus = COMPLETED` odemeler sayilir.
- `granularity` sorgu parametresi `day` (varsayilan), `week` veya `month`
  olabilir; `byPeriod` bu aralikta `paid_at` uzerinden `date_trunc` ile
  gruplanir (studyo saatine cevrilerek).
- `byMethod`: `Payment.paymentMethod` enum degerine gore toplam ve odeme
  sayisi.
- `byPackage`: odemenin bagli oldugu `MemberPackage.packageDefinitionId`'ye
  gore toplam; paketsiz odemeler `packageDefinitionId: null`,
  `packageDefinitionName: "Paketsiz"` altinda toplanir.
- `total`: araliktaki tum tamamlanmis odemelerin toplami.

## 3. Uyeler (`GET /reports/studio/:studioId/members`)

- `activeMembers`: `Membership.status = ACTIVE` olan uye sayisi (sube
  filtresi varsa `MemberProfile.homeBranchId` uzerinden).
- `newMembers`: `Membership.joinedAt` aralik icinde olan aktif uyeler.
- `revenue`: araliktaki tamamlanmis odemelerin toplami (ayni sube kapsami).
- `arpu`: `revenue / activeMembers` (aktif uye 0 ise "0.00").
- `churnedMembers`: bkz. "Kayip (churn) ve yenileme tanimi" asagida.

## 4. Yenileme orani (`GET /reports/studio/:studioId/renewal`)

- **Taban kume**: her uyenin, `MemberPackage.endDate` degeri aralik icinde
  olan **en son biten** paketi (`DISTINCT ON (member_id) ... ORDER BY
  end_date DESC`). Bu kumenin buyuklugu `expiredPackages`.
- **Yenilendi mi?**: o uyenin, bu paketin bitiminden **sonra** baslayan bir
  sonraki paketi var mi ve baslangici bitisten en fazla **14 gun** sonra mi?
  Evetse yenilenmis sayilir (`renewedPackages`).
- `renewalRate = renewedPackages / expiredPackages` (payda 0 ise 0).
- Saf hesaplama `apps/api/src/modules/reports/report-calculations.ts`
  icindeki `isRenewed` / `isChurned` / `computeRenewalRate` fonksiyonlarinda
  birim testlidir.

### Kayip (churn) ve yenileme tanimi

Bir uye, yukaridaki taban kumedeki paketi icin 14 gun icinde yeni bir paket
almamissa (hic almamis olsa da olur) **kaybedilmis (churned)** sayilir.
`churnedMembers` bu kumedeki kaybedilen uye sayisidir (`isRenewed` false
olanlar = `isChurned` true olanlar).

## 5. Kohortlar (`GET /reports/studio/:studioId/cohorts`)

- Tarih araligi almaz (`branchId` filtresi haric); her uyenin **ilk paket
  satin alma ayi** (`MIN(MemberPackage.startDate)`, aya yuvarlanmis) o
  uyenin kohortunu belirler.
- Her kohort icin, kohort ayindan itibaren en fazla 12 ay (dahil) icin
  "elde tutma (retention)" hesaplanir: bir uye o ay **aktif** sayilir eger
  o ay iceren bir paketi varsa (`start_date <= ay <= end_date`, ay bazinda)
  **veya** o ay `ATTENDED` durumunda bir rezervasyonu varsa.
- `retention[0]` her zaman kohort ayinin kendisidir (satin alma ayi, cogu
  uye icin 1.0'a yakin olmasi beklenir; tanim geregi paketi olan herkes o ay
  aktiftir).
- Saf kohort insasi (gruplama + oran hesabi)
  `apps/api/src/modules/reports/report-calculations.ts` icindeki
  `buildCohorts` fonksiyonunda birim testlidir.

## 6. Egitmen performansi (`GET /reports/studio/:studioId/trainers`)

- `SessionSchedule.trainerId` dolu olan, iptal edilmemis, araliktaki
  seanslar egitmene gore gruplanir.
- `sessions`, `capacity`, `booked`, `attended`, `occupancy`: doluluk
  raporuyla ayni tanim, egitmen bazinda.
- `noShows`: durumu `NO_SHOW` olan rezervasyon sayisi.
- `lateCancellations`: durumu `CANCELLED_LATE` olan rezervasyon sayisi.
- `substitutions`: `SessionSchedule.originalTrainerId` dolu ve o egitmenin
  kendi id'sinden farkli oldugu seans sayisi (yani bu egitmen, planlanan
  baska bir egitmenin yerine derse girmis).

## CSV disa aktarma

`apps/api/src/common/csv.ts` (`toCsv`) her raporun kendi Turkce basliklı
satirlarina donusturulmesiyle kullanilir (`apps/api/src/modules/reports/reports.csv.ts`).
Bicim: UTF-8 BOM onek, alanlar `;` ile ayrilir, satirlar `\r\n` ile biter,
`"`/`;`/satir sonu iceren alanlar RFC 4180'e gore tirnaklanir.

## Bilinen sinirlamalar / ileride yapilacaklar

- `Payment.refundedAmount` sutunu henuz yok (W6 odeme isiyle gelmesi
  bekleniyor); geldiginde `revenue.refundTotal` otomatik doldurulacaktir.
- Buyuk veri hacimlerinde `member_packages(end_date)` ve
  `member_packages(start_date)` uzerinde ek indeks faydali olabilir; mevcut
  olcekte gerekli gorulmedi (bkz. `packages/database/prisma/migrations`,
  bu is icin ek migration eklenmedi).
