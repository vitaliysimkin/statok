# Задача: вхід через Google замість пароля (allowlist на 1 email)

> **Жорстка вимога власника:** доступ до інстансу мають отримувати ВИКЛЮЧНО облікові
> записи з email `vitaliy.simkin@gmail.com`. Будь-який інший верифікований Google-акаунт →
> `403 FORBIDDEN`.
>
> **Інваріант стека (CLAUDE.md, ТЗ §0):** НОВИХ runtime-залежностей бекенда НЕ додавати.
> Верифікація Google ID token робиться через `jose`, який УЖЕ у дозволеному переліку
> (`backend/package.json` → `"jose": "^6.0.0"`). На фронтенді — БЕЗ нових npm-пакетів:
> Google Identity Services підключається `<script src="https://accounts.google.com/gsi/client">`.

---

## 0. Контекст коду (як зараз)

- **Auth-роутер** монтується на `/auth` (НЕ `/api/auth`): `backend/src/index.ts` → `app.route('/auth', authRouter)`. Поточні ендпоінти: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout` (`backend/src/routes/auth.ts`).
  > ⚠️ Розбіжність із початковим формулюванням задачі: воно згадує `POST /api/auth/google`,
  > але реальний код тримає auth на `/auth/*`. **Канонічний шлях для цієї задачі — `POST /auth/google`**
  > (узгоджено з рештою auth-ендпоінтів і з Traefik-роутером `statok-app-paths`, що вже
  > пропускає `PathPrefix(/auth)`). Якщо власник хоче саме `/api/auth/google` — це окремий
  > openQuestion, бо ламає симетрію з login/refresh.
- **Власний JWT:** `backend/src/lib/jwt.ts` — `jose`, HS256, TTL 7 діб, claims `sub`(userId)/`username`/`exp`. **Цей механізм НЕ змінюється** — Google-вхід має закінчуватись видачею ТОГО Ж власного токена (`signToken({ userId, username })`), щоб sliding-session (FR-04, `/auth/refresh`) і весь захищений API (`authMiddleware`) працювали без змін.
- **Сід адміна** (`backend/src/lib/seed.ts`): створює юзера з `ADMIN_USERNAME`/`ADMIN_PASSWORD`. Цей юзер залишається в таблиці `users` і стає «носієм» `userId`, під яким працює і Google-вхід (single-user).
- **Frontend:** `LoginPage.vue` (форма username/password), `useAuth.ts` (`login`/`refresh`/`me`/`logout`), `services/api.ts` (`apiFetch` + `ApiError` + `errKey`). Dev-порт фронта — **5273** (`frontend/vite.config.ts`).
- **Rate-limit** (`backend/src/lib/rateLimit.ts`): sliding-window по IP, 5 невдач / 15 хв, застосовано лише до `/auth/login`. Експортує `checkRateLimit`/`recordFailure`/`clearFailures` — придатне для повторного використання на `/auth/google`.

---

## 1. Потік автентифікації (end-to-end)

```
[Frontend]  кнопка "Sign in with Google" (GIS, accounts.google.com/gsi/client)
     │  користувач обирає Google-акаунт
     ▼  отримує ID token (JWT, підписаний Google)
POST /auth/google  { "credential": "<google_id_token>" }
     │
     ▼  [Backend]  верифікація ПІДПИСУ через jose:
        createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
        jwtVerify(credential, JWKS, {
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          audience: GOOGLE_CLIENT_ID,
        })
        + перевірки клеймів:
          - exp (jose перевіряє автоматично)
          - aud === GOOGLE_CLIENT_ID
          - iss ∈ {accounts.google.com, https://accounts.google.com}
          - email_verified === true
          - email === ALLOWED_GOOGLE_EMAIL   → інакше 403 FORBIDDEN
     │
     ▼  видати ВЛАСНИЙ JWT існуючим механізмом:
        signToken({ userId: <id адмін-юзера>, username: <users.username> })
     ▼
   200 { "token": "<statok_jwt>", "username": "<...>" }
```

### 1.1 Frontend — Google Identity Services без npm
- Підключити скрипт `https://accounts.google.com/gsi/client` (async, лише на `LoginPage`,
  напр. динамічно у `onMounted`, щоб не тягти на кожній сторінці).
- Ініціалізація: `google.accounts.id.initialize({ client_id: VITE_GOOGLE_CLIENT_ID, callback })`,
  рендер кнопки `google.accounts.id.renderButton(el, {...})`. `client_id` — build-time env
  `VITE_GOOGLE_CLIENT_ID` (як `VITE_API_URL`), build-arg фронт-образу в CI.
- У callback: взяти `response.credential` (ID token) → `POST /auth/google {credential}` через
  `apiFetch` → зберегти повернутий `token` у `localStorage['statok_token']` (той самий ключ,
  що зараз) → редірект на `/dashboard`.
- **CSP / offline (СВІДОМЕ обмеження, описати в коді й ТЗ):**
  поточний CSP (`frontend/nginx.conf`, ТЗ §9) — `default-src 'self'; connect-src 'self' https://api.statok.simk.in.ua; ...`.
  GIS вимагає завантаження скрипта і фреймів з доменів Google. Тому CSP треба РОЗШИРИТИ:
  - `script-src 'self' https://accounts.google.com` (завантаження `gsi/client`);
  - `connect-src` додати `https://accounts.google.com` (XHR GIS);
  - `frame-src https://accounts.google.com` (iframe вибору акаунта);
  - (стилі GIS інлайняться — `style-src 'self' 'unsafe-inline'` уже є).
  Це усвідомлене послаблення CSP заради зовнішнього IdP. **Наслідок для offline/PWA:**
  без мережі до `accounts.google.com` увійти НЕ можна (на відміну від колишнього локального
  пароля). Для self-hosted single-user прийнятно; задокументувати. Service worker уже
  виключає `/auth` з кешу (`navigateFallbackDenylist`), окремих змін SW не треба.

### 1.2 Backend — верифікація
- Новий хелпер, напр. `backend/src/lib/googleAuth.ts`:
  - `JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))` —
    створювати ОДИН раз на модуль (jose кешує ключі з урахуванням HTTP cache-control), не на кожен запит.
  - `verifyGoogleIdToken(credential): Promise<{ email: string }>` — `jwtVerify` з `issuer`/`audience`,
    далі ручні перевірки `email_verified === true`. Будь-яка невдача → кидає/повертає сигнал
    помилки, який роут мапить у канонічний формат `{error, message}`.
- Новий роут у `backend/src/routes/auth.ts`: `POST /auth/google` (ПУБЛІЧНИЙ, як `/login`).
  - Тіло: `{ credential: string }`; відсутнє/не-рядок → `400 VALIDATION_ERROR`.
  - rate-limit тим самим `checkRateLimit`/`recordFailure`/`clearFailures` по IP (як `/login`),
    щоб не дати перебирати/спамити верифікацію.
  - Підпис невалідний / iss / aud / exp не зійшлись → `401 UNAUTHORIZED` (опаковано, як login).
  - `email !== ALLOWED_GOOGLE_EMAIL` АБО `email_verified !== true` → `403 FORBIDDEN`
    (`{ error: 'FORBIDDEN', message: 'Access denied' }`).
  - Успіх: знайти єдиного користувача (адмін-сід), `signToken({ userId, username })`, повернути
    `{ token, username }`. Якщо юзера ще нема — це конфіг-помилка (сід не відпрацював) → `500 INTERNAL`.
  - Логи: лише `email`(або хеш)/`ip`/`reason`; НЕ логувати сам `credential` чи виданий токен
    (паритет з FR-02 / NFR-02).

### 1.3 Що НЕ змінюється
- `signToken`/`verifyToken` (`lib/jwt.ts`), `authMiddleware`, `/auth/refresh`, `/auth/me`,
  `/auth/logout` — без змін. Google лише замінює СПОСІБ первинного отримання власного JWT.
- `users`-схема, сід — без міграцій (Google-вхід не створює нових рядків, користується наявним).

---

## 2. Зміни конфігів і документації

### 2.1 Нові env-ключі
| Ключ | Де | Значення | Хто |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | backend `.env` (+ `env_file` у compose) | OAuth 2.0 Web Client ID із Google Cloud Console | manual-owner |
| `ALLOWED_GOOGLE_EMAIL` | backend `.env` | `vitaliy.simkin@gmail.com` | manual-owner |
| `VITE_GOOGLE_CLIENT_ID` | frontend build-arg (CI, як `VITE_API_URL`) | той самий Client ID | CI/manual-owner |
| `ENABLE_PASSWORD_LOGIN` | backend `.env` (опц.) | `false` у проді, `true` у dev | див. §3 |

Оновити:
- `backend/.env.dev` — додати `GOOGLE_CLIENT_ID=`, `ALLOWED_GOOGLE_EMAIL=`, `ENABLE_PASSWORD_LOGIN=true` (dev).
- `infra/docker-compose.yml` — `backend` уже читає `env_file`, тож `GOOGLE_CLIENT_ID`/`ALLOWED_GOOGLE_EMAIL` підхопляться автоматично; явних рядків `environment:` додавати не треба (лише задокументувати в `infra/README.md` секцію Bootstrap → `.env`).
- `infra/README.md` — у блок `.env` додати нові ключі; згадати OAuth Client ID крок.
- `.github/workflows/build-frontend.yml` — додати у `build-args` рядок `VITE_GOOGLE_CLIENT_ID=...`
  (брати з GitHub-секрета/variable, бо це не секрет у строгому сенсі, але узгодити з власником).
- `tasks/deploy-bootstrap-plan.md` (§2 крок 6) уже посилається на ці ключі — синхронізувати.

### 2.2 Оновлення `specs/statok-tz.md` (СВІДОМА зміна ТЗ — окремими пунктами задачі)
- **NFR-01** — розширити таблицю «вичерпний список зовнішніх викликів» двома рядками:
  | Напрям | Призначення | Контекст | Дозвіл |
  |`accounts.google.com` | GIS-кнопка/скрипт входу | Фронтенд (рантайм, лише сторінка логіну) | ✓ |
  |`www.googleapis.com` | JWKS Google (верифікація підпису ID token) | Бекенд (рантайм, `/auth/google`) | ✓ |
  Також скоригувати CSP-пункт NFR-01 (`connect-src`/`script-src`/`frame-src` з доменами Google).
- **FR-01..FR-04** (§4.1 auth) — додати опис нового потоку входу через Google: новий
  `POST /auth/google`, перевірки клеймів, allowlist по email (403), збереження sliding-session
  механіки (FR-04 НЕ ламати). Зафіксувати, що парольний `POST /auth/login` лишається як
  break-glass за флагом (див. §3) — або повністю видаляється (рішення власника).
- **§9 Безпека** — додати підрозділ «Google OIDC»: jose `createRemoteJWKSet`, перевірки
  iss/aud/exp/email_verified/email, відсутність зберігання Google-токена, оновлений CSP.
- **§7.8.3** — додати нові env-ключі до переліку.

### 2.3 Оновлення `CLAUDE.md`
- Розділ **Backend → дозволені вихідні хости**: до «Yahoo / Frankfurter / НБУ» додати
  `accounts.google.com` (фронт) і `www.googleapis.com` (бекенд, JWKS). Це наскрізне правило,
  тож правка `CLAUDE.md` обовʼязкова разом зі зміною NFR-01.

---

## 3. Доля парольного входу

**Рекомендація:** прибрати парольну форму з UI; залишити `POST /auth/login` у коді як
**break-glass** під env-флагом `ENABLE_PASSWORD_LOGIN` (default `false` у проді, `true` у dev).
- При `ENABLE_PASSWORD_LOGIN !== 'true'` → `/auth/login` повертає `403 FORBIDDEN` (або `404`),
  не торкаючись БД.
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` лишаються в `.env` (сід створює носія `userId`), але вхід
  по них у проді вимкнений — захист від downgrade: навіть знаючи пароль, ззовні зайти не можна.
- `LoginPage.vue`: парольна форма показується лише коли increment-флаг увімкнено (напр.
  через build-env `VITE_ENABLE_PASSWORD_LOGIN`, dev-only). У проді — лише кнопка Google.

> **openQuestion власнику:** (а) лишати break-glass `/auth/login` під флагом (рекомендовано,
> страховка якщо Google недоступний / зміна email) чи (б) видалити парольний вхід повністю?
> Варіант (а) безпечніший операційно; (б) — мінімальна поверхня.

---

## 4. Frontend — деталі

- **`LoginPage.vue`:**
  - замінити форму на кнопку Google (рендер GIS), парольну форму лишити за dev-флагом (§3);
  - обробка `credential` → `useAuth().loginWithGoogle(credential)`;
  - помилки через `errKey(e)` (`services/api.ts`): `403 FORBIDDEN` → `t('auth.forbidden')`,
    `401` → `t('auth.loginError')`, інше → `t(errKey(e))`;
  - локалізація uk/en для нових рядків: `auth.signInWithGoogle`, `auth.forbidden`
    («Доступ дозволено лише власнику» / «Access is restricted to the owner»), `auth.googleError`.
- **`useAuth.ts`:** новий метод `loginWithGoogle(credential: string)` —
  `apiFetch('/auth/google', { method:'POST', body: JSON.stringify({ credential }) })`,
  далі та сама логіка, що в `login` (зберегти token, `isAuthenticated=true`). Решта (`refresh`,
  `me`, `logout`) — без змін.
- **shared:** додати тип `GoogleLoginRequest = { credential: string }` у `@statok/shared`
  (`dto.ts`); відповідь — наявний `LoginResponse`.
- **Dev-режим:** Authorized JavaScript origins у Google Client мають містити
  `http://localhost:5273` (порт із `vite.config.ts`). Без нього GIS у dev не віддасть credential.

---

## 5. [manual-owner] кроки (Google Cloud Console)

1. Створити проєкт (або взяти наявний) → APIs & Services → Credentials.
2. (за потреби) OAuth consent screen: User type **External**, app name, support email
   `vitaliy.simkin@gmail.com`; для single-user достатньо режиму Testing із доданим test-user
   `vitaliy.simkin@gmail.com` (publish не обовʼязковий).
3. **Create credentials → OAuth client ID → Application type: Web application.**
   - **Authorized JavaScript origins:** `https://statok.simk.in.ua`, `http://localhost:5273`.
   - **Authorized redirect URIs:** для GIS One-Tap/кнопки з ID-token callback redirect URI НЕ
     потрібен (потік без редіректу). Лишити порожнім, якщо не використовується OAuth-redirect.
4. Скопіювати **Client ID** → покласти у `/opt/statok/.env` (`GOOGLE_CLIENT_ID`), у GitHub
   (для `VITE_GOOGLE_CLIENT_ID` build-arg), у `backend/.env.dev` (dev). Client secret для цього
   потоку (тільки верифікація ID token) НЕ потрібен.
5. У `/opt/statok/.env` виставити `ALLOWED_GOOGLE_EMAIL=vitaliy.simkin@gmail.com`.

> Client ID не є секретом у строгому сенсі (він публічний у фронт-бандлі), але тримаємо його
> в env/секретах для зручності ротації й уникнення хардкоду.

---

## 6. Безпека

- **Не зберігати Google ID token** ніде (ні в БД, ні в логах, ні в localStorage). Він живе лише
  в памʼяті під час одного запиту `/auth/google`; назовні віддається ВЛАСНИЙ statok-JWT.
- **Rate-limit** на `/auth/google` тим самим механізмом, що на `/auth/login` (5/15хв по IP),
  щоб не дати спамити верифікацію/підбирати.
- **Захист від downgrade:** `ADMIN_PASSWORD` може лишатись у `.env`, але парольний вхід у проді
  вимкнений флагом (§3) → знання пароля не дає доступу ззовні.
- **Перевірки клеймів — усі обовʼязкові:** підпис (JWKS), `iss`, `aud === GOOGLE_CLIENT_ID`,
  `exp`, `email_verified === true`, `email === ALLOWED_GOOGLE_EMAIL`. Пропуск будь-якої —
  діра. `aud` КРИТИЧНИЙ: без нього валідний підписаний Google токен від ІНШОГО застосунку
  пройшов би верифікацію.
- **JWKS:** `createRemoteJWKSet` сам кешує і ротує ключі Google; не вшивати ключі вручну.
- **CSP** розширюється рівно на домени Google (§1.1), не ширше; решта `default-src 'self'`.
- Email-порівняння — case-insensitive lower-case обох боків (Google віддає канонічний, але
  захиститись від регістру дешево).

---

## 7. Тест-план

### 7.1 Юніт (бекенд, без мережі до Google)
Згенерувати ЛОКАЛЬНУ пару ключів (jose `generateKeyPair('RS256')`), підняти локальний JWKS
(або підмінити resolver) і складати тестові ID-token-и:
- ✅ валідний токен (right iss/aud/exp, `email_verified=true`, email=allowed) → 200, повертає statok-JWT;
- ❌ `email` ≠ allowed → 403 FORBIDDEN;
- ❌ `email_verified=false` → 403;
- ❌ `aud` ≠ GOOGLE_CLIENT_ID → 401;
- ❌ `iss` чужий → 401;
- ❌ протермінований `exp` → 401;
- ❌ підпис чужим ключем (не з JWKS) → 401;
- ❌ тіло без `credential` → 400 VALIDATION_ERROR;
- ❌ 6-та спроба за 15 хв з IP → 429 RATE_LIMITED.
Перевірити, що виданий statok-JWT проходить наявний `verifyToken` і `authMiddleware`.

### 7.2 Live-smoke (після деплою)
- Кнопка Google на `https://statok.simk.in.ua/login` рендериться (CSP пропускає `gsi/client`).
- Вхід акаунтом `vitaliy.simkin@gmail.com` → дашборд.
- Вхід будь-яким іншим Google-акаунтом → видима помилка «доступ лише власнику» (403), токена нема.
- `/auth/refresh` після Google-входу продовжує сесію (sliding, FR-04 не зламано).

### 7.3 Acceptance criteria
- [ ] Жодної нової npm/runtime-залежності (backend і frontend `package.json` без додавань).
- [ ] `POST /auth/google` верифікує підпис через jose `createRemoteJWKSet` і всі клейми (§6).
- [ ] Тільки `vitaliy.simkin@gmail.com` отримує токен; інші — 403 канонічним `{error,message}`.
- [ ] Видається ТОЙ ЖЕ statok-JWT; `refresh`/`me`/`logout`/`authMiddleware` працюють без змін.
- [ ] Google ID token ніде не зберігається й не логується.
- [ ] Парольний вхід у проді вимкнений (флаг), у dev доступний; рішення про повне видалення — за власником.
- [ ] NFR-01, CSP, CLAUDE.md (вихідні хости), §9 оновлені; нові env задокументовані.
- [ ] uk/en локалі для нових рядків; адаптив від 360px збережено.

---

## 8. Орієнтовний перелік файлів до зміни (для Workflow-хвилі)

**Backend** (власник: backend-агент)
- `backend/src/lib/googleAuth.ts` — НОВИЙ: `verifyGoogleIdToken` (jose JWKS + клейми).
- `backend/src/routes/auth.ts` — додати `POST /auth/google`; флаг `ENABLE_PASSWORD_LOGIN` на `/login`.
- `backend/src/index.ts` — (опц.) прочитати/залогувати наявність `GOOGLE_CLIENT_ID`/`ALLOWED_GOOGLE_EMAIL` на boot (НЕ робити fatal — вирішити з власником, чи обовʼязкові).
- `backend/.env.dev` — нові ключі (dev-значення).

**Shared** (власник: backend/shared-агент)
- `packages/shared/src/dto.ts` — `GoogleLoginRequest`.

**Frontend** (власник: frontend-агент)
- `frontend/src/pages/LoginPage.vue` — кнопка Google + GIS, парольна форма за dev-флагом, помилки/локалі.
- `frontend/src/composables/useAuth.ts` — `loginWithGoogle`.
- `frontend/src/i18n/*` (uk/en) — нові ключі `auth.signInWithGoogle`/`auth.forbidden`/`auth.googleError`.
- `frontend/nginx.conf` — розширений CSP (script-src/connect-src/frame-src з Google).
- `frontend/vite.config.ts` / build-env — `VITE_GOOGLE_CLIENT_ID` (+ опц. `VITE_ENABLE_PASSWORD_LOGIN`).

**Infra / CI** (власник: deploy-агент)
- `.github/workflows/build-frontend.yml` — build-arg `VITE_GOOGLE_CLIENT_ID`.
- `infra/README.md` — нові env у блоці `.env` + крок OAuth Client ID.
- `infra/docker-compose.yml` — без структурних змін (env через `env_file`); лише коментар-нагадування.

**Docs / spec** (власник: planner/docs-агент)
- `specs/statok-tz.md` — NFR-01 (+2 хости, CSP), FR-01..04 (новий потік), §9 (Google OIDC), §7.8.3 (env).
- `CLAUDE.md` — список дозволених вихідних хостів (Backend).

---

## Зведення відкритих питань для власника
1. Шлях ендпоінта: `POST /auth/google` (рекомендовано, симетрія з login) чи наполягати на `/api/auth/google`?
2. Парольний вхід: лишити break-glass під `ENABLE_PASSWORD_LOGIN=false` (рекомендовано) чи видалити повністю?
3. Чи робити `GOOGLE_CLIENT_ID`/`ALLOWED_GOOGLE_EMAIL` обовʼязковими на boot (fatal exit, якщо відсутні), коли парольний вхід вимкнено?
4. Узгодити порядок: ця задача їде ДО першого публічного деплою (рекомендація з `tasks/deploy-bootstrap-plan.md` §5)?
