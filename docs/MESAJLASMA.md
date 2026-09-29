# Mesajlaşma Motoru (G1c)

Bu belge, `docs/BUYUME_VE_GLOBAL_MIMARI.md` bölüm 2.2 (sağlayıcı kayıt defteri), 2.3 (uyum) ve 3.6 (mesajlaşma motoru) maddelerinin G1c fazında nasıl uygulandığını anlatır. Bağlayıcı tasarım o belgedir; bu belge uygulamanın ayrıntısıdır. Önceki W7 belgesi `docs/MESSAGING.md` WhatsApp/İYS kurulum ayrıntıları için hâlâ geçerlidir; gönderim mimarisi bölümünün yerini bu belge alır.

## 1. Özet

- Platformdan çıkan her mesaj tek bir giriş noktasından geçer: `MessagingService.send()` (`apps/api/src/modules/messaging/engine/messaging.service.ts`).
- Kanallar: e-posta (Amazon SES), SMS (Türkiye: Netgsm, sonra İleti Merkezi; diğer ülkeler: Twilio; kiracı sabitleyebilir), WhatsApp (Cloud API), push (Expo, mevcut) ve uygulama içi (in-app).
- Sağlayıcılar `ProviderRegistry` üzerinden alıcının ülkesine göre seçilir. `SMS_PROVIDER` ortam değişkeni artık tüm süreci belirlemez; yalnızca kendi ülke listesi olmayan ülkeler için global varsayılandır.
- Ticari mesajlar sırasıyla uyum/izin, sessiz saat (alıcının yerel saatiyle 08:00-21:00), kişi başına sıklık sınırı ve tekilleştirme kontrolünden geçer. İşlemsel mesajların davranışı değişmedi.
- Şablonlar kanal ve dil başına varyant taşır; e-posta için konu ve tipli blok gövde (başlık, paragraf, buton, görsel, ayırıcı, alt bilgi) vardır ve kiracının logosu/rengiyle duyarlı (responsive), satır içi CSS'li HTML ile düz metne çevrilir.
- Takip: açılma pikseli (yalnızca ticari e-posta, makine açılışları ayrı), imzalı tıklama bağlantıları (`/m/c/<token>`, hedef sunucuda saklı, açık yönlendirme yok), sağlayıcı teslim bildirimleri (SES/SNS, Twilio, WhatsApp, Netgsm/İleti Merkezi). Geri dönme (hard bounce) ve şikâyet, o adrese sonraki ticari gönderimleri durdurur.
- Abonelikten çıkma: `/m/u/<token>` herkese açık sayfası (tr + en) ve tek tık (RFC 8058) POST; kanal ve bölge bazında izin deposuna yazılır (TR için İYS), idempotenttir.
- Gelen kutusu: WhatsApp ve Twilio SMS gelen mesajları ve üyenin uygulama içi sohbeti `Conversation` / `ConversationMessage` olarak toplanır; STOP/HELP anahtar kelimeleri; bilinmeyen gönderen kişi (Contact) olarak açılır; personel web ve mobilden okur, cevaplar, atar, kapatır.
- `NotificationLog` teslim kaydı olarak kaldı ve genişletildi. Tüm eski çağıranlar (bildirimler, otomasyonlar, tahsilat, hatırlatmalar, davetler, OTP) `NotificationsService` uyumluluk katmanı üzerinden motora gider; uç noktalar ve Türk kiracıların davranışı korunur.

## 2. Gönderim: `MessagingService.send()`

```ts
send({
  studioId,                       // platform mesajları (giriş kodu) için null
  recipient,                      // { contactId } | { membershipId } | { userId } | { phone } | { email }
  channel?, channels?,            // tek kanal veya deneme sırası; ikisi de yoksa kiracının WhatsApp -> SMS sırası
  purpose?,                       // TRANSACTIONAL (varsayılan) | COMMERCIAL
  templateKey? | templateId? | content?,
  locale?, variables?,
  idempotencyKey?, campaignId?, journeyRunId?,
  category?, sensitive?, billing?, // eski bildirim kategorileri, gizli içerik, SMS cüzdanı muafiyeti
})
```

