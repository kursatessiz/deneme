# Potansiyel müşteri hattı (W11)

Bu belge, bir stüdyonun kendi web sitesinden aday toplamasını sağlayan herkese
açık form uç noktasını ve personelin bu adayları takip ettiği aşama akışını
özetler.

## Aşamalar

```
YENI (NEW) -> GORUSULDU (CONTACTED) -> DENEME PLANLANDI (TRIAL_BOOKED) -> DENEME YAPILDI (TRIAL_DONE) -> UYE OLDU (WON)
```

Her aşamadan doğrudan `UYE OLDU` (WON) veya `KAYBEDILDI` (LOST) durumuna
geçilebilir. `WON` durumundan hiçbir yere çıkılamaz (üyeliğe dönüşüm
kesinleşmiştir). `LOST` durumuna geçerken bir kayıp nedeni zorunludur; `LOST`
durumundan da hiçbir yere çıkılamaz. Geriye doğru geçiş (ör. `TRIAL_BOOKED`
-> `NEW`) yapılamaz. Kural, `packages/shared/src/enums.ts` içindeki
`canTransitionLeadStage()` fonksiyonunda tanımlıdır ve hem API hem de mobil
uygulama tarafından kullanılır.

## Aday kaynakları

`WEB_FORM`, `INSTAGRAM`, `WALK_IN` (kapıdan gelen), `REFERRAL` (tavsiye),
`PHONE`, `OTHER`.

## Aynı telefonla tekrar başvuru

Bir stüdyoda aynı telefon numarasıyla **açık** (WON veya LOST olmayan) bir
aday zaten varsa, yeni bir başvuru (web formundan veya personel tarafından)
yeni bir aday satırı oluşturmaz; mevcut adayın geçmişine bir not eklenir. Bu
kural veritabanında da `leads_open_phone_key` kısmi benzersiz index'i ile
zorunlu kılınır (bkz. `docs/DATABASE_ERD.md`). Aday `WON` veya `LOST`
olduktan sonra aynı telefonla yeni bir aday açılabilir (ör. eski bir üye
tekrar ilgilenirse).

## Personel uç noktaları (JWT + `x-studio-id`, `leads.view` / `leads.manage`)

| Uç nokta | İzin | Açıklama |
|---|---|---|
| `GET /leads/studio/:studioId` | `leads.view` | Filtreli, sayfalı liste (`stage`, `source`, `ownerMembershipId`, `branchId`, `search`, `overdue`, `page`, `limit`; `limit` en fazla 100) |
| `GET /leads/:leadId/studio/:studioId` | `leads.view` | Aday detayı ve geçmişi |
| `POST /leads` | `leads.manage` | Yeni aday (veya açık telefon eşleşirse geçmişe not) |
| `PUT /leads/:leadId` | `leads.manage` | Aday bilgilerini güncelleme |
| `POST /leads/:leadId/stage` | `leads.manage` | Aşama değiştirme (yukarıdaki kurallarla) |
| `PUT /leads/:leadId/owner` | `leads.manage` | Sorumlu personel atama (hedef, aynı işletmede aktif bir personel üyeliği olmalıdır; üye rolü kabul edilmez) |
| `POST /leads/:leadId/activities` | `leads.manage` | Not, arama veya mesaj kaydı ekleme |
| `POST /leads/:leadId/convert` | `leads.manage` | Üyeliğe dönüştürme: telefonla eşleşen global bir kullanıcı varsa yeniden kullanılır, yoksa oluşturulur; bu işletmede üyelik ve üye profili açılır, aday `WON` olarak işaretlenir |
| `POST /leads/:leadId/trial` | `leads.manage` | Paketsiz deneme dersi: üyeliği açar ve verilen `scheduleId` için rezervasyon oluşturur, aday `TRIAL_BOOKED` olarak işaretlenir |

