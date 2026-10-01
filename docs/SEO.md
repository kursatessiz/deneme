# Teknik SEO

Bu belge herkese açık web sayfalarının (sayfa motoru siteleri, rezervasyon sayfası) arama motorlarına ve bağlantı önizlemelerine nasıl tanıtıldığını anlatır. Sayfa motorunun kendisi için `docs/SAYFA_MOTORU.md`, tasarım kuralları için `docs/TASARIM.md` geçerlidir. Kapsam: S1 (teknik SEO tabanı), S2 (etkinlik ve blog sayfaları) ve S3 (pasif pazarlama ve SEO operasyonu: bölüm 9-16).

## 1. Neler var

| Konu | Nerede |
| --- | --- |
| Dizinleme denetimi (noindex, `robots.txt` Disallow) | `packages/shared/src/sites/indexing.ts`, `apps/web/src/middleware.ts`, `lib/seo/noindex.ts` |
| Kök metadata (`metadataBase`, varsayılan Open Graph ve Twitter, tema rengi) | `apps/web/src/app/(app)/layout.tsx` |
| Üretilen simgeler ve manifest | `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` |
| Open Graph görselleri | `app/opengraph-image.tsx` (varsayılan kart: ürün adı), `app/og/route.tsx` (sayfa motoru), `lib/og/*` |
| `hreflang`, `x-default`, canonical, `sitemap.xml` | `components/sites/SitePage.tsx`, `lib/sites/api.ts`, `lib/sites/request-origin.ts`, `app/sitemap.xml/route.ts`, `packages/shared/src/sites/site.ts` ve `sitemap.ts` |
| Yapılandırılmış veri (JSON-LD) | `lib/sites/jsonld.ts`, `SitePage.tsx` |
| Rezervasyon sayfası metadata'sı | `app/(app)/(public)/booking/[studioSlug]/layout.tsx` |
| Etkinlik sayfaları (S2a) | `app/(app)/(public)/events/[studioSlug]/` (liste ve ayrıntı), `lib/events/*`, `eventJsonLd` |
| Blog (S2b) | `components/sites/BlogPages.tsx`, `app/[locale]/blog/*`, `app/tenant-site/.../blog/*`, `lib/sites/articles-api.ts`, `lib/sites/blog-feed.ts`, `articleJsonLd`, `packages/shared/src/sites/articles.ts`, `rss.ts` |
| Yanıt başlıkları | `apps/web/next.config.ts` (`headers()`), `deploy/caddy/Caddyfile` |
| "Powered by" rozeti (S3) | `components/branding/PoweredByBadge.tsx`, `packages/shared/src/branding.ts`, `apps/api/src/modules/sites/powered-by.ts` |
| Lighthouse CI (S3) | `.github/workflows/lighthouse.yml`, `apps/web/lighthouserc.json` |
| ISR ve önbellek temizleme (S3) | `components/layout/SiteRootLayout.tsx`, `app/[locale]/layout.tsx`, `app/api/revalidate/route.ts`, `lib/sites/{blog-paging,variant-pages}.ts`, `apps/api/src/modules/sites/site-cache.service.ts` |
| Doğrulama etiketleri, yapay zeka politikası, `aggregateRating` (S3) | `packages/shared/src/sites/seo-settings.ts`, `lib/seo/verification.ts`, `components/sites/SiteSeoSettings.tsx` |
| IndexNow (S3) | `apps/api/src/modules/sites/indexnow/`, `packages/shared/src/sites/indexnow.ts`, `app/indexnow-key/[key]/route.ts` |
| `llms.txt` (S3) | `app/llms.txt/route.ts`, `lib/sites/llms.ts`, `packages/shared/src/sites/llms.ts` |

Tüm kullanıcıya görünen metinler i18n anahtarıdır (`seo.*` ad alanı, `packages/shared/src/i18n/messages/{tr,en}/seo.ts`). Sayfa motoru sayfalarının başlık ve açıklaması kiracı verisidir (`seoTitle`, `seoDescription`) ve çevrilmez.

## 2. Dizinleme nasıl denetlenir

Dizinlenmemesi gereken yolların tek kaynağı `packages/shared/src/sites/indexing.ts` dosyasındaki `NON_INDEXABLE_PATH_PREFIXES` listesidir (korunan panel yolları `PROTECTED_PATHS` ve herkese açık ama dizinlenmemesi gerekenler `NON_INDEXABLE_PUBLIC_PATHS`). Üç yerde aynı liste kullanılır:

1. `buildRobotsTxt()` (`packages/shared/src/sites/robots.ts`) her önek için `Disallow: /yol/` ve `Disallow: /yol$` satırı yazar, `Allow: /` ve `Sitemap:` satırını korur. Birim testi: `packages/shared/src/sites/robots.spec.ts` ve `sites.spec.ts`.
2. Middleware (`apps/web/src/middleware.ts`) listedeki her yolun yanıtına `X-Robots-Tag: noindex, nofollow` ekler. Bu, istemci bileşeni olan sayfaları, route handler'ları (`/api`, `/m/c/<token>`) ve yönlendirmeleri de kapsar.
3. Sunucu layout'ları `robots: { index: false, follow: false }` metadata'sı verir (`noindexMetadata()`, `apps/web/src/lib/seo/noindex.ts`) ve tarafsız, çevrilmiş bir başlık koyar (`seo.login.title`, `seo.token.title`, `seo.panel.title`).

Dizinlenmeyenler: panel ve süper admin yolları, `/giris`, `/api/*`, token sayfaları (`/j`, `/onay`, `/paylasim`, `/m/u`, `/m/c`) ve gömülebilir widget (`/embed`). Herkese açık rezervasyon sayfası dizinlenir; bilinmeyen bir stüdyonun rezervasyon sayfası dizinlenmez.

Ön üretim ortamında Caddy zaten tüm siteye `X-Robots-Tag: noindex, nofollow` ekler (`SITE_ENV=preprod`).

