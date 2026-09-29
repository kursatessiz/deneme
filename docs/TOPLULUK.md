# Topluluk ve erişim katmanları (G5b)

Üyelere özel içerik akışı: gönderi, video, dosya ve duyuru; yorum ve beğeni; hangi üyeliğin veya paketin hangi gönderiyi göreceğini belirleyen erişim katmanları; isteğe bağlı herkese açık paylaşım bağlantısı; mobilde akış ekranı. Bağlayıcı tasarım `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 3.11 "Topluluk ve erişim katmanları" maddesidir. Modül sektörden bağımsızdır: katman adları, açıklamaları ve paket adları kiracı verisidir, çevrilmez; üyeye yönelik metinlerde pilatese özgü kelime yoktur.

Kod: `apps/api/src/modules/community`, paylaşılan şema ve tipler `packages/shared/src/community.ts`, web `/topluluk` ve `/ayarlar/topluluk`, herkese açık sayfa `/paylasim/<belirteç>`, mobil Hesabım > Topluluk (`apps/mobile/app/(app)/hesabim/topluluk.tsx`).

## 1. Kavramlar

- **Gönderi** (`CommunityPost`): `type` POST, VIDEO, FILE veya ANNOUNCEMENT; `status` DRAFT, PUBLISHED veya ARCHIVED. Başlık (en fazla 160), düz metin gövde (en fazla 10.000), sabitleme, yorumlara izin, yazar üyeliği, yayın ve arşiv zamanı.
  - **VIDEO**: mevcut video kütüphanesinden (W19, `docs/VIDEO.md`) bir içeriğe bağlanır. Videonun kendi görünürlük kuralları geçerliliğini korur: gönderiyi görebilen ama videoya erişimi olmayan üye kartı kilitli görür, kaynak bağlantısı (`sourceUrl`) asla dönmez. Yayında olmayan bir video her zaman kilitli sayılır.
  - **FILE**: projede henüz yükleme altyapısı (multipart, nesne depolama) yok; dosya bir `https://` bağlantısı ve isteğe bağlı görünen adla eklenir. Yükleme altyapısı geldiğinde `attachmentUrl` alanına oturur.
  - **ANNOUNCEMENT** ve **POST** yalnızca metindir; FILE dışındaki türlerde de isteğe bağlı bir https bağlantısı eklenebilir.
- **Erişim katmanı** (`AccessTier`): kiracı verisidir (enum değil). Bir veya daha fazla kuralı vardır; kurallardan **herhangi biri** sağlanırsa kişi katmandadır:
  - `ACTIVE_MEMBER`: işletmenin her aktif üyesi (üyelik ACTIVE ve üye profili var);
  - `ACTIVE_PACKAGE`: herhangi bir aktif paketi olan üye;
  - `PACKAGE_DEFINITION`: belirli bir paket tanımından aktif paketi olan üye.
- **Aktif paket**: durumu `ACTIVE` ve bitiş tarihi geçmemiş `MemberPackage`. Dondurulmuş (`FROZEN`), tükenmiş (`DEPLETED`) ve süresi dolmuş paketler hiçbir kuralı sağlamaz. Bu tanım video kütüphanesiyle aynıdır ve tek yerde yaşar (bölüm 2).
- **Gönderinin katmanları**: gönderiye sıfır veya daha fazla katman bağlanır. Hiç katman yoksa **tüm aktif üyeler** görür; birden fazla katman varsa **herhangi birini** sağlayan görür.
- **Kapalı başarısızlık**: kullanılan bir katman silinemez (`409 COMMUNITY_TIER_IN_USE`, veritabanında da `NO ACTION` yabancı anahtar), böylece bir katmanın silinmesi gönderiyi sessizce herkese açmaz. Bir paket tanımı silinirse ona bağlı kural da silinir; kuralı kalmayan katman kimseyi kapsamaz.

## 2. Erişim çözümleyici (tek kaynak)

`CommunityAccessService` (`community-access.service.ts`, `CommunityCoreModule`) erişim kararının tek yeridir; video kütüphanesi (`ContentService`) de aktif paketleri ve video kilidini buradan okur.

- `resolve(tenant)`: çağıranın erişimini çıkarır. `community.view` veya `community.manage` izni olan personel ve süper admin **her yayınlanmış gönderiyi** görür (`seesEverything`). Üye profili olmayan ve bu izinlere sahip olmayan çağıran `403 COMMUNITY_MEMBERS_ONLY` alır.
- `visiblePostsWhere(access)`: tek bir Prisma koşulu üretir: her zaman `studioId` ve `status = PUBLISHED`; personel dışında ek olarak "katmanı olmayan gönderi" veya "aynı işletmenin, sağlanan bir kuralı olan katmanı". Akış, tek gönderi okuma, yorum listesi, yorum yazma, beğeni ve yorum silme hep aynı koşulu kullanır; sayfalama ile tekil okuma asla ayrışmaz.
- Görülemeyen gönderi, var olmayan gönderiyle aynı `404 COMMUNITY_POST_NOT_FOUND` yanıtını alır (gönderi kimliği yoklanamaz).
- Birim testler: `community-access.service.spec.ts`, `community.services.spec.ts`; uçtan uca: `apps/api/test/e2e/community.e2e-spec.ts`.

