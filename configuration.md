# Statok — гайд із налаштування

Стек: Bun + Hono (бекенд, порт 3000) + Vue 3 + Vite (фронтенд) + PostgreSQL 16.
Single-user, self-hosted. Домени: `statok.simk.in.ua` (фронт) / `api.statok.simk.in.ua` (API).
VPS: `dakara`, `195.201.130.51`, Ubuntu 24.04, Traefik v3 (edge, certresolver `le`).

---

## Dev (локально)

### Порти

| Сервіс   | Порт  |
|----------|-------|
| backend  | 3100  |
| frontend | 5273  |
| postgres | 5434  |

### Запуск

```sh
# встановити залежності
bun install

# запустити postgres локально (або використовувати наявний на порті 5434)
# потім:
bun --cwd backend run dev      # Bun виконує TS напряму, build не потрібен
bun --cwd frontend run dev
```

### `backend/.env.dev`

Файл вже є в репо. Клієнт `GOOGLE_CLIENT_ID` можна залишити порожнім — тоді `/auth/google`
повертає `503 AUTH_NOT_CONFIGURED`. Заповни для тесту Google-входу в dev.

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok
JWT_SECRET=dev-secret-change-me-minimum-32-chars!!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
BASE_CURRENCY=USD
PORT=3100
TZ=Europe/Kyiv
CORS_ORIGINS=http://localhost:5273
GOOGLE_CLIENT_ID=               # заповни для тесту google-входу
ALLOWED_GOOGLE_EMAIL=vitaliy.simkin@gmail.com
ENABLE_PASSWORD_LOGIN=true      # dev: парольна форма увімкнена
```

### Тести

```sh
# DATABASE_URL має вказувати на тестову БД (drizzle мігрує автоматично)
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok_test bun test
```

### Google dev origin

У Google Cloud Console → OAuth Client → Authorized JavaScript origins додай
`http://localhost:5273`. Без цього GIS у dev не поверне credential.

---

## Прод: передумови

### ✅ Зроблено

- Google Auth реалізовано і закомічено (`POST /auth/google`, allowlist 1 email,
  break-glass `POST /auth/login` за флагом `ENABLE_PASSWORD_LOGIN`).
- DNS: `statok.simk.in.ua` і `api.statok.simk.in.ua` → `195.201.130.51`.
- VPS bootstrap: тека `/opt/statok` створена; deploy-ключ згенеровано, pub у
  `/root/.ssh/authorized_keys`; Docker-мережа `web` присутня; `/opt/statok/backup.sh`
  покладено і виконуваний; swap 2 GiB активний і в `/etc/fstab`.
- GitHub Secrets `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER` виставлено.

---

### ⬜ Крок 1 — Google Cloud Console [manual-owner]

1. Відкрити APIs & Services → Credentials.
2. (Якщо немає) OAuth consent screen: User type **External**, support email
   `vitaliy.simkin@gmail.com`; режим Testing, додати test-user `vitaliy.simkin@gmail.com`.
3. Create credentials → **OAuth client ID → Web application**.
   - Authorized JavaScript origins: `https://statok.simk.in.ua`, `http://localhost:5273`.
   - Authorized redirect URIs: **порожньо** (GIS ID-token callback не потребує redirect URI).
4. Скопіювати **Client ID** — знадобиться у кроках 2 і 3.

### ⬜ Крок 2 — GitHub Secrets [manual-owner]

Settings → Secrets and variables → Actions → **Secrets**:

| Secret               | Значення                                                        |
|----------------------|-----------------------------------------------------------------|
| `RELEASE_TOKEN`      | Fine-grained PAT, scope `contents: write` на цей репо          |
| `TELEGRAM_BOT_TOKEN` | токен бота (BotFather)                                          |
| `TELEGRAM_CHAT_ID`   | ID чату для нотифікацій деплою                                  |

### ⬜ Крок 3 — GitHub Variable [manual-owner]

Settings → Secrets and variables → Actions → **Variables**:

| Variable               | Значення                             |
|------------------------|--------------------------------------|
| `VITE_GOOGLE_CLIENT_ID`| Client ID з кроку 1 (не секрет — він потрапить у фронт-бандл) |

### ⬜ Крок 4 — `/opt/statok/.env` на VPS [manual-owner]

Файл живе ТІЛЬКИ на хості, не комітити. **Якщо файл уже існує — доповнювати лише відсутні
ключі; `JWT_SECRET` і `POSTGRES_PASSWORD` не перезаписувати** (зміна пароля ламає підключення
до наявного postgres volume; зміна JWT_SECRET розлогінює).

```env
# Версія — пише deploy-пайплайн; для першого створення лишити порожнім
STATOK_VERSION=

# --- Postgres ---
# Генерація: openssl rand -hex 24
POSTGRES_PASSWORD=<openssl rand -hex 24>
# Той самий пароль у DATABASE_URL (host=postgres — ім'я docker-сервісу)
DATABASE_URL=postgresql://statok:<той самий POSTGRES_PASSWORD>@postgres:5432/statok

# --- JWT ---
# Генерація: openssl rand -hex 32  (мінімум 32 байти — валідується на старті)
JWT_SECRET=<openssl rand -hex 32>

# --- Адмін-акаунт (сід при першому старті; наявного юзера не перезаписує) ---
ADMIN_USERNAME=<обираєш власноруч>
ADMIN_PASSWORD=<надійний пароль, зберігай у менеджері>

# --- Прикладні ---
BASE_CURRENCY=USD
TZ=Europe/Kyiv
CORS_ORIGINS=https://statok.simk.in.ua

# --- Google Auth ---
GOOGLE_CLIENT_ID=<Client ID з кроку 1>
ALLOWED_GOOGLE_EMAIL=vitaliy.simkin@gmail.com
# ENABLE_PASSWORD_LOGIN=false  → вхід лише через Google (рекомендовано)
# Тимчасово виставити =true для першого smoke-тесту парольним входом, якщо потрібно
ENABLE_PASSWORD_LOGIN=false
```