### Dizinlenmeyen yeni bir yol ekleme

1. Yolu `indexing.ts` içinde `PROTECTED_PATHS` (oturum gerektiren panel yolu) veya `NON_INDEXABLE_PUBLIC_PATHS` listesine ekleyin. Öneki başında `/` olan, sonunda `/` olmayan tek bir parça veya yol olarak yazın; eşleşme tam yol parçası üzerindedir (`/members` kapsar `/members/42`, `/membership-plans` kapsamaz).
2. `sites.spec.ts` içindeki testi güncelleyin (liste testleri listeyi gezdiği için çoğu zaman ek bir şey gerekmez).
3. Sayfa bir sunucu layout'u ile geliyorsa `noindexMetadata()` ile robots meta etiketini de ekleyin. Middleware başlığı listeden otomatik gelir.
4. `pnpm turbo run build typecheck test` çalıştırın.

## 3. Metadata

`layout.tsx` içindeki `generateMetadata()` sitenin varsayılanlarını verir: `metadataBase` (`SITES_DOMAIN`, yoksa `WEB_DOMAIN`, yoksa `localhost`; `lib/sites/origin.ts`), `title`, `description`, `openGraph` (`type: website`, `siteName` = `PRODUCT_NAME`, `locale` = çözümlenen dilden `Intl.Locale` ile türetilen `tr_TR` biçimi) ve `twitter` kartı. `viewport.themeColor` marka birincil renk token'ıdır.

Next.js metadata'yı yüzeysel birleştirir: kendi `openGraph` nesnesini veren bir rota kökünkini tamamen değiştirir. Bu yüzden `buildSiteMetadata()` ve rezervasyon layout'u `type`, `siteName` ve `locale` alanlarını kendileri yazar. `alternates` kökte hiç verilmez; her rota kendisininkini verir.

Simgeler ve manifest `PRODUCT_NAME` ilk harfi ile marka birincil renginden (`DEFAULT_TENANT_THEME`, `onColor()`) üretilir; emoji veya sabit renk yoktur. Middleware matcher'ı `/icon`, `/apple-icon`, `/opengraph-image` ve `/manifest.webmanifest` yollarını atlar.

Kök (`/`) bir sayfa değil, dil müzakereli bir `302` yönlendirmesidir (`app/route.ts`, `docs/SAYFA_MOTORU.md`); meta etiketi taşımaz ve `sitemap.xml` içinde listelenmez. Platform ana sayfasının (`/tr`, `/en`) canonical'ı kendisidir.

## 4. Open Graph görselleri

- Sayfa motoru sayfaları: sayfanın `ogImageUrl` alanı doluysa o kullanılır; boşsa `/og?locale=<dil>&slug=<yol>` üretilen görsel kullanılır. `/og` host'a duyarlıdır (`sitemap.xml` gibi `HOST_AWARE_PATHS` içindedir, yeniden yazılmaz) ve sayfayı `lib/sites/api.ts` içindeki önbellekli okuma ile alır; yani sayfanın zaten yaptığı API çağrısının ötesinde ek yük yoktur. Yanıt `Cache-Control: public, max-age=3600, s-maxage=3600` taşır.
- Açılış sayfası ve görseli olmayan sayfalar: `app/opengraph-image.tsx` (platform kiracısının marka rengi ve logosu, yoksa kit rengi).
- Kart `lib/og/card.tsx` içinde çizilir: 1200x630, düz marka birincil rengi, `onColor()` ile okunur metin, başlık, açıklama, ad ve varsa logo. Gradyan kullanılmaz çünkü `docs/TASARIM.md` gradyanı yalnızca üye kartı ve paket kartına ayırır.
- Yazı tipi Inter'dir, `@fontsource/inter` paketinden `fs` ile okunur (ağ çağrısı yok). Latin ve latin-ext yüzleri ayrı ailelerdir (`Inter`, `InterExt`) ve `OG_FONT_FAMILY` ile birlikte verilir; latin-ext Türkçe harfler (ğ, ş, İ) içindir. Standalone build'e `next.config.ts` içindeki `outputFileTracingIncludes` ile dahil edilir.
- Logo kiracı girdisidir. Sunucu yalnızca açık https, genel ana makine adlı (IP, tek etiketli veya `.internal`/`.local` uzantılı değil), yönlendirmesiz, 1,5 saniye ve 512 KB sınırlı PNG veya JPEG logoyu indirir (`lib/og/logo.ts`); aksi halde kart logosuz çizilir. DNS yeniden bağlama gibi ağ düzeyi saldırılar için çıkış filtresi ayrıca düşünülmelidir.

## 5. hreflang, sitemap ve canonical

- Her sayfanın `alternates.languages` kümesi yalnızca yayınlanmış dil varyantlarını ve bir `x-default` içerir. `x-default`, sitenin varsayılan dilindeki varyanta işaret eder (platform ana sayfası istisnadır: `x-default` origin köküne `/` işaret eder, kök ziyaretçiyi dilinde bir sayfaya yönlendirir); sayfanın o dilde varyantı yoksa ilk varyanta (`buildHreflangAlternates`, `packages/shared/src/sites/site.ts`).
- `sitemap.xml` her dil varyantı için ayrı bir `<url>` üretir; her biri sayfanın tam alternatif kümesini (`xhtml:link`, `x-default` dahil) taşır (`buildLocalizedSitemapEntries`). `GET /public/sites/:slug/sitemap-entries` yanıtı geriye uyumlu biçimde `defaultLocale` alanını da verir. `/` listelenmez; platform ana sayfasının alternatif kümesinde `x-default` olarak yer alır (`homeXDefaultUrl` seçeneği).
- Özel alan adı: sayfa canonical'ı ve alternatifleri (önbellekli sayfalar, bölüm 11) API'nin verdiği host'tan bağımsız kökeni kullanır (doğrulanmış birincil özel alan adı, yoksa `<slug>.<SITES_DOMAIN>`); `sitemap.xml`, `robots.txt` ve `rss.xml` istek host'u doğrulanmış (`VERIFIED`) bir özel alan adıysa o host'u kullanır. Host'a tek başına güvenilmez: API'nin `GET /public/sites/resolve` yanıtı o host'un aynı stüdyoya ait olduğunu söylemelidir (`lib/sites/request-origin.ts`, `studioSlugForHost()`).