Her kanal denemesinde sıra:

1. **Üyenin kategori tercihi** (eski bildirim kategorileri için): SMS/WhatsApp "sms", push/uygulama içi "push" anahtarına bakar.
2. **Adres**: kanal için alıcının telefonu, e-postası veya kullanıcı hesabı; push için kayıtlı cihaz.
3. **Şablon**: kanal ve dile göre çözülür (bölüm 3). Şablon ticari (`isTransactional = false`) ise ya da çağıran `COMMERCIAL` dediyse mesaj ticaridir; işlemsel bir şablon çağıranın isteğiyle ticari yapılabilir, tersi yapılamaz. WhatsApp şablonunun Meta onayı (`APPROVED`) yoksa kanal atlanır.
4. **Uyum** (`compliance.canSend`), yalnızca ticari mesajlarda: abonelikten çıkma/bastırma listesi, kayıtlı açık rıza (TR: KVKK/İYS, AB/UK: GDPR, ABD: TCPA, diğer: açık rıza) ve **sessiz saat**. Pencere alıcının yerel saatiyle 08:00-21:00'dir; saat dilimi kişinin saat diliminden, yoksa işletmenin saat diliminden okunur, bölge kişinin ülkesinden, yoksa telefon numarasının ülkesinden, yoksa işletmenin ülkesinden belirlenir.
5. **Sıklık sınırı**, yalnızca ticari mesajlarda: kişi başına (kişi yoksa kullanıcı, telefon veya e-posta) tüm kanallar birlikte, son 24 saatte `perDay` ve son 7 günde `perWeek` ticari mesaj. Kiracı ayarıdır, varsayılan günde 3, haftada 10. Gönderilmiş, iletilmiş, geri dönmüş ve şikâyet edilmiş kayıtlar sayılır; başarısız olanlar sayılmaz.
6. **Değişken yerleştirme**: paylaşılan çevirmenin `interpolate` fonksiyonu (`{ad}` sözdizimi; eski `{{ad}}` şablonları da okunur). Eksik değişken varsa mesaj yarım gönderilmez, kanal atlanır.
7. **Tekilleştirme**: `idempotencyKey` verildiyse aynı işletmede aynı anahtarla ikinci çağrı ilk sonucu döndürür ve bir şey göndermez. Anahtarı ilk teslim kaydı (`NotificationLog.idempotencyKey`, işletme başına benzersiz) taşır; bir gönderimin tüm kanalları başarısız olduysa anahtar serbest bırakılır, çağıranın tekrar denemesi gidebilir.
8. **Teslim**: sağlayıcı kayıt defterindeki adaptör. Her deneme `NotificationLog`'a yazılır; başarısız kanal bir sonrakine düşer (`fallbackOfId` zinciri).

**İşlemsel mesajlar** (rezervasyon hatırlatması, OTP, davet, ödeme bildirimi) G1a'daki gibi izin, sessiz saat ve sıklık sınırına takılmaz. Bu, mimari belgesi bölüm 2.3'teki "işlemsel mesajlar da sessiz saate tabidir" cümlesinden bilinçli bir sapmadır: bugünkü Türkiye gönderimlerinin (ör. sabah 07:00 seansı için 06:00 hatırlatması) değişmemesi için. Belge buna göre güncellendi.

**SMS kredisi** bugünkü kuralla aynıdır: SMS denemesinden önce kiracının cüzdanından 1 kredi ayrılır, sağlayıcı kabul ederse `SmsTransaction` (USAGE) yazılır, kabul etmezse kredi geri verilir ve defter kaydı yazılmaz. Kimlik akışları (OTP, davet) `billing: 'EXEMPT'` ile cüzdandan bağımsızdır; kredi bitince giriş yapılamaması mümkün değildir.

