# Handoff — фаза «Google-auth дочинити + ДЕПЛОЙ» Statok (МЕНЕДЖЕР-ОРКЕСТРАТОР)

> Скопіюй блок між `=== ПРОМПТ ===` як перше повідомлення нової сесії Claude Code.
> Робоча директорія: `O:\projects\statok`. Цикл АНАЛІЗ→ПОКРАЩЕННЯ завершено й закомічено
> ЛОКАЛЬНО (HEAD = `450728d`, НЕ запушено). У поточній сесії ЗАПУЩЕНО фазу Google-auth + CI/CD
> (Workflow `wf_796ff365-a36`) — на момент написання хвиля БУЛА В ПОЛЬОТІ; її фактичний стан
> нова сесія звіряє по git (перший крок пайплайну). Прод НЕ чіпати без зеленого Google-auth.

---

```
=== ПРОМПТ ===
Ти — МЕНЕДЖЕР-ОРКЕСТРАТОР фази «Google-auth дочинити + деплой» проєкту Statok (O:\projects\statok). Працюй ВИКЛЮЧНО через Workflow (агенти opus/sonnet); сам не аналізуєш і не пишеш код — лише менеджмент, гейти, локальні коміти. Відповідай українською. Активуй /notify-me одразу (прогрес-пінги у %; старт цієї фази = 0%). БЕЗ жодних таймерів/очікувань на старті — починай працювати негайно.

ЖОРСТКЕ ПРАВИЛО: ти НІЧОГО не робиш сам, крім менеджменту. Уся аналітика і ВСІ зміни — лише через підагентів у Workflow. Тобі дозволено лише: проектувати/запускати воркфлоу, читати звіти, синтезувати/пріоритезувати, комітити чекпойнти ЛОКАЛЬНО, запускати верифікаційні гейти (tsc/build/bun test/smoke), керувати кроками bootstrap (через підагентів з SSH — лише з ЯВНОЇ згоди власника на запис у прод), пінгувати прогрес.

Спершу прочитай ПОВНІСТЮ: prompts/HANDOFF-next-session.md (цей файл — стан, блокери, узгоджені рішення, уроки 1-19), tasks/google-auth-task.md (повна специфікація Google-входу) і tasks/deploy-bootstrap-plan.md (план bootstrap проду по кроках [manual-owner]/[agent]; його щойно оновив паралельний агент — там GHCR-рішення з flatlog). Довідково: infra/README.md, specs/statok-tz.md §7.5/§7.8.3/§7.9.

ПАЙПЛАЙН ЦІЄЇ СЕСІЇ (порядок строгий):

1. ЗВІРИТИ ФАКТИЧНИЙ СТАН AUTH-ФАЗИ ПО GIT (перший крок, обов'язково). Виконай `git log --oneline -10` і `git status`. Три гілки:
   (a) Якщо є КОМІТ google-auth ПІСЛЯ 450728d і working tree чистий — auth закомічено: одразу перевір гейт (tsc 0; build з VITE_GOOGLE_CLIENT_ID; bun test усім сьютом вкл. googleAuth.test.ts; смоук роут-матриці) і, якщо зелено, рухайся до кроку 2 (DNS).
   (b) Якщо working tree містить НЕЗАКОМІЧЕНІ auth-зміни (модифіковані backend/src/routes/auth.ts, frontend/src/composables/useAuth.ts, frontend/src/pages/LoginPage.vue, 3 workflow-файли + новий backend/src/lib/googleAuth.ts, АЛЕ можливо ВІДСУТНІ backend/test/googleAuth.test.ts / frontend/.env.development / Google-ключі в backend/.env.dev) — хвиля не дописалась. ДОЧИНИ її патерном цієї сесії, усе через Workflow: спершу домовини відсутні шматки (тести-auth, .env-файли, dto.ts GoogleLoginRequest, index.ts boot-warn — звір по §8 задачі), потім адверсаріальний SECURITY-верифікатор BE-auth (+1 раунд фіксів за реальними дефектами) → ГЕЙТ → коміт ЛОКАЛЬНО.
   (c) Якщо змін нема взагалі (working tree чистий, HEAD = 450728d) — хвиля не дописалась і нічого не лишила. Перезапусти реалізацію за tasks/google-auth-task.md + узгодженими рішеннями нижче, тим самим патерном (exec→security-verify→fix→re-verify→гейт→коміт).
   УЗГОДЖЕНІ РІШЕННЯ (вже прийняті власником у поточній сесії — НЕ перепитуй): ендпоінт POST /auth/google; доступ ЛИШЕ vitaliy.simkin@gmail.com (інший email → 403); парольний вхід = break-glass за ENABLE_PASSWORD_LOGIN (dev=true у .env.dev, прод вимкнено за замовчуванням); boot НЕ fatal без GOOGLE_CLIENT_ID (warn + /auth/google → 503 AUTH_NOT_CONFIGURED); фронт показує парольну форму коли VITE_GOOGLE_CLIENT_ID порожній (dev працює без налаштувань).
   ГЕЙТ Google-auth (обов'язковий перед комітом і перед будь-яким деплоєм): tsc 0 (вкл. test/); build фронта з VITE_GOOGLE_CLIENT_ID; bun test усім сьютом — нові юніти googleAuth.test.ts (атакувальні RS256: битий підпис, чужий aud, протермінований exp, email_verified=false, чужий email) зелені; смоук роут-матриці: битий credential→401, чужий email→403, без body→400, без GOOGLE_CLIENT_ID→503 AUTH_NOT_CONFIGURED, /auth/login з ENABLE_PASSWORD_LOGIN і без нього. Security-критичний код — адверсаріальна верифікація обов'язкова (урок 10). Коміт ЛОКАЛЬНО, пінг.

2. DNS-ПЕРЕВІРКА. Власник зараз (поточна сесія) ставить A-записи statok.simk.in.ua / api.statok.simk.in.ua → 195.201.130.51. Перевір propagation: `nslookup statok.simk.in.ua 8.8.8.8` і `nslookup api.statok.simk.in.ua 8.8.8.8`. Якщо обидва вже 195.201.130.51 — DNS готовий, рухайся далі. Якщо ще старий IP 91.197.69.34 — пінг власнику в Telegram (нагадати) і працюй над рештою (крок 1/3 паралельно не блокує DNS), періодично перевіряючи. Прод-роутинг Traefik + ACME без правильних A-записів НЕ працює.

3. BOOTSTRAP ПРОДУ за tasks/deploy-bootstrap-plan.md. [manual-owner]-кроки (DNS вище, GHCR visibility/підхід — вже описано в плані з flatlog, GitHub Secrets, .env-секрети, Google Cloud Console OAuth Client ID, swap, бекап-ключі) — оформ як ЧІТКІ запити власнику в Telegram і ЧЕКАЙ. GitHub Secrets (урок 19): значення write-only, «скопіювати з flatlog» через API неможливо — для VPS_SSH_KEY [agent] генерує НОВИЙ deploy-ключ (ssh-keygen → pub у authorized_keys на VPS через наявний tardis_ops-доступ → priv у `gh secret set`), а TELEGRAM_* / RELEASE_TOKEN значення вводить власник. [agent]-кроки запису на VPS (mkdir /opt/statok, authorized_keys, .env, копіювання backup.sh) — лише ПІСЛЯ явної згоди власника: попроси ОДНЕ «так» на ВЕСЬ список write-кроків bootstrap, перелічивши їх (урок: read-only SSH-розвідку можна без окремої згоди). Ключ доступу C:\Users\vital\.ssh\tardis_ops, root@195.201.130.51.

4. ПЕРШИЙ РЕЛІЗ. Лише коли: Google-auth ЗЕЛЕНИЙ у гейті (крок 1), передумови плану зелені (DNS, GHCR, Secrets, /opt/statok, .env, мережа web) І власник дав явне ДОБРО на push. Послідовність: push main (за рішенням власника — сам git push НЕ виконуй) → bun run release:patch (або Release workflow_dispatch) → CI збере образи → deploy.yml → health-check → ручна верифікація §4.3 плану (health/фронт/логін/Google-вхід у проді) → увімкнути нічний бекап (§2 крок 9 плану). Пінг 100% 🎉. Прод НЕ піднімати, доки Google-auth не зелений.

Застереження (деталі — розділ «Інженерні уроки 1-19» нижче): Windows — не пиши у nul; PS 5.1 не має //, ?:, && (тіла JSON для curl.exe — через -d @файл, БЕЗ пробілів); НЕ вір агентам на слово «tsc clean» — перевіряй сам повним tsc+build; спільні файли — один власник на хвилю (auth-файли: auth.ts, LoginPage.vue, useAuth.ts, nginx.conf, dto.ts, локалі — узгодь за §8 задачі); смоук ловить те, що tsc не бачить; FE-агенти самоперевіряються через vue-tsc --noEmit, НЕ build; bun test усім сьютом — DATABASE_URL на statok_test ДО запуску; адверсаріальна верифікація вимагає ЧИСЛОВИХ/конкретних контрприкладів (для auth — атакувальні токени); звіти агентів читати з .output через [System.IO.File]::ReadAllText UTF8; resume Workflow (resumeFromRunId) діє лише в межах сесії — стан відновлюй з GIT (урок 18). ПРОД — лише з явної згоди власника; жодного запису в прод «на свій розсуд».
=== /ПРОМПТ ===
```

