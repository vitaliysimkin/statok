# План bootstrap проду Statok

> Складено на основі РЕАЛЬНОЇ розвідки VPS `dakara` (Ubuntu 24.04, 195.201.130.51)
> станом на 2026-06-13. Це план підготовки інфраструктури до **першого деплою**, а не
> опис уже працюючого стану. У файлі НЕМАЄ жодного секрета — лише плейсхолдери та
> вказівки, що і де згенерувати/ввести.
>
> Джерело істини по інфрі — `infra/README.md`, `infra/docker-compose.yml`,
> `.github/workflows/{release,build-backend,build-frontend,deploy}.yml`,
> `scripts/{release.mjs,backup.sh}`, `specs/statok-tz.md` §7.5 (деплой) / §7.8.3 (env) / §7.9 (безпека).

---

## 1. Поточний стан VPS (факти з розвідки)

| Аспект | Стан | Висновок для Statok |
|---|---|---|
| Хост | Ubuntu 24.04, kernel 6.8, `dakara`, IP `195.201.130.51` | OK |
| Docker / Compose | Docker 29.3.1, Compose v5.1.1 | OK, сумісно з `docker-compose.yml` |
| Ресурси | RAM 7.5 GiB (6.4 GiB вільно), **swap 0**, диск 75 GB / 52% (35 GB вільно) | Достатньо. Swap=0 — ризик при пікових міграціях/pg_restore, але для single-user прийнятно |
| Edge | `dakara-traefik-1` (traefik **v3.7**), публікує `80/443`, ACME-резолвер з назвою **`le`** (httpChallenge, email `vitaliy.simkin@gmail.com`, storage `/acme.json`) | `docker-compose.yml` уже використовує `certresolver=le` і `entrypoints=websecure` — збігається |
| Мережа `web` | Існує (`external: true`), спільна для Traefik; до неї підключені tardis/flatlog/media | Statok-контейнери `frontend` і `backend` приєднуються до `web` (уже в compose) |
| Порти | На хост опубліковані **лише 80/443**. Внутрішні `3000` (backend), `5432` (postgres), `80` (frontend) НЕ публікуються | **Конфлікту портів НЕМАЄ.** Власний `postgres:16-alpine` Statok живе у `default`-мережі без колізій |
| Postgres сусідів | Лише `tardis-postgres-1`, теж `:16-alpine`, тільки internal | Statok ставить ВЛАСНИЙ postgres (інший compose-проєкт → інший `container_name`) |
| ACME | `/opt/dakara/acme/acme.json` (54 KB) уже працює для інших доменів | Statok отримає сертифікат автоматично **після** виправлення DNS |
| Референс-патерн | `/opt/tardis/docker-compose.yml` (ідентичний у flatlog) — робочий шаблон під Statok: `frontend(:80)` + `backend(env_file:.env, :3000)` + `postgres:16-alpine`, мережі `[web, default]`, роутер web на `Host(...)` + окремий path-роутер `priority=100` на `/api`,`/auth`,`/health` | `infra/docker-compose.yml` Statok уже повторює цей патерн 1-в-1 |
| Firewall | UFW `inactive` (ззовні доступ фактично лише через Traefik 80/443) | OK |
| Staging | Існують `/opt/tardis-staging`, `/opt/flatlog-staging` | Натяк на staging-патерн; для Statok v1 НЕ обов'язково |

### Блокери (детально — §6)
- **DNS:** `statok.simk.in.ua` та `api.statok.simk.in.ua` резолвляться у `91.197.69.34` (ЧУЖИЙ IP), а не у VPS `195.201.130.51`. Без виправлення A-записів Traefik-роутинг і випуск Let's Encrypt (httpChallenge) НЕ спрацюють.
- **GHCR:** на хості немає `docker login ghcr.io` (немає `/root/.docker/config.json`, немає cred-helper-ів). Якщо пакети `ghcr.io/vitaliysimkin/statok/*` приватні — `docker compose pull` впаде з `denied`.
- **Образи ще не зібрані:** `ghcr.io/vitaliysimkin/statok/{frontend,backend}` поки не існують — деплою нема чого тягнути, доки CI не збере й не запушить теги.
- **`/opt/statok` не існує:** теку, `docker-compose.yml`, `.env` треба створити з нуля.
- **Бекап БД відсутній в інфрі VPS:** ні cron, ні systemd-timer, ні `age`. Скрипт `scripts/backup.sh` у репо Є, але на хост НЕ розгорнутий. Для фінансових даних — окремий крок (§2, крок 9).

