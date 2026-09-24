# Raporlar (W13)

Bu doküman `reports` API modülünün ürettiği her metriği tam olarak tanımlar.
Uygulama: `apps/api/src/modules/reports`. Paylaşılan tipler ve doğrulayıcılar:
`packages/shared/src/types.ts` (rapor DTO'lari) ve
`packages/shared/src/validators.ts` (`ReportRangeSchema`, `ReportFiltersSchema`,
`RevenueGranularitySchema`).

## Ortak kurallar

- Tüm uç noktalar `GET /reports/studio/:studioId/<rapor>` altındadır, `reports.view`
  izni gerektirir ve `StudioScoped()` (JWT + `StudioTenantGuard` + `PermissionGuard`)
  ile korunur.
- Şube kısıtlı personel (`tenant.branchIds !== null`) yalnızca kendi şubelerinin
  ve şubesiz (stüdyo geneli) kayıtların verisini görür; bu, `branch-access.ts`
  ile aynı kuraldır (`apps/api/src/modules/branches/branch-access.ts`).
- `branchId` sorgu parametresi verilirse, çağıranın o şubeye erişimi olmalıdır
  (aksi halde 403); erişimi varsa yalnızca o şubenin verisi döner.
- Tarih aralığı `from`/`to` sorgu parametreleriyle verilir (`ReportRangeSchema`);
  verilmezse son 30 gün, aralık en fazla 1 yıl olabilir, aksi halde 400.
- Para tutarları her zaman `Prisma.Decimal` ile toplanır ve ondalık dizgi
  (`"1234.56"`) olarak döner; kayan noktalı (float) toplama kullanılmaz.
- Her rapor `?format=csv` ile UTF-8 BOM'lu, noktalı virgülle ayrılmış, Türkçe
  başlıklı bir CSV döner (Excel TR uyumlu). Aksi halde JSON döner.
- Zaman dilimi dönüşümleri her zaman `Studio.timezone` alanına göre yapılır ve
  SQL'de `AT TIME ZONE 'UTC' AT TIME ZONE <tz>` ile hesaplanır (veritabanında
  saatler UTC'yi temsil eden `timestamp without time zone` olarak saklanır).
- Gelir brüt olarak raporlanır: tamamen iade edilmiş (REFUNDED) ödemeler de
  `total` içinde kalır. İade tutarları `refundTotal`, net gelir `netTotal`
  (`total - refundTotal`) alanındadır.

## 1. Doluluk (`GET /reports/studio/:studioId/occupancy`)

- **Güne göre (`byDay`)**: iptal edilmemiş seanslar, stüdyo saatine göre gün
  bazında gruplanır. `sessions` = seans sayısı, `capacity` = kapasitelerin
  toplamı, `booked` = durumu `CONFIRMED`, `ATTENDED` veya `NO_SHOW` olan
  rezervasyon sayısı (yer kaplayan her rezervasyon), `attended` = durumu
  `ATTENDED` olanlar, `occupancy` = `booked / capacity` (kapasite 0 ise 0).
- **Hizmet türüne göre (`byServiceType`)**: aynı metrikler `ServiceType`
  bazında.
- **Isı haritası (`heatmap`)**: 7 (haftanın günü, 0 = Pazartesi .. 6 = Pazar,
  stüdyo saatine göre) x 24 (saat, stüdyo saatine göre) hücrelik tam matris;
  veri olmayan hücreler sıfırla doldurulur.

## 2. Gelir (`GET /reports/studio/:studioId/revenue`)

- Yalnızca `paymentStatus = COMPLETED` ödemeler sayılır.
- `granularity` sorgu parametresi `day` (varsayılan), `week` veya `month`
  olabilir; `byPeriod` bu aralıkta `paid_at` üzerinden `date_trunc` ile
  gruplanır (stüdyo saatine çevrilerek).
- `byMethod`: `Payment.paymentMethod` enum değerine göre toplam ve ödeme
  sayısı.
- `byPackage`: ödemenin bağlı olduğu `MemberPackage.packageDefinitionId`'ye
  göre toplam; paketsiz ödemeler `packageDefinitionId: null`,
  `packageDefinitionName: "Paketsiz"` altında toplanır.
- `total`: aralıktaki tüm tamamlanmış ödemelerin toplamı.

## 3. Üyeler (`GET /reports/studio/:studioId/members`)

- `activeMembers`: `Membership.status = ACTIVE` olan üye sayısı (şube
  filtresi varsa `MemberProfile.homeBranchId` üzerinden).
- `newMembers`: `Membership.joinedAt` aralık içinde olan aktif üyeler.
- `revenue`: aralıktaki tamamlanmış ödemelerin toplamı (aynı şube kapsamı).
- `arpu`: `revenue / activeMembers` (aktif üye 0 ise "0.00").
- `churnedMembers`: bkz. "Kayıp (churn) ve yenileme tanımı" aşağıda.

## 4. Yenileme oranı (`GET /reports/studio/:studioId/renewal`)

- **Taban küme**: her üyenin, `MemberPackage.endDate` değeri aralık içinde
  olan **en son biten** paketi (`DISTINCT ON (member_id) ... ORDER BY
  end_date DESC`). Bu kümenin büyüklüğü `expiredPackages`.
- **Yenilendi mi?**: o üyenin, bu paketin bitiminden **sonra** başlayan bir
  sonraki paketi var mı ve başlangıcı bitişten en fazla **14 gün** sonra mı?
  Evet ise yenilenmiş sayılır (`renewedPackages`).
- `renewalRate = renewedPackages / expiredPackages` (payda 0 ise 0).
- Saf hesaplama `apps/api/src/modules/reports/report-calculations.ts`
  içindeki `isRenewed` / `isChurned` / `computeRenewalRate` fonksiyonlarında
  birim testlidir.

### Kayıp (churn) ve yenileme tanımı

Bir üye, yukarıdaki taban kümedeki paketi için 14 gün içinde yeni bir paket
almamışsa (hiç almamış olsa da olur) **kaybedilmiş (churned)** sayılır.
`churnedMembers` bu kümedeki kaybedilen üye sayısıdır (`isRenewed` false
olanlar = `isChurned` true olanlar).

## 5. Kohortlar (`GET /reports/studio/:studioId/cohorts`)

- Tarih aralığı almaz (`branchId` filtresi hariç); her üyenin **ilk paket
  satın alma ayı** (`MIN(MemberPackage.startDate)`, aya yuvarlanmış) o
  üyenin kohortunu belirler.
- Her kohort için, kohort ayından itibaren en fazla 12 ay (dahil) için
  "elde tutma (retention)" hesaplanır: bir üye o ay **aktif** sayılır eğer
  o ay içeren bir paketi varsa (`start_date <= ay <= end_date`, ay bazında)
  **veya** o ay `ATTENDED` durumunda bir rezervasyonu varsa.
- `retention[0]` her zaman kohort ayının kendisidir (satın alma ayı, çoğu
  üye için 1.0'a yakın olması beklenir; tanım gereği paketi olan herkes o ay
  aktiftir).
- Saf kohort inşası (gruplama + oran hesabı)
  `apps/api/src/modules/reports/report-calculations.ts` içindeki
  `buildCohorts` fonksiyonunda birim testlidir.

## 6. Eğitmen performansı (`GET /reports/studio/:studioId/trainers`)

- `SessionSchedule.trainerId` dolu olan, iptal edilmemiş, aralıktaki
  seanslar eğitmene göre gruplanır.
- `sessions`, `capacity`, `booked`, `attended`, `occupancy`: doluluk
  raporuyla aynı tanım, eğitmen bazında.
- `noShows`: durumu `NO_SHOW` olan rezervasyon sayısı.
- `lateCancellations`: durumu `CANCELLED_LATE` olan rezervasyon sayısı.
- `substitutions`: `SessionSchedule.originalTrainerId` dolu ve o eğitmenin
  kendi id'sinden farklı olduğu seans sayısı (yani bu eğitmen, planlanan
  başka bir eğitmenin yerine derse girmiş).

## CSV dışa aktarma

`apps/api/src/common/csv.ts` (`toCsv`) her raporun kendi Türkçe başlıklı
satırlarına dönüştürülmesiyle kullanılır (`apps/api/src/modules/reports/reports.csv.ts`).
Biçim: UTF-8 BOM önek, alanlar `;` ile ayrılır, satırlar `\r\n` ile biter,
`"`/`;`/satır sonu içeren alanlar RFC 4180'e göre tırnaklanır.

## Bilinen sınırlamalar / ileride yapılacaklar

- Büyük veri hacimlerinde `member_packages(end_date)` ve
  `member_packages(start_date)` üzerinde ek indeks faydalı olabilir; mevcut
  ölçekte gerekli görülmedi (bkz. `packages/database/prisma/migrations`,
  bu iş için ek migration eklenmedi).