---

## Стан репо/середовища/git (станом на 2026-06-13, ПІД ЧАС auth-фази)

- **Цикл АНАЛІЗ→ПОКРАЩЕННЯ ЗАВЕРШЕНО й ЗАКОМІЧЕНО** (деталі — нижче «Історія циклу»). HEAD на старті
  цієї фази = **`450728d`** (`docs: закриття циклу + handoff фази деплою`), на гілці `main`, НЕ
  запушено (origin/main відстає, upstream «gone» — `git branch --unset-upstream` за потреби).
- **Auth-фаза (поточна сесія) — Workflow `wf_796ff365-a36`, БУЛА В ПОЛЬОТІ при написанні.** Структура
  хвилі: розвідка робочого flatlog (`O:\projects\flatlog`: auth-патерн, імена CI-secrets, як вирішено
  GHCR без `docker login`) → 4 паралельні виконавці:
  - **BE-auth:** НОВИЙ `backend/src/lib/googleAuth.ts`; `routes/auth.ts` → `POST /auth/google` +
    `ENABLE_PASSWORD_LOGIN`-флаг на `/login`; `index.ts` boot-warn; `.env.dev` нові ключі;
    `dto.ts` `GoogleLoginRequest`.
  - **FE-auth:** `LoginPage.vue` GIS-кнопка; `useAuth.loginWithGoogle`; локалі `auth.*`;
    `nginx.conf` CSP +`accounts.google.com`; НОВИЙ `frontend/.env.development`.
  - **CI-infra:** `build-frontend.yml` build-arg `VITE_GOOGLE_CLIENT_ID`; вирівнювання workflow з
    flatlog; `infra/README.md`; оновлення `tasks/deploy-bootstrap-plan.md` (GHCR-підхід).
  - **tests-auth:** НОВИЙ `backend/test/googleAuth.test.ts` — атакувальні RS256-токени.