---

## 2. Чекліст bootstrap (по кроках)

Позначки виконавця:
- **[manual-owner]** — лише власник (доступ до DNS-панелі, Google Cloud Console, GitHub-секретів, генерація реальних секретів, рішення про GHCR visibility).
- **[agent]** — можна доручити агенту з SSH-доступом (створення тек, копіювання файлів, запуск compose).

> Порядок важливий: спершу прибрати блокери (1–4), потім підготувати хост (5–7), потім перший деплой (§4).

### Крок 1 — DNS [manual-owner] · БЛОКЕР
У DNS-панелі домену `simk.in.ua` виставити A-записи **обидва** на `195.201.130.51`:
```
statok.simk.in.ua.       A   195.201.130.51
api.statok.simk.in.ua.   A   195.201.130.51
```
Перевірка (після поширення TTL):
```sh
nslookup statok.simk.in.ua 8.8.8.8
nslookup api.statok.simk.in.ua 8.8.8.8
# обидва мають віддати 195.201.130.51 (зараз віддають 91.197.69.34)
```
Доки DNS не виправлено — ACME httpChallenge для Statok НЕ видасть сертифікат.

### Крок 2 — GHCR visibility АБО docker login [manual-owner] · БЛОКЕР
Один із двох варіантів:
- **(A) Зробити пакети публічними** (GitHub → Packages → `statok/frontend`, `statok/backend` → Package settings → Change visibility → Public). Тоді `docker compose pull` на VPS працює без логіну. Простіше для self-hosted single-user.
- **(B) Залишити приватними** і виконати на VPS разовий логін:
  ```sh
  echo "<GHCR_PAT_read:packages>" | docker login ghcr.io -u vitaliysimkin --password-stdin
  ```
  PAT з scope `read:packages`. Файл `/root/.docker/config.json` зʼявиться, pull запрацює.

> Рішення A vs B — openQuestion власнику (приватність образів vs простота). Образи коду
> не містять секретів (секрети — лише в `/opt/statok/.env`), тож публічність прийнятна.

### Крок 3 — GitHub Secrets [manual-owner]
Виставити секрети репозиторію (деталі — §3). Без `RELEASE_TOKEN`/`VPS_*`/`TELEGRAM_*` пайплайн релізу й деплою не виконається.

### Крок 4 — Зібрати образи (перший CI-прогін) [manual-owner запускає]
Образів Statok ще немає у GHCR. Вони зʼявляться першим релізним тегом (§4). Тобто крок 4 фактично виконується разом із першим деплоєм — але до нього мають бути готові кроки 1–3, інакше деплой-джоба впаде на pull/health.

### Крок 5 — Створити теку `/opt/statok` [agent]
```sh
mkdir -p /opt/statok
```
Імʼя теки МАЄ бути `statok` — compose-проєкт виводиться з назви теки, контейнери стануть `statok-frontend-1`, `statok-backend-1`, `statok-postgres-1` (узгоджено з backup.sh, який звертається до `statok-postgres-1`).

> Примітка: деплой-джоба (`deploy.yml`) сама копіює `infra/` у `/opt/statok/` через scp
> (`strip_components: 1` → `docker-compose.yml` лягає в корінь `/opt/statok/`). Тобто
> ручне копіювання compose НЕ потрібне — потрібна лише сама тека і `.env` (крок 6).

### Крок 6 — Створити `/opt/statok/.env` [manual-owner] · НЕ комітити
Файл секретів живе ТІЛЬКИ на VPS (`specs §7.9`, NFR-02). Політика: **якщо файл уже існує — доповнити лише відсутні ключі, наявні значення НЕ перезаписувати** (особливо `JWT_SECRET`, `POSTGRES_PASSWORD`, `STATOK_VERSION`, бо зміна JWT_SECRET розлогінює, а зміна паролю postgres ламає підключення до наявного volume).

Повний перелік ключів (значення — плейсхолдери; НЕ вигадані):