## 3. API

Personel uçları `studios/:studioId/community` altındadır, üye uçları `studios/:studioId/community/self` altındadır (`JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard` + `BillingWriteGuard`). Servisler her sorguyu `tenant.studioId` ile süzer.

| Uç nokta | İzin |
|---|---|
| `GET /posts?status&type&page&pageSize` | `community.view` |
| `GET /posts/:postId` | `community.view` |
| `POST /posts`, `PATCH /posts/:postId` | `community.manage` |
| `POST /posts/:postId/publish`, `POST /posts/:postId/archive` | `community.manage` |
| `POST /posts/:postId/share` (aç), `DELETE /posts/:postId/share` (kapat) | `community.manage` |
| `GET /posts/:postId/comments` (gizlenenler dahil) | `community.view` |
| `POST /comments/:commentId/hide`, `POST /comments/:commentId/unhide`, `DELETE /comments/:commentId` | `community.moderate` |
| `GET /tiers` | `community.view` |
| `POST /tiers`, `PATCH /tiers/:tierId`, `DELETE /tiers/:tierId` | `community.manage` |
| `GET /self/feed?type&page&pageSize` | Üye kendi kendine (`@SelfService`) |
| `GET /self/posts/:postId`, `GET /self/posts/:postId/comments` | Üye kendi kendine |
| `POST /self/posts/:postId/comments`, `DELETE /self/comments/:commentId` (yalnızca kendi yorumu) | Üye kendi kendine |
| `PUT /self/posts/:postId/like`, `DELETE /self/posts/:postId/like` | Üye kendi kendine |
| `GET /public/community/posts/:token` | Kimlik doğrulamasız, IP başına dakikada 60 okuma |

- Hatalar kararlı `code` taşır (`COMMUNITY_ERROR_CODES`); istemciler `community.error.<code>` anahtarını çevirir.
- Arşivleme gönderiyi tüm üyelerden gizler ve paylaşım bağlantısını kapatır. Arşivlenmiş veya taslak gönderi yeniden yayınlanabilir; ilk yayın tarihi korunur.
- Sabitlenen gönderiler akışın başındadır; sonra yayın tarihine göre yeniden eskiye.
- Personel ve süper admin işlemleri `audit_logs` tablosuna yazılır (`community.post.*`, `community.tier.*`, `community.comment.*`).
- **Kısıtlı mod**: tüm yazma uçları (personel ve üye, yorum ve beğeni dahil) `BillingWriteGuard` ile engellenir (`403 BILLING_RESTRICTED`); okumalar serbesttir. `@AllowWhenRestricted()` eklenmedi.

## 4. Yorum ve beğeni

- Yorum düz metindir: kırpılır, 1 ile 1000 karakter arasıdır, olduğu gibi saklanır ve döner. Web ve mobil onu metin olarak gösterir; HTML olarak asla işlenmez.
- Gönderide yorumlar kapatılabilir (`commentsEnabled`); kapalıyken yeni yorum `409 COMMUNITY_COMMENTS_DISABLED`.
- Yazar kendi yorumunu siler (yumuşak silme, `deleted_at`). Moderatör (`community.moderate`) gizler, geri gösterir veya siler. Gizlenen yorumu üyeler (yazarı dahil) görmez; `community.view` olan personel "Gizlendi" etiketiyle görür.
- Üyeler başka üyeleri ad ve soyadın ilk harfiyle görür (`communityDisplayName`); yazar kendi adını ve personel tam adı görür.
- Beğeni üyelik başına bir tanedir (`(post_id, membership_id)` benzersiz); iki kez beğenmek tek beğeni bırakır.
- Yorum ve beğeni bir üyeliğe bağlıdır; işletmede üyeliği olmayan süper admin yorum yapamaz ve beğenemez.

## 5. Paylaşım bağlantısı

