# Toplayıcı / Pazaryeri Partner Entegrasyonları (W20)

ClassPass, Urban Sports Club, Wellhub/Gympass ve yerel Türkiye eşdeğerleri gibi toplayıcı/pazaryeri platformları, kendi üyelerini partner stüdyolara yönlendirip rezervasyon yapan aracı hizmetlerdir. Bu belge, çerçevenin nasıl çalıştığını ve gerçek bir partnerle canlıya geçmek için sahipten neyin gerektiğini anlatır.

## Genel bakış

Sistem sağlayıcıdan bağımsız (provider-agnostic) bir adaptör arayüzü üzerine kuruludur (`apps/api/src/modules/partners/providers/partner-provider.interface.ts`). Şu an yalnızca **MOCK** adaptör gerçek mantığa sahiptir; CLASSPASS, URBAN_SPORTS, WELLHUB ve OTHER (diğer yerel toplayıcılar) birer iskelettir ve her çağrıda "henüz sözleşme ve kimlik bilgisi yok" hatası döner. Gerçek bir sözleşme imzalandığında yapılacak iş, yalnızca o partnerin adaptörünü doldurmaktır; veri modeli, yetkilendirme, kapasite/kontenjan mantığı ve raporlama zaten hazırdır.

MOCK adaptör üretimde (`NODE_ENV=production`) tamamen devre dışıdır (ödeme sağlayıcılarındaki `disabledMockProvider` deseniyle aynı): her çağrı reddedilir ve webhook imzası hiçbir zaman geçerli sayılmaz.

## Bir partnerle canlıya geçmek için sahipten gereken bilgiler

Her yeni partner için aşağıdakiler olmadan gerçek adaptör yazılamaz ve bağlantı canlıya alınamaz:

1. **İmzalı sözleşme/ortaklık anlaşması**: partnerin resmi "Partner API" veya "Marka API'si" programına stüdyonun kabul edilmiş olması (çoğu toplayıcı bunu bir başvuru süreciyle onaylar).
2. **API kimlik bilgileri**: partnerin verdiği API anahtarı/sırrı, partner hesap/mekan kimliği (`partnerAccountId`) ve varsa bir OAuth istemci kimliği/sırrı.
3. **Webhook imza sırrı**: partnerin gelen webhook'ları imzalamak için kullandığı gizli anahtar (bizim tarafımızda `PartnerConnection.encryptedCredentials` içinde `webhookSecret` olarak saklanır).
4. **Webhook URL kaydı**: partnerin panelinde şu adresin webhook alıcısı olarak kaydedilmesi gerekir:
   `https://{PUBLIC_API_URL}/partners/{provider}/webhook/{connectionId}`
   `{connectionId}`, bağlantı bu platformda oluşturulduktan sonra elde edilen kimliktir; `{provider}` küçük harfle sağlayıcı adıdır (`classpass`, `urban_sports`, `wellhub`, `other`).
5. **İmza şeması dokümantasyonu**: partnerin webhook isteklerini nasıl imzaladığı (başlık adları, imza algoritması, zaman damgası formatı). MOCK adaptör `x-partner-signature` (HMAC-SHA256, `{timestamp}.{rawBody}` üzerinden) ve `x-partner-timestamp` başlıklarını kullanır; gerçek bir partnerin şeması farklı olabilir ve o partnerin adaptöründe ayrıca uygulanmalıdır.
6. **Ziyaret başına ödeme (payout) oranı ve ödeme dönemi**: partnerin stüdyoya her ziyaret için ödediği tutar ve faturalama/mutabakat periyodu (aylık, haftalık, vb.) - bu platformda `PartnerConnection.config.payoutRatePerVisit` olarak saklanır, gerçek tahsilat/faturalama partnerin kendi sürecidir.
7. **Paylaşılacak hizmet türleri, şubeler ve kontenjan**: hangi hizmet türlerinin partner üyelerine açık olacağı, hangi şubelerde, ve seans başına kaç yerin partnere ayrılacağı (işletme sahibi mobil "Partner platformlar" ekranından belirler).
8. **İptal politikası**: partnerin kendi iptal/no-show kurallarının stüdyonun kendi `CancellationPolicy`'sini geçersiz kılıp kılmayacağı (varsayılan: evet, `config.followsPartnerCancellationPolicy`).

Bunlardan herhangi biri eksikken bağlantı MOCK sağlayıcısıyla test edilebilir, ancak gerçek partner trafiği alamaz.

## Mimari