**Otomasyonlar**: bir ticari otomasyon mesajı alıcının sessiz saatine denk gelirse otomasyon kaydı bırakılır ve hedef sonraki döngüde yeniden denenir (kalıcı olarak atlanmaz). Politika kararları (izin yok, sıklık sınırı, şablon yok, tercih kapalı) `SKIPPED`, yalnızca sağlayıcı hataları `FAILED` sayılır; ayrım artık metin eşlemesiyle değil `reasonCode` ile yapılır.

### Uyumluluk katmanı: `NotificationsService`

| Eski giriş noktası | Motorda karşılığı |
|---|---|
| `send({ studioId, userId, category, template, params })` | Şablonlu, kiracının kanal sırası, kategori tercihi; ticari şablonlar tüm ticari kontrollerden geçer |
| `notifyUser(...)` | Push (cihaz yoksa atlanır, kayıt yazılmaz) ve verilmişse işlemsel, cüzdandan muaf SMS metni |
| `sendSms(...)` (OTP, davet kodu) | İşlemsel, cüzdandan muaf, gizli içerik `[gizli icerik]` olarak kaydedilir |
| `sendTemplateToPhone(...)` (davet bağlantısı) | `INVITE_LINK` şablonu, işletmenin dilinde, WhatsApp davetinde SMS'e düşer |

## 3. Şablonlar

`MessageTemplate` satırı `(studioId | null, key, channel, locale)` ile tanımlanır; kiracı satırı, platform varsayılanını (süper admin, `studioId = null`) geçersiz kılar. Yerleşik varsayılanlar `packages/shared/src/message-templates.ts` (`BUILTIN_TEMPLATES`) ve i18n kataloğunda (`msgTpl` ad alanı, tr + en) yaşar; seed bunları her dilde SMS, WhatsApp ve e-posta için global şablon olarak yazar.

**Dil çözümleme**: istenen dil (çağıranın verdiği, yoksa kişinin, yoksa kullanıcının dili), onun temel dili (`pt-BR` -> `pt`), işletmenin varsayılan dili, sonra Türkçe. Her dil için sırasıyla kiracı satırı, global satır, yerleşik varsayılan denenir; yani başka dildeki bir kiracı satırı, alıcının dilindeki varsayılanı gölgelemez.

**E-posta**: konu zorunludur. Gövde tipli bloklardan oluşur (`EmailBlocksSchema`): `heading`, `paragraph`, `button` (etiket + bağlantı), `image` (https adres, alternatif metin, isteğe bağlı bağlantı), `divider`, `footer`. Blok yoksa metin tek paragraf olur. `renderEmail()` (`packages/shared/src/email-blocks.ts`) tablo tabanlı, 600 piksel, 620 pikselin altında akışkan, satır içi CSS'li HTML ve düz metin üretir; kiracının logosu (yalnızca https), birincil rengi, tema ailesinin yazı tipleri ve nötr renkleri (her zaman açık mod) kullanılır. Tüm metinler HTML olarak kaçışlanır, yalnızca mutlak http(s) adresler `href`/`src` olur. Aynı fonksiyon web düzenleyicisindeki canlı önizlemeyi de üretir.

**Ticari e-posta alt bilgisi**: işletmenin fiziksel adresi (CAN-SPAM), neden bu e-postayı aldığı, abonelikten çıkma bağlantısı ve `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` başlıkları. İşletme adresi tanımlı değilse veya üretimde `MESSAGING_TRACKING_SECRET` yoksa ticari e-posta gönderilmez (yarım yasal alt bilgiyle gitmesin diye). İşlemsel e-postada abonelikten çıkma bağlantısı ve açılma pikseli yoktur.

**WhatsApp**: şablon adı her dil için ayrıdır (`booking_reminder_tr`, `booking_reminder_en`). Meta onay durumu (`PENDING`, `APPROVED`, `REJECTED`) şablonda saklanır; yalnızca `APPROVED` şablonlar gönderilir. Kiracı kendi şablonunu onaylı işaretleyemez: yeni ya da adı/metni değişen kiracı WhatsApp şablonu `PENDING` olur; onayı platform sahibi süper admin içerik ekranından (`admin/content/message-templates`) kaydeder.

