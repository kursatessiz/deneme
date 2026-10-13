# Sayfa Motoru (G2c)

Bu belge, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.9 (sayfa motoru) ve bölüm 5 (platform açılış sayfaları) maddelerinin G2c fazında nasıl uygulandığını anlatır. Bağlayıcı tasarım o belgedir; bu belge uygulamanın ayrıntısıdır.

## 1. Özet

- `Site` -> `Page` -> `Block` modeli: her kiracının en fazla bir sitesi vardır (`kind`: `PLATFORM` platform kiracısı için, `TENANT` diğer her kiracı için). Platform sitesi `docs/CRM_VE_ATIF.md`'deki platform kiracısı (`Studio.isPlatform`) üzerinde yaşar.
- Sayfa (`Page`) bir tür (`HOME`, `LANDING`, `CORPORATE`, `LEGAL`, `CUSTOM`), isteğe bağlı sektör ve teklif (offer) anahtarı taşır; her dilde ayrı bir `PageLocale` (slug, SEO alanları, hukuki onay) vardır. İçerik dilden bağımsız blok yapılandırması + dile göre metinlerden (`Block.text[locale]`) oluşur.
- Yayınlama (`publish`) o anki blok kümesinin değişmez bir anlık görüntüsünü (`PageVersion`) yazar; geri alma (rollback) bir önceki sürümü yeniden yayınlar.
- Bloklar `packages/shared/src/sites/blocks.ts` içinde Zod ile tipli ve doğrulanmıştır; metin her zaman düz metin olarak render edilir (asla HTML), görseller yalnızca kendi yükleme deposundan gelen URL'lerdir.
- Formlar mevcut herkese açık aday ucunu (`POST /public/studios/:slug/leads`, `docs/CRM_VE_ATIF.md`) kullanır; KVKK/GDPR onay metni, gizli alan ve hız sınırı zaten o uçta vardır.
- A/B varyantı ziyaretçiye birinci taraf çerezle (analiz izni varsa `pw_vid`, yoksa istek imzasından türetilen oturumluk bir kimlikle) sabitlenir; dönüşüm `TouchpointInput.pageVariant` ile taşınır.

## 2. Veri modeli

| Model | Açıklama |
|---|---|
| `Site` | `studioId` (benzersiz, bir kiracının en fazla bir sitesi olur), `kind`, `primaryDomain`, `defaultLocale`, `enabledLocales` (string dizisi) |
| `SiteDomain` | `siteId`, `domain`, `status` (`PENDING`/`VERIFIED`/`FAILED`), `verificationToken` (DNS TXT değeri), `verifiedAt` |
| `Page` | `siteId`, `kind`, `sectorKey`, `offerKey`, `internalLabel` (yalnızca yönetim panelinde görünür, çevrilmez), `status` (`DRAFT`/`PUBLISHED`), `abGroupKey` (varyant grubu), `publishedAt` |
| `PageLocale` | `pageId`, `locale`, `slug` (dile göre benzersiz yol), `seoTitle`, `seoDescription`, `ogImageUrl`, `legalApproved`, `legalApprovedAt` |
| `Block` | `pageId`, `type` (bkz. bölüm 3), `position`, `abVariantKey` (aynı pozisyonda birden çok varyant), `data` (JSON; `config` dilden bağımsız, `text` dile göre haritalanmış) |
| `PageVersion` | Yayınlanan anın değişmez anlık görüntüsü: `pageId`, `version` (artan), `snapshot` (JSON: o andaki tüm `PageLocale` + `Block` verisi), `publishedAt`, `publishedByUserId` |
| `CompanyInfo` | Tekil satır (platform şirket bilgisi): unvan, adres, MERSIS, ticaret sicil no, vergi dairesi/no, e-posta, telefon, sosyal medya bağlantıları (JSON) |

Kısıtlar: `Site.studioId` benzersiz; `(Site.id, PageLocale.locale, PageLocale.slug)` benzersiz (aynı dilde iki sayfa aynı yolu paylaşamaz); `SiteDomain.domain` genel benzersiz. Migration: `20261001000000_sites` (mevcut tüm migration'lardan sonra sıralanır, yalnızca ileri yönlü, drift kontrolünden temiz geçer).

İzinler: `site.view` (görüntüleme), `site.manage` (düzenleme, yayınlama, alan adı ayarlama); katalogda Türkçe etiketle (`packages/shared/src/permissions.ts`), "Web sitem" grubunda, kiracı sahibi varsayılan olarak ikisine de sahiptir (CLAUDE.md kural 5). Platform sitesi de aynı uçlar üzerinden, platform kiracısının `studioId`'siyle, yalnızca süper admin tarafından yönetilir (`StudioTenantGuard` süper admin'e her `studioId` üzerinde her izni verir).

