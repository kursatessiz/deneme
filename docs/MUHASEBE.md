# Muhasebe dışa aktarımı (G3c-3)

Muhasebeciye verilecek dönem dosyası: satış ve iade defteri, gider defteri ve
vergi oranı / ödeme yöntemi özeti. Yeni bir para mantığı yoktur; mevcut
ödeme, iade ve gider kayıtları yeniden düzenlenerek sunulur. Sektörden
bağımsızdır: hiçbir kelime veya birim bir iş türüne bağlı değildir, açıklama
sütunları kiracının kendi verisinden (paket, etkinlik, ürün adı) gelir.

## Uç nokta ve izin

```
GET /studios/:studioId/accounting/export
    ?from&to&branchId&kind=sales|expenses|summary&format=xlsx|csv|json&delimiter&locale
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
- `format`: `xlsx` (varsayılan, Excel çalışma kitabı), `csv` veya `json`.
  Yanıt türü: XLSX için `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  CSV için `text/csv; charset=utf-8`; dosya adı `accounting-<kind>-<başlangıç>_<bitiş>.<biçim>`
  (`Content-Disposition: attachment`).
- `delimiter`: `semicolon` (`;`, varsayılan) veya `comma` (`,`); yalnızca CSV.
  Karakterin kendisi (`;` veya `,`, URL kodlu) da kabul edilir.
- `locale`: XLSX ve CSV başlık satırının dili (`tr`, `en`, `en-GB` gibi);
  verilmezse işletmenin varsayılan dili. Başlıklar `accounting.col.*`
  anahtarlarıdır ve dilin **etkin** mesajlarından çevrilir: paketle gelen
  çeviri (`tr`, `en`), süper adminin yüklediği dil paketi ve CMS
  üzerinden yapılan düzeltmeler (`I18nService.getLocaleMessages`, herkese
  açık i18n uç noktasıyla aynı kaynak). Bölgesel bir dilde (`en-GB`) önce o
  dilin, sonra ana dilin (`en`) değerleri kullanılır; çevrilmemiş anahtar
  Türkçe temel katalogdan gelir. Kapalı veya bilinmeyen dil paketle
  gelen çeviriye düşer.
- Her dışa aktarım `AuditLog`'a `accounting.export` olarak yazılır.

## Satış ve iade defteri (`kind=sales`)

Bir satırın sütunları: `date`, `entryType` (`SALE` veya `REFUND`),
`documentNumber`, `invoiceNumber`, `customerName`, `description`, `net`,
`taxRate`, `tax`, `gross`, `currency`, `paymentMethod`, `providerReference`,
`paymentId`, `branchId`.

- Kapsam: durumu tamamlandı veya iade edildi olan her ödeme (paket, etkinlik,
  perakende, abonelik), **misafir ve kayıtsız müşteri ödemeleri dahil**
  (migration `20261009000000_guest_payments` ile `payments.member_id` boş
  olabilir; bkz. aşağıda "Misafir ve kayıtsız müşteri ödemeleri"). Bekleyen
  ve başarısız ödemeler yoktur.
- Müşteri: perakende satışta fiş üzerindeki ad, yoksa üyenin adı, yoksa
  ödemenin CRM kişisinin adı, hiçbiri yoksa istenen dilde "Kayıtsız müşteri"
  (`finance.payments.walkIn`).
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

## Misafir ve kayıtsız müşteri ödemeleri

Sahip kararı (G3c sonrası): misafir ve kayıtsız müşteri ödemeleri finansa girer.

- `payments.member_id` boş olabilir; yeni `payments.contact_id` (CRM kişisi,
  `ON DELETE SET NULL`) üye olmayan ödeyeni tanımlar. İkisinin de boş olması
  serbesttir (anonim perakende satışı), bu yüzden bir CHECK kısıtı yoktur.
  Kişinin aynı işletmeye ait olması, `sales.contact_id` ve
  `event_registrations.contact_id` ile aynı desende, yazan servislerde
  (kişi her zaman `studioId` ile aranır) sağlanır.
- Etkinlik: misafirin masada ödemesi (kayıt sırasında veya "Ödemeyi al")
  `memberId` boş, `contactId` kaydın kişisi olan bir `Payment` yazar; kaydın
  `payment_id`, `amount_paid` ve `payment_method` alanları bu ödemeyle
  birlikte yazılır. İade normal ödeme iadesinden geçer
  (`PaymentsService.refundPayment`), kaydın `refunded_amount` alanı ödemeyle
  eşitlenir.
- Perakende: her satış bir `Payment` yazar (`memberId` üye varsa, `contactId`
  kişi seçildiyse, ikisi de yoksa anonim); iadeler bu ödemeyi, üye
  satışlarında olduğu gibi aynı işlemde günceller.