## 4. Sağlayıcı kayıt defteri

`MessagingChannelRegistry` (`apps/api/src/modules/messaging/channels/channel-registry.service.ts`), `apps/api/src/common/provider-registry.ts` üzerindeki `ProviderRegistry` ile kurulur.

| Kanal | Seçim |
|---|---|
| SMS | 1) kiracının sabitlediği sağlayıcı (`messagingSettings.smsProvider`), 2) alıcının ülkesinin listesinden yapılandırılmış ilk adaptör (TR: Netgsm, İleti Merkezi), 3) global varsayılan: `SMS_PROVIDER` gerçek bir sağlayıcıysa o, değilse Twilio, 4) yapılandırılmış herhangi bir adaptör, 5) hiçbiri yapılandırılmamışsa ilk aday (MOCK, başarı simüle edilir; önceki davranış) |
| WhatsApp | Cloud API (tüm ülkeler) |
| E-posta | Amazon SES v2 (`@aws-sdk/client-sesv2`, sürüm sabit) (tüm ülkeler) |
| Push | Expo (mevcut `PushService`) |
| Uygulama içi | Motorun kendisi: teslim kaydı (`channel = IN_APP`) üyenin uygulamasında listelenir |

**Yapılandırılmamış e-posta**: `SES_REGION` ve `SES_FROM_ADDRESS` yoksa geliştirme/testte MOCK (başarı simüle edilir); **üretimde reddeder** (`NOT_CONFIGURED`), Stripe adaptörü gibi: yapılandırma eksikliği hiçbir zaman gönderilmiş bir e-posta gibi görünmez. SMS ve WhatsApp adaptörlerinin yapılandırılmamış MOCK davranışı değişmedi (bkz. bölüm 11).

## 5. Takip

Belirteçler (`apps/api/src/modules/messaging/tracking/tracking-tokens.ts`): `base64url("v1:<tür>:<uuid>") + "." + base64url(HMAC-SHA256)`; tür `o` (açılma), `c` (tıklama), `u` (abonelikten çıkma). Belirteç yalnızca bir satıra (teslim kaydı veya bağlantı) başvurur; içinde adres, kişisel veri ya da hedef URL yoktur. Anahtar `MESSAGING_TRACKING_SECRET`'tir; geliştirme/testte yoksa `JWT_SECRET`'ten türetilir, üretimde yoksa belirteç üretilmez.

- **Açılma** `GET /m/o/<token>` (API): 1x1 GIF her zaman döner. Yalnızca ticari e-postada kaydedilir. Apple Mail Gizlilik Koruması (çıplak `Mozilla/5.0`), boş User-Agent, bilinen botlar ve e-posta güvenlik tarayıcıları (Barracuda, Mimecast, Proofpoint, Safe Links vb.) **makine açılışı** olarak ayrıca işaretlenir (`machineOpenedAt`, olayda `isMachine`), insan açılışı sayılmaz.
- **Tıklama** `GET /m/c/<token>` (web, `apps/web/src/app/m/c/[token]/route.ts`): bağlantılar gönderim anında `MessageLink` satırı olarak saklanır. Web rotası belirteci API'ye (`POST /m/c/<token>`) sorar, `pw_vid` çerezini ve User-Agent'ı iletir, API'nin döndürdüğü saklı hedefe 302 ile yönlendirir. Hatalı, sahte veya bilinmeyen belirteç sitenin köküne gider; istekten gelen hiçbir URL'ye asla yönlendirilmez. İnsan tıklaması `clickedAt` yazar ve kişinin bir ziyaretçisi varsa (`pw_vid`) ziyaretçi kişiye bağlanır (atıf zinciri, `AttributionService.identify`). API aynı alan adındaysa doğrudan `GET /m/c/<token>` da çalışır.
- **Teslim bildirimleri**: `NotificationLog.status` yalnızca ileri gider (PENDING < FAILED < SENT < DELIVERED < BOUNCED < COMPLAINED); tekrar gelen bildirim bir şey değiştirmez.