- Yalnızca yayında olan bir gönderi için, `community.manage` izniyle açıkça açılır. Varsayılan kapalıdır.
- Belirteç CSPRNG'den 32 bayttır (256 bit), base64url (43 karakter); `community_posts.share_token` benzersizdir. Tekrar açmak mevcut belirteci korur; kapatıp açmak yeni belirteç üretir, eski bağlantı hemen 404 olur. Arşivleme de bağlantıyı kapatır.
- Belirteç personelin bağlantıyı yeniden kopyalayabilmesi için düz saklanır; yalnızca o tek gönderiyi okumaya yarar.
- Herkese açık görünüm salt okunurdur: işletme adı, tür, başlık, gövde, yayın tarihi, dosya bağlantısı ve video özeti (başlık, süre, küçük resim). Yorum, beğeni, yazar, katman ve video kaynak bağlantısı dönmez. Biçimi hatalı belirteç veritabanına gitmez; bilinmeyen, kapatılmış ve arşivlenmiş bağlantılar aynı 404'ü alır. Aktif olmayan işletmenin bağlantıları da 404'tür.
- Web sayfası: `/paylasim/<belirteç>` (`apps/web/src/app/paylasim/[token]/page.tsx`), belirteci API yoluna koymadan önce biçimini doğrular.

## 6. İzinler

| Anahtar | Açıklama | Varsayılan |
|---|---|---|
| `community.view` | Tüm gönderileri (taslaklar dahil), yorumları (gizlenenler dahil) ve katmanları görme; akışta her yayınlanmış gönderiyi okuma | Sahip, resepsiyon, eğitmen |
| `community.manage` | Gönderi yazma, düzenleme, yayınlama, arşivleme, sabitleme, paylaşım bağlantısı, erişim katmanları | Sahip |
| `community.moderate` | Yorum gizleme, gösterme ve silme | Sahip, resepsiyon |

Migration `20261017000000_community` bu anahtarları mevcut işletmelerin sahip, resepsiyon ve eğitmen rol şablonlarına ekler; yeni işletmeler `DEFAULT_ROLE_TEMPLATES` ile alır. Sahip her zaman tüm izinlere sahiptir. `community.manage` olan ama `community.view` olmayan bir rol personel listesini göremez; iki izin birlikte verilmelidir (web sayfası ikisinden birini ister).

## 7. Web ve mobil

- **Web `/topluluk`** (menüde "Topluluk", `community.view` veya `community.manage`): durum filtresi, gönderi listesi (tür, durum, sabit, erişim, beğeni ve yorum sayısı, gizlenen yorum sayısı), "Yeni gönderi" düzenleyicisi (tür, başlık, metin, video seçimi, dosya bağlantısı, katmanlar, sabitleme, yorumlar), yayınla/arşivle/sabitle, paylaşım bağlantısını aç/kapat (bağlantı salt okunur alanda), yorum inceleme ve moderasyon. Düğmeler `PermissionButton` ile izne göre görünür; API aynı izni ayrıca uygular.
- **Web `/ayarlar/topluluk`** (Ayarlar kartı "Topluluk erişim katmanları"): katman listesi (kurallar ve kullanıldığı gönderi sayısı), oluştur, düzenle, sil. Paket listesi `catalog/package-definitions` ucundan gelir.
- **Mobil Hesabım > Topluluk**: üyeler ve `community.view` olan personel görür (`buildHesabimMenu`). Akış, sayfalama, beğen/beğenmekten vazgeç, yorumları aç, yorum yaz, kendi yorumunu sil; video yalnızca kilitli değilse, dosya yalnızca https ise dış bağlantıyla açılır.
- Tüm metinler `community` (web) ve `mCommunity` (mobil) i18n ad alanlarındadır (tr + en); menü anahtarları `nav.community`, `mAccount.menu.community`, `settings.hub.community.*`.

## 8. Örnek veri

Seed, Zen işletmesine iki katman ("Tüm aktif üyeler", "Sınırsız üyelik sahipleri"), sabitlenmiş bir duyuru, yalnızca sınırsız paket sahiplerine açık bir gönderi, bir dosya gönderisi, bir taslak ve bir yorum ile bir beğeni ekler.

## 9. Bildirimler (yapılmadı)

Mesajlaşma motorunda yeni gönderi veya yeni yorum için hazır bir tetikleyici yok; bu nedenle bildirim gönderilmiyor. Yapılacak: yeni duyuru yayınlandığında katmandaki üyelere push (bilgilendirme niteliğinde, sessiz saat ve kanal tercihine uyarak) ve yazarın gönderisine gelen yorumlar için personel bildirimi. Tetikleyici eklenince `CommunityPostsService.publish` ve `CommunityInteractionsService.addComment` çağırmalıdır.

## 10. Kalan ve sahip kararları

- Dosya yükleme altyapısı (şu an yalnızca https bağlantı).
- Mobilde personel için gönderi yazma ve moderasyon ekranı (şu an web).
- Bildirimler (bölüm 9).
- Sahip kararları: katmansız gönderinin varsayılan kitlesi (şu an tüm aktif üyeler), eğitmenlerin gönderi yazıp yazamayacağı (şu an yazamaz; `community.manage` verilebilir), resepsiyonun moderasyon yetkisi, kısıtlı modda üyelerin yorum/beğeni yazabilmesi (şu an engelli), paylaşım bağlantısının varsayılanı (kapalı).