- **ФАКТИЧНИЙ СТАН WORKING TREE на момент написання хендофа** (звір сам — міг змінитися, якщо хвиля
  дописалась/закомітилась): незакомічені зміни є, АЛЕ хвиля НЕ дописалась:
  - присутні: новий untracked `backend/src/lib/googleAuth.ts`; модифіковані
    `backend/src/routes/auth.ts`, `frontend/src/composables/useAuth.ts`, `frontend/src/pages/LoginPage.vue`,
    `.github/workflows/{build-backend,build-frontend,deploy}.yml`;
  - **ВІДСУТНІ** (executor-и не долетіли): `backend/test/googleAuth.test.ts`,
    `frontend/.env.development`, Google-ключі в `backend/.env.dev`;
  - **немає** security-верифікації, гейта, коміта.
  → Це гілка (b) кроку 1 пайплайну: ДОЧИНИ відсутні шматки + security-verify + гейт + коміт.
- **Узгоджені рішення власника по auth (НЕ перепитувати):** POST /auth/google; доступ лише
  `vitaliy.simkin@gmail.com` (інший → 403); парольний вхід — break-glass за `ENABLE_PASSWORD_LOGIN`
  (dev=true, прод вимкнено); boot НЕ fatal без `GOOGLE_CLIENT_ID` (warn + `/auth/google` → 503
  `AUTH_NOT_CONFIGURED`); фронт показує парольну форму коли `VITE_GOOGLE_CLIENT_ID` порожній.
  Ці рішення закривають openQuestions §кінець `tasks/google-auth-task.md` — НЕ виносити їх знову.
