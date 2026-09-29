# Banka ödemeleri ve mutabakat (G5d-2)

Ödeme sağlayıcısının (Stripe payout, iyzico/PayTR hakediş) banka hesabına yolladığı toplu tutarları listeler, her toplu ödemenin içindeki tahsilat, iade, komisyon ve düzeltme satırlarını gösterir, bu satırları sistemdeki `payments` kayıtlarıyla eşleştirir (mutabakat) ve muhasebe dışa aktarımı ile aynı biçimde dosya üretir. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.11 "Banka ödemeleri ve mutabakat" maddesidir. Sektörden ve ülkeden bağımsızdır: tutarlar her zaman kendi para birimiyle tutulur (sabit para birimi yok), sağlayıcı bir adaptördür.

## 1. Kavramlar

- **Banka ödemesi (`Payout`)**: sağlayıcının işletmenin banka hesabına yolladığı tek transfer. Sağlayıcı tarafı kimliği `provider_payout_id`; (`studio_id`, `provider`, `provider_payout_id`) benzersizdir. Durumlar sağlayıcıdan normalize edilir: `PENDING`, `IN_TRANSIT`, `PAID`, `FAILED`, `CANCELED`. `arrival_date` bankaya geçiş (veya beklenen geçiş) günüdür.
- **Satır (`PayoutItem`)**: ödemenin içindeki tek işlem. Türler: `CHARGE` (tahsilat), `REFUND` (iade), `FEE` (tek başına komisyon satırı), `ADJUSTMENT` (itiraz, düzeltme vb.). Tutarlar işaretlidir: tahsilat artı, iade ve komisyon eksi; `fee` satırın kendi sağlayıcı komisyonu (artı), `net = amount - fee`.
- **Toplamlar**: `gross_amount` = tahsilat satırlarının toplamı; `fee_amount` = satır komisyonları + `FEE` satırları (artı); `refund_amount` = iade satırlarının toplamı (artı); `net_amount` = sağlayıcının bankaya yolladığını bildirdiği tutar (otorite budur). Satır netlerinin toplamı `net_amount`'tan farklıysa ayrıntıda `netDifference` sıfırdan farklı gösterilir ve uyarı verilir; durum hesabını etkilemez.
- **Eşleştirme**: `CHARGE` ve `REFUND` satırları, sağlayıcı referansıyla `payments.provider_reference` üzerinden `payments` kaydına bağlanır (`payout_items.payment_id`, `ON DELETE SET NULL`). `FEE` ve `ADJUSTMENT` satırları eşleştirilmez.
- **Mutabakat durumu** (`reconciliation_status`, her eşitleme ve her elle değişiklikte satırlardan yeniden hesaplanır): `MATCHED` = bütün tahsilat ve iade satırları eşleşti (yalnızca komisyon/düzeltme içeren ödeme de `MATCHED`); `UNMATCHED` = hiçbiri eşleşmedi veya ödemenin hiç satırı yok; `PARTIAL` = arası. Kural `reconciliationStatusOf` (`packages/shared/src/payouts.ts`) içindedir ve birim testlidir.

## 2. Otomatik eşleştirme kuralları

Saf kural `autoMatchItems` (`packages/shared/src/payouts.ts`); API yalnızca aynı işletmenin, aynı sağlayıcının `payments` satırlarını verir:

1. Satırın `provider_reference` değeri, yoksa `related_reference` değeri bir ödemenin `provider_reference` alanına eşitse eşleşir. İade satırı kendi kimliğiyle değil, özgün tahsilatın referansıyla (`related_reference`) ödemeye bağlanır; böylece iade, ödemenin kendisinde görünür.
2. Para birimi farklıysa eşleşmez.
3. Aynı referansı taşıyan birden fazla ödeme varsa belirsizdir, eşleşmez (insan karar verir).
4. Elle eşleştirilmiş (`MANUAL`) veya elle kaldırılmış (`UNMATCHED_MANUAL`) satır, sonraki eşitlemelerde otomatik olarak yeniden bağlanmaz. Bağlı ödemesi silinmiş (`SET NULL`) otomatik satır yeniden eşleşebilir.

Stripe'ta bir Checkout ile alınan ödemenin `provider_reference` değeri oturum kimliğidir (`cs_...`), tahsilat satırı ise PaymentIntent kimliğini taşır; bu yüzden Stripe adaptörü her tahsilat için oturumu (`checkout.sessions.list` ile `payment_intent`) bulup `related_reference` olarak ekler. Bulunamazsa satır eşleşmemiş kalır ve elle eşleştirilebilir.

## 3. Sağlayıcı adaptörü ve destek durumu

