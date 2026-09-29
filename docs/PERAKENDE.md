# Perakende ve Stok (G3c-2)

Bağlayıcı tasarım: `docs/BUYUME_VE_GLOBAL_MIMARI.md` G3c satırı ve bölüm 3.11 (global hızlı işlem çubuğu). Bu belge uygulanan modeli, kuralları, uç noktaları ve sahip kararlarını anlatır.

## Özet

- İşletmeler resepsiyonda fiziksel ürün ve basit ek hizmet satar (su, havlu, kaymaz çorap, raket, takviye, kitap, havlu kiralama gibi). Ürün adları, kategoriler, fiyatlar ve vergi oranları **kiracı verisidir** (CLAUDE.md kural 7); kodda sektöre özgü hiçbir ürün yoktur.
- Stok şube başına tutulur. Her değişiklik **yalnızca ekleme yapılan** bir stok defterine (`stock_movements`) işaretli miktarla ve satırdan sonraki şube stoku ile yazılır; satırlar hiçbir zaman güncellenmez veya silinmez. `stock_levels` yalnızca hızlı okuma için önbellektir ve defterle aynı işlemde güncellenir.
- Tutarlar her zaman para birimiyle saklanır (kural 8): ürün fiyatı, satış toplamları, iadeler. Para birimi her zaman işletmenin para birimidir; başka para birimi 400 `RETAIL_CURRENCY_MISMATCH` ile reddedilir.
- Tüm tablolarda `studio_id` vardır; her sorgu işletmeye göre süzülür. Şube, ürün ve satış satırları bileşik yabancı anahtarlarla (`(id, studio_id)`) kendi işletmesine sabitlenir, yani başka işletmenin şubesine veya ürününe satır yazılamaz. Şubeye kısıtlı personel yalnızca kendi şubelerinin stokunu ve satışlarını görür ve değiştirir.

## Veri modeli

Migration: `20261007000000_retail` (yalnızca yeni enum ve tablolar; mevcut tablolara kolon eklenmez).

