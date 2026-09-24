# Ayrılma Riski (Churn Risk, W12)

Bu doküman `churn` API modülünün ürettiği puanı, sinyalleri ve varsayılan
ağırlıkları tam olarak tanımlar. Uygulama: `apps/api/src/modules/churn`.
Saf puanlama fonksiyonu (`churn-scoring.ts`) iş mantığı olduğu için `apps/api`
içinde yaşar (CLAUDE.md kural 7); paylaşılan, doğrulanmış tip ve varsayılan
ağırlıklar `packages/shared/src/churn.ts` içindedir
(`ChurnWeightsSchema`, `DEFAULT_CHURN_WEIGHTS`, `CHURN_REASON_LABELS`).

## Genel bakış

- Her aktif üye için 0-100 arası, açıklanabilir (explainable) bir puan
  hesaplanır: kural tabanlıdır, makine öğrenmesi yoktur. Her puan, hangi
  sinyalin ne kadar katkı yaptığını gösteren bir gerekçe (`reasons`) listesiyle
  birlikte döner.
- Seviye: `score >= highThreshold` ise **HIGH**, `score >= mediumThreshold`
  ise **MEDIUM**, aksi halde **LOW** (varsayılan eşikler: 70 ve 40).
- Hesaplama stüdyo başına toplu (batch) çalışır: `ChurnService.recomputeStudio`
  bir stüdyonun tüm aktif üyeleri için birkaç sınırlı (bounded), stüdyo
  genelinde sorgu çalıştırır (üye başına sorgu değil), sonra sonuçları tek
  seferde (chunk'lar hâlinde) `member_risk_snapshots` tablosuna upsert eder ve
  `member_risk_history` tablosuna bir satır ekler.
- Ağırlıklar kiracı ayarıdır: `studios.churn_weights` (JSONB, null ise
  paylaşılan varsayılanlar geçerlidir). Her ağırlık, bir sinyalin
  ekleyebileceği en fazla puandır (cap); toplam puan her zaman 0-100 aralığına
  sıkıştırılır (clamp).

## Sinyaller

| # | Sinyal (anahtar) | Ne zaman tetiklenir | Varsayılan ağırlık | Ölçekleme |
|---|-------------------|----------------------|---------------------|-----------|
| 1 | `attendance_declining` | Son 28 gündeki katılım, önceki 28 güne göre düştüyse (önceki dönemde en az bir katılım olmalı) | 20 | Düşüş oranı `attendanceDeclineRatio` (varsayılan %50) eşiğinde tam puana ulaşır; altında orantılı |
| 2 | `inactive` | Son katılımdan bu yana geçen gün sayısı `inactivityThresholdDays` (varsayılan 14) veya üzeriyse, veya üye hiç derse katılmadıysa | 25 | `inactivityMaxDays` (varsayılan 60) gün ve üzerinde tam puana ulaşır |
| 3 | `package_ending_soon` | Üyenin aktif/dondurulmuş paketi `packageEndingWindowDays` (varsayılan 7) gün içinde bitiyor **ve** henüz yenileme satın alınmamışsa (yeni paket veya aktif otomatik yenileme aboneliği yok) | 15 | Bitişe kalan güne göre orantılı, bitiş gününde tam puan |
| 4 | `package_low_units` | Aktif paket `SESSION_COUNT`/`CREDIT` tipindeyse, kalan hakkı `packageLowUnitsThreshold` (varsayılan 2) veya altındaysa **ve** yenileme satın alınmamışsa (`TIME_UNLIMITED` paketler bu sinyale hiç girmez) | 15 | Kalan hakka göre orantılı |
| 5 | `package_frozen` | Aktif paket dondurulmuşsa (`status = FROZEN`) | 10 | Sabit (tetiklenince tam puan) |
| 6 | `late_cancels_no_shows` | Son 28 günde geç iptal + gelmeme (no-show) toplamı 1 veya üzeriyse | 15 | `lateCancelNoShowMaxCount` (varsayılan 4) adette tam puana ulaşır |
| 7 | `failed_payments` | Son 28 günde başarısız (`PaymentAttempt.status = FAILED`) ödeme denemesi varsa (tablo boşsa veya üyenin otomatik yenileme aboneliği yoksa sinyal hiç oluşmaz) | 20 | `failedPaymentMaxCount` (varsayılan 2) adette tam puana ulaşır |
| - | `onboarding` (bilgilendirme, 0 puan) | Üyelik `onboardingDays` (varsayılan 60) günden daha yeniyse | 0 | Bu durumda 1 ve 2 numaralı sinyaller (katılım trendi ve hareketsizlik) hiç hesaplanmaz; henüz yeterli geçmiş yoktur |

Her gerekçe nesnesi `{ key, label, points, detail? }` şeklindedir; `label`
Türkçe, `key` makine anahtarıdır (mobil ve web'de doğrudan gösterilebilir ya
da kendi metnine çevrilebilir), `detail` hesaplamada kullanılan ham
değerleri taşır (ör. `{ daysSinceLastAttendance: 21 }`).

## Yenileme satın alınmış mı

3 ve 4 numaralı sinyaller için "yenileme satın alınmış" şu ikisinden biri
doğruysa kabul edilir:

- Üyenin `ACTIVE` durumda bir `MemberSubscription`'ı (otomatik yenileme) varsa, veya
- Aktif/dondurulmuş paketten daha sonra başlayan (`start_date` daha ileri
  tarihli) başka bir `MemberPackage` satın alınmışsa.

## Seviyeler ve haftalık değişim

- `GET /churn/studio/:studioId/summary`, her seviye için güncel üye sayısını
  ve 7 gün önceki (`member_risk_history` üzerinden en yakın önceki
  hesaplama) sayıyı döner, böylece "HIGH seviyede geçen haftaya göre +3 üye"
  gibi bir trend gösterilebilir.
- Her `member_risk_snapshots` satırında ayrıca `previousScore` tutulur: bir
  önceki `recomputeStudio` çağrısındaki puandır, üye kartında "puan 62 -> 74"
  gibi bir hareket göstermek için kullanılır.

## Hesaplama ne zaman çalışır

- Bu API'de henüz bir jobs/scheduler modülü yok (bkz. HANDOVER.md W12).
  Bunun yerine:
  - Kiracı içi: `POST /churn/studio/:studioId/recompute` (`members.manage`
    izni, stüdyo başına 10 dakikada bir hız sınırlı; `audit_logs` üzerinden
    kontrol edilir).
  - Platform geneli: `POST /admin/churn/recompute-all` (yalnızca süper admin,
    `apps/api/src/modules/churn/churn-admin.controller.ts`), tüm aktif
    stüdyoları sırayla yeniden hesaplar. Bir jobs modülü eklendiğinde bu
    çağrı günlük bir işe taşınmalıdır (bkz. `docs/PAYMENTS.md`'deki dunning
    modülü için aynı not).
- `now` alanı (isteğe bağlı gövde alanı) yalnızca `NODE_ENV=test` iken
  dikkate alınır; e2e testlerinin sabit (deterministic) tarihlere göre
  hesaplama yapmasını sağlar, üretimde yok sayılır.

## Uç noktalar

Tüm uç noktalar `StudioScoped()` (JWT + `StudioTenantGuard` + `PermissionGuard`)
ile korunur ve şube kısıtlı personel yalnızca kendi şubelerinin (ve
şubesiz/stüdyo geneli) üyelerini görür (`assertBranchAccess`,
`apps/api/src/modules/branches/branch-access.ts`, üyenin `homeBranchId`'i
üzerinden).

| Uç nokta | İzin | Açıklama |
|----------|------|----------|
| `GET /churn/studio/:studioId/members` | `reports.view` | `level`, `branchId`, `includeSnoozed`, `search`, `page`, `limit` filtreleri; puana göre azalan sıralı; `?format=csv` ile CSV |
| `GET /churn/studio/:studioId/summary` | `reports.view` | Seviye başına güncel ve geçen haftaki sayı |
| `GET /churn/studio/:studioId/members/:memberId` | `reports.view` | Tek üyenin risk detayı |
| `POST /churn/studio/:studioId/recompute` | `members.manage` | Stüdyoyu yeniden hesaplar, 10 dakikada bir |
| `POST /churn/studio/:studioId/members/:memberId/contacted` | `members.manage` | "Görüşüldü" işaretler, bir not kaydeder, `audit_logs`'a `churn.contacted` yazar |
| `POST /churn/studio/:studioId/members/:memberId/snooze` | `members.manage` | Üyeyi listeden `days` gün gizler (`snoozedUntil`), `audit_logs`'a `churn.snoozed` yazar |

Üyenin telefon numarası (`phone`) yalnızca çağıranın `members.contact.view`
izni varsa yanıta eklenir (CLAUDE.md kural: iletişim bilgisi maskeleme).

## Mobil

`Hesabım > Riskli üyeler` (`reports.view` izniyle görünür): önce HIGH,
sonra MEDIUM seviyesindeki üyeleri, en yüksek puanlı ilk 2 gerekçeleriyle
birlikte listeler; her kartta hızlı bir "Görüşüldü" aksiyonu vardır
(`apps/mobile/app/(app)/hesabim/riskli-uyeler`).