```env
# Версія — пише deploy-пайплайн (sed по цьому рядку); для першого створення лиши порожнім
STATOK_VERSION=

# --- Postgres ---
# POSTGRES_PASSWORD: згенерувати  ->  openssl rand -hex 24
POSTGRES_PASSWORD=<generate: openssl rand -hex 24>
# DATABASE_URL: той самий пароль, host=postgres (імʼя сервісу), db=statok, user=statok
DATABASE_URL=postgresql://statok:<той самий POSTGRES_PASSWORD>@postgres:5432/statok

# --- JWT ---
# JWT_SECRET: >= 32 байти (валідація на старті), згенерувати  ->  openssl rand -hex 32
JWT_SECRET=<generate: openssl rand -hex 32>

# --- Адмін (сід при першому старті; наявного юзера НЕ перезаписує) ---
ADMIN_USERNAME=<вводить власник>
# ADMIN_PASSWORD: ввести надійний пароль власника (зберігати в менеджері паролів)
ADMIN_PASSWORD=<вводить власник>

# --- Прикладні ---
BASE_CURRENCY=USD
TZ=Europe/Kyiv
CORS_ORIGINS=https://statok.simk.in.ua
```

Чим генерувати:
- `openssl rand -hex 24` → `POSTGRES_PASSWORD` (і той самий рядок вставити у `DATABASE_URL`).
- `openssl rand -hex 32` → `JWT_SECRET` (рівно 64 hex-символи = 32 байти, проходить валідацію boot).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — вводить власник вручну (це креденшали входу).

> Після впровадження Google-auth (файл `tasks/google-auth-task.md`) сюди додаються ще
> два ключі — `GOOGLE_CLIENT_ID` та `ALLOWED_GOOGLE_EMAIL` (+ опц. `ENABLE_PASSWORD_LOGIN`).
> Див. §5 про рекомендований порядок.

`backend` у compose читає `.env` через `env_file: /opt/statok/.env`; `postgres` бере
`POSTGRES_PASSWORD` через `${POSTGRES_PASSWORD}` (тобто змінна має бути присутня у `.env`).

### Крок 7 — Перевірити мережу `web` [agent]
```sh
docker network inspect web >/dev/null 2>&1 && echo "web OK" || echo "web MISSING"
```
За розвідкою `web` існує (підняв стек dakara). Якщо `MISSING` — спершу підняти edge-стек dakara; Statok власний Traefik НЕ ставить.

### Крок 8 — (опц.) Перевірити, що порти не зайняті [agent]
```sh
ss -ltnp | grep -E ':(80|443)\b'   # очікувано: лише docker-proxy (Traefik)
```
`3000/5432/80` контейнерів Statok на хост не публікуються — конфлікту бути не повинно.

### Крок 9 — Бекап БД (окремий міні-проєкт) [manual-owner + agent] · РЕКОМЕНДОВАНО
Бекапів на хості зараз НЕМАЄ. Скрипт `scripts/backup.sh` у репо готовий (pg_dump → age → rclone → ротація). Розгортання:
1. [agent] скопіювати `scripts/backup.sh` → `/opt/statok/backup.sh`, `chmod +x`.
2. [manual-owner] встановити `age` і `rclone` на хост; `rclone config` для віддаленого стореджа (B2/S3).
3. [manual-owner] згенерувати age-ключ; **приватний ключ зберігати ПОЗА VPS** (для відновлення); публічний `age1...` покласти у `/opt/statok/backup.env`:
   ```env
   AGE_RECIPIENT=age1...        # публічний ключ (recipient)
   RCLONE_REMOTE=b2             # імʼя rclone-remote
   ```
4. [manual-owner] root-cron:
   ```cron
   30 3 * * * /opt/statok/backup.sh >> /var/log/statok-backup.log 2>&1
   ```
Відновлення задокументоване в `infra/README.md` (age -d → pg_restore).

> Можна відкласти на пару днів після запуску, але для фінансових даних — ризик; краще
> увімкнути ще до того, як накопичаться реальні транзакції.

---

## 3. GitHub Secrets (таблиця)

Усі — у Settings → Secrets and variables → Actions репозиторію Statok. [manual-owner].