| Tablo | Amaç |
|---|---|
| `retail_settings` | İşletme başına: eksi stoka satış izni (`allow_backorder`, varsayılan kapalı), fiş öneki (`receipt_prefix`, varsayılan `S`) ve fiş sayacı (`last_receipt_seq`). Satır ilk kullanımda oluşturulur. |
| `product_categories` | Kategori (işletme içinde ad benzersiz). Silinen kategorinin ürünleri kategorisiz kalır. |
| `products` | Ad, isteğe bağlı stok kodu (SKU) ve barkod (ikisi de işletme içinde benzersiz), açıklama, fiyat + para birimi, vergi oranı (boşsa işletme varsayılanı), alış maliyeti (kâr için), satışta bayrağı, stok takibi bayrağı, düşük stok eşiği, görsel adresi. |
| `stock_levels` | Ürün + şube başına eldeki miktar (önbellek). |
| `stock_movements` | Defter: tür (`RECEIVE`, `SALE`, `RETURN`, `ADJUSTMENT`, `TRANSFER`), işaretli miktar, sonraki miktar, açıklama, referans (fiş no, irsaliye no, transfer grubu), birim maliyet, satış/iade kimliği, işlemi yapan. |
| `sales` | Satış: şube, işletme içinde sıralı fiş numarası (`receipt_seq`, `receipt_number`), durum (`COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `VOID`), isteğe bağlı üye ve CRM kişisi, müşteri adı anlık görüntüsü, para birimi, vergi dahil/haric bayrağı, ara toplam, indirim, vergi hariç tutar, vergi, toplam, iade edilen tutar, ödeme yöntemi, varsa ödeme kaydı (`payment_id`), promosyon kodu ve indirimi, not, tekrar gönderim anahtarı (`idempotency_key`), satışı yapan. |
| `sale_lines` | Satır: ürün adı/SKU anlık görüntüsü (ürün sonradan değişse de fiş değişmez), stok takibi anlık görüntüsü, adet, birim fiyat, birim maliyet, satır indirimi, sepet indiriminden payı, vergi oranı, vergi hariç tutar, vergi, toplam, iade edilen adet ve tutar. |
| `sale_refunds`, `sale_refund_lines` | İade: tutar + para birimi, neden, yapan; satır başına adet, tutar ve stoka geri alınıp alınmadığı. |

Veritabanı kısıtları: fiyat, maliyet ve toplamlar negatif olamaz; vergi oranı 0-100; defter miktarı sıfır olamaz; satır adedi pozitif; iade edilen adet satılanı, iade edilen tutar toplamı aşamaz.

**Varyant (beden/renk):** bu fazda ayrı bir `ProductVariant` modeli yok. Beden veya renk farkı olan ürünler ayrı ürün olarak açılır (ör. "Kaymaz çorap - M", "Kaymaz çorap - L"), her birinin kendi SKU/barkodu ve stoku olur. Ortak üst ürün altında gruplama ileride ayrı bir iş olarak eklenebilir.

## Vergi ve tutar hesabı (G1a)

- Vergi, işletmenin bölge ayarlarından gelir: `Studio.taxRegime`, `Studio.pricesIncludeTax` ve e-fatura ayarındaki `defaultVatRate`.
- Ürünün kendi oranı yoksa varsayılan oran kullanılır: `NONE` rejiminde 0, diğerlerinde fatura ayarındaki varsayılan oran (fatura ayarı yoksa 0). Oran satış anında satıra kopyalanır.
- Hesap `packages/shared/src/retail.ts` içindeki saf fonksiyonlarla yapılır (`computeCartTotals`, `lineRefundAmount`); API, web ve mobil aynı kodu kullanır. Tutarlar ondalık metin olarak taşınır, hesap BigInt ile tam sayı küsurat birimlerinde yapılır; ikili kayan nokta hiçbir tutara dokunmaz.
- Satır başına: liste tutarı eksi personel indirimi, eksi sepet indiriminden (promosyon) payı. Sepet indirimi satırlara tutarlarıyla orantılı ve en büyük kalan yöntemiyle dağıtılır, böylece satır toplamları her zaman sepet toplamına eşittir. Vergi dahil fiyatlarda vergi içeriden ayrılır (`net = brüt / (1 + oran)`), vergi hariç fiyatlarda üstüne eklenir. Yuvarlama para biriminin küsurat basamağına, yarım yukarı ve satır başınadır.
- Küsuratsız para birimlerinde (JPY gibi) tutarlar tam birime yuvarlanır. Üç küsuratlı para birimleri (KWD gibi), şemadaki tüm para kolonları gibi iki basamağa yuvarlanır.

## Satış (checkout)

`POST /studios/:studioId/retail/sales` tek bir veritabanı işlemidir:

1. İşletmenin `retail_settings` satırında fiş sayacı artırılır (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`). Satır kilidi aynı işletmenin satışlarını sıraya koyar; işlem geri alınırsa numara da geri alınır, bu yüzden fiş numaraları **boşluksuz ve işletme başına benzersizdir** (`S000001`, `S000002`, ...).
2. Promosyon kodu varsa `PromotionsService.applyPromoCodeTx` ile doğrulanır ve kullanım hakkı aynı işlemde ayrılır.
3. Stok takip edilen her ürün için tek bir koşullu güncelleme: `quantity = quantity - n WHERE quantity - n >= 0`. Postgres satırı kilitler ve eşzamanlı bir satış tamamlandıktan sonra koşulu yeniden değerlendirir; son ürün için yarışan iki satıştan yalnızca biri geçer, diğeri 409 `RETAIL_INSUFFICIENT_STOCK` alır ve tüm işlem geri alınır. Ürünler kimlik sırasıyla kilitlenir (kilitlenme sırası sabit, deadlock yok). İşletme eksi stoka izin verdiyse (`allow_backorder`) koşul uygulanmaz.
4. Satış ve satırları, defter satırları (`SALE`) ve müşteri üye ise ödeme kaydı (`Payment`) ile promosyon kullanımı yazılır.
5. İşlem bittikten sonra, üyeye yapılan satışta paket ödemeleriyle aynı kancalar çalışır: `CrmHooksService.onPaymentCompleted` (CRM satın alma dönüşümü ve sadakat puanı, `docs/SADAKAT.md`) ve `payment.completed` webhook'u.

İstemci her gönderimde bir `idempotencyKey` yollar; aynı anahtarla tekrar gelen istek ilk satışı döndürür (`duplicate: true`), yeniden satış yapmaz.

### Müşteri, ödeme ve promosyon

