# Ubuntu 24.04 LTS Üretim Ortamı (Production) Kurulum Rehberi

Bu rehber, **6 GB RAM / 4 vCPU / 60 GB SSD** özelliklerindeki Ubuntu 24.04 sunucunuzu yüksek güvenlikli ve sıfır kesintili bir şekilde Pilates Studio OS sistemini çalıştıracak hale getirmek için hazırlanmıştır.

---

## 1. Sunucu Kaynak Mimarisi & Bellek Optimizasyonu

6 GB RAM sınırlı bir kaynak olduğu için konteynerler şu limitlerle sabitlenmiştir:

| Servis | Bellek Limiti | vCPU Limiti | Açıklama |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16** | 768 MB | 1.5 | 512MB shared_buffers, optimize WAL |
| **Redis 7** | 256 MB | 0.5 | allkeys-lru tahliye politikası |
| **NestJS Core API** | 512 MB | 1.0 | BullMQ kuyrukları + REST API |
| **Next.js 15 Web** | 512 MB | 1.0 | Standalone mode derleme |
| **Caddy Reverse Proxy**| 128 MB | 0.5 | Otomatik Let's Encrypt SSL + HTTP/3 |
| **İşletim Sistemi + OS** | ~600 MB | - | Çekirdek servisleri, SSH, Fail2ban |
| **Toplam Tüketim** | **~2.7 GB** | - | **> 3 GB boş tampon bellek kalır!** |

> [!IMPORTANT]
> **Neden Build Sunucuda Yapılmaz?**
> Next.js (`next build`) ve TypeScript derlemeleri anlık 2-3 GB RAM tepe noktası oluşturabilir. Bu işlem sunucuda yapılırsa PostgreSQL veya API konteynerleri `OOM Killer` (Out of Memory) tarafından kapatılabilir. Bu nedenle tüm derlemeler **GitHub Actions (CI)** üzerinde yapılarak sunucuya yalnızca hazır Docker imajları indirilir.

---

## 2. Tek Komutla Otomatik Sunucu Hazırlama

Sunucunuza root veya `sudo` yetkili kullanıcı ile SSH bağlantısı yaptıktan sonra, depomuzdaki hazırlık scriptini çalıştırabilirsiniz:

```bash
# 1. Hazırlık scriptini sunucuya indirin veya oluşturun:
curl -fsSL https://raw.githubusercontent.com/your-username/pilates-studio-os/main/deploy/scripts/server-init.sh -o server-init.sh

# 2. Çalıştırma izni verip başlatın:
chmod +x server-init.sh
sudo bash server-init.sh
```

### Script Neler Yapar?
1. **APT Güncellemeleri:** En son güvenlik yamalarını yükler.
2. **4 GB Swap Alanı:** `/swapfile` oluşturur ve `swappiness=10` ayarıyla SSD üzerinde güvenli bellek tamponu sağlar.
3. **UFW Güvenlik Duvarı:** 
   - SSH (Port 22), Caddy HTTP (Port 80), Caddy HTTPS (Port 443 TCP/UDP QUIC) dışındaki tüm gelen istekleri engeller.
   - PostgreSQL (5432) ve Redis (6379) portları dış dünyaya **asla açılmaz**, yalnızca Docker iç ağında (`internal_net`) çalışır.
4. **Fail2ban:** SSH kaba kuvvet (brute-force) saldırılarını engeller.
5. **Docker Engine & Compose:** Resmi Docker APT deposunu bağlayarak Docker ve Compose plugin'ini kurar.
6. **Dizinler:** `/opt/pilates-studio` uygulama dizinini oluşturur.

---

## 3. Alan Adı (DNS) ve SSL Ayarları

Domain kayıt firmanızın DNS yönetim panelinde iki adet `A` kaydı oluşturun:

| Kayıt Türü | İsim (Host) | Yönlendirilecek IP | Açıklama |
| :--- | :--- | :--- | :--- |
| `A` | `panel.studyonuz.com` | Sunucu IP adresiniz | Yönetim Paneli ve Rezervasyon |
| `A` | `api.studyonuz.com` | Sunucu IP adresiniz | REST API ve Webhook'lar |

> [!TIP]
> Caddy Reverse Proxy, bu alan adlarını gördüğü anda Let's Encrypt üzerinden **otomatik olarak ücretsiz SSL sertifikasını alır ve süresi dolmadan otomatik yeniler**. Certbot veya cron scriptiyle uğraşmanıza gerek yoktur.

---

## 4. Ortam Değişkenleri (`.env`) Dosyasının Hazırlanması

Sunucuda `/opt/pilates-studio/.env` dosyasını oluşturun:

```bash
cd /opt/pilates-studio
nano .env
```

Aşağıdaki şablonu kendi güvenli şifrelerinizle doldurun:

```env
NODE_ENV=production
APP_VERSION=1.0.0

# Alan Adlarınız
WEB_DOMAIN=panel.studyonuz.com
API_DOMAIN=api.studyonuz.com

# PostgreSQL Şifresi (Güçlü bir parola üretin)
POSTGRES_USER=pilates_admin
POSTGRES_PASSWORD=cok_guclu_bir_veritabani_sifresi_32_karakter!
POSTGRES_DB=pilates_prod

# Redis Şifresi
REDIS_PASSWORD=guclu_bir_redis_sifresi_32_karakter!

# JWT Secret Anahtarı (Oturum güvenliği için en az 64 karakter)
JWT_SECRET=super_secret_jwt_hmac_sha256_key_at_least_64_characters_long!
CORS_ORIGIN=https://panel.studyonuz.com

# SMS Sağlayıcısı (NETGSM veya MOCK)
SMS_PROVIDER=NETGSM
NETGSM_USER=850xxxxxxx
NETGSM_PASSWORD=netgsm_api_sifreniz
NETGSM_HEADER=STUDYO_SMS_BASLIGI
```

---

## 5. Otomatik Günlük Veritabanı Yedeği Kurulumu

Gecelik otomatik yedekleme için sunucuda cron görevi ekleyin:

```bash
# Crontab düzenleyicisini açın
sudo crontab -e

# Her gece 03:30'da çalışacak yedekleme satırını ekleyin:
30 3 * * * /bin/bash /opt/pilates-studio/scripts/backup.sh >> /opt/pilates-studio/backups/cron.log 2>&1
```

Bu script:
- Veritabanını gzip sıkıştırmalı olarak `/opt/pilates-studio/backups/` altına kaydeder.
- 14 günden eski yedekleri otomatik silerek disk alanınızı korur.
