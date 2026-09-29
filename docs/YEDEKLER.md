# Veritabanı Yedekleri (D2)

Sahibin isteği: "Yedekler süper admin panelinden yönetilebilmeli, kontrol edebileyim. Süper admin
paneli dışında hiçbir şeyi yönetmek istemiyorum." Bu yüzden yedeklerin tek operasyon ekranı
süper admin panelindeki **Yedekler** sayfasıdır (`/admin/yedekler`). Sunucudaki cron yedeği
yedek (fallback) olarak kalır; panel onun ürettiği dosyaları da gösterir.

## 1. Mimari

İki yazıcı, tek biçim, tek depo:

| | API (panel) | Sunucu cron (`deploy/scripts/backup.sh`) |
| --- | --- | --- |
| Ne zaman | Paneldeki zamanlamaya göre her gün (varsayılan 01:00 UTC) ve "Şimdi yedek al" ile | Her gün 02:30 (sunucu saati) ve her deploy'dan önce |
| Nasıl | API konteynerinde `pg_dump` (PostgreSQL 16 istemcisi imajda) -> gzip -> AES-256-CBC (PBKDF2, 200.000 tur) -> çok parçalı (multipart) yükleme | `docker compose exec postgres pg_dump` -> gzip -> `openssl enc` -> curl ile yükleme |
| Yerel kopya | Yok (konteyner salt okunur) | `/opt/app/backups`, 14 gün, şifresiz |
| Uzak kopya adı | `<prefix>/db_YYYYMMDD_HHMMSSZ-api.sql.gz.enc` | `<prefix>/db_YYYYMMDD_HHMMSSZ-host.sql.gz.enc` |
| Kayıt | `backup_runs` tablosu ve denetim günlüğü | `/opt/app/deploy.log` |

- Saat damgası her ikisinde de UTC'dir (`Z`). `-api` / `-host` işareti sayesinde iki yazıcı aynı
  bucket ve önekte birbirinin dosyasının üzerine yazmaz. Eski betiğin ürettiği işaretsiz adlar
  (`db_YYYYMMDD_HHMMSS.sql.gz`, sunucu yerel saati) panelde "Sunucu cron (eski ad)" olarak görünür.
- Biçim birebir aynıdır: `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` çıktısı
  ("Salted__" + 8 bayt tuz + şifreli veri, anahtar ve IV PBKDF2-HMAC-SHA256 ile türetilir) ve
  yanında `sha256sum` biçiminde `.sha256` dosyası. Bu yüzden iki kaynağın yedeği de aynı komutla
  açılır (bölüm 6). Uyumluluk birim testinde iki yönlü (TS ile şifrele / openssl ile çöz ve tersi)
  ve sabit bir test vektörüyle, API e2e testinde de belgelenen komutla doğrulanır.
- Uzak depo S3 uyumlu herhangi bir hizmettir (AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO).
  API yeni bir bağımlılık eklemez: ListObjectsV2, GetObject, PutObject, DeleteObject, multipart
  yükleme ve ön imzalı (presigned) GET için SigV4 imzalama `apps/api/src/modules/backups/s3/`
  içinde yazılmıştır ve AWS'nin örnek imzalarıyla test edilir. Adresleme `backup.sh` ile aynıdır
  (path-style: `<endpoint>/<bucket>/<anahtar>`).