- Finans ödeme listesi (`GET /payments`) `contactId` ve `contactDisplayName`
  döner; web finans ekranı üye yoksa kişi adını ve "Misafir" etiketini,
  kişi de yoksa "Kayıtsız müşteri" yazar.
- Webhook: `payment.completed` ve `payment.refunded` yükleri artık `memberId`
  (misafirde `null`), `contactId`, tutar ve para birimini taşır.
- CRM: misafir ödemesi kişiye `purchase` dönüşümü yazar, yaşam döngüsünü
  değiştirmez (tek ödeme kimseyi üye yapmaz); anonim ödeme atlanır.
  Sadakat puanı yalnızca üyeye verilir. E-fatura alıcısı kişinin adı, kişi
  yoksa işletme dilinde "Kayıtsız müşteri"dir (e-Arşiv genel tüketici).
- Raporlar: gelir raporu tüm ödemeleri sayar; üye raporundaki ARPU ve süper
  admin karşılaştırmasındaki üye başına gelir yalnızca üyeli ödemeleri
  sayar (önceki anlam korunur).
- **Eski veri:** bu sürümden önce oluşan misafir etkinlik kayıtları ve
  kayıtsız müşteri satışlarının `Payment` satırı yoktur ve dışa aktarımda
  görünmez. Migration yalnızca şemayı değiştirir, geriye dönük para kaydı
  üretmez. Geçmiş dönemlerin tamamlanması istenirse ayrı, tekrar
  çalıştırılabilir bir yönetici betiği yazılmalıdır (sahip kararı, aşağıda).
  Bu tür eski bir misafir kaydının iadesi eskisi gibi yalnızca kayıtta
  işaretlenir.
- Daraltma (contract) adımı gerekmez: kolon boş olabilir kalır.

## Biçimler

- XLSX (varsayılan): **para birimi başına bir sayfa**, sayfa adı para birimi
  kodudur (`EUR`, `TRY`, ...). Seçilen düzen budur çünkü bir sayfa hiçbir
  zaman iki para birimini karıştırmaz, süzgeç ve sıralama ara toplam
  satırlarını bozmaz ve muhasebeci her para birimini ayrı defter gibi
  açabilir. Para birimi sütunu satırlarda kalır. Kayıt olmayan dışa aktarım
  işletmenin para biriminde yalnızca başlıklı tek sayfadır.
  - Başlık satırı kalın, dondurulmuş ve otomatik süzgeçlidir; sütun
    genişlikleri içeriğe göre (10 ile 50 karakter arası) ayarlanır.
  - Tutarlar gerçek sayıdır; biçim para biriminin küçük birimine göredir
    (`#,##0.00`, JPY gibi ondalıksız para birimlerinde `#,##0`). Vergi oranı
    ve satır sayısı sayıdır. Tarihler tarih hücresidir (UTC,
    `yyyy-mm-dd hh:mm:ss`).
  - Diğer her şey metin hücresidir; hiçbir hücre formül değildir. `=` ile
    başlayan metin de metin hücresi olarak yazılır ve çalıştırılmaz, bu
    yüzden XLSX'te tek tırnak öneki gerekmez (değer olduğu gibi kalır).
  - Satış ve gider defterinde her sayfanın altında, bir boş satırdan sonra
    kalın bir "Toplam" satırı vardır (tutar sütunları; küçük birimlerle
    hesaplanır, formül değildir, iadeler düşülmüştür). Özet zaten bir
    toplamlar tablosu olduğu için toplam satırı yoktur.
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

- Saf satır kurucuları, para birimi gruplama, CSV ve XLSX hücre tipleri /
  sayfa gruplama / toplamlar: `packages/shared/src/accounting.ts` (birim
  testler: `accounting.spec.ts`; yuvarlama, para birimi gruplama, CSV kaçışı,
  formül koruması, hücre tipleri).