## 3. Bloklar

`packages/shared/src/sites/blocks.ts`, her tür için ayrı bir Zod şeması ve tek bir `BLOCK_SCHEMAS` haritası tanımlar; `validateBlockData(type, data)` API'de her yazımda çalışır.

| Tür | Kullanım |
|---|---|
| `hero` | Başlık bandı: eyebrow, başlık, alt başlık, birincil/ikincil CTA, arka plan görseli |
| `feature_grid` | Özellik listesi (başlık + açıklama, en fazla 12) |
| `sector_cards` | Sektör kartları; `config.sectorKeys` hangi `BusinessTypeTemplate` anahtarlarının hangi sırada gösterileceğini seçer, metinler o şablonun kelime dağarcığından ve i18n'den üretilir |
| `how_it_works` | Adım listesi |
| `pricing` | Platform sitesinde `Plan`, işletme sitesinde `PackageDefinition` okur; `config.hidden` fiyatları gizler |
| `testimonials` | Yorumlar (veri, kodda sabit metin değil) |
| `faq` | Soru/cevap; ayrıca `FAQPage` JSON-LD üretir |
| `stats` | Etiket/değer çiftleri |
| `cta` | Tek eylem çağrısı |
| `lead_form` | `POST /public/studios/:slug/leads`'e gönderir; bölge onay metni ve bot koruması var olan uçtan miras alınır |
| `booking_widget` | Yalnızca işletme siteleri; mevcut herkese açık rezervasyon akışına bağlanır |
| `trainers` | Yalnızca işletme siteleri; elle girilmiş eğitmen listesi |
| `contact` | `CompanyInfo` (platform) veya kiracının iletişim bilgileri (işletme sitesi) |
| `legal_text` | Serbest metin (paragraf), yalnızca düz metin |

`TENANT_ONLY_BLOCK_TYPES` (`booking_widget`, `trainers`) platform sitesinde reddedilir (API 400, editör bu türleri göstermez).

## 4. Yayınlama ve render

Rota yapısı (`apps/web/src/app/[locale]/[[...slug]]/page.tsx`, platform sitesi):

- `/{dil}` -> `HOME`
- `/{dil}/{sektör}` -> sektör `LANDING`
- `/{dil}/{sektör}/{teklif}` -> kampanya varyantı
- `/{dil}/{slug}` -> `CORPORATE` / `LEGAL` / `CUSTOM`

İşletme siteleri aynı motoru `apps/web/src/app/tenant-site/[studioSlug]/[locale]/[[...slug]]/page.tsx` üzerinden, `<slug>.<platform-alan-adı>` alt alan adında veya doğrulanmış özel alan adında, `middleware.ts`'in host çözümlemesiyle (`/public/sites/resolve`) sunar.