- **PartnerConnection**: stüdyo başına partner bağlantısı. Kimlik bilgileri `INTEGRATION_ENCRYPTION_KEY` (AES-256-GCM, 32 bayt base64) ile şifrelenip saklanır; hiçbir uç nokta şifreli veya çözülmüş kimlik bilgisini geri döndürmez (`hasCredentials: boolean` dışında). Anahtar geliştirme/test ortamında isteğe bağlıdır (yoksa okunabilir bir "plain:" zarfı kullanılır, yalnızca MOCK sağlayıcıyla güvenlidir); üretimde bir bağlantı oluşturulmaya çalışıldığında anahtar yoksa istek reddedilir.
- **PartnerGuest** + **User (placeholder)**: partner bir telefon numarası verirse, kural 6 gereği global `User` telefonla bulunur veya oluşturulur ve gerçek bir `Membership`/`MemberProfile` açılır (tam onboarding akışı - davet/OTP/PIN/consent - hiç çalışmaz). Partner telefon vermezse, yalnızca `Booking.member_id` kısıtını karşılamak için "GP-" önekli, gerçek bir telefon biçiminde olmayan bir yer tutucu `User` oluşturulur; misafirin gerçek kimliği (ad, varsa telefon) her zaman `PartnerGuest` üzerindendir ve arayüzlerde gösterilen odur.
- **PartnerSpotAllocation**: bir partnerin bir seans için kaç yer ayırabileceğinin tavanı (`config.spotsPerSession`, seansın kalan kapasitesiyle sınırlı). Seans başlangıcından `config.releaseHoursBeforeStart` saat önce kontenjan otomatik olarak kapanır (yeni partner rezervasyonu kabul edilmez); zaten yapılmış rezervasyonlar etkilenmez.
- **Kapasite ve kontenjan eşzamanlılığı**: hem seansın genel kapasitesi (`SessionSchedule.bookedCount < capacity`) hem de partner kontenjanı (`PartnerSpotAllocation.usedSpots < reservedSpots`) koşullu `updateMany` ile atomik olarak kontrol edilir - aynı SchedulesService deseniyle - böylece eşzamanlı webhook çağrıları asla kapasiteyi aşamaz.
- **Idempotency**: bir rezervasyon `(connectionId, externalReservationId)` ile benzersizdir; aynı rezervasyonun tekrar bildirilmesi (yeni bir webhook olay kimliğiyle de olsa) yeni bir kayıt oluşturmaz. Ayrıca partnerin kendi webhook olay kimliği (`eventId`) bağlantı başına benzersizdir (`PartnerWebhookEvent`), böylece ağ tekrarları (at-least-once teslimat) da güvenle yutulur.
- **Partner iptali**: stüdyonun kendi `CancellationPolicy`'sini (geç iptal cezası vb.) hiçbir zaman uygulamaz; yalnızca partnerin bildirdiği `cancelledWithinPartnerPolicy` bayrağına göre `CANCELLED_EARLY`/`CANCELLED_LATE` işaretlenir ve `partner_cancelled=true` ile denetim kaydı tutulur.
- **Giden senkronizasyon**: 15 dakikalık `JobsService.runAll()` nabzı her aktif bağlantı için önümüzdeki 48 saatteki seansların müsaitlik durumunu partnere iletir (`PartnerSyncService`), ardışık hatalarda üstel geri çekilme (5, 10, 20, ... en fazla 60 dakika) uygular ve bağlantı başına hata sayacını günceller; ayrıca süresi geçen partner kontenjanlarını serbest bırakır.
- **Raporlama**: `GET /partners/reports/visits` (`reports.view`), sağlayıcı/bağlantı/ay bazında ziyaret sayısı, gelmeme (no-show) sayısı ve beklenen ödeme tutarını (`Prisma.Decimal` ile, ondalık sapma olmadan) döner; `?format=csv` ile CSV.

## Uç noktalar

| Uç nokta | İzin | Açıklama |
|---|---|---|
| `GET /partners/connections` | `integrations.partners.manage` | Stüdyonun bağlantılarını listeler (kimlik bilgisi hariç) |
| `POST /partners/connections` | `integrations.partners.manage` | Yeni bağlantı oluşturur (kimlik bilgisi yalnızca yazılır) |
| `PATCH /partners/connections/:id` | `integrations.partners.manage` | Etiket, durum, yapılandırma ve/veya kimlik bilgisini günceller |
| `DELETE /partners/connections/:id` | `integrations.partners.manage` | Bağlantıyı siler |
| `POST /partners/:provider/webhook/:connectionId` | yok (partnerin kendi imzası) | Gelen rezervasyon/iptal/check-in olayları |
| `GET /partners/reports/visits` | `reports.view` | Sağlayıcı/ay bazında ziyaret ve beklenen ödeme raporu |

## Tasarım kararı: neden `Booking.member_id` değişmedi