### ⬜ Крок 5 — GHCR visibility [manual-owner] (після першого білда)

Після першого успішного CI-білда виставити пакети як **Public**:
GitHub → Packages → `statok/frontend` → Package settings → Change visibility → Public.
Повторити для `statok/backend`.
Без цього VPS не зможе виконати `docker compose pull` (доступ без логіну).

### ⬜ Крок 6 — Нічний бекап [manual-owner]

```sh
# На VPS: встановити age і rclone, налаштувати rclone remote
apt-get install age
# rclone install: https://rclone.org/install/
rclone config   # налаштувати remote, напр. b2 або s3

# Згенерувати age-ключ
age-keygen -o ~/.age/key.txt
# Публічний ключ (age1...) → /opt/statok/backup.env
```

`/opt/statok/backup.env` (приватний ключ тримати ПОЗА VPS — для відновлення):

```env
AGE_RECIPIENT=age1...        # публічний ключ
RCLONE_REMOTE=b2             # ім'я rclone-remote
```

Cron (root):

```cron
30 3 * * * /opt/statok/backup.sh >> /var/log/statok-backup.log 2>&1
```

---

## Прод: перший реліз

Передумови кроків 1–5 виконано.

### Варіант A — локально

```sh
# Робоче дерево чисте, знаходишся на main
bun run release:patch   # або release:minor / release:major
# Скрипт: bump версії в package.json (root/backend/frontend),
# коміт "chore: release vX.Y.Z", тег vX.Y.Z, push коміту й тега
```

### Варіант B — GitHub Actions

Actions → **Release** → Run workflow → вибрати bump (patch / minor / major).
Потребує `RELEASE_TOKEN`.

### Що відбувається автоматично після пушу тега `v*`

1. `build-backend.yml` і `build-frontend.yml` стартують паралельно — збирають Docker-образи і
   пушать у `ghcr.io/vitaliysimkin/statok/{backend,frontend}` з тегами `<version>` і `latest`.
   Фронтенд збирається з `VITE_API_URL=https://api.statok.simk.in.ua` і
   `VITE_GOOGLE_CLIENT_ID` (з GitHub Variable).
2. `deploy.yml` → `wait-for-builds` чекає успіху обох білдів, потім:
   - scp `infra/` → `/opt/statok/` (strip_components: 1 → `docker-compose.yml` у корені);
   - ssh: `sed` оновлює `STATOK_VERSION=<version>` у `/opt/statok/.env`;
   - `docker compose pull` + `docker compose up -d --remove-orphans`;
   - бекенд на старті: валідація env → міграції Drizzle → сід адміна → listen;
   - health check: 24 спроби × 5 с на `https://api.statok.simk.in.ua/health`;
   - GitHub Release з авто-нотатками;
   - Telegram-нотифікація статусу.

---

## Верифікація

```sh
# 1) Health (Traefik → бекенд → БД)
curl -s https://api.statok.simk.in.ua/health
# очікувано: {"status":"ok","db":"ok","version":"X.Y.Z"}

# 2) Фронтенд
curl -sI https://statok.simk.in.ua | head -n1
# очікувано: HTTP/2 200

# 3) Break-glass логін (тільки якщо ENABLE_PASSWORD_LOGIN=true)
curl -s -X POST https://api.statok.simk.in.ua/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
# очікувано: {"token":"...","username":"..."}

# 4) Refresh сесії (перевіряє FR-04 sliding-session)
curl -s -X POST https://api.statok.simk.in.ua/auth/refresh \
  -H 'Authorization: Bearer <token>'
```

В UI: відкрити `https://statok.simk.in.ua` → увійти через Google → переконатись, що
дашборд вантажиться; виконати ручний sync цін/курсів — кнопки `/api/prices/...`, `/api/fx/...`
(підтвердить вихідний доступ із контейнера до Yahoo/Frankfurter/НБУ).

---

## Відкат

Образи зберігаються в GHCR за версійними тегами. Відкат без зміни схеми БД:

```sh
cd /opt/statok
sed -i 's/^STATOK_VERSION=.*/STATOK_VERSION=<попередня X.Y.Z>/' .env
docker compose pull
docker compose up -d --remove-orphans
```

Міграції forward-only. Якщо нова версія мала несумісну міграцію — відновлення з бекапу:

```sh
# Розшифрувати (приватний ключ тримається ПОЗА VPS)
age -d -i ~/.age/key.txt statok-YYYYMMDD-HHmm.dump.age > statok.dump

# Відновити в запущений контейнер
docker exec -i statok-postgres-1 pg_restore -U statok -d statok --clean --if-exists < statok.dump
```

---

## Дозволені вихідні хости

| Хост                              | Напрям   | Призначення                          |
|-----------------------------------|----------|--------------------------------------|
| `query1.finance.yahoo.com`        | бекенд   | ціни акцій/ETF                       |
| `query2.finance.yahoo.com`        | бекенд   | ціни акцій/ETF (дзеркало)            |
| `frankfurter.dev`, `frankfurter.app` | бекенд | курси валют                        |
| `bank.gov.ua`                     | бекенд   | курс НБУ                             |
| `www.googleapis.com`              | бекенд   | JWKS Google (верифікація ID token)   |
| `accounts.google.com`             | фронтенд | GIS-скрипт (лише сторінка логіну)   |

Будь-які інші вихідні HTTP-виклики — заборонені (NFR-01).