- Müşteri isteğe bağlıdır: üye (`memberId`), CRM kişisi (`contactId`) veya kayıtsız müşteri.
- Ödeme yöntemi yalnızca anlık yöntemlerdir: nakit (`CASH`) ve POS cihazıyla kart (`CREDIT_CARD_POS`). Tek satışta tek ödeme yöntemi vardır.
- **Üyeye yapılan satış** bir `Payment` kaydı üretir (tutar, para birimi, yöntem, şube, fiş numarası, promosyon). Bu sayede finans ekranındaki ödeme listesi, gelir raporu, promosyon kullanım kaydı, sadakat puanı ve CRM dönüşümü mevcut mekanizmalarla çalışır.
- **Kayıtsız müşteriye satış** `Payment` üretmez; çünkü `payments.member_id` zorunludur. Bu satışlar perakende raporunda ve satış geçmişinde görünür, finans gelir raporuna girmez (sahip kararı, aşağıda).
- Promosyon kodu yalnızca üyeye satışta kullanılabilir (kod kullanım limiti kullanıcı başınadır); aksi 400 `RETAIL_PROMO_REQUIRES_MEMBER`. Pakete kısıtlı kodlar ve `FREE_UNITS` türü perakende satışta geçersizdir. Promosyon indirimi, satır indirimlerinden sonraki tutar üzerinden hesaplanır.

## İade ve iptal

- `POST .../sales/:saleId/refund`: satırların tamamı (gövdede `lines` yoksa) veya seçili satır ve adetler. Her satır için "stoka geri al" seçilebilir (bozuk ürün için kapatılır). Satış satırı önce kilitlenir (`FOR UPDATE`), bu yüzden aynı satışın iki iadesi sırayla çalışır; iade edilen adet satılanı aşamaz (400 `RETAIL_REFUND_EXCEEDS_SOLD`).
- İade tutarı satır toplamıyla orantılıdır; satırı tamamen kapatan iade kalan tutarın tamamını alır, yuvarlama farkı oluşmaz.
- Stoka geri alınan birimler `RETURN` defter satırıyla girer. Satışın durumu `PARTIALLY_REFUNDED` veya `REFUNDED` olur.
- Satışın ödeme kaydı varsa, ödemenin `refunded_amount` ve durumu (`REFUNDED` tam iadede) aynı işlemde, mevcut değerlere koşullu olarak güncellenir; ardından `payment.refunded` webhook'u gönderilir. Masada alınan ödemelerin sağlayıcı referansı ve hediye kartı payı olmadığı için sağlayıcı iadesi gerekmez.
- Finans ekranındaki genel ödeme iadesi, bir ürün satışına ait ödemeyi 409 `RETAIL_PAYMENT_IS_RETAIL` ile reddeder; aksi halde para iade edilir ama stok ve satış durumu güncellenmezdi.
- `POST .../sales/:saleId/void`: hiç iadesi olmayan satışı tamamen iptal eder (tüm tutar iade, tüm ürünler stoka), durum `VOID`. İptal edilen satışlar rapora girmez.
- Kazanılan sadakat puanı iadede geri alınmaz (sadakat modülünün genel kalan işi, `docs/SADAKAT.md`).

## Stok işlemleri

- **Giriş** (`RECEIVE`): pozitif miktar, isteğe bağlı birim maliyet ve belge no.
- **Düzeltme** (`ADJUSTMENT`): işaretli değişim (ör. -2 kırık) veya sayım miktarı (raftaki gerçek miktar; fark yazılır). Açıklama zorunludur. Sonuç asla sıfırın altına düşemez (409 `RETAIL_NEGATIVE_STOCK`).
- **Transfer** (`TRANSFER`): kaynak şubede eksi, hedef şubede artı iki defter satırı, ortak `transfer:<uuid>` referansıyla. Kaynak stok yetersizse 409. İki şube satırı kimlik sırasıyla kilitlenir.
- Stok takip edilmeyen ürünlerde (ör. havlu kiralama) stok işlemi 400 `RETAIL_UNTRACKED_PRODUCT` ile reddedilir; satışları defter yazmaz.
- Satışı veya stok hareketi olan ürün silinmez, satışa kapatılır (fiş ve defter referansı korunur).

## Düşük stok

Sistemde personele bildirim veya gelen kutusu öğesi üreten bir mekanizma bulunmadığından (gelen kutusu müşteri konuşmaları içindir), günlük kalp atışı işi eklenmedi. Bunun yerine:

- `GET .../stock/low`: satışta, stoku takip edilen ve eşiği olan ürünlerden, stoklandığı şubede miktarı eşiğin altında veya eşitinde olanlar.
- Web genel bakış ekranında "Stoku azalan ürünler" kutusu (yalnızca `retail.view` olanlar görür) ve ürün listesinde "Stok az" etiketi.

## İzinler