- Yalnızca yayınlanan (`PUBLISHED`) diller render edilir; olmayan veya yayınlanmamış bir dil/slug kombinasyonu 404'tür (`resolvePageLocale`, `packages/shared/src/sites/site.ts`).
- Sayfalar ISR ile önbelleğe alınır (S3): ilk istekte render edilir, en fazla 300 saniye önbellekten servis edilir ve yayında `POST /api/revalidate` (etiket `site:<slug>`) ile temizlenir. Kök layout sayfa dilini URL'den alır, hiçbir istek verisi okumaz; canonical kökeni API'nin `settings.canonicalOrigin` alanından gelir. A/B varyantı çereze bağlı olduğundan, iki veya daha çok `abVariantKey` taşıyan sayfalar `/{dil}/_dynamic/...` rotasında istek başına render edilir (middleware yönlendirir). Ayrıntı ve takaslar: `docs/SEO.md` bölüm 11. `<html lang>` her zaman sayfanın URL'deki dilidir.
- `hreflang`, `canonical`, Open Graph/Twitter etiketleri ve JSON-LD (`Organization`, `LocalBusiness`, `WebSite`, `BreadcrumbList`, `FAQPage`, `SoftwareApplication`, `Product` + `Offer`) `apps/web/src/lib/sites/jsonld.ts` ve `SitePage.tsx`'te üretilir; `hreflang` yalnızca o sayfanın yayınlanmış dil varyantları için yazılır ve sitenin varsayılan dilindeki varyanta (yoksa ilk varyanta) işaret eden bir `x-default` içerir. Canonical ve alternatifler API'nin verdiği host'tan bağımsız kökeni kullanır (doğrulanmış özel alan adı, yoksa `<slug>.<alan>`; `docs/SEO.md` bölüm 11). Ayrıntılar: `docs/SEO.md`.
- `sitemap.xml` ve `robots.txt` (`apps/web/src/app/sitemap.xml/route.ts`, `.../robots.txt/route.ts`) istek host'una göre platform veya ilgili işletme sitesi için üretilir. `sitemap.xml` her dil varyantı için ayrı bir `<url>` yazar ve her biri sayfanın tam `hreflang` kümesini (`x-default` dahil) taşır; `/` listelenmez; platform sitesinde ana sayfanın `x-default` girdisi `/`'e işaret eder. `robots.txt` dizinlenmeyen yollar için `Disallow` satırları içerir (`docs/SEO.md`).
- `/` sayfa motoruna devredildi (S2a, sahibin kararı): artık bir sayfa değil, dil müzakereli bir yönlendirmedir (`apps/web/src/app/route.ts`). Ziyaretçinin dili (`pw_locale` çerezi, sonra `Accept-Language`) platform ana sayfasının yayınlandığı dillerle sınırlanır (`lib/sites/root-locale.ts`; yayınlı dil listesi önbellekli `sitemap-entries` okumasından gelir), uygun dil yoksa sitenin varsayılan dili, o da yoksa `BASE_LOCALE` kullanılır; yanıt `302` + `Vary: Accept-Language, Cookie` ile `/<dil>`'e gider. Eski kodla yazılmış açılış sayfasının içeriği (hero, altı özellik, dört adım, sektör listesi) platform ana sayfasının tohum bloklarına (`PLATFORM_HOME_PAGE_DEFAULT`, `packages/database/src/platform-defaults.ts`) taşındı; `landing.*` i18n anahtarları kaldırıldı. Not: ana sayfa yalnızca site oluşturulurken tohumlanır, mevcut ortamlardaki ana sayfa süper admin panelinden güncellenir.

### Tasarım dili (T6)

Sayfa motoru blokları ve işletme/platform siteleri Perfect UI kitiyle (`docs/TASARIM.md`) çizilir; `BlockRenderer`, `LeadFormBlock` ve `SitePage` satır içi renk, köşe veya tipografi yazmaz, `components/ui` bileşenlerini ve `ui-*` yardımcı sınıflarını kullanır. Tailwind yalnızca yerleşim içindir (grid, flex, boşluk, genişlik).

| Blok | Çizim |
|------|-------|
| `hero` | `ui-display` başlık (tek `h1`), `ui-lead` alt metin, `LinkButton` (düz birincil + `outline surface` ikincil), üst etiket `Badge` |
| `feature_grid`, `trainers`, `how_it_works` | `Card`/`CardContent` ızgarası (tek seviye kart); adım numarası `Badge` |
| `sector_cards` | `pui-card ui-card-link` bağlantı kartları |
| `pricing` | plan fiyatı `Card` + `ui-stat-value`; işletme paketleri `ui-gradient-package-card` (gradyanın izinli iki alanından biri); tutar `formatMoney()` ile etkin dilde ve kendi para birimiyle |
| `testimonials` | `Card` içinde `blockquote` + `ui-rail` |
| `faq` | `Accordion` (yerel `<details>`, istemci JS yok) |
| `stats`, `cta`, `contact`, `booking_widget`, `legal_text` | `ui-title`/`ui-caption`, `ui-rule` ayracı, `LinkButton` |
| `lead_form` | `FieldGroup` + `Input`/`Textarea`/`Checkbox` + `Button`; bal tuzağı ve 1,5 saniye kuralı aynı |

Platform sitesi platform kiracısının, işletme siteleri işletmenin markasını `SitePage` içinde `ThemeRoot` ile alır (`page.theme`, sistem açık/koyu modu); gömülebilir widget ile herkese açık rezervasyon sayfası aynı çözümlemeyi (`resolveTheme()`) kullanır. Sunucuda render, çapa kimlikleri (`#iletisim`/`#contact`), `hreflang` ve `sitemap.xml` davranışı değişmedi; istemci JS yalnızca form, izin ve izleme içindir. Hukuki taslak bandı `role="note"` ile `ui-panel` olarak çizilir.

### A/B testi