`Booking.member_id` platformun ~30 modülünde (hakediş, oyunlaştırma, otomasyon, geri bildirim, raporlar, churn, ...) zorunlu bir alan olarak varsayılır. Bu alanı nullable yapmak, tüm bu modüllerin gözden geçirilmesini gerektirirdi. Bunun yerine her partner misafiri için gerçek bir `MemberProfile` (ve onu taşıyan bir `Membership`/`User`) açılır; telefon verilmeyen misafirler için bu `User` yalnızca kısıt gereği var olan, asla giriş yapamayan bir yer tutucudur (`PartnerGuest.isPlaceholder=true`). Misafirin gerçek kimliği her zaman `PartnerGuest` üzerinden görüntülenir. Bu, W20'nin geri kalan platformla sürtüşmesiz bütünleşmesini sağlar; ödün, her partner misafiri için stüdüonun `Membership`/`MemberProfile` tablolarında bir satır oluşmasıdır (bu üyeler stüdyonun kendi üye listesinde görünür ve staff arayüzlerinde `isPartnerGuest` etiketiyle işaretlenir; bkz. aşağıdaki bölüm).

## Partner misafirleri ve mesajlaşma

Sahip kararı: bir partner misafiri, kendisi stüdyoya gerçekten katılana kadar (davet/OTP/PIN/consent akışını tamamlayana ya da personel onu doğrudan üyeye dönüştürene kadar) mesajlaşma ve etkileşim (engagement) açısından sıradan bir üye gibi ele alınamaz. Bu, `Membership.isPartnerGuest` alanıyla uygulanır:

- **Ne zaman true olur**: `resolvePartnerGuest` (`apps/api/src/modules/partners/partner-reservations.service.ts`) o telefon/misafir için stüdyoda **yeni** bir `Membership` oluşturduğunda `isPartnerGuest=true` yazılır. Telefon bu stüdyoda zaten bir üyeliğe sahipse (gerçek bir üye ya da daha önce oluşmuş bir partner misafiri), o üyelik dokunulmadan bırakılır - gerçek bir üye asla geri düşürülmez.
- **Ne zaman temizlenir (false olur)**: iki yoldan biriyle, satır her zaman **yeniden kullanılır**, asla ikinci bir `Membership`/`MemberProfile` oluşturulmaz:
  1. Kişi normal onboarding akışını tamamlar (davet kabulü: `InvitesService.accept`, `apps/api/src/modules/invites/invites.service.ts`) - telefonuna ait mevcut bir üyelik varsa `isPartnerGuest=false` ile güncellenir.
  2. Personel aynı telefonla `POST /members` üzerinden yeni üye oluşturur veya bir lead'i (`LeadsService.convert`/`bookTrial`, ikisi de `MembersService.createMember`'ı çağırır) üyeliğe dönüştürür - mevcut partner misafiri üyeliği bulunur, güncellenir (bayrak temizlenir) ve `MemberProfile` `upsert` ile doldurulur; sadece gerçek bir üyeliğin telefonuyla çakışma hâlâ 409 döner.
- **Hariç tutulan akışlar** (`isPartnerGuest=true` iken):
  - Otomasyon kural hedeflemesi: `WIN_BACK`, `BIRTHDAY`, `PACKAGE_EXPIRING` değerlendiricileri (`apps/api/src/modules/automations/evaluators/`) partner misafirlerini sorgudan filtreler.
  - Churn (kayıp riski) skorlaması: `ChurnService.recomputeStudio` partner misafirleri için hiç `MemberRiskSnapshot` üretmez.
  - Oyunlaştırma: rozet kazanma push bildirimleri (`GamificationService.notifyNewBadges`) ve aylık liderlik tablosu (`leaderboard`) partner misafirlerini atlar.
  - Geri bildirim: puanlama (rating) anımsatmaları (`RatingPromptService`) ve tavsiye (referral) kodu üretimi (`ReferralsService.myCode`) partner misafirleri için çalışmaz.
- **Hariç tutulmayan akışlar (transactional)**: partner misafirinin **kendi** rezervasyonuna ait randevu hatırlatmaları ve no-show takip mesajları (`BOOKING_REMINDER`, `NO_SHOW_FOLLOW_UP`, `FIRST_CLASS_FOLLOW_UP` değerlendiricileri) normal şekilde çalışmaya devam eder - bunlar pazarlama değil, kendi rezervasyonlarıyla ilgili işlemsel bildirimlerdir.
- **Personel arayüzleri**: `GET /members/studio/:studioId` ve `GET /members/:memberId/studio/:studioId` yanıtlarında `isPartnerGuest` alanı döner (bkz. `packages/shared` içindeki `MemberDetailDTO`); bu üyeler personel üye listesinden gizlenmez, yalnızca etiketlenir.