| Secret | Призначення | Звідки взяти |
|---|---|---|
| `RELEASE_TOKEN` | `release.yml`: checkout із правом push коміту версії + тегу (обходить обмеження `GITHUB_TOKEN` на запуск інших workflow по тегу) | Fine-grained PAT, scope `contents: write` на репо Statok |
| `VPS_HOST` | `deploy.yml`: scp + ssh на VPS | `195.201.130.51` (або `dakara.simk.in.ua`) |
| `VPS_USER` | користувач SSH | напр. `root` (узгодити з власником VPS) |
| `VPS_SSH_KEY` | приватний SSH-ключ для деплою | **ОКРЕМИЙ deploy-ключ** (не особистий): `ssh-keygen -t ed25519 -C statok-deploy -f statok_deploy`; публічну частину додати в `~/.ssh/authorized_keys` цільового користувача на VPS; приватну — у цей секрет |
| `TELEGRAM_BOT_TOKEN` | `deploy.yml`: нотифікація статусу деплою | BotFather |
| `TELEGRAM_CHAT_ID` | куди слати нотифікацію | свій chat id |

> `GITHUB_TOKEN` — вбудований, окремо НЕ створюється; його використовують
> `build-backend.yml`/`build-frontend.yml` (push у GHCR, `packages: write`) та
> `wait-for-builds` у deploy.

**Примітка GHCR:** окремого секрета для pull на VPS НЕМАЄ. Доступ забезпечується
рішенням із §2 крок 2 — або публічні пакети, або разовий `docker login ghcr.io` на хості.
Для CI-push достатньо вбудованого `GITHUB_TOKEN` (`packages: write`).

---

## 4. Порядок першого деплою + верифікація + відкат

Передумова: кроки §2 (1) DNS, (2) GHCR, (3) Secrets, (5) тека, (6) `.env`, (7) `web` — виконані.

### 4.1 Запуск релізу (один із варіантів)
- **Локально:** `bun run release:patch` (або `release:minor` / `release:major`).
  Скрипт `scripts/release.mjs`: bump версії в root+backend+frontend `package.json`, коміт
  `chore: release vX.Y.Z`, тег `vX.Y.Z`, push коміту й тега. Передумова — чисте робоче
  дерево і відсутність такого тега.
- **Або GitHub Actions → Release (workflow_dispatch)** з вибором `bump` (patch/minor/major) —
  робить те саме через `RELEASE_TOKEN`.

### 4.2 Що відбувається автоматично після пушу тега `v*`
1. `build-backend.yml` + `build-frontend.yml` паралельно: build образів і push у
   `ghcr.io/vitaliysimkin/statok/{backend,frontend}` з тегами `<version>` і `latest`.
   Frontend збирається з build-arg `VITE_API_URL=https://api.statok.simk.in.ua`.
2. `deploy.yml`:
   - `wait-for-builds` чекає успіху обох build-джоб;
   - scp `infra/` → `/opt/statok/` (`strip_components:1`);
   - ssh: `sed` оновлює `STATOK_VERSION=<version>` у `/opt/statok/.env`, далі
     `docker compose pull` + `docker compose up -d --remove-orphans`;
   - backend на старті: валідація env → міграції → сід адміна → старт джоб → listen;
   - **Health check**: до 24 спроб × 5с по `https://api.statok.simk.in.ua/health`, очікує `.status == "ok"`;
   - GitHub Release з авто-нотатками;
   - Telegram-нотифікація статусу.

### 4.3 Ручна верифікація (після зеленого деплою)
```sh
# 1) health (через Traefik, перевіряє і TLS, і БД)
curl -s https://api.statok.simk.in.ua/health
# очікувано: {"status":"ok","db":"ok","version":"X.Y.Z"}

# 2) фронт віддається
curl -sI https://statok.simk.in.ua | head -n1   # 200

# 3) логін (поверне {token, username})
curl -s -X POST https://api.statok.simk.in.ua/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
```
Далі в UI: зайти на `https://statok.simk.in.ua`, увійти, перевірити що дашборд
вантажиться, і що ручний sync джерел (ціни/курси) працює — кнопки/ендпоінти
`/api/prices/...`, `/api/fx/...` (джоби тягнуть Yahoo/Frankfurter/НБУ; перший прогін
підтверджує вихідний доступ із контейнера).