| Anahtar | Kapsam | Varsayılan |
|---|---|---|
| `retail.view` | Ürünler, stok, stok hareketleri, satış geçmişi ve fiş, düşük stok, satış raporu | Sahip, resepsiyon |
| `retail.sell` | Hızlı satış (checkout) | Sahip, resepsiyon |
| `retail.manage` | Ürün ve kategori yönetimi, fiyat, stok giriş/düzeltme/transfer, mağaza ayarları | Sahip |
| `retail.refund` | Satış iadesi ve iptali | Sahip |

Migration dört anahtarı sahip rollerine, `retail.view` ve `retail.sell` anahtarlarını `reception` anahtarlı rollere ekler; yeni işletmeler için `DEFAULT_ROLE_TEMPLATES` aynı şekilde güncellendi.

## API

Tümü `@StudioScoped()`; işletme her zaman kiracı korumasından gelir. Hatalar gövdede kararlı bir `code` taşır (`RETAIL_ERROR_CODES`); istemciler `retail.error.<code>` / `mRetail.error.<code>` anahtarıyla çevirir.

| Uç nokta | İzin |
|---|---|
| `GET /studios/:studioId/retail/settings` | view |
| `PUT /studios/:studioId/retail/settings` | manage |
| `GET/POST /studios/:studioId/retail/categories`, `PATCH/DELETE .../categories/:categoryId` | view / manage |
| `GET /studios/:studioId/retail/products?search&barcode&categoryId&active&branchId`, `GET .../products/:productId` | view |
| `POST .../products`, `PATCH/DELETE .../products/:productId` | manage |
| `POST .../stock/receive`, `POST .../stock/adjust`, `POST .../stock/transfer` | manage |
| `GET .../stock/movements?productId&branchId&type&page&limit` | view |
| `GET .../stock/low?branchId` | view |
| `POST .../sales` (checkout) | sell |
| `GET .../sales?from&to&branchId&status&memberId&receipt&page&limit`, `GET .../sales/:saleId` | view |
| `POST .../sales/:saleId/refund`, `POST .../sales/:saleId/void` | refund |
| `GET .../reports/sales?from&to&branchId&format=json|csv&view=product|day` | view |

## Rapor

- Aralıktaki iptal edilmemiş satışlar: satış sayısı, satılan adet (iadeler düşülmüş), brüt satış, iade, net satış, vergi (satış anındaki), maliyet ve brüt kâr.
- Ürüne göre: adet, iade adedi, tutar (iade düşülmüş), maliyet ve brüt kâr. Brüt kâr yalnızca alış maliyeti girilmiş ürünler için, vergi hariç tutar üzerinden hesaplanır (satır maliyeti satış anında kopyalanır).
- Güne göre: işletmenin saat diliminde gün, satış sayısı, brüt ve iade.
- CSV: `format=csv`, `view=product` (varsayılan) veya `view=day`. Başlıklar işletmenin varsayılan dilinde i18n kataloğundan gelir (`retail.csv.*`); `docs/REPORTS.md` ile aynı CSV kuralları (UTF-8 BOM, noktalı virgül, formül koruması).
- **Finans raporu:** mevcut gelir raporu `payments` tablosundan hesaplanır. Üyeye yapılan ürün satışları ödeme kaydı ürettiği için finans toplamlarına zaten girer ("Paketsiz" satırında); kayıtsız müşteri satışları girmez. Tam perakende cirosu perakende raporundadır.

## Arayüz