| Sağlayıcı | Uç nokta | Doğrulama |
|---|---|---|
| Amazon SES (SNS üzerinden) | `POST /messaging/webhook/ses` | SNS imzası (SignatureVersion 1: SHA1, 2: SHA256), sertifika yalnızca `https://sns.<bölge>.amazonaws.com(.cn)` üzerinden `.pem`, yetkisiz/port/yönlendirme yok; isteğe bağlı konu (topic) ARN listesi; abonelik onayı yalnızca AWS SNS adresine |
| Twilio | `POST /notifications/webhook/twilio/status`, `POST /notifications/webhook/twilio/inbound` | `X-Twilio-Signature` (mevcut) |
| WhatsApp Cloud | `GET/POST /messaging/webhook/whatsapp` | GET el sıkışması `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; POST ham gövde üzerinde `X-Hub-Signature-256` (`WHATSAPP_APP_SECRET`) |
| Netgsm, İleti Merkezi | `/messaging/webhook/sms-dlr/netgsm?token=...`, `/messaging/webhook/sms-dlr/iletimerkezi?token=...` | İmza desteklemedikleri için adreste paylaşılan gizli anahtar (`SMS_DLR_WEBHOOK_TOKEN`, sabit zamanlı karşılaştırma) |

**Bastırma**: kalıcı geri dönme (SES `Permanent`, Twilio 30003/30005/30006, WhatsApp 131026) ve şikâyet, adresi kanal bazında `MessageSuppression` listesine ekler; bu adrese sonraki **ticari** gönderimler durur, işlemsel mesajlar devam eder. Geçici geri dönme bastırmaz.

## 6. Abonelikten çıkma

- Sayfa: `/m/u/<token>` (web, `apps/web/src/app/m/u/[token]/page.tsx`, tr + en, dil seçici). İşletme adını, kanalı ve maskelenmiş adresi gösterir; tek düğmeyle çıkar. Zaten çıkmış adres bunu görür.
- Tek tık: posta istemcileri `List-Unsubscribe-Post` ile doğrudan `POST <API>/m/u/<token>` çağırır (RFC 8058). Sayfanın düğmesi de aynı ucu kullanır (BFF üzerinden).
- Kayıt: adres kanal bazında bastırma listesine eklenir (`UNSUBSCRIBED`); alıcının hesabı varsa `CommunicationConsent` o kanal için `REVOKED` olur ve mevcut İYS kuyruğuna girer (TR). Hesabı olmayan TR kişisi için ret doğrudan İYS adaptörüne bildirilir. İşlem idempotenttir: ikinci çağrı `alreadyUnsubscribed: true` döner, yeni kayıt yazmaz.

## 7. Gelen mesajlar ve gelen kutusu

**Yönlendirme** (hangi işletmeye ait): önce işletmenin kendi numarası (WhatsApp `phone_number_id` veya SMS "To" numarası, `messagingSettings`'te; yalnızca süper admin atar, bir numara tek işletmeye atanabilir), yoksa bu telefonla bu kanaldaki en yeni konuşma veya giden mesajın işletmesi (paylaşılan platform numarası). Hiçbiri yoksa mesaj loglanır ve bırakılır.

**Kişi**: gönderen telefonla CRM üzerinden eşleşir; yoksa `sourceChannel = INBOUND` ile yeni kişi (WhatsApp profil adı ad olarak) açılır. Kişinin kanal başına en fazla bir açık konuşması vardır (kısmi benzersiz index); sağlayıcı mesaj kimliği tekrar eden webhook'ları eler.

**Anahtar kelimeler** (mesajın tamamı tek kelimeyse; Türkçe harfler ve noktalama normalize edilir):

| Bölge | Çıkış (ticari mesajlardan) | Yardım |
|---|---|---|
| Hepsi | STOP, UNSUBSCRIBE, IPTAL (İPTAL), DUR | HELP, YARDIM |
| TR | + RET | |
| ABD | + STOPALL, CANCEL, END, QUIT, REVOKE, OPTOUT | + INFO |
| Kanada | ABD listesi + ARRET | + INFO, AIDE |
| Birleşik Krallık | | + INFO |

Çıkış, abonelikten çıkma ile aynı kaydı yazar (`STOP_KEYWORD`). WhatsApp'ta onay cevabı (`INBOX_OPT_OUT_CONFIRM`) gider; SMS'te STOP cevabını Twilio kendisi verir. Yardım `INBOX_HELP_REPLY` şablonuyla cevaplanır.

**Personel API'si** (`/studios/:studioId/inbox`, `JwtAuthGuard` + `StudioTenantGuard` + `PermissionGuard`, her sorgu `studioId` ile):

| Uç nokta | İzin |
|---|---|
| `GET conversations` (`status`, `channel`, `assigned=me|unassigned|any`, `search`, `take`, `before`) | `inbox.view` |
| `GET conversations/:id` (mesajlar; okunmamış sayısını sıfırlar) | `inbox.view` |
| `POST conversations/:id/reply` (`body` veya `templateKey` + `variables`) | `inbox.view` + `inbox.reply` |
| `PATCH conversations/:id/assign` (`membershipId`: personel üyeliği, `me` veya `null`) | `inbox.view` + `inbox.manage` |
| `PATCH conversations/:id/status` (`OPEN`/`CLOSED`) | `inbox.view` + `inbox.manage` |
| `GET reply-templates` (pencere dışı cevap için onaylı WhatsApp şablonları) | `inbox.reply` |
| `GET saved-replies` / `POST`, `PATCH :id`, `DELETE :id` | `inbox.view` / `inbox.manage` |

Cevaplar `MessagingService` üzerinden işlemsel olarak gider ve konuşmaya giden mesaj olarak eklenir. **WhatsApp 24 saat kuralı**: müşterinin son mesajından sonraki 24 saat içinde serbest metin, dışında yalnızca onaylı şablon (serbest metin 422 döner). Kapalı konuşmaya cevap yazılamaz. Üyeye bağlı kişilerin telefon ve e-postası yalnızca `members.contact.view` ile görünür (G1b kuralı).

**Üye sohbeti** (`/studios/:studioId/messaging/self`, üye profili gerekir): `GET/POST chat` (üyenin uygulama içi konuşması, personel kutusuna `IN_APP` kanalıyla düşer), `GET in-app` (işletmenin gönderdiği uygulama içi mesajlar), `POST in-app/:id/read`.

**İzinler**: `inbox.view`, `inbox.reply`, `inbox.manage` (`packages/shared/src/permissions.ts`, "Gelen kutusu" alanı). Varsayılan resepsiyon rolünde üçü de vardır; migration, mevcut her kiracının `owner` ve `reception` anahtarlı rol şablonlarına ekler (sahip zaten her izne sahiptir).

## 8. Ayarlar ve ekranlar

**API** (`/studios/:studioId/messaging`, `notifications.manage`): `GET/PUT settings` (`frequencyCap`, `defaultSendTimeLocal` (M3c: alıcı yerel saati ve en iyi saat kampanyalarının yedek gönderim saati, "SS:dd", varsayılan 10:00), `smsProvider`, `emailFromName`, `emailReplyTo`), `GET templates` (anahtar x kanal x dil için motorun gerçekten göndereceği varyant ve kaynağı: işletmeye özel, platform varsayılanı, yerleşik), `PUT templates`, `DELETE templates/:id` (yalnızca kiracının kendi satırı). Süper admin: `PUT /admin/messaging/studios/:studioId/routing` (gelen mesaj numaraları).

**Web**: "Gelen Kutusu" (`/gelen-kutusu`, menüde `inbox.view` ile): filtreler, iki panelli liste + konuşma, cevap kutusu, hazır cevaplar, pencere dışında şablon seçimi ve değişkenleri, bana ata / atamayı kaldır, kapat / yeniden aç, hazır cevap yönetimi. "Mesaj şablonları" (`/ayarlar/mesaj-sablonlari`, `notifications.manage`): gönderim ayarları, şablon listesi (anahtar, kanal, dil filtreleri, kaynak ve Meta onay rozetleri), SMS/WhatsApp/e-posta düzenleyicisi, e-posta blok düzenleyicisi ve API ile aynı fonksiyonla üretilen canlı önizleme (korumalı `iframe`), işletme şablonunu silip varsayılana dönme. Tüm metinler `messaging.*` i18n anahtarlarıdır (tr + en).

**Mobil**: Hesabım > "İşletmeye yaz" (üye sohbeti ve duyurular) ve Hesabım > "Gelen kutusu" (`inbox.view`; tablette liste + konuşma yan yana). Metinler `mMessaging.*` anahtarlarıdır.

## 9. Veri modeli (migration `20261002000000_messaging_engine`)

| Değişiklik | Açıklama |
|---|---|
| `NotificationChannel` + `IN_APP`; `NotificationStatus` + `DELIVERED`, `BOUNCED`, `COMPLAINED` | |
| `NotificationLog` genişletildi | `purpose`, `userId`, `contactId`, `recipientEmail` (telefon artık isteğe bağlı), `templateId`, `locale`, `subject`, `provider`, `idempotencyKey` (işletme başına benzersiz), `campaignId`, `journeyRunId`, `deliveredAt`, `openedAt`, `machineOpenedAt`, `clickedAt`, `bouncedAt`, `complainedAt`, `readAt` |
| `MessageTemplate` genişletildi | `subject`, `blocks` (JSON), `whatsappStatus` (mevcut satırlar `APPROVED`) |
| `Studio.messagingSettings` | JSON, varsayılan `{}` |
| `MessageLink` | Tıklama hedefi (sunucuda saklı) |
| `MessageTrackingEvent` | DELIVERY, OPEN, CLICK, BOUNCE, COMPLAINT, UNSUBSCRIBE; `isMachine` |
| `MessageSuppression` | (işletme, kanal, adres) benzersiz; UNSUBSCRIBED, STOP_KEYWORD, BOUNCED, COMPLAINED |
| `Conversation`, `ConversationMessage`, `SavedReply` | Gelen kutusu |

Prisma'nın ifade edemediği iki kısmi benzersiz index migration SQL'indedir: kişi ve kanal başına tek açık konuşma; gelen mesajlarda (işletme, sağlayıcı mesaj kimliği). Migration yalnızca ekler (önce genişlet); hiçbir kolon silinmez.

## 10. Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `SES_REGION`, `SES_FROM_ADDRESS` | SES bölgesi ve doğrulanmış gönderen adresi. AWS kimlik bilgileri SDK'nın varsayılan zincirinden (ortam değişkeni veya sunucu rolü) gelir, kodda yoktur |
| `SES_FROM_NAME` | İşletmesiz platform e-postalarının gönderen adı |
| `SES_CONFIGURATION_SET` | Bounce/complaint/delivery olaylarını SNS'e yayınlayan yapılandırma seti |
| `SES_SNS_TOPIC_ARNS` | Kabul edilen SNS konu ARN'leri (virgülle); boşsa imzası doğrulanan her konu |
| `MESSAGING_TRACKING_SECRET` | Açılma/tıklama/abonelikten çıkma belirteçlerinin HMAC anahtarı (en az 32 karakter); üretimde ticari e-posta için zorunlu |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta webhook imzası ve el sıkışma belirteci |
| `SMS_DLR_WEBHOOK_TOKEN` | Netgsm / İleti Merkezi teslim raporu adresindeki paylaşılan anahtar |
| `SMS_PROVIDER` | Artık yalnızca global varsayılan SMS sağlayıcısı (ve saatlik bakiye uyarısının izlediği hesap) |

## 11. Kararlar, sınırlar ve sahibin onayı gerekenler

- **Sessiz saat yalnızca ticari mesajlarda** ve her bölgede 08:00-21:00 (TCPA penceresi platform varsayılanı). Bölgeye özgü pencereler (ör. TR İYS saatleri) teyit edilirse `compliance.service.ts` içinde bölge başına ayrılabilir.
- **Ticari izin hesaba bağlıdır**: izin deposu (`CommunicationConsent`) kullanıcı başınadır. Hesabı olmayan kişilere (aday, gelen mesajdan açılan kişi) ticari mesaj gönderilemez; kişi düzeyinde izin kaydı kampanya fazında (G2a) eklenecektir.
- **SMS ve WhatsApp üretimde yapılandırılmamışsa** bugünkü gibi MOCK çalışır (başarı simüle edilir). E-posta üretimde reddeder. SMS/WhatsApp için de reddetme istenirse tek satırlık değişikliktir, ancak `SMS_PROVIDER=MOCK` ile çalışan mevcut kurulumları etkiler; sahibin kararı gerekir.
- **Netgsm ve İleti Merkezi teslim raporları**: alan adları ve durum kodları sağlayıcı ve API sürümüne göre değişir; uç nokta yaygın adları okur (`jobid`/`msgid`/`id`, `status`/`durum`). Canlıya almadan önce her sağlayıcının güncel belgesiyle doğrulanmalıdır. İki sağlayıcının gelen SMS webhook'u bu fazda bağlanmadı (yalnızca Twilio SMS ve WhatsApp).
- **Paylaşılan numarada gelen mesaj yönlendirmesi** son iz üzerinden yapılır; aynı kişi iki işletmeyle yazışıyorsa en yeni işletmeye düşer. Kesin ayrım için her işletmeye kendi numarası atanmalıdır (süper admin).
- **E-posta cevapları** (gelen e-posta) bu fazda gelen kutusuna alınmadı; SES gelen posta kuralı ve alan adı MX kaydı gerekir.
- **Yapay zeka cevap önerisi** G3b'dedir.

## 12. Nasıl test edilir

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test

export DATABASE_URL=postgresql://u:pw@localhost:5432/g1c_test
cd packages/database
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm db:seed

cd ../../apps/api
JWT_SECRET=... OTP_TEST_CODE=482915 NODE_ENV=test npx jest -c test/jest-e2e.config.js

cd ../web
pnpm exec playwright test --reporter=list
```