`PaymentProviderAdapter` (`apps/api/src/modules/payments/providers/payment-provider.interface.ts`) **isteğe bağlı** iki metotla genişledi; ikisi de yoksa sağlayıcı "desteklenmiyor" sayılır, hata değildir:

- `listPayouts({ studioId, since, accountId })`: `since` tarihinden itibaren banka ödemeleri (`ProviderPayout`: kimlik, normalize durum, bankaya geçiş tarihi, net tutar, para birimi).
- `listPayoutItems({ studioId, providerPayoutId, accountId })`: bir ödemenin satırları (`ProviderPayoutItem`).
- `payoutsNeedAccountId`: gerçek eşitleme işletmenin sağlayıcıdaki kendi hesabını gerektiriyorsa `true`.
- Yapılandırma eksikliği için `PayoutNotConfiguredError` fırlatılır; eşitleme bunu `NOT_CONFIGURED` olarak kaydeder.

| Sağlayıcı | Durum | Ayrıntı |
|---|---|---|
| `MOCK` | Destekli | Geliştirme, test ve seed için. Süreç içi bir defter (`MockPaymentProvider.recordLedger`) tutar: mock checkout, kayıtlı kart tahsilatı ve iade birer kayıt bırakır. Ödeme, işletme ve para birimi başına UTC günü kümesidir; gün bitmediyse `PENDING`, bitmişse `PAID`, bankaya geçiş ertesi gün 00:00 UTC. Komisyon tahsilatın yüzde 2,9'u (küsurat yukarı yuvarlanır), iadede komisyon yok. Aynı defter her zaman aynı kimlik ve tutarları üretir. Defter işletme başına son 2000 kayıtla sınırlıdır ve süreç yeniden başlayınca sıfırlanır. Üretimde MOCK devre dışıdır (kayıt defteri `disabledMockProvider` döner; eşitleme "desteklenmiyor" der). |
| `STRIPE` | Destekli | Resmî `stripe` paketiyle (mevcut bağımlılık; yeni paket yok): `payouts.list` ve `balanceTransactions.list({ payout, expand: ['data.source'] })`, her ikisi `stripeAccount` (işletmenin bağlı hesabı) ile. `charge`/`payment` -> `CHARGE`, `refund`/`payment_refund` -> `REFUND`, `stripe_fee`/`network_cost`/`application_fee` -> `FEE`, diğerleri `ADJUSTMENT`; payout'un kendi işlemi (`payout`, `payout_cancel`, `payout_failure`) satır sayılmaz. Tutarlar Stripe küçük birimlerinden para biriminin kendi basamağına çevrilir (JPY 0, çoğu 2 basamak; 3 basamaklı para birimleri 2 basamağa yuvarlanır, tüm veritabanı tutarları gibi). Ağ çağrısı yalnızca gerçek `STRIPE_SECRET_KEY` varken yapılır; anahtar yoksa geliştirmede boş liste, üretimde `503`. **Bağlı hesap kimliği (`providerAccountId`) olmadan gerçek eşitleme yapılmaz** (`NOT_CONFIGURED`): platform anahtarı platformun kendi payout'larını okurdu ve işletmeler arasında sızdırırdı. |
| `IYZICO` | Desteklenmiyor | Adaptör henüz iskelettir (HTTP altyapısı ve kimlik doğrulaması yok). Eşitleme `UNSUPPORTED` döner, web'de "henüz desteklenmiyor" rozeti görünür. Kalan iş: iyzico hakediş (settlement) raporu uç noktaları ve HMAC imzalı istekler. |
| `PAYTR` | Desteklenmiyor | Aynı durum; kalan iş: PayTR ödeme detay ve hakediş raporu servisleri. |

Yeni sağlayıcı eklemek, adaptöre bu iki metodu yazmaktan ibarettir; şema, eşleştirme, arayüz ve dışa aktarım değişmez.

## 4. Şema (migration `20261014000000_payouts`)

Genişlet-daralt kuralına uygun: yalnızca yeni enum ve tablolar, mevcut tablo veya kolon değişmez; ileri yönlüdür.