- Web `/magaza` (menüde "Mağaza", `retail.view`): Ürünler (arama, ürün formu, stok giriş/düzeltme/sayım/transfer penceresi, kategoriler), Satışlar (filtreler, fiş no araması), Stok hareketleri, Rapor (CSV indirme), Ayarlar (`retail.manage`: eksi stok izni, fiş öneki; vergi bilgisi salt okunur).
- Web `/magaza/satis` (hızlı satış, `retail.sell`): ürün ara veya barkod okut (barkod okuyucu kodu yazıp Enter'a basar; tam barkod eşleşmesi doğrudan sepete ekler), sepet (adet, satır indirimi), isteğe bağlı üye (yalnızca `members.view` olanlar arar) ve promosyon kodu, ödeme yöntemi, not, toplam tahmini (paylaşılan hesap fonksiyonuyla; kesin tutarı API hesaplar).
- Web `/magaza/satislar/:saleId`: fiş, yazdırma (yalnızca CSS: `globals.css` içindeki `@media print` kuralı fiş dışındaki her şeyi gizler), iade ve iptal (`retail.refund`).
- Genel bakış hızlı işlem çubuğunda "Hızlı satış" (`retail.sell`) ve "Stoku azalan ürünler" kutusu.
- Mobil personel "Hesabım > Hızlı satış" (`retail.sell`): şube seçimi, ürün arama, sepet, nakit/POS ödeme. Mobil satış kayıtsız müşteriye yapılır; üyeye satış, promosyon kodu, iade ve ürün/stok yönetimi web panelindedir.
- Tüm metinler `retail` (web) ve `mRetail` (mobil) ad alanlarında (tr + en).

## Demo verisi

Seed, Zen işletmesinde üç kategori (İçecekler, Aksesuar, Beslenme), işletmenin para biriminde beş ürün (su, havlu, kaymaz çorap, protein bar ve stok takibi olmayan havlu kiralama), iki şubede açılış stoku (defter satırlarıyla; kaymaz çorap birinci şubede eşiğin altında) ve bir kayıtsız müşteri satışı (`S000001`) yazar.

## Testler

- `packages/shared/src/retail.spec.ts`: küsurat birimleri, yuvarlama, vergi dahil/haric hesap, satır ve sepet indirimi dağılımı, küsuratsız para birimi, iade tutarı, durum geçişi, şema doğrulamaları.
- `apps/api/test/e2e/retail.e2e-spec.ts`: izinler (resepsiyon, eğitmen), kiracı izolasyonu, para birimi ve vergi saklama, SKU/barkod benzersizliği, stok defteri (giriş, düzeltme, sayım, transfer), eksi stok reddi ve eksi stok izni, eşzamanlı 8 satışta 3 stokla tam 3 başarılı satış, boşluksuz fiş numaraları, tekrar gönderim anahtarı, üye satışında ödeme + promosyon + sadakat, finans iadesinin reddi, satır bazında iade ve stok dönüşü, eşzamanlı iki iadeden yalnızca birinin geçmesi, iptal, düşük stok listesi, rapor ve CSV.
- `apps/web/e2e/retail-quick-sale.e2e.ts`: resepsiyonun hızlı işlem çubuğundan hızlı satış yapıp fişi açması, sahibin mağaza ekranı, eğitmenin 403 görmesi.

## Kalan

- Sepette paket satışı: mimari belge tek bir hızlı satış akışı istiyor, ancak mevcut iki paket satış yolu (`MembersService.assignPackage` ve `PaymentsService.sellPackage`) kendi işlemini açıyor ve ürün satışıyla tek işlemde birleştirmek paket satış servisinin yeniden düzenlenmesini gerektiriyor. Bu fazda sepet yalnızca ürün alır; paket satışı üye kartından yapılır (G5a hızlı işlem çubuğu işinde birleştirilecek).
- Birden fazla ödeme yöntemiyle bölünmüş ödeme ve hediye kartıyla ürün ödemesi.
- Ürün varyantları (yukarıda).
- Perakende satışları için e-fatura: mevcut fatura akışı tek oranlı ve paket açıklamalı; çok oranlı satır bazlı fatura ayrı iş.
- Düşük stok için personel bildirimi (bildirim altyapısı personel hedefli mesaj destekleyince).
- Tedarikçi ve satın alma siparişi, stok sayımı oturumu, ürün görseli yükleme (şimdilik https adresi).
- Mobilde üyeye satış, iade ve stok yönetimi.

## Sahip kararları

1. **Kayıtsız müşteri satışları finans gelirine girsin mi?** Şu an girmiyor (ödeme kaydı üye gerektiriyor). Girmesi için `payments.member_id` boş olabilir hale getirilmeli (genişlet-daralt ile, finans ve fatura ekranlarının üyesiz ödemeyi göstermesi gerekir) veya gelir raporuna perakende satırı eklenmeli.
2. **Resepsiyon iade yapabilsin mi?** Varsayılan olarak hayır (`retail.refund` yalnızca sahipte). İşletme rol şablonundan açabilir.
3. **Vergi varsayılanı:** fatura ayarı olmayan ve rejimi `NONE` olmayan işletmelerde ürün oranı girilmezse vergi 0 hesaplanır. Ülke varsayılan oranı (ör. TR yüzde 20) otomatik uygulansın mı?
4. **Promosyon kodu kayıtsız müşteride:** kullanıcı başı limit nedeniyle kapalı. Genel (limitsiz) kodlar kayıtsız müşteride de kullanılabilsin mi?