- Birim: `packages/shared/src/messaging-engine.spec.ts` (değişken yerleştirme, sıklık sınırı, bölgeye göre anahtar kelimeler, WhatsApp penceresi, e-posta blok görüntüleyici, yerleşik şablonlar), `apps/api/src/modules/messaging/**/*.spec.ts` (kanal seçimi, uyum + sessiz saat + sınırlar, şablon dil yedeklemesi, belirteç imzalama ve açık yönlendirme reddi, SNS ve WhatsApp imza doğrulaması, teslim raporu durumları), `automation-runner.service.spec.ts` (sessiz saatte yeniden deneme), `apps/web/src/lib/messaging/messaging.spec.ts` (yönlendirme hedefi ve belirteç biçimi), mobil `staffMenu.spec.ts`.
- API e2e: `apps/api/test/e2e/messaging-engine.e2e-spec.ts` (işlemsel ve ticari gönderim, izin, sessiz saat, sıklık sınırı, tekilleştirme, takip, bounce ile bastırma, abonelikten çıkma, gelen mesaj -> konuşma + kişi, anahtar kelimeler, gelen kutusu izinleri ve kiracı izolasyonu, WhatsApp 24 saat kuralı, şablon ve ayar uçları, kiracının WhatsApp onayı veremeyişi); `messaging.e2e-spec.ts` (mevcut bildirim davranışı değişmeden).
- Web e2e (Playwright): `apps/web/e2e/inbox.e2e.ts` (üye mesajı -> resepsiyon gelen kutusu -> cevap -> üye; eğitmende menü ve sayfa yok), `apps/web/e2e/unsubscribe.e2e.ts` (sayfa akışı tr + en, zaten çıkmış adres, geçersiz belirteç, sahte tıklama bağlantısı köke gider).

Test paketleri oluşturdukları her şeyi siler; art arda iki kez geçer.