Resepsiyon rolü varsayılan olarak `leads.view` ve `leads.manage` iznine
sahiptir; eğitmen rolü sahip değildir. İşletme sahibi her zaman tüm izinlere
sahiptir.

## Herkese açık web formu

`POST /public/studios/:slug/leads` -- JWT gerektirmez, stüdyo slug'ından
çözülür. Yanıt her zaman `202 Accepted`dir: bilinmeyen veya pasif bir stüdyo
slug'ı, honeypot alanı dolu bir bot isteği ve geçerli bir başvuru aynı sabit
yanıtı alır, böylece slug'ların var olup olmadığı dışarıdan anlaşılamaz. IP
başına hız sınırı uygulanır (Redis yapılandırılmışsa Redis ile, yoksa tek
sunucu örneğiyle sınırlı bellek içi bir yedek sayaçla; üretimde `REDIS_URL`
ayarlanmalıdır).

İstek gövdesi:

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `fullName` | evet | Ad soyad |
| `phone` | evet | Türkçe yaygın biçimler kabul edilir, E.164'e normalize edilir |
| `email` | hayır | |
| `interest` | hayır | Serbest metin, örn. "Reformer dersleri" |
| `consent` | evet | `true` olmalıdır (iletişim izni) |
| `website` | hayır | Honeypot: görünmez tutulmalı, gerçek ziyaretçi hiç doldurmaz |

### Gömülebilir form örneği

Aşağıdaki düz HTML, bir stüdyonun kendi web sitesine gömebileceği asgari bir
formdur. `zen-reformer-pilates` yerine stüdyonun kendi slug'ı, `API_BASE`
yerine platformun genel API adresi (`PUBLIC_API_URL`) kullanılmalıdır.

```html
<form id="lead-form" action="https://API_BASE/public/studios/zen-reformer-pilates/leads" method="POST">
  <label>Ad soyad
    <input type="text" name="fullName" required minlength="2" />
  </label>

  <label>Telefon
    <input type="tel" name="phone" required placeholder="0532 111 22 33" />
  </label>

  <label>E-posta (opsiyonel)
    <input type="email" name="email" />
  </label>

  <label>İlgilendiğiniz ders
    <input type="text" name="interest" placeholder="Örn. Reformer" />
  </label>

  <label>
    <input type="checkbox" name="consent" value="true" required />
    Tarafımla iletişime geçilmesini kabul ediyorum.
  </label>

  <!-- Honeypot: CSS ile görünmez tutulur, gerçek ziyaretçi doldurmaz. -->
  <div style="position: absolute; left: -9999px;" aria-hidden="true">
    <label>Web sitesi
      <input type="text" name="website" tabindex="-1" autocomplete="off" />
    </label>
  </div>

  <button type="submit">Gönder</button>
</form>

<script>
  document.getElementById('lead-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.target;
    var data = new FormData(form);
    var payload = {
      fullName: data.get('fullName'),
      phone: data.get('phone'),
      email: data.get('email') || undefined,
      interest: data.get('interest') || undefined,
      consent: data.get('consent') === 'true',
      website: data.get('website') || '',
    };

    var response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      form.hidden = true;
      document.getElementById('lead-form-success').hidden = false;
    } else if (response.status === 429) {
      alert('Çok fazla deneme yapıldı, lütfen biraz sonra tekrar deneyin.');
    } else {
      alert('Bir şeyler ters gitti, lütfen bilgilerinizi kontrol edip tekrar deneyin.');
    }
  });
</script>

<p id="lead-form-success" hidden>Talebiniz alındı, en kısa sürede sizinle iletişime geçeceğiz.</p>
```

## Mobil

Hesabım > Potansiyel üyeler (`leads.view` izni gerektirir): aşamaya göre
sayımlı liste, aday detayında telefon numarası seçilebilir metin olarak
gösterilir (otomatik arama bağlantısı değildir), not ekleme, aşama değiştirme
ve üyeye dönüştürme hızlı eylemleri bulunur (`leads.manage` gerektirir).
