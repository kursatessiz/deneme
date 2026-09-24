# Mesajlaşma (W7)

Bu doküman, platformun WhatsApp/SMS bildirim altyapısını, mesaj şablonlarını
ve İYS (İleti Yönetim Sistemi) ticari mesaj onayını anlatır. Uygulama
tarafı CLAUDE.md kural 8'e göre tasarlanmıştır: tüm gönderim tek bir
`NotificationsService.send()` üzerinden geçer, kanal tercihi ve fallback
(WhatsApp -> SMS) kiracı ayarıdır, SMS kredisi yalnızca bir SMS fiilen
gönderildiğinde düşer.

## Mimari

```
NotificationsService.send({ studioId, userId, category, template, params })
  -> kullanıcının kategori tercihi (push/sms) kontrol edilir
  -> Studio.notificationSettings'ten kanal sırası okunur (varsayılan: WhatsApp, sonra SMS)
  -> her kanal için:
       - MessageTemplate çözümlenir (kiracı override'ı varsa o, yoksa küresel varsayılan)
       - ticari (isTransactional=false) şablonlar için CommunicationConsent GRANTED şart
       - WhatsApp: WhatsAppCloudAdapter, SMS: SmsNetgsmAdapter veya SmsIletiMerkeziAdapter (SMS_PROVIDER env'ine göre)
       - her deneme NotificationLog'a yazılır (başarı/başarısızlık, fallback_of_id zinciri)
       - SMS başarılı olursa SmsWallet'tan 1 kredi düşülür (SmsTransaction kaydıyla)
```

`sendSms()` ve `notifyUser()` eski (legacy) giriş noktaları olarak çalışmaya
devam eder: OTP, davet ve serbest metinli bildirimler için kullanılır, SMS
kredisi ve onay kontrolüne tabi değildir (kimlik doğrulama akışları kredi
bitmişse asla bloklanmamalıdır). Yeni şablon tabanlı ve ticari mesajlar
`send()` üzerinden gönderilmelidir.

## WhatsApp Cloud API kurulumu

1. Meta Business hesabı ve bir WhatsApp Business hesabı (WABA) oluşturun.
2. Bir telefon numarası kaydedin ve `WHATSAPP_PHONE_NUMBER_ID` değerini alın.
3. Kalıcı bir sistem kullanıcı erişim jetonu (system user access token)
   oluşturun; bu `WHATSAPP_ACCESS_TOKEN` olur.
4. Kullanılacak her mesaj (BOOKING_REMINDER, BOOKING_CANCELLED_BY_STUDIO,
   WAITLIST_PROMOTED, PACKAGE_EXPIRING, PAYMENT_FAILED, OTP) için Meta
   şablon onay sürecinden geçen bir "template" oluşturun; onaylanan şablon
   adını `MessageTemplate.whatsappTemplateName` alanına yazın.
5. `WHATSAPP_ACCESS_TOKEN` ve `WHATSAPP_PHONE_NUMBER_ID` ortam
   değişkenleri ayarlanana kadar adaptör MOCK modda çalışır (loglar,
   başarılı döner); bu sayede geliştirme ortamı bir Meta hesabına ihtiyaç
   duymaz.

Sahibin sağlaması gerekenler: WABA hesabı, telefon numarası, sistem
kullanıcı jetonu, onaylanmış şablon adları.

## SMS sağlayıcıları

İki sağlayıcı desteklenir, `SMS_PROVIDER` env değişkeniyle seçilir
(`MOCK` | `NETGSM` | `ILETI_MERKEZI`):

- **Netgsm**: `NETGSM_USER`, `NETGSM_PASSWORD`, `NETGSM_HEADER` (onaylı
  başlık/gönderici adı, en fazla 11 karakter).
- **İleti Merkezi**: `ILETI_MERKEZI_USER`, `ILETI_MERKEZI_PASSWORD`,
  `ILETI_MERKEZI_SENDER`.

Kimlik bilgileri eksikse adaptör MOCK modda çalışır (mevcut varsayılan
davranış korunur). Kiracı, `notification-settings` üzerinden kendi SMS
başlığını (`smsSenderName`) belirleyebilir; bu, sağlayıcı ayarındaki
varsayılan başlığı geçersiz kılar.

Sahibin sağlaması gerekenler: seçilen sağlayıcı ile sözleşme, kullanıcı
adı/şifre, onaylı başlık.

## İYS (İleti Yönetim Sistemi) marka kodu

Ticari (pazarlama) mesajlar için `CommunicationConsent` GRANTED kaydı
şarttır; bu kayıtlar `IysClient` arayüzü üzerinden gerçek İYS API'sine
senkronize edilir. `IYS_BRAND_CODE` ve `IYS_API_KEY` ayarlanana kadar
`IysClientAdapter` MOCK modda çalışır (senkronizasyonu başarılı sayar,
loglar). Gerçek entegrasyon için:

1. İYS'ye marka olarak kaydolun ve bir marka kodu (brand code) alın.
2. API entegrasyon tipini seçin ve API anahtarınızı oluşturun.
3. `IYS_BRAND_CODE` ve `IYS_API_KEY` ortam değişkenlerini ayarlayın.
4. `apps/api/src/modules/notifications/consent/iys-client.adapter.ts`
   içindeki istek gövdesini İYS'nin güncel API dokümanına göre doğrulayın
   (bu dosya bir iskelet olarak bırakılmıştır).

`ConsentService.syncPendingConsents()` henüz İYS'ye gönderilmemiş
(`iys_synced_at` null) onay değişikliklerini toplu olarak gönderir;
zamanlanmış bir işe (cron/BullMQ) bağlanması önerilir (bu backlog
maddesinde eklenmedi, ayrı bir işlem olarak planlanmalıdır).

Sahibin sağlaması gerekenler: İYS marka kaydı, marka kodu, API anahtarı.

## İşlemsel (transactional) ve ticari (commercial) mesaj ayrımı

`MessageTemplate.isTransactional` alanı belirler:

- `true` (varsayılan; rezervasyon hatırlatma/iptal, bekleme listesi,
  paket bitişi, ödeme hatası, OTP): her zaman gönderilir, onay gerekmez.
- `false` (kampanya/duyuru gibi pazarlama mesajları): kanal başına
  `CommunicationConsent` GRANTED kaydı olmadan gönderilmez.

## Mesaj şablonları

`MessageTemplate` kiracı verisidir. `studioId = null` satırlar süper
adminin oluşturduğu küresel varsayılanlardır; bir kiracı aynı
(key, channel, locale) için kendi satırını oluşturursa o kullanılır.
Gövdede `{{ad}}` biçiminde adlandırılmış yer tutucular kullanılır;
gönderim sırasında eksik bir parametre varsa istek reddedilir (mesaj asla
yarım render edilmiş gönderilmez).

Küresel varsayılan şablon anahtarları: `BOOKING_REMINDER`,
`BOOKING_CANCELLED_BY_STUDIO`, `WAITLIST_PROMOTED`, `PACKAGE_EXPIRING`,
`PAYMENT_FAILED`, `OTP`.
