# Ubuntu 24.04 Üretim Kurulumu

Bu rehber, platformu çalıştırmak için bir üretim (production) sunucusunun (6 GB RAM / 4 vCPU / 60
GB SSD) kurulumunu ve ilk deploy'un yapılmasını kapsar. Uygulama image'ları her zaman CI'da build
edilir; sunucu yalnızca önceden build edilmiş image'ları çeker.

## 1. Kaynak bütçesi

| Servis | Bellek limiti | vCPU limiti | Notlar |
| --- | --- | --- | --- |
| PostgreSQL 16 | 1 GB | 1.5 | `shared_buffers=512MB`, `max_connections=100` |
| Redis 7 | 320 MB | 0.5 | `maxmemory 256mb`, `allkeys-lru` eviction |
| NestJS API | 768 MB | 1.0 | Node heap 512 MB ile sınırlı; kalan pay native bellek için |
| Next.js web | 768 MB | 1.0 | `output: 'standalone'`, Node heap 512 MB ile sınırlı |
| Caddy | 128 MB | 0.5 | Otomatik Let's Encrypt SSL, HTTP/3 |

Bu limitler `deploy/docker-compose.prod.yml` içinde zorunlu kılınır. `server-init.sh` tarafından
yapılandırılan 4 GB'lık bir swapfile, kısa süreli spike'ları (ani yükselmeleri) emer.

Build'ler sunucuda asla çalıştırılmaz: bir `next build` veya TypeScript derlemesi, canlı bir
veritabanının yanında 6 GB'lık bir host'un kaldırabileceğinin çok üzerinde RAM kullanımına yol
açabilir. Tüm image'lar GitHub Actions runner'larında build edilir ve burada yalnızca çekilir
(bkz. `docs/CICD_GUIDE.md`).

### Ölçülen kullanım (24 Eylül 2026)

Production compose yığını, seed verisiyle (4 işletme, 41 kullanıcı) çalıştırıldı ve her uç noktaya
30 saniye boyunca 100 eş zamanlı bağlantıyla yük verildi. Yük aynı makineden üretildiği için
istek/saniye değerleri gerçek sunucudakinden biraz düşüktür.

| Servis | Boşta | Yük altında (en yüksek) |
| --- | --- | --- |
| API | 49 MB | 82 MB, CPU %109 |
| Web | 36 MB | 59 MB, CPU %106 |
| PostgreSQL | 59 MB | 89 MB, CPU %33 |
| Redis | 4 MB | 5 MB |
| Caddy | 13 MB | 13 MB |

| Uç nokta | İstek/sn | Ortalama gecikme |
| --- | --- | --- |
| `/health` | ~1.230 | 81 ms |
| Üye listesi (yetki + ilişkili veri) | ~95 | 1,0 sn |
| Seans listesi | ~75 | 1,3 sn |
| Web `/dashboard` | ~820 | 121 ms |

Sonuç: 6 GB RAM / 4 vCPU fazlasıyla yeterli; toplam kullanım ~250 MB. Darboğaz, ağır liste uç
noktalarında API'nin tek CPU çekirdeğidir (Node tek iş parçacıklı). Liste uç noktalarına sayfalama
ve alan seçimi (backlog 2.1) kapasiteyi birkaç kat artırır; gerekirse aynı sunucuda ikinci bir API
kopyası çalıştırılabilir. İlk aşama için 4 GB / 2 vCPU da yeterli olur.

## 2. Sunucu kurulumu

`deploy/scripts/server-init.sh`, yeni bir sunucu için kurulum referansıdır. Sunucuya
kopyaladıktan sonra root olarak veya `sudo` ile bir kez çalıştırın:

```bash
chmod +x server-init.sh
sudo bash server-init.sh
```

Yaptıkları:
1. APT güncellemeleri ve temel araçların kurulumu (`curl`, `git`, `ufw`, `fail2ban` vb.).
2. `vm.swappiness=10` ile `/swapfile` konumunda 4 GB'lık bir swapfile.
3. UFW firewall kuralları: yalnızca SSH (22), HTTP (80) ve HTTPS/HTTP3 (443 tcp+udp) izin verilir.
   PostgreSQL ve Redis host ağına asla açılmaz - yalnızca Docker'ın iç ağında
   (`docker-compose.prod.yml` içindeki `internal_net`) çalışırlar.
