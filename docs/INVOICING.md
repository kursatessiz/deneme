# e-Arşiv / e-Fatura (W8)

Bu doküman, e-fatura entegratör soyutlamasını, hangi ortam değişkenlerinin gerektiğini ve işletme sahibinin sağlaması gereken bilgileri özetler. Tasarım, `docs/PAYMENTS.md`'deki ödeme sağlayıcı soyutlamasıyla aynı desendedir.

## Sağlayıcı soyutlaması

Tüm e-fatura akışları tek bir arayüz üzerinden çalışır (`apps/api/src/modules/invoicing/providers/einvoice-provider.interface.ts`):

- `issue` — bir faturayı sağlayıcıya gönderir, GİB'e iletilmesini sağlar.
- `cancel` — kesilmiş bir e-Arşiv faturasını iptal eder (GİB'in izin verdiği süre içinde).
- `getStatus` — sağlayıcıdaki güncel durumu sorgular.
- `getPdf` — faturanın PDF (veya MOCK için HTML) belgesini döndürür.

Beş adaptör vardır; her stüdyo kendi sağlayıcısını `InvoiceSettings.provider` alanından seçer:

| Değer | Adaptör | Durum |
|-------|---------|-------|
| `MOCK` (varsayılan) | `MockEInvoiceProvider` | Tam işlevsel, deterministik, ağ çağrısı yok. Fatura kimliğini (UUID) faturanın kendi id'sinden türetir (aynı fatura için tekrar çağrılırsa aynı kimliği döner), PDF yerine basit bir HTML belge üretir. Test ve geliştirme için varsayılan. |
| `PARASUT` | `ParasutEInvoiceProvider` | İskelet: gerçek HTTP çağrıları henüz uygulanmadı, çağrıldığında açık bir "yapılandırılmadı" hatası fırlatır. İstek şekilleri kod içinde TODO yorumlarıyla belgelenmiştir. |
| `ELOGO` | `ElogoEInvoiceProvider` | Aynı şekilde iskelet (Logo/eLogo Connect API). |
| `FORIBA` | `ForibaEInvoiceProvider` | Aynı şekilde iskelet (Foriba/Sovos SOAP API). |
| `UYUMSOFT` | `UyumsoftEInvoiceProvider` | Aynı şekilde iskelet (Uyumsoft Entegratör SOAP API). |

`EInvoiceProviderRegistry`, `PaymentProviderRegistry` ile aynı desende: her adaptörü tutar ve `InvoiceSettings.provider`'a göre doğru olanı döner.

### MOCK sağlayıcı ile test

- `issue`, faturanın kendi id'sinden türetilmiş deterministik bir UUID ile her zaman başarıyla döner; aynı fatura için tekrar çağrıldığında aynı UUID'yi verir (yeniden deneme idempotenttir).
- `getPdf`, gerçek bir yasal belge olmadığını açıkça belirten basit bir HTML sayfası döner (`text/html` içerik türüyle).
- Sağlayıcı kimlik bilgisi gerekmez; hiçbir ağ çağrısı yapılmaz.

## Üretimde MOCK sağlayıcı

`NODE_ENV=production` iken MOCK sağlayıcı devre dışıdır: bir fatura "kesmek" gerçek bir yasal belge oluşturulduğunu iddia eder, bu yüzden `ödemeler` modülündeki aynı korumayla (bkz. `docs/PAYMENTS.md`) her çağrı reddedilir ("e-Fatura sağlayıcısı henüz yapılandırılmadı."). Gerçek bir entegratör hesabı ve kimlik bilgileri girilmeden canlı ortamda hiçbir fatura kesilemez.

## Ortam değişkenleri (`apps/api/src/config/env.ts`)

```
PARASUT_CLIENT_ID=...       PARASUT_CLIENT_SECRET=...
ELOGO_USERNAME=...          ELOGO_PASSWORD=...
FORIBA_USERNAME=...         FORIBA_PASSWORD=...
UYUMSOFT_USERNAME=...       UYUMSOFT_PASSWORD=...
```

Bu sürümde hiçbiri zorunlu değildir (yalnızca MOCK tam çalışır); bir stüdyo gerçek bir sağlayıcı seçtiğinde ilgili adaptör kimlik bilgisi eksikse açık bir hata fırlatır. Kodda hiçbir gizli bilgi (secret) yoktur; her stüdyo aynı ortamdaki aynı sağlayıcı kimlik bilgilerini paylaşır (bkz. "Kalan işler" altındaki not).

## Vergi kimliği doğrulama (VKN / TCKN)

TCKN (11 haneli, bireyler) ve VKN (10 haneli, şirketler) checksum doğrulaması `packages/shared/src/tax-id.ts` içinde yaşar (tek doğruluk kaynağı; API, web ve mobil aynı fonksiyonu kullanır):

- `isValidTckn` / `TcknSchema`: resmi TCKN algoritmasını uygular (10. ve 11. hane kontrol basamaklarını doğrular; ilk hane 0 olamaz).
- `isValidVkn` / `VknSchema`: GİB'in yayımladığı VKN checksum algoritmasını uygular.
- `TaxNumberSchema`: ikisinden birini kabul eder (VKN veya TCKN).

## Alıcı bilgisi ve standart tüketici TCKN'si

Bir üyenin fatura kimliği `BillingProfile` tablosunda tutulur (`kind`: `INDIVIDUAL` veya `COMPANY`). Şirket profili unvan, vergi dairesi ve VKN gerektirir; bireysel profil için TCKN opsiyoneldir.

Bir üyenin `BillingProfile`'ı yoksa (veya bireysel profilinde TCKN girilmemişse) ve stüdyonun modu e-Arşiv ise, fatura GİB'in **standart tüketici TCKN'si "11111111111"** ile kesilir. Bu, e-Arşiv'de kimliği bilinmeyen/istemeyen nihai tüketiciler için resmi olarak kabul edilen bir konvansiyondur; alıcı adı yine de üyenin gerçek adı olarak görünür.

**e-Fatura modunda bu geçerli değildir**: e-Fatura, karşı tarafın da GİB'e e-Fatura mükellefi olarak kayıtlı olmasını gerektirir, bu yüzden VKN zorunludur. Alıcının `BillingProfile`'ında VKN yoksa fatura oluşturulmaz; ilgili `Invoice` satırı `FAILED` durumunda ve açık bir gerekçeyle (`failureReason`) kaydedilir, ödeme etkilenmez.

## Fatura numaralandırma

Fatura numarası `seri_kodu + yıl + 6 haneli sıra` biçimindedir (örn. `A2026000001`). Sıra, stüdyo+seri+yıl başına `invoice_counters` tablosunda atomik olarak (Prisma `upsert` ile, fatura oluşturmayla aynı transaction içinde) artırılır; bu yüzden iki eşzamanlı fatura kesimi asla aynı numarayı alamaz.

## KDV hesaplama (fiyattan geriye bölme)

Üye her zaman KDV dahil bir fiyat öder (`Payment.amount`). Fatura, bu tutarı geriye doğru böler:

```
net = KDV_dahil_toplam / (1 + oran/100), 2 ondalığa yarım-yukarı yuvarlanır
kdv = KDV_dahil_toplam - net
```

Örnek: 1000,00 TL, %20 KDV → net 833,33 TL + KDV 166,67 TL (`apps/api/src/modules/invoicing/invoicing.service.ts` içindeki `splitVat`, testleri `invoicing.service.spec.ts`).

## Akış: ödeme tamamlandığında otomatik kesim

`InvoiceSettings.autoIssueOnPayment` açıksa (ve mod `NONE` değilse), bir `Payment` `COMPLETED` durumuna her ulaştığında (satış, üye self-checkout, banka havalesi onayı, sağlayıcı webhook'u) `PaymentsService`, `InvoicingService.issueForPayment()`'ı çağırır:

- **İdempotenttir**: aynı `paymentId` için ikinci bir çağrı, zaten `ISSUED` veya `CANCELLED` olan bir faturayı olduğu gibi döner; `FAILED` bir fatura aynı numarayla yeniden denenir.
- **Ödemeyi asla geri almaz**: fatura oluşturma/kesme bir `try/catch` içinde çalışır; sağlayıcı hatası yalnızca `Invoice`'u `FAILED` yapar ve `failureReason`'a yazar, ödeme `COMPLETED` olarak kalır.
- Başarısız bir fatura, `finance.manage` iznine sahip personel tarafından `POST /invoices/:id/retry` ile yeniden denenebilir.

## İadeler

- **Tam iade**: ilgili fatura `ISSUED` ise otomatik olarak `CANCELLED` yapılır (sağlayıcının `cancel` uç noktası çağrılır). GİB kuralı: bir e-Arşiv faturası yalnızca **kesildiği güne kadar (gün sonuna dek)** iptal edilebilir; bu pencere dışındaki tam iadelerde fatura iptal edilmeye çalışılır ama gerçek bir sağlayıcı bunu reddedebilir.
  - **TODO (W8 sonrası)**: GİB'in aynı gün penceresi dışındaki iptaller için gerçek bir "iade faturası" (credit note) kesimi henüz uygulanmadı. Şimdilik bu durum yalnızca loglanır (`InvoicingService.cancel`), sahibin muhasebecisiyle manuel mutabakat yapması gerekir.
- **Kısmi iade**: fatura hiçbir şekilde değiştirilmez veya iptal edilmez; yalnızca `Payment.refundedAmount` güncellenir. Kısmi iadeler için ayrı bir iade faturası kesimi de henüz uygulanmadı (aynı TODO).

## Uç noktalar

| Uç nokta | İzin | Açıklama |
|----------|------|----------|
| `GET /invoicing/settings` | `finance.view` | Stüdyonun fatura ayarlarını görüntüler |
| `PUT /invoicing/settings` | `finance.manage` | Ayarları oluşturur/günceller (unvan, vergi no, mod, sağlayıcı, KDV oranı, seri kodu, otomatik kesim) |
| `GET /invoicing/billing-profiles/self`, `PUT /invoicing/billing-profiles/self` | self-service | Üye kendi fatura kimliğini görüntüler/düzenler |
| `GET /invoicing/billing-profiles/:memberId`, `PUT /invoicing/billing-profiles/:memberId` | `finance.view` / `finance.manage` | Personel bir üyenin fatura kimliğini görüntüler/düzenler |
| `GET /invoices` | `finance.view` | Tarih, şube, durum filtreleriyle fatura listesi |
| `GET /invoices/export` | `finance.view` | Muhasebeci için CSV dışa aktarımı |
| `GET /invoices/self` | self-service | Üyenin kendi faturaları |
| `GET /invoices/:id` | `finance.view` | Tek fatura |
| `GET /invoices/:id/download`, `GET /invoices/self/:id/download` | `finance.view` / self-service | Sağlayıcı PDF'i veya MOCK için HTML (doğru `Content-Type` ile) |
| `POST /invoices/:id/retry` | `finance.manage` | Başarısız bir faturayı yeniden dener (idempotent, aynı numara) |
| `POST /invoices/:id/cancel` | `finance.manage` | Kesilmiş bir faturayı iptal eder (gerekçe zorunlu) |

## Mobil

`apps/mobile/app/(app)/hesabim/faturalarim.tsx` — "Faturalarım" ekranı: üyenin kendi fatura geçmişi, kesilmiş faturalar için "Faturayı görüntüle" eylemi. Gerçek entegratörler (Paraşüt, eLogo, ...) genellikle herkese açık/ön-imzalı bir belge bağlantısı (`pdfUrl`) döner; bu bağlantı doğrudan cihazın tarayıcısında açılır. MOCK sağlayıcı (yalnızca geliştirme/test) `pdfUrl` döndürmez, çünkü belgeyi kimlik doğrulamalı API uç noktasından sunar; bu durumda ekran belgenin web panelinden görüntülenebileceğini belirtir. Üretimde MOCK zaten devre dışı olduğundan bu, mobil kullanıcıyı etkilemez.

## İşletme sahibinin sağlaması gerekenler

- Bir e-fatura entegratörü hesabı (Paraşüt, Logo/eLogo, Foriba/Sovos veya Uyumsoft) ve GİB e-Arşiv/e-Fatura kaydı.
- Entegratörün API kimlik bilgileri (yukarıdaki ortam değişkenleri).
- İşletmenin unvanı, vergi dairesi ve vergi numarası (uygulama ayarlarından, `InvoicingService.upsertSettings`).
- e-Fatura kullanılacaksa (yalnızca B2B satışlar için), alıcı şirketlerin VKN'lerinin fatura kimliklerinde kayıtlı olması.

## Kalan işler (bir sonraki PR'a)

- Gerçek HTTP/SOAP entegrasyonları (Paraşüt, eLogo, Foriba, Uyumsoft) — kod içi TODO yorumlarında istek şekilleri belgelendi.
- GİB'in aynı gün penceresi dışındaki tam iadeler ve tüm kısmi iadeler için gerçek "iade faturası" (credit note) kesimi.
- Şu an tüm stüdyolar aynı ortamdaki entegratör kimlik bilgilerini paylaşıyor (stüdyo başına farklı bir entegratör hesabı/kimliği desteklenmiyor); çok kiracılı, farklı entegratör hesaplarına sahip stüdyolar için kimlik bilgilerinin kiracı başına (şifrelenmiş) saklanması gerekecek.
- Web panelinde fatura ayarları ve fatura listesi ekranları henüz eklenmedi (yalnızca API ve mobil "Faturalarım").