`packages/shared/src/sites/ab.ts` + `apps/web/src/lib/sites/ab.ts`: bir sayfanın bloklarında birden çok `abVariantKey` varsa, ziyaretçinin sticky kimliği (izin varsa `pw_vid`/`pw_sid` çerezi, yoksa istekten türetilmiş, hiçbir yerde saklanmayan bir özet) üzerinden deterministik olarak bir varyant seçilir (FNV-1a tabanlı, kriptografik olmayan dağıtım). Seçilen varyant `TouchpointInput.pageVariant` alanıyla izleme istemcisine iletilir, böylece dönüşüm raporları varyanta göre kırılabilir.

## 5. Editörler

**Süper admin -- "Web sitesi"** (`apps/web/src/app/(app)/admin/web-sitesi/page.tsx`): platform sitesinin sayfaları (dil bazlı durum), blok editörü (`SiteEditor`, `components/ui` üzerinde; ekle/sırala/kaldır, her blokta isteğe bağlı A/B varyant anahtarı alanı ve alan tabanlı blok formu, bölüm 5a), canlı önizleme, yayınla/yayından kaldır, sürüm geçmişi + geri alma, şirket bilgisi formu (`CompanyInfo`), sektör açılış sayfası sihirbazı (`POST sites/studio/:studioId/pages/wizard`: sektör + teklif + dil listesi seçilir, `BusinessTypeTemplate` kelime dağarcığından önceden doldurulmuş bir `LANDING` sayfası oluşturur).

**Kiracı -- "Web sitem"** (`apps/web/src/app/(app)/(dashboard)/ayarlar/web-sitem/page.tsx`, `site.manage`/`site.view`, sahip varsayılan): yalnızca kendi sitesi, özel alan adı kurulumu ve doğrulaması (DNS TXT + CNAME), rezervasyon/eğitmen/fiyat blokları dahil aynı editör bileşeni (`components/sites/SiteEditor.tsx`).

Ortak bileşen `SiteEditor.tsx` her iki panelde de kullanılır; `TENANT_ONLY_BLOCK_TYPES` platform sitesinde gizlenir.

### 5a. Alan tabanlı blok formları (S3)

Blok verisi artık ham JSON olarak düzenlenmez: `components/sites/BlockForm.tsx` her blok türü için formu, `packages/shared/src/sites/blocks.ts` içindeki Zod şemasından üretir (`deriveBlockFormSpec`, `packages/shared/src/sites/block-form.ts`). Bir şemaya alan eklendiğinde form editöre dokunmadan o alanı gösterir.