### 4.4 Відкат
Образи лишаються в GHCR за версійними тегами, тож відкат — це підстановка попередньої версії:
```sh
cd /opt/statok
sed -i 's/^STATOK_VERSION=.*/STATOK_VERSION=<попередня X.Y.Z>/' .env
docker compose pull
docker compose up -d --remove-orphans
```
БД-міграції — forward-only; якщо нова версія додала несумісну міграцію, простий відкат
образу може не збігтися зі схемою — у такому разі відновлення з нічного бекапу (§2 крок 9,
`infra/README.md`). Для прибирання саме коду (без міграцій) відкат образу безпечний.

---

## 5. Залежність від задачі Google-auth

Специфікація — `tasks/google-auth-task.md` (вхід через Google замість пароля, доступ
**лише** для `vitaliy.simkin@gmail.com`).

**Рекомендований порядок: впровадити Google-auth ДО першого ПУБЛІЧНОГО деплою.**
Причини:
- Після виправлення DNS (§2 крок 1) інстанс дивиться в інтернет на `statok.simk.in.ua`.
  Парольний вхід з `ADMIN_PASSWORD` із `.env` — слабша поверхня, ніж Google OIDC із
  жорстким allowlist по email.
- Google-auth додає env-ключі `GOOGLE_CLIENT_ID`, `ALLOWED_GOOGLE_EMAIL` — зручно завести
  їх у `/opt/statok/.env` одразу при крокі 6, а не доповнювати потім.
- Google OAuth Client ID (manual-owner крок у Google Cloud Console) має містити
  origins `https://statok.simk.in.ua` (прод) і `http://localhost:5273` (dev) — прод-origin
  можна додати лише ПІСЛЯ того, як домен закріплено за VPS, тож логічно робити одразу
  після виправлення DNS.

Якщо власник усе ж хоче спершу підняти інстанс на паролі (швидкий smoke), то:
короткий проміжок із парольним входом прийнятний за умови сильного `ADMIN_PASSWORD` і
того, що Google-auth їде наступною хвилею — але це openQuestion (див. нижче).

---

## 6. Відомі ризики / блокери (зведення)

| # | Ризик / блокер | Вплив | Дія |
|---|---|---|---|
| 1 | **DNS на чужий IP** `91.197.69.34` | Traefik-роутинг і ACME не працюють — деплой зелений лише після фіксу | §2 крок 1 [manual-owner] |
| 2 | **GHCR без логіну** на VPS | `docker compose pull` впаде, якщо пакети приватні | §2 крок 2 [manual-owner] |
| 3 | **Образи ще не зібрані** | Нема чого тягнути до першого релізного тега | §4.1 (перший реліз) |
| 4 | **`/opt/statok` + `.env` відсутні** | Backend не стартує без `DATABASE_URL`/`JWT_SECRET` (fatal exit) | §2 кроки 5–6 |
| 5 | **Бекап БД відсутній** | Втрата фінансових даних при збої | §2 крок 9 [manual-owner] |
| 6 | **swap = 0**, RAM 7.5 GiB ділиться з tardis/flatlog/media | Пік памʼяті при міграції/pg_restore може OOM-нути | Моніторити; за потреби додати swap (рішення власника) |
| 7 | **JWT_SECRET / POSTGRES_PASSWORD не перезаписувати** при повторному `.env` | Зміна розлогінює всіх / ламає підключення до наявного volume | Політика «доповнювати, не перезаписувати» (§2 крок 6) |
| 8 | **Парольний вхід дивиться в інтернет** після DNS-фіксу | Слабша поверхня до впровадження Google-auth | §5 — Google-auth перед публічним деплоєм |

---

## Зведення відкритих питань для власника

1. **GHCR visibility:** зробити пакети `statok/*` публічними (простіше) чи лишити приватними з `docker login` на VPS?
2. **Порядок Google-auth vs перший деплой:** впровадити Google-auth ДО публічного деплою (рекомендовано) чи допустити короткий проміжок на парольному вході для smoke?
3. **VPS_USER:** під яким користувачем деплоїти (root чи окремий deploy-user із доступом до docker)?
4. **Swap:** додавати swap на хост (RAM 7.5 GiB без swap, ділиться з іншими стеками)?
5. **Бекап зараз чи відкласти:** вмикати нічний бекап одразу при bootstrap чи після перших днів роботи?