- Yedekleme API içinde arka planda (in-process) çalışır; ayrı bir kuyruk kullanılmaz, çünkü API
  tek konteynerdir ve yedeğin amacı arızalardan kurtulmaktır (Redis'e bağımlı olmamalı). Aynı
  anda yalnızca bir yedek çalışır: kilit `backup_settings.lock_run_id` üzerinde koşullu
  güncellemedir. Süreç yarıda ölürse 3 saat sonra çalışma "başarısız (kesildi)" sayılır ve kilit
  serbest kalır.
- Bellek: döküm akış (stream) olarak işlenir, 8 MiB'lık parçalarla yüklenir; diske veya
  `/tmp`'ye yazılmaz. 512 MB Node heap sınırı içinde kalır.

Veri modeli (migration `20261018000000_backup_runs`, yalnızca ekleme):

- `backup_settings`: tek satır (`id = 'platform'`): günlük zamanlama açık/kapalı, saat (UTC,
  `SS:DD`), saklama günü (0 = kapalı), çalışma kilidi.
- `backup_runs`: API'nin her yedeği: başlangıç/bitiş, durum (RUNNING/SUCCEEDED/FAILED), tetikleyen
  (MANUAL/SCHEDULED), şifreli boyut, nesne anahtarı, sha256, doğrulama zamanı, hata, isteyen
  kullanıcı. Kiracı verisi değildir (`studio_id` yok), yalnızca süper admin görür.

## 2. Panel

`/admin/yedekler` (menüde "Yedekler"):

- **Özet kartları**: son başarılı yedek (zaman, kaç saat önce, günlük aralıktan eski ise
  "Gecikmiş"), uzak depodaki yedek sayısı ve toplam boyut, sunucudaki kopya sayısı ve boyutu,
  saklama ayarı.
- **Şimdi yedek al**: yedeği arka planda başlatır; liste yedek bitene kadar 5 saniyede bir
  yenilenir. Hız sınırı: iki elle yedek arasında en az 10 dakika. Başka bir yedek sürerken
  reddedilir.
- **Zamanlama ve saklama**: günlük otomatik yedek açık/kapalı, saat (UTC), saklama günü.
  Sıradaki otomatik yedeğin zamanı gösterilir.
- **Yedek dosyaları**: ad ve zaman, kaynak (panel / sunucu cron), konum (sunucu, uzak depo veya
  ikisi), boyut, yaş, SHA-256 dosyası var mı, doğrulandı mı, korunuyor mu. Uzak kopyası olan
  her yedek için **Doğrula**, **İndir** ve (korunmuyorsa) **Sil**.
- **Panelden alınan yedekler**: son 20 çalışma, durum ve hata ayrıntısı.

Sistem Sağlığı sayfasında (`/admin/health`) ayrıca bir "Veritabanı Yedekleri" kartı vardır.

Uç noktalar (hepsi `@SuperAdminOnly()`, her yazma işlemi `audit_logs`'a yazılır):

| Uç nokta | İş | Denetim kaydı |
| --- | --- | --- |
| `GET /admin/backups` | Özet, ayarlar, dosyalar, son çalışmalar | - |
| `POST /admin/backups/run` | Elle yedek (202) | `backup.run_started`, sonra `backup.run_succeeded` / `backup.run_failed` |
| `PUT /admin/backups/settings` | Zamanlama ve saklama | `backup.settings_updated` (önce/sonra) |
| `POST /admin/backups/verify` `{name}` | İndirir, sha256'yı karşılaştırır, tamamını test amaçlı çözer | `backup.verified` / `backup.verify_failed` |
| `POST /admin/backups/download-url` `{name}` | Kısa ömürlü ön imzalı indirme bağlantısı | `backup.download_url_created` |
| `POST /admin/backups/delete` `{name, confirmName}` | Uzak yedeği ve `.sha256` dosyasını siler | `backup.deleted` |

Hata kodları (`BACKUP_ERROR_CODES`, panel `adminBackups.error.*` ile çevirir):
`BACKUP_OFFSITE_NOT_CONFIGURED`, `BACKUP_ALREADY_RUNNING`, `BACKUP_RATE_LIMITED`,
`BACKUP_NOT_FOUND`, `BACKUP_CONFIRM_MISMATCH`, `BACKUP_NEWEST_VERIFIED_PROTECTED`,
`BACKUP_LAST_COPY_PROTECTED`, `BACKUP_NOT_DOWNLOADABLE`, `BACKUP_STORE_ERROR`.

## 3. Doğrulama, saklama ve silme kuralları

- **Doğrulama**: nesnenin tamamı bir kez okunur: şifreli verinin sha256'sı `.sha256` dosyasıyla
  karşılaştırılır, dosya tamamen çözülür (yanlış anahtar veya eksik dosya dolgu hatası verir),
  gzip açılır ve içeriğin bir `pg_dump` dökümü gibi başlayıp "PostgreSQL database dump complete"
  ile bittiği kontrol edilir. Hiçbir şey diske yazılmaz. API her yedeğini yükledikten hemen sonra
  bu doğrulamadan geçirir; doğrulanamayan yükleme silinir ve çalışma başarısız sayılır. Sunucu
  cron'unun yedekleri panelden "Doğrula" ile doğrulanır.
- **Saklama**: yalnızca başarılı ve doğrulanmış bir API yedeğinden sonra çalışır. Uzak depodaki
  (her iki kaynaktan) yedeklerden saklama gününden eski olanları siler. En yeni yedek doğrulanmış
  değilse hiçbir şey silmez (`backup.prune_skipped`), doğrulanmış en yeni yedeği hiçbir koşulda
  silmez. Silinenler `backup.pruned` kaydında listelenir. 0 gün seçilirse API silmez; o durumda
  bucket'ın yaşam döngüsü (lifecycle) kuralı geçerlidir (önerilen: 35 gün). İkisi birlikte
  kullanılacaksa lifecycle süresi paneldeki süreden uzun olmalıdır.
- **Silme**: yalnızca uzak kopya silinebilir (sunucu klasörü API'ye salt okunur bağlıdır). Yedeğin
  adı onay kutusuna aynen yazılmalıdır. Doğrulanmış en yeni yedek ve uzak depodaki son yedek
  silinemez.
- **İndirme**: tarayıcıya 5 dakika (en fazla 15 dakika, `BACKUP_DOWNLOAD_URL_TTL_SECONDS`)
  geçerli ön imzalı bir bağlantı verilir; dosya şifrelidir ve açmak için anahtar gerekir.
  Sunucudaki şifresiz yerel kopyalar panelden indirilemez.

## 4. Uyarılar

- Zamanlayıcı kalp atışı (15 dakikada bir) en fazla saatte bir yedek durumunu hesaplar. Son
  başarılı yedek `BACKUP_STALE_HOURS` (varsayılan 26) saatten eskiyse veya hiç yoksa, e-postası
  olan tüm süper adminlere `BACKUP_STALE` şablonuyla (mesajlaşma motoru, işlemsel) e-posta gider;
  en fazla günde bir kez (`backup.stale_alert_sent`).
- "Son başarılı yedek": uzak depo tanımlıysa `.sha256` dosyası olan en yeni uzak yedek veya
  başarılı son API çalışması (yalnızca sunucuda duran bir dosya, yüklemenin başarısız olduğunu
  gösterir ve sayılmaz); uzak depo yoksa sunucudaki en yeni dosya.
- Uzak depo listelenemezse durum "Hata" olur; bu durumda e-posta gitmez, sayfada ve Sistem
  Sağlığı'nda görünür.
- Sunucu cron'u başarısız olursa betik hata kodu döner ve `/opt/app/deploy.log`'a yazar; panel
  bunu yeni dosya gelmemesinden (gecikme uyarısı) anlar.

## 5. Kurulum

1. `/opt/app/.env` içine `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (AWS dışı sağlayıcılarda),
   `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY` ve `BACKUP_ENCRYPTION_KEY` (`openssl rand -hex 32`) girin.
   Bucket tanımlıyken diğerleri eksikse API açılmaz (Zod doğrulaması). Şifreleme anahtarını
   sunucu dışında da (parola yöneticisi) saklayın.
2. `docker-compose.prod.yml` bu değerleri API'ye aktarır ve `/opt/app/backups` klasörünü
   `/var/backups/app` olarak salt okunur bağlar (`BACKUP_LOCAL_DIR`).
3. Klasör izinleri: `backup.sh` ve `server-init.sh` klasörü `750` ve grup `1000` yapar
   (`BACKUP_READER_GID` ile değiştirilebilir); bu, API imajının `node` kullanıcısının grubudur.
   API böylece dosyaları listeleyebilir ama yedek dosyalarının kendisi `0600 root` kaldığı için
   şifresiz dökümü okuyamaz. Sunucuda 1000 numaralı grup genellikle ilk kullanıcıya aittir (o
   kullanıcı zaten docker grubunda olduğundan yeni bir erişim açılmaz).
4. API imajı `postgresql16-client` içerir; sürüm, compose'daki `postgres:16-alpine` ile aynı ana
   sürümdür. Postgres ana sürümü yükseltilirse `deploy/docker/api.Dockerfile` da güncellenmelidir.
5. Panelde **Zamanlama ve saklama** bölümünü kontrol edin ve bir kez **Şimdi yedek al** deyin.
   Bitince yedek listede "Panel / Uzak depo / Doğrulandı / Korunuyor" olarak görünmelidir.

Ortam değişkenleri (API, `apps/api/src/config/env.ts`):

| Değişken | Varsayılan | Not |
| --- | --- | --- |
| `BACKUP_S3_BUCKET` | - | Boşsa panel yalnızca sunucu klasörünü gösterir, yedek alamaz |
| `BACKUP_S3_ENDPOINT` | `https://s3.<region>.amazonaws.com` | R2/B2/Wasabi/MinIO adresi |
| `BACKUP_S3_REGION` | `us-east-1` | R2 için `auto` |
| `BACKUP_S3_PREFIX` | `db` | |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | - | Hiçbir uç nokta döndürmez |
| `BACKUP_ENCRYPTION_KEY` | - | En az 16 karakter; hiçbir uç nokta döndürmez |
| `BACKUP_LOCAL_DIR` | - | Prod compose'da `/var/backups/app` |
| `BACKUP_STALE_HOURS` | 26 | Gecikme eşiği (saat) |
| `BACKUP_DOWNLOAD_URL_TTL_SECONDS` | 300 | 60-900 |
| `BACKUP_PG_DUMP_PATH` | `pg_dump` | |

Depo yetkisi: API'nin anahtarının bucket'ta `ListBucket`, `GetObject`, `PutObject`,
`DeleteObject` ve multipart izinleri olmalıdır (silme ve saklama için `DeleteObject`). Anahtar
yalnızca bu bucket ile sınırlandırılmalıdır.

## 6. Geri yükleme (adım adım)

Panel veritabanını geri yüklemez: üretime geri yükleme yıkıcı bir sunucu işlemidir ve bilerek
panelin dışında tutulmuştur. Adımlar:

1. **Yedeği seçin ve doğrulayın.** Panelde yedeğin satırında **Doğrula** deyin; "doğrulandı"
   görmelisiniz.
2. **İndirin.** **İndir** ile gelen bağlantı birkaç dakika geçerlidir. Sunucuda çalışacaksanız
   bağlantıyı kopyalayıp sunucuda `curl -o db.sql.gz.enc '<bağlantı>'` ile indirin. `.sha256`
   değeri doğrulama kaydında (`backup.verified`) ve uzak depoda durur:

   ```bash
   sha256sum db.sql.gz.enc   # .sha256 dosyasındaki değerle aynı olmalı
   ```

3. **Şifreyi çözün** (anahtar ortamdan okunur, komut satırında görünmez; iki kaynağın yedeği
   için de aynı komut):

   ```bash
   read -rs BACKUP_ENCRYPTION_KEY && export BACKUP_ENCRYPTION_KEY
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY \
     -in db.sql.gz.enc -out db.sql.gz
   ```

4. **Önce deneme veritabanına yükleyin** (kuru çalıştırma, üretime dokunmaz):

   ```bash
   C="docker compose -f /opt/app/docker-compose.prod.yml"
   $C exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" restore_check'
   gunzip -c db.sql.gz | $C exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d restore_check'
   $C exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_check -c "select count(*) from studios"'
   $C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
   ```

5. **Üretime geri yükleyin** (bakım penceresinde; mevcut veritabanı önce yedeklenir):

   ```bash
   /opt/app/scripts/backup.sh                     # o anki durumun yedeği
   $C stop api web
   $C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   gunzip -c db.sql.gz | $C exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   $C start api web
   ```

   API açılırken bekleyen migration'lar (yedek daha eski bir sürümden ise) deploy akışıyla
   uygulanır; gerekirse `deploy.sh` ile aynı sürümü yeniden deploy edin.

6. **Sonrası**: panelde yeni bir yedek alın ve Sistem Sağlığı'nı kontrol edin. İndirilen şifresiz
   dosyaları silin (`shred -u db.sql.gz`).

Sunucudaki yerel kopyalar şifresizdir; onlarla geri yüklemede 2. ve 3. adımlar atlanır
(`/opt/app/backups/db_...-host.sql.gz`). Geri yükleme en az üç ayda bir 4. adımdaki kuru
çalıştırmayla denenmelidir.

## 7. Güvenlik

- Tüm uç noktalar yalnızca süper admin (platform sahibi) içindir; işletme sahibi 403 alır.
- Şifreleme anahtarı ve depo gizli anahtarı yalnızca ortamdan okunur, hiçbir yanıtta, logda veya
  hata mesajında yer almaz (S3 hataları yalnızca HTTP durumu ve S3 hata kodunu taşır, `pg_dump`
  hata çıktısında parola maskelenir). `pg_dump` parolayı `PGPASSWORD` ortamından alır, komut
  satırında görünmez.
- İndirme bağlantıları dakikalarla sınırlıdır ve her biri denetim günlüğüne yazılır.
- API yerel şifresiz dökümleri okuyamaz (bkz. Kurulum 3).
- Elle yedek 10 dakikada bir ile sınırlıdır; aynı anda tek yedek çalışır.

## 8. Test

- Birim (`apps/api/src/modules/backups/backups.spec.ts`): SigV4 (AWS örnek imzaları), S3 listeleme
  sayfalaması, multipart yükleme ve iptal, ön imzalı bağlantı (sahte HTTP), openssl uyumluluğu
  (sabit vektör ve openssl varsa iki yönlü), doğrulama, ad/zamanlama/saklama kuralları.
- API e2e (`apps/api/test/e2e/backups.e2e-spec.ts`): bellek içi depo ve sahte `pg_dump` ile
  yetki (süper admin / sahip 403), listeleme, doğrulama, indirme, ayarlar, elle yedek, hız sınırı,
  kilit, saklama, onaylı silme, gecikme uyarısı ve denetim kayıtları.
- Playwright (`apps/web/e2e/admin-backups.e2e.ts`): yapılandırılmamış durum, ayar kaydetme,
  Sistem Sağlığı kartı, sahibin erişememesi.
