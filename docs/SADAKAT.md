# Sadakat Puanı (G3a)

Bağlayıcı tasarım: `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.8. Bu belge uygulanan modeli, kuralları, uç noktaları ve sahip kararlarını anlatır.

## Özet

- Her işletme kendi sadakat programını açıp kapatır; puan kazanma kuralları ve ödül kataloğu **kiracı verisidir** (CLAUDE.md kural 7), kodda sabit değildir.
- Puanlar **yalnızca ekleme yapılan bir defterde** (`loyalty_ledger`) tutulur. Her kazanma, harcama, elle düzeltme ve süre dolumu tek bir satırdır: işaretli puan (`delta`), satırdan sonraki bakiye (`balance_after`), neden anahtarı (`reason`), kaynak türü ve kimliği. Satırlar hiçbir zaman güncellenmez veya silinmez.
- Üyelik başına önbelleklenmiş bakiye (`loyalty_accounts`) defterle aynı işlemde güncellenir. Defter tek doğruluk kaynağıdır; bakiye yalnızca hızlı okuma içindir.
- Tüm tablolarda `studio_id` vardır; her sorgu işletmeye göre süzülür.

## Veri modeli

| Tablo | Amaç |
|---|---|
| `loyalty_settings` | İşletme başına program ayarı: açık/kapalı, son kullanma politikası (`NONE` / `MONTHS_AFTER_EARN` + ay sayısı), bildirim günü (0 = bildirim yok), üyelerin uygulamadan ödül kullanabilmesi. Satır yoksa program kapalıdır. |
| `loyalty_rules` | Kazanma kuralı: tür (`ATTENDANCE`, `PURCHASE_AMOUNT`, `REFERRAL`, `BIRTHDAY`, `BADGE`, `MANUAL`), ad, puan, tutar kuralı için `per_amount` + `currency`, koşullar (`serviceTypeIds`, `packageDefinitionIds`, `badgeDefinitionIds`), etkinlik. |
| `loyalty_rewards` | Ödül: tür (`DISCOUNT_AMOUNT`, `DISCOUNT_PERCENT`, `EXTRA_SESSION_CREDIT`, `GIFT`), puan bedeli, değer (tutar + para birimi, yüzde veya hak sayısı), kodun geçerlilik günü, etkinlik, üyelerin uygulamadan alıp alamayacağı. |
| `loyalty_accounts` | Üyelik başına bakiye, toplam kazanılan/harcanan, bir sonraki olası son kullanma tarihi (`next_expiry_at`, süre dolumu işinin ipucu) ve son bildirilen tarih (`expiry_notice_for`). `balance >= 0` veritabanı kısıtıdır. |
| `loyalty_ledger` | Defter. Tekillik: (`studio_id`, `source_type`, `source_id`, `reason`). Pozitif satırlar birer **parti** (lot) olup kazanıldığı andaki politikaya göre `expires_at` taşır; negatif satırlar harcamadır. `delta <> 0` ve `balance_after >= 0` veritabanı kısıtıdır. |
| `loyalty_redemptions` | Kullanılan ödül: negatif defter satırı (`ledger_id` benzersiz), ödülün o anki adı/türü/değeri, üretilen promosyon kodu veya hak eklenen paket. |
| `promo_codes.restricted_to_user_id` | Yeni, boş olabilir kolon: sadakat ödülüyle üretilen kod yalnızca o kullanıcı tarafından kullanılabilir. |

Kaynak türleri ve tekillik anahtarları:

| Kaynak | `source_type` / `source_id` | Neden |
|---|---|---|
| Check-in | `booking` / rezervasyon kimliği | `EARN_ATTENDANCE` |
| Tamamlanan ödeme | `payment` / ödeme kimliği | `EARN_PURCHASE` |
| Tavsiye ödülü | `referral` / tavsiye kimliği | `EARN_REFERRAL` |
| Doğum günü | `birthday` / `<üyelik>:<yıl>` | `EARN_BIRTHDAY` |
| Rozet | `badge` / `member_badges` satırı | `EARN_BADGE` |
| Elle düzeltme | `manual` / `<üyelik>:<istemci anahtarı>` veya rastgele kimlik | `MANUAL_ADJUST` |
| Akış adımı | `journey` / `<kayıt>:<adım>` | `JOURNEY_AWARD` |
| Ödül kullanımı | `redemption` / `<üyelik>:<istemci anahtarı>` veya kullanım kimliği | `REDEEM` |
| Süre dolumu | `lot` / süresi dolan pozitif satırın kimliği | `EXPIRED` |

## Yazma sözleşmesi

Deftere yalnızca `LoyaltyLedgerService` yazar (`apps/api/src/modules/loyalty`):

1. Üyeliğin hesap satırı yoksa oluşturulur ve satır kilitlenir (`FOR UPDATE`); aynı üyenin tüm defter yazımları sıraya girer.
2. Tekillik anahtarı daha önce kullanıldıysa ilk satır döner, hiçbir şey değişmez. Tekrarlanan kanca çağrıları, ikinci bir check-in yolu, yeniden denenen istekler ve eşzamanlı kalp atışları puanı iki kez vermez.
3. Bakiyeyi sıfırın altına düşürecek harcama 409 (`LOYALTY_INSUFFICIENT_BALANCE`) ile reddedilir.
4. Satır, sonraki bakiye ile eklenir; hesap aynı işlemde güncellenir.

## Kazanma

Aynı türde birden fazla etkin kural varsa puanları toplanır ve kayıt başına **tek** defter satırı yazılır. Program kapalıyken hiçbir kaynak puan vermez. Partner misafirleri (`is_partner_guest`) puan kazanmaz.

- **Seansa katılım**: personel check-in'i, QR ve kiosk yolları aynı `CrmHooksService.onBookingAttended` kancasından geçer; `serviceTypeIds` koşulu hizmet türüne göre süzer.
- **Satın alma tutarı**: `CrmHooksService.onPaymentCompleted` (üye kartında satış, ödeme uç noktaları, abonelik tahsilatı). Puan = `points x floor(net tutar / per_amount)`; net tutar iade düşülmüş tutardır. Kural 8 gereği yalnızca kuralın para birimiyle aynı para birimindeki ödemeler puan kazanır; kural para birimi işletmenin para birimi olmalıdır (aksi 400 `LOYALTY_CURRENCY_MISMATCH`). Bu iş sırasında üye kartından yapılan paket satışının ödemesine artık işletmenin para birimi yazılıyor (daha önce kolonun varsayılanı kullanılıyordu).
- **Tavsiye**: mevcut W15 akışında tavsiye `QUALIFIED -> REWARDED` koşullu geçişini yapan işlem, aynı işlem içinde tavsiye edene puan yazar. Geçiş yalnızca bir kez olabildiği için ve defter anahtarı tavsiye kimliği olduğu için çift puan olmaz. Mevcut paket hakkı ödülü (`studios.referral_reward_units`) ayrı bir kiracı ayarı olarak aynen devam eder; yalnızca puan isteyen işletme bu değeri 0 yapar.
- **Rozet**: oyunlaştırma modülü yeni bir `member_badges` satırı oluşturduğunda (benzersiz üye + rozet) puan yazılır; `badgeDefinitionIds` koşulu belirli rozetlere daraltır. Geriye dönük doldurma (backfill) aynı satırlar için tekrar puan vermez.
- **Doğum günü**: zamanlayıcı kalp atışı, işletmenin saat diliminde bugün doğum günü olan etkin üyelere yılda bir kez puan verir (29 Şubat artık yıl dışında 28 Şubat'ta).
- **Elle verme şablonu (`MANUAL`)**: bir tetikleyici değildir; üye kartındaki elle puan formunda hazır seçenek olarak görünür (ör. "İşletme yorumu: 30 puan").

## Harcama (ödül kullanma)

Tek işlemde: negatif `REDEEM` satırı ve etkisi. Etki başarısız olursa harcama da geri alınır.

- `DISCOUNT_AMOUNT` / `DISCOUNT_PERCENT`: `PromotionsService` üzerinden tek kullanımlık (`max_redemptions = 1`, `per_user_limit = 1`), `LOY-` önekli, ödülün geçerlilik günü kadar geçerli ve **yalnızca o üyeye özel** bir promosyon kodu üretilir. Kod normal satış akışında kullanılır; mevcut tüm promosyon kuralları geçerlidir. Tutar indirimi ödülünün para birimi işletmenin para birimi olmalıdır.
- `EXTRA_SESSION_CREDIT`: üyenin en yeni etkin, birim tabanlı paketine hak eklenir (tavsiye ödülüyle ortak `creditActivePackageUnits` yardımcı fonksiyonu). Uygun paket yoksa 409 `LOYALTY_NO_ACTIVE_PACKAGE` ve puan düşülmez.
- `GIFT`: yalnızca kayıt; hediye resepsiyonda teslim edilir.

Personel üye kartından (`loyalty.redeem`), üye mobil uygulamadan kullanabilir (işletme `member_redeem_enabled` açtıysa ve ödül `member_redeemable` ise; aksi 403 `LOYALTY_MEMBER_REDEEM_DISABLED`). İstemci her gönderimde bir tekillik anahtarı yollar; aynı anahtarla tekrarlanan istek ilk kullanımı döndürür (`duplicate: true`).

## Son kullanma

- Politika `NONE`: puanlar süresizdir. `MONTHS_AFTER_EARN`: her pozitif satır kazanıldığı andan N ay sonra sona erer (ay sonu taşmasında ayın son günü). Politika değişikliği yalnızca sonraki kazanımları etkiler.
- **FIFO**: harcamalar önce süresi en erken dolacak partilerden düşülür (süresiz partiler en son). Hesap, değişmez satırlardan her zaman yeniden yapılabilir (`remainingLots`, `packages/shared/src/loyalty.ts`).
- Kalp atışı, `next_expiry_at` tarihi gelmiş hesaplar için süresi dolmuş ve puanı kalan her parti için negatif `EXPIRED` satırı yazar (parti başına tekil), sonra ipucunu bir sonraki partiye taşır.
- **Bildirim**: süresi `expiry_notice_days` gün içinde dolacak puanı olan üyeye `LOYALTY_POINTS_EXPIRING` şablonuyla (tr/en yerleşik varsayılan, işletme özelleştirebilir) mesajlaşma motorundan bir kez gönderilir; tarih başına bir deneme (`expiry_notice_for` + motorun tekilleştirme anahtarı).
- **Karar**: bu bildirim **TRANSACTIONAL** gönderilir. Gerekçe: bir teklif veya kampanya değil, üyenin kendi hesabındaki bakiyeye dair bilgilendirmedir (paket bitiş hatırlatmasıyla aynı sınıf); bu yüzden ticari izin (İYS/GDPR pazarlama izni) aranmaz, sessiz saat ve kanal sırası motor tarafından yine uygulanır. İşletme bildirimi istemezse gün sayısını 0 yapar. Şablon metnine kampanya/indirim içeriği eklenmemelidir; eklenmek istenirse şablon ticari işaretlenmelidir.

## Büyüme entegrasyonları (G2a'dan)

- **Segment alanı** `loyalty.pointsBalance` (sayı) artık etkin: kişinin bağlı üyeliğinin önbellekli bakiyesi, işletmeye göre süzülen parametreli sorguyla; hesabı olmayan kişi 0 sayılır. Segment oluşturucuda "Sadakat" grubunda görünür.
- **Akış adımı** `award_points` artık etkin: puan (1-100000) ve açıklama zorunludur. Adım, kayıt ve adım başına tekildir (`journey:<kayıt>:<adım>`); yeniden denenen iş puanı iki kez vermez. Üyeliği olmayan kişi (aday) için adım `SKIPPED` / `NO_MEMBERSHIP`, program kapalıysa `SKIPPED` / `LOYALTY_DISABLED` olarak geçer.

## İzinler

| Anahtar | Kapsam | Varsayılan |
|---|---|---|
| `loyalty.view` | Ayarlar, kurallar, ödüller, üye kartı ve kişi kartında bakiye ve hareketler | Sahip, resepsiyon |
| `loyalty.manage` | Program ayarları, kurallar, ödüller, elle puan düzeltme | Sahip |
| `loyalty.redeem` | Üye kartında ödül kullandırma | Sahip, resepsiyon |

Migration üç anahtarı sahip rollerine, `loyalty.view` ve `loyalty.redeem` anahtarlarını `reception` anahtarlı rollere ekler. Resepsiyon bakiyeyi görüp ödül verebilir ama elle puan yazamaz (kötüye kullanıma açık olduğu için). Üye uç noktaları (`me`) kendi verisiyle sınırlı self-servistir.

## API

Tümü `@StudioScoped()`; işletme her zaman kiracı korumasından gelir.

| Uç nokta | İzin |
|---|---|
| `GET/PUT /studios/:studioId/loyalty/settings` | view / manage |
| `GET/POST /studios/:studioId/loyalty/rules`, `PATCH/DELETE .../rules/:ruleId` | view / manage |
| `GET/POST /studios/:studioId/loyalty/rewards`, `PATCH/DELETE .../rewards/:rewardId` (kullanılmış ödül silinmez, pasif yapılır) | view / manage |
| `GET /studios/:studioId/loyalty/members/:memberId` (bakiye, son 20 hareket, kullanılan ödüller, ödüller, elle verme şablonları) | view |
| `GET /studios/:studioId/loyalty/members/:memberId/ledger?page&limit` | view |
| `POST /studios/:studioId/loyalty/members/:memberId/adjust` | manage |
| `POST /studios/:studioId/loyalty/members/:memberId/redeem` | redeem |
| `GET /studios/:studioId/loyalty/contacts/:contactId/balance` | view |
| `GET /studios/:studioId/loyalty/me`, `GET .../me/ledger`, `POST .../me/redeem` | self-servis |

Hatalar gövdede kararlı bir `code` taşır (`LOYALTY_ERROR_CODES`); istemciler `loyalty.error.<code>` / `mLoyalty.error.<code>` anahtarıyla çevirir.

## Arayüz

- Web `/ayarlar/sadakat`: program (aç/kapa, son kullanma, bildirim günü, üye kullanımı), kazanma kuralları, ödül kataloğu.
- Web üye kartı: sadakat paneli (bakiye, sonraki son kullanma, toplamlar, elle düzeltme ve hazır seçenek, ödül kullandırma ve üretilen kod, hareketler, kullanılan ödüller).
- Web kişi kartı: üyeliği olan kişiler için "Sadakat puanı" satırı.
- Mobil: üye "Hesabım > Puanlarım" (bakiye, ödüller ve izinliyse kullanma, hareketler); personel üye kartında bakiye satırı.
- Tüm metinler `loyalty` ve `mLoyalty` ad alanlarında (tr + en).

## Demo verisi

Seed, Zen işletmesinde programı açar (12 ay son kullanma, 14 gün bildirim, üye kullanımı açık), her kaynak için bir kural, dört ödül ("Havlu hediyesi", yüzde 10, bir seans hakkı, tutar indirimi) ve ilk üç üyeye birkaç hareket yazar.

## Kalan

- Ödeme iadesinde kazanılan puanın geri alınması (şimdilik net tutar yalnızca kazanım anında hesaplanır).
- Personel üye kartında mobil ödül kullandırma (mobil kartta şimdilik yalnızca bakiye satırı var; kullandırma web üye kartında).
- Sadakat raporu (dönemsel kazanılan/harcanan/süresi dolan puan) ve CSV dışa aktarımı.
- Aile hesabında ortak puan havuzu.