- **Alan türleri**: kısa metin (`Input`), uzun metin (`Textarea`; 200 karakteri aşan alanlar), görsel adresi ve bağlantı hedefi (`Input`), anahtar (`Switch`), sabit seçenek listesi (`ChipButton`; `lead_form.fields`), tekrarlanan öğe listesi (SSS, özellik, adım, yorum, değer, eğitmen: öğe başına alanlar, ekle/kaldır, şemadaki üst sınırda ekleme düğmesi kapanır) ve sektör seçici (`sector_cards.sectorKeys`: süper adminde `GET /admin/business-type-templates` ile `Select`, liste yüklenemezse virgülle ayrılmış anahtar alanı).
- **Diller**: metin alanları `ChipButton` ile dil seçilerek düzenlenir (sitenin etkin dilleri ve blokta metni olan diller); metni olmayan dil "çevrilmedi" rozeti taşır. Bir dilin tüm alanları boşaltılırsa o dilin girdisi silinir (sayfa varsayılan dile düşer); boşaltılan isteğe bağlı alan JSON'dan çıkar.
- **Doğrulama**: form, bloğun şemasını (`BLOCK_SCHEMAS`) her değişiklikte çalıştırır ve her sorunu ilgili alanın altında, arayüz dilinde gösterir (`describeIssue`: zorunlu, çok uzun, çok kısa, çok az/çok fazla öğe, geçersiz adres, yalnızca https, geçersiz bağlantı; şemanın kendi metni gösterilmez). Hatalı blok varsa "Blokları kaydet" göndermez ve kaç bloğun düzeltilmesi gerektiğini söyler; API aynı şemayla yine doğrular.
- **Gelişmiş (JSON)**: her blokta kapalı bir `details` bölümü, formun kapsamadığı her şey için ham JSON'u gösterir; geçerli JSON yazıldığında form güncellenir, geçersizken son geçerli değer korunur.
- **Kayıt yükü değişmedi**: `PUT sites/studio/:studioId/pages/:pageId/blocks` gövdesi aynı `[{ type, position, abVariantKey, data }]` dizisidir. Yeni bloğun başlangıç verisi (`newBlockData`) şemaya uyar ve çevrilmiş başlangıç metinlerini (`sites.editor.blocks.template.*`) sitenin varsayılan diline yazar.
- **i18n**: tüm etiketler ve hata iletileri `sites` ad alanındadır (`sites.editor.blocks.field.*`, `.items.*`, `.choice.*`, `.error.*`, `.form.*`, `.advanced.*`); testler her türetilen alan için tr ve en etiketin var olduğunu doğrular.
- **Testler**: `packages/shared/src/sites/block-form.spec.ts` (şemadan alan türetme: her blok türü, tür ve sınırlar), `apps/web/src/lib/sites/block-form.spec.ts` (yol düzenlemeleri, doğrulama iletileri, etiket anahtarları, başlangıç verisi), Playwright `apps/web/e2e/site-editor.e2e.ts` (süper admin form ile hero bloğu oluşturur, satır içi hata, JSON görünümü, yayın; SSS tekrarlanan öğeleri; yalnızca CI'da).

## 6. Uçlar

Tüm kiracı uçları `sites/studio/:studioId` altında, `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` ile korunur (`apps/api/src/modules/sites/sites-tenant.controller.ts`):

| Uç nokta | İzin |
|---|---|
| `GET /sites/studio/:studioId` (siteyi tembel oluşturur yoksa) | `site.view` |
| `PATCH /sites/studio/:studioId` (varsayılan/etkin diller, birincil alan adı) | `site.manage` |
| `POST/DELETE .../domains`, `POST .../domains/:domainId/verify` | `site.manage` |
| `GET/POST .../pages`, `POST .../pages/wizard` | `site.view` / `site.manage` |
| `GET/DELETE .../pages/:pageId` | `site.view` / `site.manage` |
| `PUT/DELETE .../pages/:pageId/locales/:locale` | `site.manage` |
| `PATCH .../pages/:pageId/locales/:locale/legal-approval` (yalnızca `LEGAL` sayfalarda) | `site.manage` |
| `PUT .../pages/:pageId/blocks` (tüm blok kümesini değiştirir, tür başına şema doğrulaması) | `site.manage` |
| `POST .../pages/:pageId/publish` \| `unpublish` | `site.manage` |
| `GET .../pages/:pageId/versions`, `POST .../versions/:versionId/rollback` | `site.view` / `site.manage` |
| `GET/PUT /admin/company-info`, `GET /admin/company-info/platform-studio-id` | yalnızca süper admin |

Herkese açık, kimliksiz uçlar (`apps/api/src/modules/sites/public-sites.controller.ts`):

| Uç nokta | Amaç |
|---|---|
| `GET /public/sites/resolve?host=` | Web middleware'i: bir Host başlığı hangi siteye ait |
| `GET /public/sites/:studioSlug/pages?locale=&slug=` | Bir sayfanın yayınlanmış tek dil hali; yayınlanmamış/bilinmeyen 404 |
| `GET /public/sites/:studioSlug/sitemap-entries` | `sitemap.xml` için yayınlanmış sayfa listesi (`items`), sitenin varsayılan dili (`defaultLocale`) ve S2b'den beri geriye uyumlu biçimde yayınlanmış yazı varyantları (`articles`) |
| `GET /public/sites/:studioSlug/articles`, `.../articles/:slug`, `.../article-tags`, `.../feed/:locale` | Blog okumaları ve RSS beslemesi (bölüm 11, `docs/PUBLIC_API.md`) |
| `GET /public/domains/ask?domain=` | Caddy on-demand TLS "ask" uç noktası; hız sınırlıdır (`SitesPublicRateLimitGuard`), yalnızca aktif bir kiracının doğrulanmış özel alan adı veya `<slug>.<SITES_DOMAIN>` alt alan adı için 200 döner, başka her şey 404 |

## 7. Özel alan adları

Akış: kiracı alan adını ekler (`POST .../domains`) -> API bir `verificationToken` üretir ve beklenen DNS kayıtlarını döner (`expectedDnsRecords`, `packages/shared/src/sites/domain.ts`: TXT doğrulama kaydı + CNAME hedefi platformun alan adı) -> kiracı DNS'te bu kayıtları ekler -> `POST .../domains/:domainId/verify` DNS'i sorgular (`DnsVerificationService`, gerçek `dns.resolveTxt`/`resolveCname`) ve durumu `VERIFIED`/`FAILED` yapar. Bir alan adını yalnızca doğrulanmış (`VERIFIED`) bir kayıt veya sitenin kendi kaydı engeller (`409`); başka bir sitenin doğrulanmamış kaydı sahiplik kanıtı olmadığı için yeni talep edene taşınır, yeni bir `verificationToken` üretilir ve doğrulama baştan başlar (DNS'i kim yönetiyorsa o doğrular).

`deploy/caddy/Caddyfile`, `on_demand_tls` ile `ask http://api:4000/public/domains/ask` çağıran genel bir ayar ve `WEB_DOMAIN`/`API_DOMAIN` ile eşleşmeyen her host için `web:3000`'e yönlenen bir `:443` yakalayıcı (catch-all) bloğu içerir; böylece hem `<slug>.{$SITES_DOMAIN}` alt alan adları hem de doğrulanmış özel alan adları ilk istekte otomatik sertifika alır. `SITES_DOMAIN` ortam değişkeni ayarlanmazsa `WEB_DOMAIN`'e düşer.

**Sahibin sağlaması gereken**: `SITES_DOMAIN` DNS'inde `*.{$SITES_DOMAIN}` için (veya alt alan adı başına) Caddy sunucusuna işaret eden bir A/AAAA kaydı; joker (wildcard) bir kapsayıcı sertifika istenirse ayrıca bir DNS-01 sağlayıcı eklentisi ve API anahtarı gerekir (şu an kurulu değildir, on-demand HTTP-01 her alt alan adı için ayrı sertifika alır, bu 6 GB RAM'lik sunucuda beklenen kiracı sayısı için yeterlidir).

## 8. Kampanya açılış sayfası oluşturma

1. Süper admin panelinde "Web sitesi" -> "Sektör açılış sayfası oluştur" sihirbazını aç.
2. Sektör anahtarını (`BusinessTypeTemplate.key`), isteğe bağlı bir teklif anahtarı (örn. `ucretsiz-deneme`) ve yayınlanacak dilleri seç.
3. Sihirbaz `hero`, `feature_grid`, `sector_cards`, `lead_form`, `faq`, `cta` bloklarıyla önceden doldurulmuş bir `LANDING` sayfası oluşturur; metinler seçilen sektörün kelime dağarcığından ve i18n'den gelir.
4. Blok editöründe metni düzenle, gerekirse `abVariantKey` ile bir varyant ekle, yayınla.
5. Sonuç URL'si `/{dil}/{sektör}` veya teklif verildiyse `/{dil}/{sektör}/{teklif}` olur; bu tam URL, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 4'teki UTM oluşturucuya açılış sayfası olarak girilir (oluşturucu URL'nin var olduğunu ve dilin etkin olduğunu doğrular).

## 9. Kararlar ve sınırlar

- **Hukuki taslak bandı**: yasal sayfalar (`kind = LEGAL`) her zaman `legalApproved = false` olarak başlar (seed dahil); süper admin panelden dil başına onaylamadan görünür bir "taslak, hukuki incelemeden geçmeli" bandıyla render edilir. Onay `PageLocale` düzeyindedir (bir dil onaylı, diğeri taslak olabilir).
- **Görsel kaynağı**: bloklardaki her görsel alanı yalnızca kendi yükleme deposu URL'sini kabul eder (Zod `url()` + iş kuralı; dışarıdan rastgele bir görsel URL'si yazılamaz); metin alanları HTML olarak asla render edilmez.
- **Fiyat gizleme**: `pricing` bloğunun `config.hidden` anahtarı, kampanya sayfalarında fiyatın gösterilmemesi istendiğinde bloğu tutar ama render etmez.
- **AB test raporlaması**: bu fazda yalnızca varyant ataması ve `pageVariant`'ın izleme istemcisine iletilmesi vardır; varyant başına dönüşüm oranı raporu `docs/CRM_VE_ATIF.md`'deki atıf raporunun `pageVariant` kırılımıyla ileride eklenecektir.
- **Joker sertifika**: yukarıda bölüm 7'de açıklandığı gibi, şimdilik alt alan adı başına on-demand sertifika; ölçek büyüdükçe bir DNS-01 sağlayıcısına geçiş sahibin kararıdır.

## 10. Nasıl test edilir

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test          # birim testleri (shared: blok şemaları, dil düşümü, hreflang/sitemap; api: sites servisleri)

# Postgres + Redis çalışırken
export DATABASE_URL=postgresql://u:pw@localhost:5432/g2c_test
cd packages/database
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm db:seed                                 # platform sitesi: 2 dilde kurumsal + yasal sayfalar, en az iki sektör açılış sayfası

cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js

cd ../web
pnpm exec playwright test --reporter=list    # platform ana sayfa (tr/en), bir sektör sayfası, form akışı, yasal taslak bandı, yayınlanmamış dil 404'ü
```

İlgili testler:

- Birim: `packages/shared/src/sites/sites.spec.ts` (blok şemaları, `resolveBlockText` dil düşümü, `buildHreflangAlternates`, `assignVariant` determinizmi, `expectedDnsRecords`).
- API e2e: `apps/api/test/e2e/sites.e2e-spec.ts` (izin ve kiracı izolasyonu, sayfa yaşam döngüsü, yayınlama/sürüm/geri alma, sektör sihirbazı, özel alan adı doğrulama akışı ve `ask` uç noktası, herkese açık render + sitemap girdileri + host çözümleme, yayınlanmış bir açılış sayfasından form gönderimi -> `Contact` + `lead` dönüşümü, şirket bilgisi).
- Web e2e (Playwright, CI'da çalışır, bu ortamda `playwright install` engellendiği için burada koşulmamıştır): `apps/web/e2e/sites.e2e.ts` ve `apps/web/e2e/site-editor.e2e.ts` (alan tabanlı blok formları).

Test paketleri oluşturdukları her şeyi siler; art arda iki kez geçer.

## 11. Yazılar / blog (S2b)

Sahibin kararı (pasif pazarlama): hem platform sitesi hem işletme siteleri sayfa motoru üzerinden yazı (blog) yayınlayabilir. Yazılar sayfa bloklarından ayrı, kendi tablolarında yaşar; aynı site, tema, alan adı ve SEO altyapısını kullanır.

### Veri modeli

Migration `20261101000000_articles` (yalnızca yeni enum ve dört yeni tablo; mevcut hiçbir tabloya dokunmaz).

| Model | Açıklama |
|---|---|
| `Article` | `siteId`, `studioId` (sitenin `studioId`'sinin kopyası; kiracı izolasyonu için her sorgu buna göre filtrelenir), `status` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `authorName` (görünen imza, serbest metin), `authorUserId` (isteğe bağlı, yazıyı oluşturan kullanıcı), `coverImageUrl`, `publishedAt` (ilk yayın anı, arşivden yeniden yayında korunur) |
| `ArticleLocale` | `articleId`, `siteId` (benzersizlik için kopya), `locale`, `slug`, `title`, `excerpt`, `body` (düz metin + aşağıdaki işaretleme alt kümesi), `seoTitle`, `seoDescription`, `ogImageUrl`, `readingMinutes` (her yazımda gövdeden hesaplanır, dakikada 200 kelime) |
| `ArticleTag` | `siteId`, `studioId`, dilden bağımsız `slug`, dil başına ad (`labels` JSON: dil -> ad) |
| `ArticleTagLink` | yazı-etiket bağlantısı |

Kısıtlar: `(site_id, locale, slug)` benzersiz (aynı dilde iki yazı aynı adresi paylaşamaz), `(article_id, locale)` benzersiz, `(site_id, slug)` etiket için benzersiz; `(site_id, status, published_at)` listeleme indeksi. Yayınlama `PageVersion` gibi anlık görüntü yazmaz; durum + `publishedAt` yeterli görüldü (yazının geri alma ihtiyacı sayfadan düşük, düzenleme doğrudan canlıya yansır).

Not: istenen tasarımda `Article.studioId` boş olabilir diye düşünülmüştü; `Site.studioId` zorunlu olduğu (platform sitesi de platform kiracısının sitesidir) için alan zorunlu yapıldı.

### Gövde işaretlemesi

`packages/shared/src/sites/article-markup.ts` küçük ve güvenli bir alt küme tanımlar; HTML hiçbir zaman geçmez:

- Paragraflar boş satırla ayrılır; paragraf içindeki tek satır sonu korunur.
- Satır başında `## ` bölüm başlığı (`h2`), `- ` madde (ardışık satırlar tek liste).
- `**metin**` kalın, `[metin](https://...)` bağlantı. Bağlantı yalnızca noktalı bir ana makine adına giden `https` adresi olabilir (kimlik bilgisi, `javascript:`, `data:`, `http:`, göreli adres yok); API böyle bir bağlantıyı yazımda 400 ile reddeder, renderer ise her durumda yalnızca etiket metnini gösterir.

Ayrıştırıcı tipli bir ağaç döndürür (`parseArticleBody`); web tarafında `components/sites/ArticleBody.tsx` bu ağacı React öğelerine çevirir (`dangerouslySetInnerHTML` yok, her metin React tarafından kaçışlanır, bağlantılar `target="_blank" rel="noopener noreferrer"`). Aynı ağaç özet (`articleSummary`), okuma süresi ve RSS açıklaması için de kullanılır.

### İzin ve yönetim

Yeni izin anahtarı `sites.articles.manage` ("Web sitem" grubu; sahip her zaman sahiptir, platform pazarlama yöneticisi `platform.marketing.manage` ile platform kiracısında alır). Kiracı uçları `sites/studio/:studioId` altında, `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` ile:

| Uç nokta | İzin |
|---|---|
| `GET .../articles?page&pageSize&status` | `sites.articles.manage` |
| `POST .../articles`, `GET/PATCH/DELETE .../articles/:articleId` (silme yalnızca taslak veya arşivdeki yazı için; yayındaki yazı 409 `ARTICLE_NOT_DELETABLE`) | `sites.articles.manage` |
| `POST .../articles/:articleId/publish` \| `archive` | `sites.articles.manage` |
| `GET/POST .../article-tags`, `PATCH/DELETE .../article-tags/:tagId` | `sites.articles.manage` |

Platform sitesinin yazıları, sayfalarda olduğu gibi süper admin tarafından aynı uçlarla, platform kiracısının `studioId`'siyle yönetilir. Hatalar sabit bir `code` taşır (`ARTICLE_NOT_FOUND`, `ARTICLE_SLUG_TAKEN`, `ARTICLE_TAG_NOT_FOUND`, `ARTICLE_TAG_SLUG_TAKEN`, `ARTICLE_NOT_DELETABLE`); arayüz `articles.error.<code>` ile çevirir.

Editör: süper admin "Web sitesi" ekranı ve kiracı "Web sitem" ayarı "Sayfalar / Yazılar" sekmeleri taşır (`components/sites/ArticleEditor.tsx`). Liste (durum filtresi, sayfalama), alan tabanlı form (yazar, kapak görseli adresi, etiketler, her dil için adres, başlık, özet, metin, SEO başlığı/açıklaması, paylaşım görseli), yayınla/arşivle/sil ve etiket yönetimi. Kiracı sekmesi izne göre görünür. Görsel seçici yok; kapak görseli adresi elle girilir (yalnızca https).

### Herkese açık render

| Yol | Rota |
|---|---|
| `/{dil}/blog` (`?page=N`) | `app/[locale]/blog/page.tsx` |
| `/{dil}/blog/{yazı}` | `app/[locale]/blog/[slug]/page.tsx` |
| `/{dil}/blog/tag/{etiket}` | `app/[locale]/blog/tag/[tag]/page.tsx` |
| `/{dil}/blog/rss.xml` | `app/[locale]/blog/rss.xml/route.ts` |

İşletme sitelerinde aynı yollar `tenant-site/[studioSlug]/[locale]/blog/...` altındadır ve middleware yeniden yazımıyla işletmenin kendi host'unda `/{dil}/blog...` olarak sunulur. Statik `blog` bölümü Next.js'te sayfa motorunun `[[...slug]]` yakalayıcısından önce eşleşir; ayrıca sayfa slug'ı artık `blog` ile başlayamaz (`UpsertPageLocaleSchema`), böylece bir sayfa yazı rotalarını gölgeleyemez ve tersi de olmaz.

Sayfalar sunucuda, `SitePage` ile ortak `SiteShell` içinde (tema, izinli izleme, JSON-LD, alt bilgi) render edilir; yalnızca `PUBLISHED` yazılar görünür, taslak/arşiv/bilinmeyen adres ve bilinmeyen etiket 404'tür; sitenin etkin dilleri dışındaki ve hiç yazısı olmayan dil 404'tür. Başlıklar, metinler ve etiket adları kiracı verisidir, çevrilmez; arayüz metinleri `articles.*` ad alanındadır. SEO ayrıntıları: `docs/SEO.md`.

### Testler

- Birim: `packages/shared/src/sites/articles.spec.ts` (işaretleme ayrıştırıcısı, güvenli bağlantı, şemalar, yollar, sitemap girdileri ve hreflang, RSS kaçışı), `apps/web/src/components/sites/article-body.spec.ts` (renderer), `apps/web/src/lib/sites/json-ld.spec.ts` (`articleJsonLd`).
- API e2e: `apps/api/test/e2e/articles.e2e-spec.ts` (izin, kiracı izolasyonu, yaşam döngüsü, yalnızca yayındaki yazının görünmesi, RSS kaçışı, bilinmeyen slug 404, sitemap girdileri, platform sitesi).
- Web e2e (Playwright, yalnızca CI): `apps/web/e2e/blog.e2e.ts`. Tohum: platform sitesinde iki dilli iki yazı ve bir taslak, Zen için işletme sitesi ve bir yazı.
