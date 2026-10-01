# Teknik SEO

Bu belge herkese açık web sayfalarının (sayfa motoru siteleri, rezervasyon sayfası) arama motorlarına ve bağlantı önizlemelerine nasıl tanıtıldığını anlatır. Sayfa motorunun kendisi için `docs/SAYFA_MOTORU.md`, tasarım kuralları için `docs/TASARIM.md` geçerlidir. Kapsam: S1 (teknik SEO tabanı).

## 1. Neler var

| Konu | Nerede |
| --- | --- |
| Dizinleme denetimi (noindex, `robots.txt` Disallow) | `packages/shared/src/sites/indexing.ts`, `apps/web/src/middleware.ts`, `lib/seo/noindex.ts` |
| Kök metadata (`metadataBase`, varsayılan Open Graph ve Twitter, tema rengi) | `apps/web/src/app/layout.tsx` |
| Üretilen simgeler ve manifest | `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` |
| Open Graph görselleri | `app/opengraph-image.tsx` (varsayılan kart: ürün adı), `app/og/route.tsx` (sayfa motoru), `lib/og/*` |
| `hreflang`, `x-default`, canonical, `sitemap.xml` | `components/sites/SitePage.tsx`, `lib/sites/api.ts`, `lib/sites/request-origin.ts`, `app/sitemap.xml/route.ts`, `packages/shared/src/sites/site.ts` ve `sitemap.ts` |
| Yapılandırılmış veri (JSON-LD) | `lib/sites/jsonld.ts`, `SitePage.tsx` |
| Rezervasyon sayfası metadata'sı | `app/(public)/booking/[studioSlug]/layout.tsx` |
| Yanıt başlıkları | `apps/web/next.config.ts` (`headers()`), `deploy/caddy/Caddyfile` |

Tüm kullanıcıya görünen metinler i18n anahtarıdır (`seo.*` ad alanı, `packages/shared/src/i18n/messages/{tr,en}/seo.ts`). Sayfa motoru sayfalarının başlık ve açıklaması kiracı verisidir (`seoTitle`, `seoDescription`) ve çevrilmez.

## 2. Dizinleme nasıl denetlenir

Dizinlenmemesi gereken yolların tek kaynağı `packages/shared/src/sites/indexing.ts` dosyasındaki `NON_INDEXABLE_PATH_PREFIXES` listesidir (korunan panel yolları `PROTECTED_PATHS` ve herkese açık ama dizinlenmemesi gerekenler `NON_INDEXABLE_PUBLIC_PATHS`). Üç yerde aynı liste kullanılır:

1. `buildRobotsTxt()` her önek için `Disallow: /yol/` ve `Disallow: /yol$` satırı yazar, `Allow: /` ve `Sitemap:` satırını korur. Birim testi: `packages/shared/src/sites/sites.spec.ts`.
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
- Özel alan adı: istek host'u doğrulanmış (`VERIFIED`) bir özel alan adıysa canonical, alternatifler, sitemap ve `robots.txt` o host'u kullanır; aksi halde `<slug>.<SITES_DOMAIN>` kullanılır. Host'a tek başına güvenilmez: API'nin `GET /public/sites/resolve` yanıtı o host'un aynı stüdyoya ait olduğunu söylemelidir (`lib/sites/request-origin.ts`, `studioSlugForHost()`).

## 6. JSON-LD kataloğu

| Tür | Nerede | Not |
| --- | --- | --- |
| `Organization` | `companyInfo` olan sayfalar | `logo` (kiracı logosu), `sameAs` (yalnızca https sosyal bağlantılar), e-posta, telefon |
| `LocalBusiness` | `companyInfo` yoksa stüdyo iletişimi | `url`, `telephone`, `image` (logo); adres tek serbest metin olduğu için `PostalAddress` yazılmaz |
| `WebSite` | `HOME` türündeki sayfalar | `inLanguage` sayfanın dili |
| `BreadcrumbList` | her sayfa motoru sayfası | ana sayfa, üst sayfalar, geçerli sayfa; üst sayfa adı yayınlanmış sayfanın `seoTitle` alanı, yoksa slug parçası |
| `FAQPage` | `faq` bloğu olan sayfalar | sayfadaki tüm `faq` bloklarının soruları tek `FAQPage` içinde |
| `SoftwareApplication` | yalnızca platform ana sayfası | `applicationCategory: BusinessApplication`, `offers` yayınlanmış planlardan (fiyatlandırma bloğu yüklediyse) |
| `Product` + `Offer` | plan (platform) ve paket (kiracı) listesi olan sayfalar | `priceCurrency` öğenin kendi para birimi |

Çıktı `serializeJsonLd()` ile kaçışlanır (`<`, `>`, `&`); metinler kiracı girdisidir.

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

## 9. Açık işler

- Blog (içerik türü ve şablonu yok).
- ISR: sayfalar `force-dynamic` ve her istekte render ediliyor; API yanıtları önbellekli.
- Lighthouse CI (CI'da performans ve SEO bütçesi).
- GA4 (yalnızca reklam piksellerinin onay kapısı var; analitik kurulu değil).
- Kiracı sitesi için kiracıya özel simge ve manifest (şimdilik platform simgesi).
- `PostalAddress` için yapılandırılmış adres alanları (stüdyo adresi tek serbest metin).
- Doğrulanmış özel alan adı varken `<slug>.<alan>` alt alan adından özel alan adına kalıcı yönlendirme (şimdilik yalnızca canonical).
