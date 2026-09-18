# Agentic CI/CD Pipeline & Otomatik Dağıtım Rehberi

Bu doküman, Pilates Studio OS projesinin GitHub Actions üzerinde çalışan **Agentic CI/CD** mimarisini, sunucuya dağıtım adımlarını ve otomatik hata tespit/geri alma (Self-Healing Rollback) mekanizmasını açıklar.

---

## 1. Mimarinin Çalışma Prensibi

```mermaid
flowchart TD
    A["Developer (git push main)"] --> B["Quality Gate (Lint, TSC, Prisma Validate)"]
    B --> C["Docker Buildx (GitHub CI Runner'da Derleme)"]
    C --> D["Push to GitHub Container Registry (ghcr.io)"]
    D --> E["SSH Deploy to Ubuntu 24.04"]
    E --> F["Pull Images & Run Prisma Migrations"]
    F --> G["Rolling Container Update (Zero-Downtime)"]
    G --> H{"Agentic Smoke Test (/health Probes)"}
    H -- "Başarılı (HTTP 200 & DB: OK)" --> I["🎉 Release Live & Verified"]
    H -- "Başarısız (Degraded / Crash)" --> J["🚨 Auto-Rollback to Previous Tag"]
```

---

## 2. GitHub Repository Secrets Yapılandırması

Pipeline'ın sunucunuza bağlanıp dağıtım yapabilmesi için GitHub reponuzda **Settings > Secrets and variables > Actions** sekmesinden aşağıdaki secret'ları tanımlamanız gerekmektedir:

| Secret Adı | Açıklama | Örnek Değer |
| :--- | :--- | :--- |
| `UBUNTU_HOST` | Ubuntu 24.04 sunucunuzun statik IP adresi | `194.xxx.xxx.xxx` |
| `UBUNTU_USER` | Sunucudaki deploy kullanıcısı veya root | `root` veya `deployer` |
| `UBUNTU_SSH_PRIVATE_KEY` | Sunucuya şifresiz bağlanacak SSH özel anahtarı (`id_rsa` veya `id_ed25519`) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### SSH Anahtarının Hazırlanması:
Sunucunuzda veya yerel terminalinizde anahtar çifti üretin:
```bash
# SSH key üretin
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy

# Public key'i sunucunun authorized_keys dosyasına ekleyin:
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys

# Private key içeriğini kopyalayıp GitHub Secret 'UBUNTU_SSH_PRIVATE_KEY' içine yapıştırın:
cat ~/.ssh/github_deploy
```

---

## 3. Pipeline Aşamaları Detayı

### Aşama 1: Kalite Kapısı (Quality Gate)
- Kod `main` dalına itildiğinde veya Pull Request açıldığında çalışır.
- TypeScript tip kontrolü (`pnpm turbo run typecheck`) yapılır.
- Prisma veri modeli kuralları doğrulanır (`prisma validate`).
- Herhangi bir tip veya sözdizimi hatasında dağıtım başlamadan durdurulur.

### Aşama 2: CI Ortamında Derleme (Build & Push)
- 6 GB RAM'li sunucunun yorulmaması için derleme GitHub'ın 16 GB bellekli sanal makinelerinde yapılır.
- Multi-stage optimize imajlar oluşturulur.
- GitHub Container Registry'ye iki etiketle yüklenir:
  - `ghcr.io/org/repo/api:sha-a1b2c3d` (Özgün commit etiketi)
  - `ghcr.io/org/repo/api:latest`

### Aşama 3: Sıfır Kesintili Dağıtım (Zero-Downtime Deploy)
- SSH üzerinden Ubuntu sunucusuna bağlanılır.
- Yeni imajlar sunucuya çekilir (`docker compose pull`).
- Veritabanı migration'ları konteyner üzerinden güvenle uygulanır (`prisma migrate deploy`).
- Konteynerler rolling update mantığıyla sırayla yeniden başlatılır (kullanıcılar kesinti hissetmez).

### Aşama 4: Agentic Smoke Test & Otomatik Rollback
- Dağıtım tamamlandıktan hemen sonra `healthcheck.sh` scripti tetiklenir:
  - `http://localhost:4000/health` adresine 5 saniye arayla 6 kez istek atılır.
  - API uptime, veritabanı yanıt süresi ve bellek sağlığı denetlenir.
  - Next.js Web Dashboard'un HTTP 200 döndürdüğü doğrulanır.
- **Eğer test başarısız olursa:**
  - Pipeline durdurulmaz, otomatik kurtarma moduna geçer.
  - `rollback.sh` çalıştırılarak bir önceki çalışan kararlı imaja anında geri dönülür.
  - Geliştiriciye GitHub Step Summary üzerinde hata ve geri alma raporu sunulur.