- `payouts`: `studio_id`, `provider`, `provider_payout_id`, `status`, `arrival_date`, `gross_amount`, `fee_amount`, `refund_amount`, `net_amount`, `currency` (varsayılansız, her zaman sağlayıcıdan), `item_count`, `matched_item_count`, `matchable_item_count`, `reconciliation_status`, `synced_at`. Index: (`studio_id`, `provider`, `provider_payout_id`) benzersiz, (`studio_id`, `arrival_date`), (`studio_id`, `reconciliation_status`).
- `payout_items`: `studio_id`, `payout_id` (cascade), `provider_item_id`, `type`, `provider_reference`, `related_reference`, `amount`, `fee`, `net`, `currency`, `occurred_at`, `description`, `payment_id` (`payments`, `SET NULL`), `match_source` (`AUTO`/`MANUAL`/`UNMATCHED_MANUAL`). Index: (`payout_id`, `provider_item_id`) benzersiz, (`studio_id`, `payment_id`), (`studio_id`, `provider_reference`).
- `payout_connections`: (`studio_id`, `provider`) benzersiz; `provider_account_id` (Stripe bağlı hesabı), `last_synced_at`, `last_error` (kısa kod: `SYNC_FAILED`, `ACCOUNT_REQUIRED`, `NOT_CONFIGURED`).
- Enum'lar: `PayoutStatus`, `PayoutItemType`, `PayoutReconciliationStatus`, `PayoutMatchSource`.
- Veri adımı: mevcut işletmelerin sahip rolüne `payouts.view` ve `payouts.manage` eklenir (idempotent; yeni işletmeler sahibin tüm izinlere sahip olmasıyla alır).

Tutar kolonları `Decimal(12,2)`; API onları ondalık dizge olarak döner, hesap BigInt küçük birimlerle yapılır (`packages/shared/src/accounting.ts` yardımcıları).

## 5. Eşitleme (sync)

- **Elle**: `POST studios/:studioId/payouts/sync` (`payouts.manage`). İşletmenin sağlayıcıları: ödemelerinde kullandığı sağlayıcılar, `payout_connections` satırı olanlar ve süreç varsayılanı destekliyorsa o. Her sağlayıcı için sonuç: `SYNCED`, `UNSUPPORTED`, `NOT_CONFIGURED`, `FAILED` (ayrıntı günlüğe, arayüze genel mesaj).
- **Arka plan**: 15 dakikalık kalp atışındaki `PayoutsJobsService` (`JobsService.runAll`), Redis'siz de çalışır; BullMQ yalnızca kalp atışını tetikler. Son 180 günde ödemesi o sağlayıcıyla yapılmış veya bağlantısı olan (işletme, sağlayıcı) çiftlerini, son eşitlemesi 6 saatten eskiyse (hiç eşitlenmemişler önce) en fazla 25 çiftle işler. Bir hata kalp atışının geri kalanını durdurmaz.
- **Aralık**: ilk eşitleme 90 gün geriye bakar; sonrakiler son eşitlemeden 7 gün önceden başlar (durumu değişen ödemeler yenilensin diye).
- **Idempotent**: ödeme satırı `upsert` (durum, tarih, net tutar güncellenir); satırlar yalnızca henüz kayıtlı olmayanlar eklenir, kayıtlı satıra dokunulmaz. Böylece elle eşleştirme hiçbir eşitlemede bozulmaz. Bir ödeme tek işlemde (transaction) yazılır ve aynı işlemde yeniden hesaplanır (`PayoutReconcileService`).

## 6. API

Hepsi `studios/:studioId/payouts` altındadır (`JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` + `BillingWriteGuard`, yani `@StudioScoped()`); her uç `@RequirePermission` bildirir, her sorgu `tenant.studioId` ile süzülür. Kısıtlı modda (`RESTRICTED`/`CANCELLED`) yazma uçları `BILLING_RESTRICTED` ile reddedilir, okuma ve dışa aktarım açık kalır.

| Uç nokta | İzin |
|---|---|
| `GET /` (`from`, `to` bankaya geçiş tarihi; `provider`, `status`, `reconciliationStatus`, `page`, `pageSize` en fazla 100) | `payouts.view` |
| `GET /:id` (satırlar, eşleşen ödeme özeti, `itemsNetAmount`, `netDifference`) | `payouts.view` |
| `GET /connections` (sağlayıcı, destek, hesap gerekli mi, son eşitleme, son hata) | `payouts.view` |
| `GET /export?kind=payouts\|items&format=xlsx\|csv&from&to&provider&locale&delimiter` | `payouts.view` |
| `POST /sync` | `payouts.manage` |
| `PATCH /connections/:provider` (`providerAccountId`, boş = kaldır) | `payouts.manage` |
| `GET /:id/items/:itemId/candidates` (aynı işletme ve para birimi, satırın ±45 günündeki ödemeler, tutarı aynı olanlar önde) | `payouts.manage` |
| `POST /:id/items/:itemId/match` (`paymentId`) | `payouts.manage` |
| `DELETE /:id/items/:itemId/match` | `payouts.manage` |