## 6. JSON-LD kataloğu

| Tür | Nerede | Not |
| --- | --- | --- |
| `Organization` | `companyInfo` olan sayfalar | `logo` (kiracı logosu), `sameAs` (yalnızca https sosyal bağlantılar), e-posta, telefon |
| `LocalBusiness` | `companyInfo` yoksa stüdyo iletişimi | `url`, `telephone`, `image` (logo); adres tek serbest metin olduğu için `PostalAddress` yazılmaz; en az 5 gerçek üye puanı varsa ve işletme vazgeçmediyse `aggregateRating` (bölüm 16) |
| `WebSite` | `HOME` türündeki sayfalar | `inLanguage` sayfanın dili |
| `BreadcrumbList` | her sayfa motoru sayfası | ana sayfa, üst sayfalar, geçerli sayfa; üst sayfa adı yayınlanmış sayfanın `seoTitle` alanı, yoksa slug parçası |
| `FAQPage` | `faq` bloğu olan sayfalar | sayfadaki tüm `faq` bloklarının soruları tek `FAQPage` içinde |
| `SoftwareApplication` | yalnızca platform ana sayfası | `applicationCategory: BusinessApplication`, `offers` yayınlanmış planlardan (fiyatlandırma bloğu yüklediyse) |
| `Product` + `Offer` | plan (platform) ve paket (kiracı) listesi olan sayfalar | `priceCurrency` öğenin kendi para birimi |
| `Article` | blog yazısı sayfası (`/{dil}/blog/{yazı}`) | `headline` (110 karakterle sınırlı), `datePublished` (ilk yayın), `dateModified` (yazı veya dil varyantının son değişikliği), `author` (imza sitenin veya yayıncının adıysa `Organization`, değilse `Person`), `publisher` (`Organization`: platform sitesinde şirket unvanı, işletme sitesinde işletme adı; logo varsa `ImageObject`), `image` (paylaşım görseli, yoksa kapak, yoksa logo), `inLanguage`, `mainEntityOfPage` (`WebPage`, kendi URL'si); yanında `BreadcrumbList` (site, Blog, yazı) |
| `Event` | herkese açık etkinlik ayrıntı sayfası (`/events/.../<etkinlik>`) | `startDate`/`endDate` etkinliğin saat diliminin UTC farkıyla (`zonedIsoString`), `eventStatus: EventScheduled`, `eventAttendanceMode: OfflineEventAttendanceMode`, `location` (`Place`, ad + serbest metin adres), `organizer` (`Organization`), bilet türü başına `Offer` (`price`, `priceCurrency`, `availability`), çok oturumlu etkinlikte `subEvent`, `image` (kapak, yoksa logo) |

Çıktı `serializeJsonLd()` ile kaçışlanır (`<`, `>`, `&`); metinler kiracı girdisidir.

### Herkese açık etkinlik sayfaları

`/events/<studioSlug>` (liste) ve `/events/<studioSlug>/<etkinlik>` (ayrıntı), `(public)/events` altında sunucuda render edilir; yalnızca `PUBLIC` ve `PUBLISHED`, bitmemiş etkinlikler gösterilir (API'nin herkese açık uçları). `<etkinlik>` bölümü `<başlık-slug>-<id>` veya yalın kimliktir; yalnızca sondaki kimlik aranır (etkinlikte slug sütunu yoktur). İşletmenin kendi site host'unda (`<slug>.<alan>` veya doğrulanmış özel alan adı) aynı sayfalar `/events` ve `/events/<etkinlik>` yollarında sunulur (middleware yeniden yazımı, `lib/sites/tenant-path.ts`). Canonical her zaman işletmenin site origin'indeki `/events...` adresidir; platform host'undaki adres onun kopyasıdır. İşletme `sitemap.xml` dosyası, en az bir herkese açık etkinlik varsa `/events` ve her etkinliğin adresini listeler (aynı önbellekli liste okuması, en fazla 100 etkinlik). Başlık, açıklama, Open Graph ve Twitter etiketleri ile `Event` + `BreadcrumbList` JSON-LD üretilir. Tarih ve saatler etkinliğin saat diliminde (şube, yoksa işletme) biçimlenir ve dilim adı blok başına bir kez yazılır.

### Blog (S2b)

- **Metadata**: yazıda başlık `seoTitle`, yoksa "{başlık} | {site}" (`articles.public.metaTitle`); açıklama `seoDescription`, yoksa özet (yazarın özeti veya gövdeden üretilen ilk 200 karakter). Canonical yazının kendi URL'si; `hreflang` yalnızca yazının yayınlanmış dil varyantları + `x-default` (sitenin varsayılan dilindeki varyant, yoksa ilk varyant); Open Graph `type: article`, `publishedTime`, `modifiedTime`, `authors`, `tags`; görsel `ogImageUrl`, yoksa kapak, yoksa `/og?locale=<dil>&article=<yazı>` ile üretilen kart.
- **Liste ve etiket sayfaları**: canonical sayfa numarasıyla (`?page=N`); dil alternatifleri yalnızca ilk sayfada, en az bir yayınlanmış yazısı olan diller için; boş liste `noindex, follow`.
- **RSS 2.0**: her liste ve yazı sayfası `<link rel="alternate" type="application/rss+xml">` taşır (`/{dil}/blog/rss.xml`). Besleme, isteğin host'unu (doğrulanmış özel alan adı dahil) kullanan web rotasından üretilir; API'de ayrıca `GET /public/sites/:slug/feed/:locale` vardır (sitenin varsayılan origin'i: platform alanı, doğrulanmış birincil özel alan adı veya `<slug>.<alan>`). İkisi de aynı paylaşılan üreticiyi (`buildArticleFeedXml`, `packages/shared/src/sites/rss.ts`) kullanır: en yeni 30 yazı, `guid` kalıcı bağlantı, `pubDate` RFC 822, yazar `dc:creator`, etiketler `category`, `atom:link rel="self"`. Tüm değerler kiracı girdisidir ve XML kaçışlanır (`& < > " '`), XML 1.0'ın taşıyamadığı karakterler atılır. Yanıt `Cache-Control: public, max-age=300`; API tarafında site ve dil başına 5 dakikalık süreç içi önbellek her yazı/etiket yazımında temizlenir ve uç nokta IP başına dakikada 60 istekle sınırlıdır.
- **Sitemap**: `buildArticleSitemapEntries` her yazının her dil varyantı için ayrı `<url>` yazar, her biri yazının tam alternatif kümesini (`x-default` dahil) taşır; ayrıca en az bir yazısı olan her dil için blog dizini (`/{dil}/blog`, `lastmod` o dildeki en son değişiklik). Veri `sitemap-entries` yanıtındaki yeni `articles` alanından gelir. Etiket sayfaları sitemap'e yazılmaz (ince içerik).

## 7. Yanıt başlıkları ve performans

- `next.config.ts` `headers()`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=(), microphone=()` ve üretimde `/_next/static` için `Cache-Control: public, max-age=31536000, immutable`. Caddy web alan adında aynı başlıkları kendisi de yazar (Caddy değeri geçerli olur); kiracı siteleri bloğunda `Permissions-Policy` olmadığı için bu başlık orada Next.js'ten gelir.
- `Strict-Transport-Security` Next.js'te yazılmaz: Caddy her site bloğunda ayarlar (`deploy/caddy/Caddyfile`, `env_production_*` ve `env_preprod_*`). Çift başlık oluşmaması için burada tekrar edilmez.
- CSP mantığına dokunulmadı (`middleware.ts`).
- `next/image` kullanılmadı: logo adresleri keyfi https ana makinelerindedir (`remotePatterns` `**`) ve optimizasyon sunucuda (6 GB) keyfi adresleri indirip yeniden boyutlandırmak anlamına gelir. Bunun yerine ham `<img>` etiketlerine `width`/`height` ve `decoding="async"` eklendi. Sayfa motoru blokları görsel render etmiyor.
- Inter 400 için `<link rel="preload">` eklenmedi: font dosyası yalnızca CSS üzerinden içe alınıyor ve JS'ten içe aktarmak için ek webpack kuralı gerekir; kazanç bu maliyete değmedi.

## 8. Search Console ile doğrulama

1. Her alan adı için (platform alan adı, işletmenin özel alan adı) Search Console'da mülk ekleyin (DNS TXT ile alan adı mülkü, tüm alt alan adlarını kapsar).
2. `https://<alan-adı>/sitemap.xml` adresini "Site Haritaları" bölümünden gönderin; durumun "Başarılı" olduğunu ve keşfedilen URL sayısının dil varyantı sayısıyla uyduğunu kontrol edin.
3. "URL Denetimi" ile bir sayfa motoru sayfasını inceleyin: kullanıcı tarafından seçilen canonical, `hreflang` kümesi ve "Sayfa dizinlenebilir" sonucu doğru olmalı. Bir panel yolu ve bir token sayfası için "noindex etiketi nedeniyle hariç tutuldu" görülmelidir.
4. Zengin sonuçlar için "Zengin Sonuçlar Testi" ile `FAQPage`, `Breadcrumb` ve `Product` çıktısını denetleyin.
5. Açık Grafik önizlemesi için bir sayfa adresini bir paylaşım hata ayıklayıcısında (Facebook Sharing Debugger, LinkedIn Post Inspector) açın.
6. Komut satırı: `curl -sI https://<alan-adı>/giris | grep -i x-robots-tag` ve `curl -s https://<alan-adı>/robots.txt`.

## 9. "Powered by" rozeti (S3)

Pasif edinim: işletme sitelerinin altbilgisinde (`SiteShell`: sayfa motoru sayfaları ve blog), herkese açık rezervasyon sayfasında, herkese açık etkinlik sayfalarında (`PublicEventsShell`) ve gömülebilir widget'ta küçük bir "{ürün} ile hazırlandı" bağlantısı görünür (`branding.poweredBy`, `packages/shared/src/i18n/messages/{tr,en}/branding.ts`).

- **Bağlantı**: `buildPoweredByUrl()` (`packages/shared/src/branding.ts`) platform alan adının kökünü `utm_source=tenant-site&utm_medium=badge&utm_campaign=<studioSlug>` ile üretir. Kök `/` dil müzakereli yönlendirmedir ve artık sorgu dizesini korur (`app/route.ts`), böylece UTM atıf kaydı açılış sayfasına ulaşır. Bağlantı `rel="noopener"` taşır, `nofollow` taşımaz (geri bağlantı amaçtır); bileşen `components/branding/PoweredByBadge.tsx`.
- **Plan kapısı**: `branding.hide_badge` özellik bayrağı (varsayılan kapalı, yani rozet görünür). Bayrak diğer bayraklarla aynı çözümlenir (kiracı satırı, uygulama pazarı eklentisi, işletme türü, global; `FeatureFlagsService`), dolayısıyla premium bir eklenti `featureFlagKey = 'branding.hide_badge'` ile rozeti gizleyebilir veya süper admin "Özellik Bayrakları" ekranından tek kiracı için `TENANT` kapsamında açabilir. Bayrak kataloğu: `FEATURE_FLAGS` (`packages/shared/src/admin.ts`).
- **API**: `GET /public/studios/:slug/embed/config` (rezervasyon sayfası, etkinlik sayfaları, widget) ve yeni `GET /public/sites/:slug/settings` (sayfa motoru) `showPoweredBy` ve `poweredByUrl` döner; gizliyken `poweredByUrl` `null`dır. Platform kiracısı için her zaman `showPoweredBy: false`. Kural tek yerde: `apps/api/src/modules/sites/powered-by.ts`.
- **Önbellek**: web tarafında ayar okuması 300 saniye önbellekli (`fetchSiteSettings`, etiket `site-settings:<slug>`); bayrak değişimi en geç 5 dakikada yansır. API hatasında rozet gösterilmez (güvenli kapalı).
- **Testler**: `packages/shared/src/branding.spec.ts` (URL oluşturucu), `apps/api/test/e2e/branding.e2e-spec.ts` (varsayılan görünür, bayrakla gizlenir, platform kiracısı, bilinmeyen site 404).

## 10. Lighthouse CI (S3)

`.github/workflows/lighthouse.yml` her pull request'te `/tr`, `/tr/blog`, `/tr/pilates` ve rezervasyon sayfasını Lighthouse ile ölçer (`apps/web/lighthouserc.json`). SEO >= 0,95 ve erişilebilirlik >= 0,9 hata, performans >= 0,8 ve en iyi uygulamalar >= 0,9 uyarıdır; rapor artifact olarak yüklenir, herkese açık depoya gönderilmez. Workflow ayrıntısı: `docs/CICD_GUIDE.md` bölüm 2a.

Yerel ölçümden çıkan düzeltme: Next.js 15 tarayıcı kullanıcı ajanlarına metadata'yı akışla `<body>` içine koyar; Lighthouse (ve bot listesinde olmayan tarayıcılar) `<meta name="description">` etiketini `<head>` içinde göremez ve SEO puanı 0,91'de kalırdı. `next.config.ts` içindeki `htmlLimitedBots: /.*/` her ajana metadata'yı `<head>` içinde verir (SEO 1,0). Sayfa başlığı ve açıklaması kritik SEO verisi olduğundan akışın getirdiği küçük gecikme kazancından vazgeçildi.

## 11. ISR: önbellekli sayfa motoru sayfaları (S3)

Sayfa motoru sayfaları (`/{dil}/...`), blog sayfaları ve işletme siteleri artık her istekte render edilmez: ilk istekte render edilir, Next.js ISR önbelleğinden en fazla 300 saniye servis edilir ve yayında anında temizlenir. Ölçüm (üretim `server.js`, yerel, 30 istek): önbellekten `/tr` ortalama 8 ms TTFB, aynı sayfa kodunun istek başına render eden ikizi (A/B sayfası) ortalama 71 ms.

**Ne değişti**

- **Kök layout'lar**: `app/layout.tsx` tek kök layout'u cookie ve başlık okuyordu (`resolveRequestLocale`); bu, altındaki her rotayı dinamik yapıyordu. Artık birden çok kök layout var (`app/(app)/layout.tsx` panel, giriş, rezervasyon ve token sayfaları için; `app/[locale]/layout.tsx` platform sitesi; `app/tenant-site/[studioSlug]/[locale]/layout.tsx` işletme siteleri). Site kök layout'ları `<html lang>` ve mesajları URL'deki dilden alır (`components/layout/SiteRootLayout.tsx`, `lib/sites/document-locale.ts`), hiçbir istek verisi okumaz. Panel rotaları `app/(app)/` grubuna taşındı (URL'ler değişmedi); `@/app/(dashboard)/...` içe aktarımları `@/app/(app)/(dashboard)/...` oldu.
- **Rotalar**: `export const revalidate = 300` ve `generateStaticParams() { return [] }` (build'de hiçbir sayfa üretilmez, ilk istek önbelleği doldurur). Kapsam: `[[...slug]]`, `blog`, `blog/[slug]`, `blog/tag/[tag]` ve sayfalama rotaları, hem platform hem işletme sitesi için. `rss.xml`, `sitemap.xml`, `robots.txt` ve `/og` host'a duyarlı route handler'lar olarak dinamik kalır.
- **Canonical host'tan bağımsız**: önbellekli bir sayfa istek host'una bakamaz. Canonical kökeni API verir (`GET /public/sites/:slug/settings` -> `canonicalOrigin`): platform sitesi için alan adı, işletme için doğrulanmış birincil özel alan adı, yoksa en eski doğrulanmış özel alan adı, yoksa `<slug>.<alan>` (`pickCanonicalHost`). Önceki davranış (istek host'u doğrulanmış özel alan adıysa onu kullan) yerine bu, `<slug>.<alan>` alt alan adından açılan sayfaların da özel alan adına canonical vermesini sağlar; `sitemap.xml` ve `rss.xml` istek host'unu kullanmaya devam eder.
- **Sayfalama**: `?page=N` `searchParams` okutur ve sayfayı dinamik yapar. Middleware `?page=N` (N >= 2) isteğini içeride `/{dil}/blog/page/N` ve `/{dil}/blog/tag/{etiket}/page/N` rotalarına yeniden yazar (`lib/sites/blog-paging.ts`); ziyaretçinin URL'si ve canonical aynı kalır, birinci sayfa düz rotadır.
- **Rıza bölgesi**: `PublicTracking` bölgeyi istek başlıklarından (CF-IPCountry, Accept-Language) sunucuda çözüyordu. Önbellekli sayfa bunu okuyamaz; tarayıcı bölgeyi yüklemede `GET /api/consent-region` ile alır. Bölge bilinene kadar çerez yazılmaz, hiçbir şey gönderilmez ve banner gösterilmez (en katı davranış). Rezervasyon, etkinlik ve widget sayfaları (dinamik) sunucuda çözmeye devam eder.
- **Bellek önbelleği**: üretim konteyneri salt okunur dosya sistemiyle çalışır; `next.config.ts` `experimental.isrFlushToDisk: false` ve `cacheMaxMemorySize: 64 MB` ile sayfalar yalnızca bellekte tutulur (512 MB Node heap içinde), yeniden başlatmada ilk istek yeniden render eder.

**A/B sayfaları**: A/B varyantı ziyaretçinin çerezine bağlıdır ve önbelleğe alınamaz. API, iki veya daha çok `abVariantKey` taşıyan yayınlı sayfaları `GET /public/sites/:slug/variant-pages` ile verir; middleware bu listeyi 60 saniye bellekte tutar (`lib/sites/variant-pages.ts`) ve yalnızca bu sayfaları `/{dil}/_dynamic/...` rotasına (`app/[locale]/%5Fdynamic`, `force-dynamic`) yeniden yazar. Takas: bu sayfalar önbelleğin hızından yararlanmaz (istek başına render); yeni bir A/B testi önbellekten en geç bir dakikada çıkar; liste alınamazsa sayfa önbellekten ilk varyantla servis edilir (kısa süreli, en kötü durum).

**Yayında temizleme**: API `POST {WEB_INTERNAL_URL}/api/revalidate` çağırır (`SiteCacheService`), gövde `{ "tags": ["site:<slug>"] }`, başlık `x-revalidate-secret`. Web tarafı (`app/api/revalidate/route.ts`) sırrı sabit zamanlı karşılaştırır (`REVALIDATE_SECRET`, `lib/server-env.ts` içinde Zod ile doğrulanır, en az 16 karakter), yalnızca `site:<slug>` biçimli etiketleri kabul eder ve `revalidateTag` çağırır. Sayfa, ayar, sitemap ve yazı okumalarının hepsi aynı `site:<slug>` etiketini taşır (`siteCacheTag`), yani tek bir etiket o sitenin tüm önbelleğini temizler. Tetikleyiciler: sayfa yayınla/yayından kaldır/geri al, yayındaki sayfada blok, dil veya hukuki onay değişikliği, yazı yayınla/arşivle/yayındaki yazıyı düzenle, etiket değişikliği, site dilleri ve alan adı değişikliği, şirket bilgisi. Taslak düzenlemeleri temizleme yapmaz. Sır veya `WEB_INTERNAL_URL` yoksa temizleme yapılmaz ve sayfalar 300 saniye penceresiyle yenilenir (yerel geliştirme, e2e). Değerler `deploy/docker-compose.prod.yml` ve `.env.example` içindedir; **sahibin yapması gereken**: `/opt/app/.env` içine `REVALIDATE_SECRET` yazmak.

**Önbellek anahtarı ve kiracı izolasyonu**: önbellek yolla anahtarlanır; işletme siteleri `tenant-site/[studioSlug]/...` yoluna yeniden yazıldığı için anahtar stüdyo slug'ını içerir ve iki kiracı hangi host'tan gelirse gelsin aynı girdiyi paylaşamaz. Korunum testi: `apps/web/src/lib/sites/isr-routes.spec.ts` (her önbellekli rota `revalidate = 300` bildirir, istek verisi okumaz, işletme rotaları `[studioSlug]` taşır, iki kiracı farklı yollara gider).

**Test**: `isr-routes.spec.ts`, `blog-paging.spec.ts`, `variant-pages.spec.ts`, `revalidate.spec.ts` (web); `site-cache.service.spec.ts` (API); `apps/api/test/e2e/site-cache.e2e-spec.ts` (yayın ve yayından kaldırmada temizleme, taslakta temizleme yok, A/B sayfa listesi ve kiracı ayrımı, host'tan bağımsız canonical).

## 12. Arama motoru doğrulama etiketleri (S3)

Search Console ve Bing Webmaster Tools'un "HTML etiketi" yöntemiyle sahiplik doğrulaması site ayarıdır (`Site.seoSettings`, JSON sütunu; migration `20261102000000_site_seo_settings`, yalnızca yeni sütun):

- `googleSiteVerification` -> `<meta name="google-site-verification" content="...">`
- `bingSiteVerification` -> `<meta name="msvalidate.01" content="...">`

Platform sitesi de bir `Site` olduğundan platformun kodları platform sitesinin ayarlarıdır ve yalnızca platform alan adında görünür; her işletmenin kodları yalnızca kendi sitesinde (alt alan adı veya özel alan adı) görünür. Etiketler `generateMetadata` ile (`verification` alanı; `lib/seo/verification.ts`) sayfa motoru ve blog sayfalarının `<head>` bölümüne yazılır; değer API'nin `GET /public/sites/:slug/settings` yanıtından gelir.

**Düzenleme**: süper admin "Web sitesi" ekranı (platform) ve kiracı "Web sitem" ekranı (`site.manage`) aynı "Arama motoru doğrulaması" bölümünü gösterir (`components/sites/SiteSeoSettings.tsx`); kayıt `PATCH /sites/studio/:studioId` gövdesindeki `seo` nesnesidir (`UpdateSiteSeoSettingsSchema`). Kod 8-100 karakter, yalnızca harf, rakam, tire ve alt çizgi olabilir (etikete işaretleme sızamaz), boş değer etiketi kaldırır, gönderilmeyen alan korunur, bilinmeyen alan 400'dür. Değişiklik yayında önbellek temizlemesiyle (bölüm 11) birkaç saniyede, temizleme kapalıysa en geç 5 dakikada görünür.

## 13. IndexNow (S3)

Sayfa veya yazı yayınlandığında ve yayından kaldırıldığında değişen adresler IndexNow protokolüyle (`https://api.indexnow.org/indexnow`; Bing, Yandex, Seznam ve Naver paylaşır) arama motorlarına bildirilir.

- **Bayrak**: `seo.indexnow` özellik bayrağı, varsayılan kapalı. Süper admin "Özellik Bayrakları" ekranından global, işletme türü veya tek kiracı için açar (platform kiracısı dahil).
- **Anahtar**: her site için ilk kullanımda üretilir (32 onaltılık karakter, `Site.seoSettings.indexNowKey`), `https://<host>/<anahtar>.txt` adresinde anahtarın kendisini döner. Dosyayı web uygulaması sunar: middleware `/<32 hex>.txt` isteğini `app/indexnow-key/[key]/route.ts` rotasına yeniden yazar, rota isteğin host'una göre siteyi seçer (platform, `<slug>.<alan>` veya doğrulanmış özel alan adı) ve yalnızca o sitenin anahtarı için 200 döner. Anahtar herkese açıktır (dosyanın içeriğidir) ve `GET /public/sites/:slug/indexnow-key` ile okunur.
- **Tetikleyiciler**: sayfa yayınla, geri al ve yayından kaldır (sayfanın tüm dil adresleri); yazı yayınla ve arşivle (yazının tüm dil adresleri ve her dilin blog dizini). Taslak düzenlemesi bildirim göndermez. Adresler sitenin canonical kökenindendir (bölüm 11) ve tek bir host'a aittir.
- **Kuyruk**: `IndexNowService` işi BullMQ `indexnow` kuyruğuna ekler (Redis varsa; 3 deneme, üstel bekleme); `IndexNowProcessor` bildirimi gönderir. Redis yoksa (yerel geliştirme) aynı kod aynı süreçte arka planda çalışır. İş beklerken bayrak kapatılırsa gönderim atlanır.
- **Çıkış**: istek mevcut HTTP çıkış istemcisinden (`AlertHttpClient`: yalnızca https, `api.indexnow.org` izin listesi, SSRF korumalı, 5 saniye, yönlendirme yok) geçer ve test ortamında (`NODE_ENV=test`) hiç yapılmaz. 200/202 başarıdır; 429 ve 5xx yeniden denenir, diğer 4xx (geçersiz anahtar vb.) yeniden denenmez.
- **Kayıt**: her gönderim `AuditLog` satırıdır (`indexnow.submitted` veya `indexnow.rejected`; host, adres sayısı, HTTP durumu).
- **Yük**: `buildIndexNowPayload()` (`packages/shared/src/sites/indexnow.ts`) gövdeyi kurar: `host`, `key`, `keyLocation`, yalnızca o host'un adresleri, tekilleştirilmiş, en fazla 10 000.
- **Testler**: `packages/shared/src/sites/seo-settings.spec.ts` (yük, ayar şeması), `indexnow-submitter.service.spec.ts` (çıkış, test ortamı, yeniden deneme), `lib/sites/indexnow-key.spec.ts` ve `lib/seo/verification.spec.ts` (web), `apps/api/test/e2e/indexnow-verification.e2e-spec.ts` (bayrak açıkken yayında iş kuyruğa girer, kapalıyken girmez; doğrulama kodları, anahtar).

## 14. llms.txt (S3)

`/llms.txt` ([llmstxt.org](https://llmstxt.org)) dil modellerine sitenin ne olduğunu ve ana içeriğinin nerede durduğunu söyleyen bir Markdown dosyasıdır. Host'a duyarlı route handler (`app/llms.txt/route.ts`, `lib/sites/llms.ts`) platform alan adında platform sitesi, işletme alt alan adında veya doğrulanmış özel alan adında işletme sitesi için üretir; yalnızca site zaten yayınladığı veriyi kullanır:

- **Dil**: ziyaretçinin dili (`pw_locale` çerezi, sonra Accept-Language) sitenin yayınlandığı dillerle sınırlanır (kök yönlendirmesiyle aynı kural, `negotiateRootLocale`), yanıt `Vary: Accept-Language, Cookie` taşır.
- **Platform**: ad (`PRODUCT_NAME`), açıklama (`seo.root.description`, istek dilinde), "Sayfalar" (ana sayfa önce, en fazla 20 yayınlı sayfa; başlık `seoTitle`, açıklama `seoDescription`), yazısı olan dillerde blog dizini.
- **İşletme**: ad ve özet (ana sayfanın SEO açıklaması, yoksa `seo.llms.tenantSummary`), aynı sayfa ve blog bölümleri, "Hizmetler" (herkese açık yapılandırmadan `GET /public/studios/:slug/embed/service-types`, en fazla 30; açıklama yoksa süre) ve "Randevu" (platform alan adındaki herkese açık rezervasyon sayfası `/booking/<slug>/book`).
- **Güvenlik**: dosya `buildLlmsTxt()` (`packages/shared/src/sites/llms.ts`) ile kurulur; kiracı verisi tek satıra indirilir, `[` `]` atılır, bağlantı hedefi yalnızca boşluksuz, parantezsiz mutlak http(s) adresi olabilir. Bölüm başlıkları `seo.llms.*` i18n anahtarlarıdır.
- **Politika**: site yapay zeka tarayıcılarını engellediyse (bölüm 15) `llms.txt` yayınlanmaz (404); iki dosya birbiriyle çelişmez.
- **Test**: `packages/shared/src/sites/llms.spec.ts`.

## 15. Yapay zeka tarayıcı politikası (S3)

Site ayarı `aiCrawlers: 'allow' | 'block'` (`Site.seoSettings`, varsayılan `allow`). `block` iken `robots.txt` GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot, Bytespider ve anthropic-ai için `Disallow: /` içeren bir grup ekler (`User-agent: *` kurallarından önce, tek grupta yedi `User-agent` satırı); arama motoru tarayıcıları (Googlebot, Bingbot) etkilenmez. Platform sitesinin politikası platform alan adının `robots.txt` dosyasını, işletmenin politikası kendi host'unun dosyasını belirler. Ayar süper admin "Web sitesi" ve kiracı "Web sitem" ekranlarındaki "Arama motoru doğrulaması" bölümünde seçilir. Kural tek yerdedir: `buildRobotsTxt(sitemapUrl, { aiCrawlers })` (`packages/shared/src/sites/robots.ts`, test `robots.spec.ts`). Not: `robots.txt` yalnızca uyan tarayıcılar için bir istektir, teknik bir engel değildir.

## 16. AggregateRating: gerçek geri bildirimden puan (S3)

İşletme sitesinin `LocalBusiness` yapılandırılmış verisine (`lib/sites/jsonld.ts` `localBusinessJsonLd`) gerçek üye puanlarından bir `aggregateRating` eklenir: `ratingValue` (ortalama, bir ondalık), `reviewCount` (gerçek puan sayısı) ve `bestRating: 5`.

- **Kaynak**: işletmenin kendi `SessionRating` satırları (ders sonrası üye puanı, `docs/FEEDBACK_REFERRAL.md`); yalnızca 1-5 tam sayı puanlar sayılır. Hesap sunucuda `GET /public/sites/:slug/settings` yanıtının `aggregateRating` alanında yapılır (`SiteAggregateRatingService`: tek `aggregate` sorgusu, her zaman `studioId` ile süzülür, süreç içinde 10 dakika önbellek; yeni puan en geç o pencerede görünür).
- **Asla uydurulmaz**: en az 5 puan (`AGGREGATE_RATING_MIN_COUNT`) yoksa alan hiç yazılmaz; platform sitesi için hiçbir zaman yazılmaz (platformun üye puanı yoktur); Google yorum bağlantısı (`googleReviewUrl`) veya dış yorumlar kullanılmaz.
- **Vazgeçme**: site ayarı `showAggregateRating` (varsayılan açık), kiracı "Web sitem" ekranındaki "Arama motoru doğrulaması" bölümünde "Gerçek üye puanlarını arama sonuçlarında göster" anahtarıdır; kapalıyken alan yazılmaz.
- **Nerede görünür**: `LocalBusiness` yalnızca işletme sitesinde bir `contact` bloğu olan sayfalarda üretilir (bölüm 6); `aggregateRating` onunla birlikte gider.
- **Test**: `packages/shared/src/sites/aggregate-rating.spec.ts` (toplama: 5 altı yok, ortalama, geçersiz puanlar), `site-aggregate-rating.service.spec.ts` (sorgu kapsamı, önbellek), `apps/web/src/lib/sites/json-ld.spec.ts`, `apps/api/test/e2e/site-rating.e2e-spec.ts` (gerçek puanlarla, başka işletme, vazgeçme).

## 17. Yayına alma kontrol listesi

Yeni bir alan adı (platform veya işletme) yayına alınırken sırayla:

1. **Ortam**: sunucuda `SITE_ENV=production` (preprod `noindex` yazar) ve `REVALIDATE_SECRET` dolu olmalı (en az 16 karakter; boşsa yayın sonrası önbellek yalnızca 300 saniyelik pencereyle yenilenir, bölüm 11). Değişkenler: `docs/CICD_GUIDE.md` "Ortam değişkenleri envanteri".
2. **Doğrulama alanları**: süper admin "Web sitesi" (platform) veya kiracı "Web sitem" ekranı, "Arama motoru doğrulaması" bölümü: Search Console kodu (`googleSiteVerification`) ve Bing Webmaster Tools kodu (`bingSiteVerification`); etiketlerin sayfa `<head>` bölümünde göründüğünü kontrol edin (bölüm 12).
3. **Sitemap gönderimi**: Search Console ve Bing'de `https://<alan-adı>/sitemap.xml` adresini gönderin (bölüm 8); keşfedilen URL sayısı dil varyantı sayısıyla uymalı.
4. **IndexNow**: `seo.indexnow` özellik bayrağını ilgili kiracı veya global için açın (varsayılan kapalı) ve `https://<alan-adı>/<anahtar>.txt` adresinin anahtarı döndürdüğünü doğrulayın (bölüm 13).
5. **robots ve llms.txt**: `curl -s https://<alan-adı>/robots.txt` Disallow satırlarını ve sitemap adresini, `curl -s https://<alan-adı>/llms.txt` sayfa ve blog bölümlerini göstermeli; yapay zeka tarayıcıları engelliyse (`aiCrawlers: block`) `llms.txt` 404 döner (bölüm 14 ve 15). `curl -sI https://<alan-adı>/giris | grep -i x-robots-tag` noindex göstermeli.
6. **Lighthouse raporu**: son çalıştırmanın raporu GitHub Actions'ta `lighthouse.yml` çalıştırmasının `lighthouse-results` artifact'ındadır (herkese açık depoya gönderilmez, bölüm 10).
7. **"Powered by" rozeti**: işletme sitesinde rozetin görünmesi beklenir; `branding.hide_badge` bayrağı yalnızca ilgili plan veya eklenti için açılır, platform sitesinde rozet hiç görünmez (bölüm 9).

## 18. Açık işler

- Blog için görsel seçici, yazı önizlemesi ve zamanlanmış yayın (S2b'de yok).
- GA4 (yalnızca reklam piksellerinin onay kapısı var; analitik kurulu değil).
- Kiracı sitesi için kiracıya özel simge ve manifest (şimdilik platform simgesi).
- `PostalAddress` için yapılandırılmış adres alanları (stüdyo adresi tek serbest metin).
- Doğrulanmış özel alan adı varken `<slug>.<alan>` alt alan adından özel alan adına kalıcı yönlendirme (şimdilik yalnızca canonical).
- Search Console API ile sitemap'in otomatik gönderilmesi (şimdilik elle, bölüm 8) ve IndexNow'un içerik düzenlemeleri ile sitemap değişimlerine bağlanması (şimdilik yalnızca yayın ve yayından kaldırma).
- Kiracının kendi özel alan adı için ayrı `llms.txt` içeriği (şimdilik host'a göre site verisinden üretilir, elle düzenlenemez).
- `aggregateRating` için `LocalBusiness` yalnızca `contact` bloğu olan sayfalarda üretildiğinden ana sayfada da üretilmesi.
- A/B sayfalarının önbellekten çıkması bir dakika sürer (bölüm 11); API'den anlık bildirim eklenebilir.
- Blok formunda görsel yükleme seçici (görsel adresi şimdilik elle girilir).