4. SSH brute-force koruması için Fail2ban.
5. Resmi Docker APT deposundan Docker Engine ve Compose eklentisi.
6. Deployment dizinlerinin oluşturulması.

`server-init.sh`'ı bu rehberden hareketle düzenlemeyin; onu tek doğru kaynak (source of truth)
olarak kabul edin ve davranışının değişmesi gerekiyorsa script'in kendisini güncelleyin.

## 3. DNS ve TLS

Sunucunun IP'sine işaret eden ve `.env` içine koyacağınız domain'lerle (`WEB_DOMAIN`,
`API_DOMAIN`) eşleşen iki `A` kaydı oluşturun, örneğin:

| Type | Host | Purpose |
| --- | --- | --- |
| A | panel.example.com | Admin panel / booking pages |
| A | api.example.com | REST API |

Caddy (`deploy/caddy/Caddyfile`), bu domain'ler sunucuya işaret ettiğinde Let's Encrypt
sertifikalarını otomatik olarak talep eder ve yeniler - manuel bir certbot kurulumuna gerek
yoktur.

## 4. Uygulama dizini ve ortam

Sunucu tarafındaki uygulama dizini `/opt/app`'tir (`server-init.sh` tarafından oluşturulur ve
`deploy/scripts/lib.sh` ile deploy workflow'u tarafından kullanılır). Bir kez kurun:

```bash
sudo mkdir -p /opt/app
sudo chown -R "$USER":"$USER" /opt/app
cd /opt/app
cp .env.example .env
nano .env
```

`.env` dosyasını repository kökündeki şablondan (`.env.example`) doldurun: `IMAGE_REPO`,
`GIT_REMOTE` (yalnızca `nightly-deploy.sh` için gereklidir), `WEB_DOMAIN`, `API_DOMAIN`,
`ACME_EMAIL`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET` (32+ karakter, `openssl rand
-hex 32` ile üretin) ve SMS sağlayıcı ayarları. Bu dosyayı asla commit etmeyin.

## 5. İlk deploy

`/opt/app/.env` doldurulduktan sonra önerilen yol, CI'da deploy job'unu etkinleştirip (bkz.
`DEPLOY_ENABLED` değişkeni ve gereken SSH secret'ları için `docs/CICD_GUIDE.md`) `main`'e push
yapmak veya `release.yml`'i `workflow_dispatch` ile manuel olarak tetiklemektir.

Bunun yerine elle deploy etmek için - yalnızca ilk çalıştırma için ya da sorunu doğrudan
sunucuda teşhis ederken kullanışlıdır - `deploy/docker-compose.prod.yml`, `deploy/caddy/Caddyfile`
ve `deploy/scripts/*.sh` dosyalarını `/opt/app` ve `/opt/app/caddy`, `/opt/app/scripts` içine
kopyalayın, ardından şunu çalıştırın:

```bash
cd /opt/app
chmod +x scripts/*.sh
bash scripts/deploy.sh sha-<commit>
```

`sha-<commit>`, CI'nın zaten build edip `ghcr.io`'ya push ettiği bir tag olmalıdır. `deploy.sh`
image'ları çeker, veritabanı migration'larını çalıştırır, stack'i başlatır ve başarısızlık
durumunda otomatik rollback içeren bir smoke test çalıştırır. Tam sıralama için
`docs/CICD_GUIDE.md` bölüm 4'e bakın.

## 6. Otomatik günlük yedeklemeler

`deploy/scripts/backup.sh` için bir cron job ekleyin; bu script veritabanını `pg_dump` ile alır,
gzip ile sıkıştırıp `/opt/app/backups/` içine koyar ve 14 günden eski dump'ları döndürür (rotate
eder):

```bash
sudo crontab -e
```

```cron
30 3 * * * /bin/bash /opt/app/scripts/backup.sh >> /opt/app/backups/cron.log 2>&1
```

Object storage'a off-site (site dışı) bir kopya henüz uygulanmadı; bkz. `HANDOVER.md` (bölüm
6.1) içindeki backlog.
