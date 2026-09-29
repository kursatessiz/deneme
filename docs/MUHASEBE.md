# Muhasebe dışa aktarımı (G3c-3)

Muhasebeciye verilecek dönem dosyası: satış ve iade defteri, gider defteri ve
vergi oranı / ödeme yöntemi özeti. Yeni bir para mantığı yoktur; mevcut
ödeme, iade ve gider kayıtları yeniden düzenlenerek sunulur. Sektörden
bağımsızdır: hiçbir kelime veya birim bir iş türüne bağlı değildir, açıklama
sütunları kiracının kendi verisinden (paket, etkinlik, ürün adı) gelir.

## Uç nokta ve izin

```
GET /studios/:studioId/accounting/export
    ?from&to&branchId&kind=sales|expenses|summary&format=csv|json&delimiter&locale
```

- İzin: `accounting.export` (`packages/shared/src/permissions.ts`, alan: Finans).
  Varsayılan olarak yalnızca sahip rolünde; resepsiyon, eğitmen ve üye
  erişemez. Migration `20261008000000_accounting_export` mevcut kiracıların
  sahip rollerine anahtarı ekler (yeni kiracılar `DEFAULT_ROLE_TEMPLATES`
  üzerinden alır; şema değişikliği yoktur).
- Kiracı: `:studioId` çağıranın üyeliğiyle doğrulanır (`StudioTenantGuard`).
  Şubeyle kısıtlı personel yalnızca kendi şubelerini dışa aktarır;
  `branchId` verilirse yalnızca o şube (şubesiz kayıtlar şube süzgeci
  olmadığında dahildir).
- `from` / `to`: ISO tarih veya zaman (her ikisi de dahil). Varsayılan son 30
  gün, en fazla 366 gün, en fazla 50.000 ödeme.
- `kind`: `sales` (varsayılan), `expenses`, `summary`.
- `format`: `csv` (varsayılan) veya `json`.
- `delimiter`: `semicolon` (`;`, varsayılan) veya `comma` (`,`); yalnızca CSV.
  Karakterin kendisi (`;` veya `,`, URL kodlu) da kabul edilir.
- `locale`: CSV başlık satırının dili (`tr`, `en`, `en-GB` gibi); verilmezse
  işletmenin varsayılan dili. Başlıklar `packages/shared/src/i18n/messages/*/accounting.ts`
  anahtarlarından gelir.
- Her dışa aktarım `AuditLog`'a `accounting.export` olarak yazılır.

## Satış ve iade defteri (`kind=sales`)

Bir satırın sütunları: `date`, `entryType` (`SALE` veya `REFUND`),
`documentNumber`, `invoiceNumber`, `customerName`, `description`, `net`,
`taxRate`, `tax`, `gross`, `currency`, `paymentMethod`, `providerReference`,
`paymentId`, `branchId`.

- Kapsam: durumu tamamlandı veya iade edildi olan her ödeme (paket, etkinlik,
  perakende, abonelik). Bekleyen ve başarısız ödemeler yoktur.
- İadeler negatif satırdır ve iade gününe yazılır. Kaynakları: perakende
  satışlarda `SaleRefund` kayıtları, diğer ödemelerde `PaymentsService.refundPayment`
  denetim kaydı (`payments.refund`, tutar `metadata.amount`). Bu kayıtlardan
  önce yapılmış eski iadeler (denetim kaydı olmayan) satır üretmez; tarihi
  bilinmediği için tahmin edilmez.
- Belge no: perakendede fiş numarası, yoksa ödeme fişi numarası, yoksa fatura
  numarası. Fatura numarası ayrıca `invoiceNumber` sütunundadır (iptal edilen
  fatura yazılmaz).
- Vergi: perakende satışlarda her satırın kendi oranı (satır başına bir defter
  satırı, oran başına toplanır). Diğer ödemelerde işletmenin varsayılan
  oranı (fatura ayarındaki `defaultVatRate`, vergi rejimi `NONE` ise 0) tutara
  dahil kabul edilir; e-faturanın kullandığı kuralın aynısıdır
  (`net = brüt / (1 + oran)`, yarım yukarı yuvarlama, vergi = brüt - net).
  Birden çok oranlı bir ödeme ve iadesi, oranlara orantılı dağıtılır ve
  satırlar tam olarak brüte eşitlenir (kuruş kaybı yoktur).
- Ödeme yöntemi: ödeme yöntemi kodu olduğu gibi (`CASH`, `ONLINE_STRIPE`, ...).

## Gider defteri (`kind=expenses`)

`date`, `category`, `description` (not), `amount`, `currency`, `expenseId`,
`branchId`. Giderin kendi para birimi yoktur; her zaman işletmenin para
biriminde yazılır (kural 8: sabit para birimi yok).

## Özet (`kind=summary`)

Her satır para birimiyle başlar: `currency`, `section`, `key`, `count`, `net`,
`tax`, `gross`. Bölümler: `taxRate` (oran başına), `paymentMethod` (yöntem
başına, iadeler düşülmüş), `expenseCategory` ve `total` (`sales`, `expenses`,
`result` = satış - gider). Para birimleri hiçbir zaman tek toplamda
karıştırılmaz: her toplam yalnızca kendi para biriminin satırlarından oluşur.

## Biçimler

- CSV: UTF-8, başında BOM (Excel kodlamayı doğru tanır), CRLF satır sonu,
  RFC 4180 tırnaklama, çevrilmiş başlık satırı. Tutarlar her zaman nokta
  ondalıklıdır ve para biriminin küçük birimiyle yazılır (iki hane; JPY gibi
  ondalıksız para birimlerinde hane yok). Tarihler ISO 8601 (UTC).
- Formül enjeksiyonu koruması: `=`, `+`, `-`, `@` (ve sekme / satır başı) ile
  başlayan metin hücrelerinin başına tek tırnak konur. Sayısal sütunlardaki
  düz ondalıklar (iade satırının `-40.00` değeri) olduğu gibi kalır.
- JSON: `{ kind, from, to, branchId, rowCount, rows }`; satırlar CSV
  sütunlarıyla aynı alanlara sahiptir.

## Kod

- Saf satır kurucuları, para birimi gruplama ve CSV: `packages/shared/src/accounting.ts`
  (birim testler: `accounting.spec.ts`; yuvarlama, para birimi gruplama, CSV
  kaçışı, formül koruması).
- Yükleme ve uç nokta: `apps/api/src/modules/accounting`; e2e:
  `apps/api/test/e2e/accounting.e2e-spec.ts` (izin reddi, kiracı ve şube
  izolasyonu, BOM, formül kaçışı, negatif iade, para birimi ayrımı).
- Web: `/finans` sayfasındaki "Muhasebe dışa aktarımı" kartı
  (`apps/web/src/components/finance/AccountingExportCard.tsx`); dosya BFF
  üzerinden (`/api/bff/studios/:studioId/accounting/export`) indirilir.

## Bilinen sınırlar

- Ödemelerde ayrı bir vergi kaydı yoktur; paket ve etkinlik ödemelerinin
  vergisi varsayılan orandan türetilir. Farklı oranlı paketler için ürün
  başına oran gerekir (ileride).
- Hediye kartı veya promosyonla ödenen kısım ayrı bir ödeme yöntemi satırı
  değildir; ödeme tutarı tek yöntemle yazılır.
- Yerel dil paketleri (süper admin yüklemesi) başlık çevirisinde kullanılmaz;
  yalnızca paketle gelen diller (`tr`, `en`) ve bulunamazsa Türkçe.