- Elle eşleştirme: yalnızca `CHARGE`/`REFUND` satırı (aksi 400); ödeme aynı işletmeden olmalı (başka işletmenin ödemesi 404) ve para birimi eşit olmalı (aksi 409). Sonuç `MANUAL` olarak işaretlenir. Eşlemeyi kaldırma `UNMATCHED_MANUAL` bırakır. İkisi de aynı işlemde durumu yeniden hesaplar ve `audit_logs` yazar: `payouts.match` (`itemId`, `paymentId`, önceki `previousPaymentId`), `payouts.unmatch`; dışa aktarım için `payouts.export`.
- Yol parçaları UUID'dir; web BFF'nin `^[A-Za-z0-9_.-]+$` kuralına uyar, kural gevşetilmedi.
- `payouts.view` ve `payouts.manage` varsayılan olarak yalnızca sahip rolündedir (işletmenin sağlayıcı hakedişlerini taşır); resepsiyon ve eğitmen şablonlarında yoktur, gerekirse rol düzenleyicisinden verilir.

## 7. Dışa aktarım

`kind=payouts` (ödeme başına bir satır: bankaya geçiş tarihi, sağlayıcı, kimlik, durum, mutabakat, satır sayıları, brüt, komisyon, iade, net, para birimi) veya `kind=items` (satır başına: ödeme bilgisi, tür, referans, işlem zamanı, tutar, komisyon, net, para birimi, eşleşen makbuz no ve ödeme kimliği). Biçim `xlsx` (varsayılan) veya `csv`; muhasebe dışa aktarımıyla aynı yazıcılar kullanılır (`buildAccountingWorkbook`, `renderAccountingCsv`; bkz. `docs/MUHASEBE.md`): para birimi başına bir sayfa (sayfa adı para birimi kodu), kalın dondurulmuş süzgeçli başlık, tutarlar sayı, tarihler tarih hücresi, hiçbir hücre formül değil, sayfa sonunda BigInt küçük birimlerle hesaplanmış toplam satırı; CSV UTF-8 BOM, `;` veya `,`, formül enjeksiyonu koruması. Başlıklar istenen dilde (`payouts.col.*`). `from` verilmezse `to` öncesi 90 gün, `to` verilmezse bugünden 7 gün sonrası (bekleyen ödemeler de gelsin); en fazla 366 gün ve 50.000 satır.

## 8. Web

`/finans/odemeler` (`payouts.view` sayfa koruması; `/finans` başlığında bağlantı): ödeme listesi (durum ve mutabakat rozetleri, brüt/komisyon/iade/net, eşleşen satır sayısı), tarih aralığı, sağlayıcı, durum ve mutabakat süzgeçleri, sayfalama; "Şimdi eşitle" (`payouts.manage`), sağlayıcı paneli (son eşitleme, hata, "desteklenmiyor" rozeti, Stripe için hesap kimliği alanı), dışa aktarım kartı; ödeme ayrıntısı (özet, satır tablosu, eşleşen ödeme, elle eşleştirme penceresi ve eşlemeyi kaldırma). Para ve tarihler etkin dile göre `Intl` ile, ödemenin kendi para birimiyle biçimlenir. Metinler `payouts` i18n ad alanındadır (tr/en). Playwright: `apps/web/e2e/payouts.e2e.ts`.

## 9. Seed

`seedPayouts` (Zen): üç MOCK ödemesi ve satırları. `mock_po_seed_a` (`MATCHED`, iki tahsilat ve bir iade), `mock_po_seed_b` (`PARTIAL`, bir tahsilatın ödemesi yok), `mock_po_seed_c` (bekleyen, `UNMATCHED`). Tutarlar işletmenin para biriminde, ödemeler `provider = MOCK` ve sağlayıcı referansıyla.

## 10. Testler

- `packages/shared/src/payouts.spec.ts`: toplamlar, mutabakat durumu, otomatik eşleştirme kuralları, şemalar (doğrusal zamanlı doğrulama dahil), dışa aktarım satırları.
- `payments/providers/mock-payment.provider.payouts.spec.ts`, `stripe-payment.provider.payouts.spec.ts`: adaptör eşlemeleri; Stripe sahte istemciyle, ağ çağrısı yok.
- `apps/api/test/e2e/payouts.e2e-spec.ts`: izinler (resepsiyon ve eğitmen reddedilir), kiracı yalıtımı, MOCK ile eşitleme ve idempotency, otomatik/elle eşleştirme ve denetim kaydı, kısıtlı mod, CSV ve XLSX içeriği, arka plan eşitleme sınırı.

## 11. Kalan işler

- iyzico ve PayTR hakediş adaptörleri (bölüm 3).
- Stripe Connect ile işletme bağlı hesabının otomatik alınması (bugün hesap kimliği elle girilir).
- Banka ekstresi (havale/EFT) satırlarıyla ikinci düzey mutabakat: sağlayıcı ödemesinin bankaya gerçekten yattığının ekstreyle doğrulanması.
- Mobil ekran ve bildirim (ödeme bankaya geçti, eşleşmeyen satır uyarısı).
- Tutar farkı (`netDifference`) olan ödemeler için ayrı mutabakat durumu veya uyarı bildirimi.