- XLSX yazıcısı: `apps/api/src/modules/accounting/accounting-xlsx.ts`
  (düzen ve hücre eşlemesi) ile bağımlılıksız yazıcı
  `apps/api/src/modules/accounting/xlsx/` (`xlsx-writer.ts`: SpreadsheetML
  parçaları, `xlsx-primitives.ts`: CRC-32, XML kaçışı, sütun/hücre
  başvurusu, Excel seri tarihi, sayfa adı kuralları, ZIP kabı). Yalnızca
  Node yerleşikleri (`zlib.deflateRawSync`) kullanılır; CRC-32 tablo ile
  elle hesaplanır (`zlib.crc32` Node 20'de yoktur). Node'a özgü olduğu için
  `packages/shared` (web ve mobil de kullanır) içine değil API'ye konur.
  Yazıcı hücre olarak yalnızca sayı, satır içi metin (`inlineStr`) ve tarih
  (biçimli sayı) bilir; `<f>` (formül) öğesi yazacak bir kod yolu yoktur.
  Geçersiz XML 1.0 karakterleri atılır, sayfa adları Excel kurallarına
  (en fazla 31 karakter, `[]:*?/\` yok) göre temizlenir ve tekilleştirilir,
  4 GB üstü arşiv hata verir (ZIP64 yok).
  Neden `exceljs` değil: PR #95'teki `exceljs@4.4.0` yaklaşık 58 geçişli
  paket getiriyordu; biri (`jszip`) GPL-3.0 ile çift lisanslıydı (politika
  gereği yasak) ve 12'si zayıf OpenSSF Scorecard puanlıydı. Tedarik zinciri
  yüzeyini sıfırlamak için küçük ve denetlenebilir kendi yazıcımız var.
  Birim testler: `xlsx/xlsx-primitives.spec.ts` (CRC-32 bilinen değerler,
  kaçış, sütun harfleri, tarih seri numarası, sayfa adı, ZIP) ve
  `accounting-xlsx.spec.ts`; ikisi de çıktıyı test amaçlı küçük bir ZIP
  okuyucu (`xlsx/xlsx-test-reader.ts`, merkezi dizin + `inflateRawSync`)
  ile geri okur: gerekli parçalar, hiç `<f>` olmaması, `=` ile başlayan
  metnin `inlineStr` olması, sayı hücreleri, toplam satırı, para birimi
  sayfaları. Çıktı ayrıca harici olarak openpyxl ile doğrulandı.
- Başlık çevirisi: `accounting-i18n.ts` (`I18nService` etkin mesajları;
  birim test `accounting-i18n.spec.ts`, bir geçersiz kılmanın başlığa
  yansıması).
- Yükleme ve uç nokta: `apps/api/src/modules/accounting`; e2e:
  `apps/api/test/e2e/accounting.e2e-spec.ts` (izin reddi, kiracı ve şube
  izolasyonu, BOM, formül kaçışı, negatif iade, para birimi ayrımı) ve
  `apps/api/test/e2e/guest-payments.e2e-spec.ts` (misafir etkinlik ve
  kayıtsız perakende ödemeleri finans listesinde ve dışa aktarımda, iadeleri
  negatif, varsayılan XLSX dosyasının ayrıştırılması ve dil paketi
  başlığı, CSV ayraç, kiracı izolasyonu).
- Web: `/finans` sayfasındaki "Muhasebe dışa aktarımı" kartı
  (`apps/web/src/components/finance/AccountingExportCard.tsx`); biçim seçimi
  varsayılan olarak XLSX'tir, ayraç seçeneği yalnızca CSV'de görünür. Dosya
  BFF üzerinden (`/api/bff/studios/:studioId/accounting/export`) indirilir;
  BFF JSON olmayan yanıtları bayt olarak (`arrayBuffer`) ve
  `content-type` / `content-disposition` başlıklarıyla aynen geçirir
  (`apps/web/src/lib/bff/proxy-response.ts`, test: XLSX baytları).

## Bilinen sınırlar

- Ödemelerde ayrı bir vergi kaydı yoktur; paket ve etkinlik ödemelerinin
  vergisi varsayılan orandan türetilir. Farklı oranlı paketler için ürün
  başına oran gerekir (ileride).
- Hediye kartı veya promosyonla ödenen kısım ayrı bir ödeme yöntemi satırı
  değildir; ödeme tutarı tek yöntemle yazılır.
- Bu sürümden önceki misafir etkinlik ödemeleri ve kayıtsız müşteri
  satışları dışa aktarımda yoktur (yukarıda "Eski veri").

## Sahip kararları

1. **Eski misafir ve kayıtsız müşteri satışları için geriye dönük ödeme
   kaydı:** migration saf şemadır ve para satırı üretmez. İstenirse ayrı,
   tekrar çalıştırılabilir bir yönetici betiği (ör. `payment_id` boş olan
   `sales` ve `amount_paid > 0` olan misafir `event_registrations` için,
   satış / kayıt tarihiyle `Payment` yazan ve bağlayan) ayrı bir PR'da
   yazılabilir. Karar verilene kadar geçmiş dönemlerin dışa aktarımı bu
   tutarları içermez.
2. **XLSX düzeni:** para birimi başına sayfa seçildi (tek sayfa + para
   birimi ara toplam satırları yerine). Tek sayfa istenirse satır kurucuları
   değişmeden yalnızca yazıcı değiştirilir.