- **DNS прямо зараз:** власник ставить A-записи `statok.simk.in.ua` / `api.statok.simk.in.ua` →
  `195.201.130.51`. Наступна сесія — перевірити propagation (`nslookup ... 8.8.8.8`); якщо ще старий
  `91.197.69.34` — пінг власнику й працювати над рештою, періодично перевіряючи.
- **Середовище:** бекенд dev на **3100** (`bun --env-file=.env.dev`), vite dev на **5273**, Postgres
  docker **5434** (БД `statok` зі smoke-даними + `statok_test` від тестів). Логін dev: `admin`/`admin`.
- **Запуск тестів (важливо):**
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok_test bun test packages/shared/test backend/test`
  — URL ОБОВ'ЯЗКОВО на `statok_test` (urok 14: singleton db запікає URL на момент імпорту, а
  `bond.test.ts` іде першим). Після auth у сьюті з'явиться `googleAuth.test.ts`.
- **Telegram:** /notify-me активний у фазі; пінгувати прогрес.
- **Прод/інфра-розвідка:** read-only розвідка VPS `dakara` (195.201.130.51) → `tasks/deploy-bootstrap-plan.md`.
  Задача Google-auth — `tasks/google-auth-task.md`.

### Історія циклу АНАЛІЗ→ПОКРАЩЕННЯ (для контексту; завершено)
- Аналіз: 8 read-only аналітиків (opus), **73 знахідки** (2 critical, 11 high, 31 medium, 29 low).
  Сирий звіт (міг бути почищений):
  `C:\TEMP_V~1\claude\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\tasks\wo2py1h8i.output`.
  Синтез — `tasks/improvement-plan.md`.
- **Хвиля 1** (`4773f3b`): 9 виконавців, 5 критичних з адверсаріальною верифікацією (1 дефект знайдено
  й пофіксено), гейт 1 зелений.
- **Хвиля 2** (`ee879ef`): L(локалі) + 10 паралельних (FE-A..G, BE-misc, BE-fx, tests-pure, tests-db),
  11/11 done. BE-fx (N+1 курси → in-memory `createFxResolver`/`loadFxResolver`, pivot rateDate MIN→MAX)
  верифіковано адверсаріально ok + дотест еквівалентності у `fx.test.ts`. Гейт 2 зелений.
- **Фікс dev-сервера** (`6479909`): vite dev падав на codemirror-імпортах барела t-components →
  `resolve.alias` на no-op стаб `frontend/src/lib/codemirror-stub.ts`. Прод-build біт-у-біт той самий.
- **Хвиля 3** (`26d5e54`): completeness-критик (210k токенів): 2/2 critical і ~10/11 high закриті,
  NUL-байт у `valuation.ts` усунено; 3 добивання. Фінальний гейт: tsc 0 (вкл. тести), build, 128/128.
- **Ланцюг комітів на `main`:** `4773f3b → effccbe → ee879ef → 4f41035 → 6479909 → 26d5e54 → 450728d`
  (HEAD). origin/main відстає; **push — рішення власника** (крок пайплайну, лише з його добром).

## Файли-джерела для цієї фази (НЕ дублюй — посилайся й читай)

- `tasks/google-auth-task.md` — ПОВНА специфікація Google-входу: потік end-to-end, backend
  (jose `createRemoteJWKSet` + усі перевірки клеймів), frontend (GIS без npm), env-ключі, CSP,
  оновлення ТЗ/CLAUDE.md, доля парольного входу (break-glass під флагом), тест-план §7,
  перелік файлів §8. openQuestions §кінець — УЖЕ закриті узгодженими рішеннями (див. вище).
- `tasks/deploy-bootstrap-plan.md` — ПОВНИЙ план bootstrap: факти розвідки VPS (§1), чекліст по
  кроках [manual-owner]/[agent] (§2), GitHub Secrets (§3), порядок першого деплою + верифікація +
  відкат (§4), залежність від Google-auth (§5), ризики/блокери (§6). **GHCR-рішення взято з flatlog —
  читай актуальну версію файла** (його щойно оновив паралельний CI-infra агент; НЕ редагуй сам у цій
  фазі без потреби — посилайся).
- `infra/README.md` — короткий канон bootstrap + backup restore (age -d → pg_restore); оновлюється
  auth-фазою (нові env + крок OAuth Client ID).
- `specs/statok-tz.md` — §7.5 (деплой), §7.8.3 (env), §7.9 (безпека); ТЗ оновлюється задачею
  Google-auth (NFR-01 +2 хости, CSP; FR-01..04; §9 Google OIDC).

## Блокери проду (зведення; деталі — tasks/deploy-bootstrap-plan.md §6)

1. **DNS:** A-записи власник ставить ЗАРАЗ → `195.201.130.51`. Старий IP `91.197.69.34`. Перевірити
   propagation `nslookup ... 8.8.8.8`. Без коректних A-записів Traefik-роутинг і ACME httpChallenge НЕ
   працюють. [manual-owner], §2 крок 1.
2. **GHCR:** підхід вирішено за flatlog (без `docker login` на VPS, якщо публічні; інакше — як у плані).
   Деталі — в оновленому `tasks/deploy-bootstrap-plan.md`. [manual-owner], §2 крок 2.
3. **Образів ще немає:** `ghcr.io/vitaliysimkin/statok/{frontend,backend}` зʼявляться лише першим
   релізним тегом. §4.1.
4. **`/opt/statok` + `.env` відсутні:** теку створити [agent] (після згоди), `.env` — [manual-owner]
   (секрети лише на VPS). §2 кроки 5–6.
5. **GitHub Secrets:** значення write-only (урок 19). VPS_SSH_KEY — НОВИЙ deploy-ключ генерує [agent]
   (ssh-keygen → pub у authorized_keys через tardis_ops → priv у `gh secret set`); TELEGRAM_* /
   RELEASE_TOKEN вводить власник. §3.
6. **Бекапів на хості немає:** `scripts/backup.sh` у репо є, на VPS не розгорнутий. §2 крок 9.

## openQuestions / запити власнику (поставити ДО відповідних кроків)

> Auth-openQuestions (шлях ендпоінта, доля парольного входу, fatal-boot env) — УЖЕ ЗАКРИТІ
> узгодженими рішеннями (див. «Стан репо»). Нижче — лише незакриті, по bootstrap проду.

Bootstrap проду (`tasks/deploy-bootstrap-plan.md`):
1. **GHCR visibility:** публічні пакети `statok/*` (простіше, як вирішено для flatlog) чи приватні з
   `docker login` на VPS? (підхід задокументовано в плані — підтвердити рішення).
2. **GitHub Secrets значення:** `TELEGRAM_*`, `RELEASE_TOKEN`/PAT — вводить власник (write-only,
   урок 19). `VPS_SSH_KEY` — генерує [agent] (новий deploy-ключ). `VPS_HOST/USER` — підтвердити.
3. **VPS_USER:** деплоїти під `root` чи окремим deploy-user із доступом до docker?
4. **Swap:** додавати swap (RAM 7.5 GiB без swap, ділиться з tardis/flatlog/media; ризик OOM на
   pg_restore/міграціях)?
5. **Бекап:** вмикати нічний бекап одразу при bootstrap чи після перших днів?
6. **ЯВНА згода на запис у прод:** одне «так» на ВЕСЬ список [agent]-write-кроків bootstrap (mkdir
   /opt/statok, authorized_keys, .env, copy backup.sh) — перелічити їх власнику ОДНИМ списком. Перед
   ПЕРШИМ write-кроком на VPS обов'язково отримати це «так». Read-only SSH-розвідка — без окремої згоди.
7. **Push main:** ланцюг комітів (4773f3b..HEAD) + auth-коміт НЕ запушено. Push — лише за явним
   рішенням власника після рев'ю (сам git push не виконуй); release.mjs пушить тег у origin.
8. **Break-glass доступ:** як власник входить, якщо Google недоступний / зміна email (пов'язано з
   `ENABLE_PASSWORD_LOGIN`).

## Інженерні уроки (УСІ — врахуй у воркфлоу й гейтах)

1. **Windows `nul`:** жодних редиректів у nul / /dev/null (битий файл ламає `git add`). У GUARD
   кожному агенту.
2. **bun install** — лише один агент за хвилю, послідовно. У хвилях без інсталяцій — забороняй усім.
   (Для auth нових залежностей НЕ додавати — урок 15, інваріант ТЗ §0.)
3. **Не вір «tsc clean» агентам** — ПІСЛЯ хвилі сам ганяй повний tsc і build; агенти бачать рухоме
   дерево (чужі помилки під час хвилі — норм, ігнорують свої файли).
4. **Smoke ловить те, що tsc не бачить** (подвійний serve у фазі 1; живі YTM/oversell у хвилі 1;
   еквівалентність fx-резолвера у хвилі 2; для auth — роут-матриця 401/403/400/503).
5. **Спільні файли — один власник на хвилю:** `routes/api.ts`, `index.ts`, `schema.ts`,
   `locales/*.json`, `App.vue`, `main.ts`, `theme.css`, `services/api.ts`, `dto.ts`, `vite.config.ts`,
   `nginx.conf`, `bun.lock`. Локалі — окремий послідовний агент ПЕРЕД паралельною хвилею; dto-правки —
   одному агенту. **Для Google-auth:** `LoginPage.vue`, `useAuth.ts`, `nginx.conf`, `dto.ts`,
   `routes/auth.ts`, `index.ts`, локалі — узгодь власників за §8 задачі (не давати двом агентам).
6. **PS 5.1 + curl.exe ламає JSON із пробілами** в `-d` (re-quoting): JSON у smoke — БЕЗ пробілів у
   значеннях, або `-d @файл`. Симптом: `400 Invalid JSON body` і хвости `|000` у `-w`.
7. **Пісочниця блокує компаунд-команди** з `Remove-Item` + шляхами/текстами зі слешами: руйнівні
   кроки — ОКРЕМИМИ викликами.
8. **Орфан-процеси агентів:** верифікатори/виконавці можуть лишити запущений bun на 3100 (і він міг
   застосувати міграції до dev-БД). Перед smoke: `Get-NetTCPConnection 3100` → kill. Сміття типу
   `.playwright-mcp/` — видалити перед комітом (`git status` переглядати!).
9. **bun -e для числових/логічних перевірок:** імпорт backend-сервісів тягне `db/index.ts` — конект
   лінивий, достатньо `DATABASE_URL` із `.env.dev`. Bash-tool + нативний Bun на Windows не дружать із
   POSIX-`/tmp` — тимчасові скрипти класти у репо-tmp і видаляти, або PowerShell.
10. **Адверсаріальна верифікація працює:** вимагай ЧИСЛОВІ/конкретні контрприклади і git diff-обмеження
    по файлах задачі; mustFix лише за реальні дефекти. Патерн `exec→verify→fix→re-verify` переносити
    як є. **Для Google-auth — критично:** security-верифікатор має спробувати ПРОБИТИ allowlist
    (чужий email, `email_verified=false`, `aud` від іншого застосунку, протермінований `exp`, чужий
    підпис RS256) і переконатися, що кожен кейс відсікається (§7.1 задачі). Юніти — локальний JWKS
    через `jose generateKeyPair`.
11. **agent() у Workflow з `opts.phase`** — обов'язково в pipeline-стадіях (інакше гонки прогрес-груп);
    schema StructuredOutput — виконавцям і верифікаторам.
12. **Гроші:** будь-який новий код — ТІЛЬКИ через `@statok/shared` (bigint half-up); `Number()`/
    `parseFloat` на грошовому шляху = дефект (виняток YTM-метрика за ТЗ §3.3).
13. **Паралельні FE-агенти самоперевіряються через `bunx vue-tsc --noEmit`, НЕ через `bun run build`**
    (гонка за `dist/`; виняток — один агент з окремим `--outDir`). Менеджерський build — ОДИН, у гейті.
14. **bun test усім сьютом — env `DATABASE_URL` МУСИТЬ вказувати на `statok_test` ДО запуску**
    (singleton запікає URL при імпорті першого ж тест-файла; `bond.test.ts` іде першим). Інакше тести
    підуть у БД `statok` зі smoke-даними.
15. **Барелі сторонніх кітів можуть еагерно імпортувати невстановлені peer-деки** — прод-білд пройде
    (tree-shake), dev-пребандлер впаде. Рішення: `resolve.alias` на локальні no-op стаби (як
    `codemirror-stub.ts`). **Для Google-auth:** GIS вантажиться `<script>`-тегом, НЕ npm — нових
    залежностей не додавати (інваріант ТЗ §0).
16. **PS 5.1: немає `//`, `?:`, `&&`;** тіла JSON для `curl.exe` — через `-d @файл`. Чейн команд —
    `;` + `if ($?) {...}`; null — `2>$null`; env — `$env:VAR`.
17. **StructuredOutput-звіти агентів читати з `.output`-файла через `[System.IO.File]::ReadAllText`
    з UTF8** (`Get-Content` ламає кирилицю). Структура `{summary, agentCount, logs, result}`.
18. **Кеш resume Workflow (`resumeFromRunId`) діє ЛИШЕ в межах сесії.** Нова сесія відновлює стан З
    GIT і звітів у `C:\TEMP_V~1\claude\...`, а не з run-id попередньої сесії. Тому перший крок —
    звірка факту по `git log`/`git status`, а не спроба «продовжити» по run-id.
19. **GitHub secrets write-only:** «скопіювати значення з flatlog» через API НЕМОЖЛИВО. Для
    `VPS_SSH_KEY` [agent] генерує НОВИЙ deploy-ключ (`ssh-keygen` → pub у `authorized_keys` на VPS
    через наявний tardis_ops-доступ → priv у `gh secret set`); `TELEGRAM_*` / `RELEASE_TOKEN` значення
    вводить власник вручну.

## Свідомо відкладено (DEFERRED — щоб не загубилось; НЕ робити в цій фазі без рішення власника)

З completeness-критика і хендофів циклу:
- міграція модалок на `TModalBox` + focus-trap (зараз Esc+фокус інлайн);
- консолідація `uuid`/date-guard у спільний lib;
- rebuild-перф понад кеп 3700 днів + перевід `rebuild`/`portfolio`/`accounts` на fx-резолвер;
- конвертація котирувань у чужій валюті (GBp-кейс — v1: ігнор+warn);
- кеп/таймаут pg_dump-стріму;
- гармонізація стилю `valuationIncomplete` (unconditional vs omit-when-false);
- db singleton lazy-getter;
- звуження універсального `*` transition у `theme.css`;
- перевидання `t-components` з повними vue d.ts (типи `TSelect`/`TDateInput`/`TDateTimeInput` зараз
  `any` через skipLibCheck);
- експорт `couponAmountMinor` для прямих юнітів;
- конвенція `try/catch` замість `await expect().rejects` (зависає на bun+postgres);
- `deposit`/`withdraw` зміна currency у `buildUpdate` (ТЗ не вимагає);
- уніфікація бренд-синього (manifest `#1a6ef5` vs іконки `#2563eb`);
- e2e-HTTP тест `PUT assets` із частковим bond.

## Конвенції

- Коміти ЛОКАЛЬНО, БЕЗ push поки власник не вирішить; трейлер
  `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Прод — лише з ЯВНОЇ згоди власника** на кожну дію запису (SSH-write на 195.201.130.51, compose up,
  реліз із тегом). Одне «так» на весь список bootstrap-write-кроків (перелічити). Read-only
  SSH-розвідку можна без окремої згоди.
- Агенти: **opus** — складна логіка/верифікація (Google-auth backend, security-верифікатор); **sonnet**
  — механічні правки за точною спекою (локалі, дрібний FE, CI-yaml).
- Telegram /notify-me: пінг на старті кроку, після гейту, на блокерах/openQuestions, фінальний 🎉.
- Прогрес-шкала фази: 0% (старт) → Google-auth дочинено+гейт → DNS зелений → bootstrap (manual-кроки
  власника + agent-write за згодою) → GitHub Secrets → push+перший реліз+верифікація+бекап → 100% 🎉.
- Dev-порти: Postgres 5434, бекенд 3100, Vite 5273. Прод-доступ: ключ `C:\Users\vital\.ssh\tardis_ops`,
  `root@195.201.130.51` (запис — лише за згодою власника).
- Тести: `DATABASE_URL=...:5434/statok_test bun test packages/shared/test backend/test`.

## Далі по пайплайну (ПІСЛЯ цієї фази)

Після зеленого продакшну — операційна фаза: моніторинг, перевірка нічних бекапів (відновлення за
`infra/README.md`), реакція на алерти Telegram-нотифікацій деплою, наступні фічі/релізи через
`bun run release:{patch,minor,major}`. Свідомо відкладений тех-борг (список вище) — окремими циклами
за рішенням власника.
