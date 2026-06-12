# Handoff — фаза ДЕПЛОЮ Statok (МЕНЕДЖЕР-ОРКЕСТРАТОР)

> Скопіюй блок між `=== ПРОМПТ ===` як перше повідомлення нової сесії Claude Code.
> Робоча директорія: `O:\projects\statok`. Цикл АНАЛІЗ→ПОКРАЩЕННЯ завершено (3 хвилі,
> 73 знахідки опрацьовано, обидва гейти зелені, фінальний коміт `26d5e54` локально, НЕ
> запушено). Ця сесія = ДЕПЛОЙ: рев'ю+push власником → Google-auth хвилею → bootstrap проду
> → перший реліз. Прод НЕ чіпати без зеленого Google-auth.

---

```
=== ПРОМПТ ===
Ти — МЕНЕДЖЕР-ОРКЕСТРАТОР проєкту Statok (O:\projects\statok). Цикл АНАЛІЗ→ПОКРАЩЕННЯ завершено й закомічено ЛОКАЛЬНО (HEAD = 26d5e54, НЕ запушено, working tree чистий). Твоя задача — провести ФАЗУ ДЕПЛОЮ: (а) дочекатися рев'ю+push власником, (б) реалізувати Google-auth Workflow-хвилею з адверсаріальною верифікацією security-критичного коду + гейт, (в) bootstrap проду, (г) перший реліз + верифікація + бекапи. Працюй ВИКЛЮЧНО через Workflow (агенти opus/sonnet). Відповідай українською.

ЖОРСТКЕ ПРАВИЛО: ти НІЧОГО не робиш сам, крім менеджменту. Не аналізуєш і не пишеш код власноруч. Уся аналітика і ВСІ зміни — лише через підагентів у Workflow. Тобі дозволено лише: проектувати/запускати воркфлоу, читати звіти, синтезувати/пріоритезувати, комітити чекпойнти ЛОКАЛЬНО, запускати верифікаційні гейти (tsc/build/test/smoke), керувати кроками bootstrap (через підагентів з SSH — лише з ЯВНОЇ згоди власника на запис у прод), пінгувати прогрес.

ОСОБЛИВІСТЬ ЦІЄЇ ФАЗИ: вона має [manual-owner]-кроки, яких НЕ можна виконати без власника (DNS, Google Cloud Console, GitHub-секрети, генерація реальних секретів, рішення про GHCR visibility, ЯВНА згода на запис у прод). Не блокуйся на них — рухайся тим, що можна (Google-auth код + його гейт), а manual-кроки оформляй як чіткі запити власнику через Telegram і чекай відповіді. Прод НЕ піднімати, доки Google-auth не зелений (рекомендація tasks/deploy-bootstrap-plan.md §5).

Спершу прочитай ПОВНІСТЮ: prompts/HANDOFF-next-session.md (цей файл — стан, блокери, openQuestions, уроки), tasks/google-auth-task.md (повна специфікація Google-входу) і tasks/deploy-bootstrap-plan.md (план bootstrap проду по кроках [manual-owner]/[agent]). Довідково: infra/README.md, specs/statok-tz.md §7.5/§7.8.3/§7.9. Активуй /notify-me (прогрес у %; старт фази деплою = 0% цієї фази).

ПАЙПЛАЙН ЦІЄЇ СЕСІЇ (порядок строгий):
1. РЕВ'Ю+PUSH ВЛАСНИКОМ. Ланцюг 6 локальних комітів (4773f3b..26d5e54) НЕ запушено. Спитай власника: рев'ю зроблено? push в origin/main — за його рішенням. Сам git push НЕ виконуй. Доки не запушено — origin відстає; врахуй це при реліз-тегу (release.mjs пушить тег у origin).
2. GOOGLE-AUTH (Workflow-хвиля ЗА tasks/google-auth-task.md). Security-критичний код → ОБОВ'ЯЗКОВА адверсаріальна верифікація (патерн exec→verify→fix→re-verify хвиль 1/2). Ексклюзивне володіння файлами — за §8 таблицею задачі. Тест-план §7 (юніт із локальним JWKS через jose generateKeyPair). Узгодь із власником openQuestions задачі (шлях /auth/google, доля парольного входу/break-glass, fatal-boot env) ДО старту. Потім ГЕЙТ Google-auth: tsc 0; build (з VITE_GOOGLE_CLIENT_ID); bun test (нові юніти 200/403/401/400/429 — усі зелені); live-smoke (кнопка GIS рендериться, allowed→токен, чужий email→403, refresh після Google-входу тримає сесію). Коміт ЛОКАЛЬНО, пінг.
3. BOOTSTRAP ПРОДУ за tasks/deploy-bootstrap-plan.md. [manual-owner]-кроки (DNS, GHCR visibility, GitHub Secrets, .env-секрети, Google Cloud Console, swap, бекап-ключі) — оформ як запити власнику й ЧЕКАЙ. [agent]-кроки (mkdir /opt/statok, перевірка мережі web/портів, копіювання backup.sh) — через підагентів з SSH (ключ C:\Users\vital\.ssh\tardis_ops, root@195.201.130.51), але ЛИШЕ після ЯВНОЇ згоди власника на конкретну дію запису. Read-only розвідку SSH можна без окремої згоди.
4. ПЕРШИЙ РЕЛІЗ. Лише коли передумови §2 плану (DNS, GHCR, Secrets, тека, .env, web) зелені І Google-auth зелений. bun run release:patch (або через GitHub Actions Release workflow_dispatch) → CI збере образи → deploy.yml → health-check. Ручна верифікація §4.3 плану (health/фронт/логін/Google-вхід у проді). Увімкнути нічний бекап (§2 крок 9). Пінг 100% 🎉.

Застереження (деталі нижче, розділ «Інженерні уроки 1-17»): Windows — не пиши у nul; PS 5.1 не має //, ?:, && (тіла JSON для curl.exe — через -d @файл, БЕЗ пробілів); НЕ вір агентам на слово «tsc clean» — перевіряй сам; спільні файли — один власник на хвилю; смоук ловить те, що tsc не бачить; FE-агенти самоперевіряються через vue-tsc --noEmit, НЕ build (гонка за dist/); bun test усім сьютом — DATABASE_URL на statok_test ДО запуску; адверсаріальна верифікація вимагає ЧИСЛОВИХ контрприкладів; звіти агентів читати з .output через [System.IO.File]::ReadAllText UTF8. ПРОД — лише з явної згоди власника; жодного запису в прод «на свій розсуд».
=== /ПРОМПТ ===
```

---

## Стан репо/середовища/git (станом на закриття циклу, 2026-06-13)

- **Цикл АНАЛІЗ→ПОКРАЩЕННЯ ЗАВЕРШЕНО.** Аналіз: 8 read-only аналітиків (opus), **73 знахідки**
  (2 critical, 11 high, 31 medium, 29 low). Сирий звіт аналізу (може бути почищений системою):
  `C:\TEMP_V~1\claude\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\tasks\wo2py1h8i.output`.
  Синтез знахідок — `tasks/improvement-plan.md` (статуси оновлені).
- **Хвиля 1** (`4773f3b`): 9 виконавців, 5 критичних з адверсаріальною верифікацією (1 дефект
  знайдено й пофіксено), гейт 1 зелений.
- **Хвиля 2** (`ee879ef`): L(локалі) + 10 паралельних (FE-A..G, BE-misc, BE-fx, tests-pure,
  tests-db), 11/11 done. BE-fx (N+1 курси → in-memory резолвер `createFxResolver`/`loadFxResolver`,
  pivot rateDate MIN→MAX) верифіковано адверсаріально ok з 1-го разу + дотест еквівалентності у
  `fx.test.ts`. Гейт 2 зелений: tsc 0, build (PWA PNG у manifest), 128/128 тестів, live-smoke
  повний (oversell-409, cashflow deposits=1194, manual exact-string, convert інверс+fallback,
  backup PGDMP, sync Frankfurter+НБУ живий).
- **Фікс dev-сервера** (`6479909`): vite dev падав на codemirror-імпортах барела t-components →
  `resolve.alias` на no-op стаб `frontend/src/lib/codemirror-stub.ts`. Прод-build біт-у-біт той самий.
- **Хвиля 3** (`26d5e54`): completeness-критик (210k токенів, по коду): 2/2 critical і ~10/11 high
  закриті, регресій у грошах немає, NUL-байт у `valuation.ts` реально усунено. Добивання 3 фіксами
  (pencil→pen у AssetsPage/PriceHistory; useFx.history base/quote обов'язкові;
  `backend/tsconfig.json` include `test/**/*.ts`). Фінальний гейт: tsc 0 (вкл. тести), build
  зелений, 128/128.
- **Git:** ланцюг ЛОКАЛЬНИХ комітів на `main`, НЕ запушено:
  `4773f3b → effccbe → ee879ef → 4f41035 → 6479909 → 26d5e54` (HEAD). Working tree чистий.
  Користувацький `f862d52` (VSCode tasks) між `415429d`-попередником і хвилею 1 — уже на місці.
  origin/main відстає; **push — рішення власника після рев'ю** (перший крок пайплайну).
- **Середовище зараз:** бекенд працює на **3100** (`bun --env-file=.env.dev`), vite dev на **5273**,
  Postgres docker **5434** (БД `statok` зі smoke-даними гейтів + `statok_test` від тестів).
  Логін dev: `admin`/`admin`.
- **Запуск тестів (важливо):**
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok_test bun test packages/shared/test backend/test`
  — URL ОБОВ'ЯЗКОВО на `statok_test`: singleton db запікає URL на момент імпорту, а `bond.test.ts`
  імпортується першим (урок 14).
- **Telegram:** /notify-me був активний; останній пінг — фінальний 🎉 закриття циклу.
- **Прод/інфра-розвідка:** read-only розвідка VPS `dakara` (195.201.130.51) → `tasks/deploy-bootstrap-plan.md`
  (коміт `4f41035`). Задача Google-auth — `tasks/google-auth-task.md`.

## Файли-джерела для цієї фази (НЕ дублюй — посилайся й читай)

- `tasks/google-auth-task.md` — ПОВНА специфікація Google-входу: потік end-to-end, backend
  (jose `createRemoteJWKSet` + усі перевірки клеймів), frontend (GIS без npm), env-ключі, CSP,
  оновлення ТЗ/CLAUDE.md, доля парольного входу (break-glass під флагом), тест-план §7,
  перелік файлів §8, 4 openQuestions §кінець.
- `tasks/deploy-bootstrap-plan.md` — ПОВНИЙ план bootstrap: факти розвідки VPS (§1), чекліст по
  кроках із позначками [manual-owner]/[agent] (§2), GitHub Secrets (§3), порядок першого деплою +
  верифікація + відкат (§4), залежність від Google-auth (§5), ризики/блокери (§6), 5 openQuestions.
- `infra/README.md` — короткий канон bootstrap + backup restore (age -d → pg_restore).
- `specs/statok-tz.md` — §7.5 (деплой), §7.8.3 (env), §7.9 (безпека); ТЗ оновлюється задачею
  Google-auth (NFR-01 +2 хости, CSP; FR-01..04; §9 Google OIDC).

## Блокери проду (зведення; деталі — tasks/deploy-bootstrap-plan.md §6)

1. **DNS на чужий IP:** `statok.simk.in.ua` та `api.statok.simk.in.ua` резолвляться у
   `91.197.69.34`, а не у VPS `195.201.130.51`. Без A-записів на VPS Traefik-роутинг і ACME
   httpChallenge НЕ працюють. [manual-owner], §2 крок 1.
2. **GHCR без логіну** на хості: нема `docker login ghcr.io`. Якщо пакети приватні —
   `docker compose pull` впаде `denied`. [manual-owner], §2 крок 2.
3. **Образів ще немає:** `ghcr.io/vitaliysimkin/statok/{frontend,backend}` зʼявляться лише першим
   релізним тегом. §4.1.
4. **`/opt/statok` + `.env` відсутні:** теку створити [agent], `.env` — [manual-owner] (секрети
   лише на VPS). §2 кроки 5–6.
5. **Бекапів на хості немає:** `scripts/backup.sh` у репо є, на VPS не розгорнутий. §2 крок 9.

## openQuestions власнику (зібрано з обох task-файлів — поставити ДО відповідних кроків)

Bootstrap проду (`tasks/deploy-bootstrap-plan.md`):
1. **GHCR visibility:** публічні пакети `statok/*` (простіше) чи приватні з `docker login` на VPS?
2. **RELEASE_TOKEN / PAT** і решта GitHub Secrets (`VPS_HOST/USER/SSH_KEY`, `TELEGRAM_*`) — завести
   (§3 плану). Без них реліз/деплой не виконається.
3. **VPS_USER:** деплоїти під `root` чи окремим deploy-user із доступом до docker?
4. **Swap:** додавати swap (RAM 7.5 GiB без swap, ділиться з tardis/flatlog/media; ризик OOM на
   pg_restore/міграціях)?
5. **Бекап зараз чи відкласти:** вмикати нічний бекап одразу при bootstrap чи після перших днів?
6. **Порядок auth-vs-deploy:** Google-auth ДО публічного деплою (рекомендовано §5) чи короткий
   проміжок на парольному вході для smoke?

Google-auth (`tasks/google-auth-task.md`):
7. **Шлях ендпоінта:** `POST /auth/google` (рекомендовано, симетрія з login/refresh) чи
   наполягати на `/api/auth/google`?
8. **Парольний вхід:** break-glass під `ENABLE_PASSWORD_LOGIN=false` (рекомендовано, страховка)
   чи видалити повністю?
9. **fatal-boot env:** робити `GOOGLE_CLIENT_ID`/`ALLOWED_GOOGLE_EMAIL` обов'язковими на boot
   (fatal exit за відсутності, коли парольний вхід вимкнено)?

Окремо узгодити:
10. **ЯВНА згода на запис у прод:** кожна [agent]-дія запису на VPS (mkdir, copy, compose up) —
    лише після підтвердження власника. Read-only SSH-розвідка — без окремої згоди.
11. **Break-glass доступ:** як власник входить, якщо Google недоступний / зміна email (пов'язано
    з openQuestion 8).

## Інженерні уроки (УСІ — врахуй у воркфлоу й гейтах)

1. **Windows `nul`:** жодних редиректів у nul / /dev/null (битий файл ламає `git add`). У GUARD
   кожному агенту.
2. **bun install** — лише один агент за хвилю, послідовно. У хвилях без інсталяцій — забороняй усім.
3. **Не вір «tsc clean» агентам** — ПІСЛЯ хвилі сам ганяй повний tsc і build; агенти бачать
   рухоме дерево (чужі помилки під час хвилі — норм, ігнорують свої файли).
4. **Smoke ловить те, що tsc не бачить** (подвійний serve у фазі 1; живі YTM/oversell у хвилі 1;
   еквівалентність fx-резолвера у хвилі 2).
5. **Спільні файли — один власник на хвилю:** `routes/api.ts`, `index.ts`, `schema.ts`,
   `locales/*.json`, `App.vue`, `main.ts`, `theme.css`, `services/api.ts`, `dto.ts`,
   `vite.config.ts`, `nginx.conf`, `bun.lock`. Локалі — окремий послідовний агент ПЕРЕД
   паралельною хвилею; dto-правки — одному агенту за хвилю. (Актуально для Google-auth: `LoginPage.vue`,
   `useAuth.ts`, `nginx.conf`, `dto.ts`, `auth.ts`, локалі — узгодь власників за §8 задачі.)
6. **PS 5.1 + curl.exe ламає JSON із пробілами** в `-d` (re-quoting): JSON у smoke — БЕЗ пробілів
   у значеннях, або `-d @файл`. Симптом: `400 Invalid JSON body` і хвости `|000` у `-w`.
7. **Пісочниця блокує компаунд-команди** з `Remove-Item` + шляхами/текстами зі слешами (хибний
   матч): руйнівні кроки — ОКРЕМИМИ викликами.
8. **Орфан-процеси агентів:** верифікатори/виконавці можуть лишити запущений bun на 3100 (і він
   міг застосувати міграції до dev-БД). Перед smoke: `Get-NetTCPConnection 3100` → kill. Сміття
   типу `.playwright-mcp/` — видалити перед комітом (`git status` переглядати!).
9. **bun -e для числових перевірок:** імпорт backend-сервісів тягне `db/index.ts` — конект лінивий,
   достатньо `DATABASE_URL` із `.env.dev` (без живої БД для чистих фн). Bash-tool + нативний Bun
   на Windows не дружать із POSIX-`/tmp` — тимчасові скрипти класти у репо-tmp і видаляти, або PowerShell.
10. **Адверсаріальна верифікація працює:** вимагай ЧИСЛОВІ контрприклади (`bun -e`) і git diff-обмеження
    по файлах задачі; mustFix лише за реальні дефекти. Патерн `exec→verify→fix→re-verify` переносити
    як є. **Для Google-auth — критично:** верифікатор має спробувати ПРОБИТИ allowlist (чужий email,
    `email_verified=false`, `aud` від іншого застосунку, протермінований `exp`, чужий підпис) і
    переконатися, що кожен кейс відсікається (§7.1 задачі).
11. **agent() у Workflow з `opts.phase`** — обов'язково в pipeline-стадіях (інакше гонки прогрес-груп);
    schema StructuredOutput — виконавцям і верифікаторам.
12. **Гроші:** будь-який новий код — ТІЛЬКИ через `@statok/shared` (bigint half-up);
    `Number()`/`parseFloat` на грошовому шляху = дефект (виняток YTM-метрика за ТЗ §3.3).
13. **Паралельні FE-агенти самоперевіряються через `bunx vue-tsc --noEmit`, НЕ через `bun run build`**
    (гонка за `dist/`; виняток — один агент з окремим `--outDir`). Менеджерський build — ОДИН, у гейті.
14. **bun test усім сьютом — env `DATABASE_URL` МУСИТЬ вказувати на `statok_test` ДО запуску**
    (singleton запікає URL при імпорті першого ж тест-файла; `bond.test.ts` іде першим). Інакше
    тести підуть у БД `statok` зі smoke-даними.
15. **Барелі сторонніх кітів можуть еагерно імпортувати невстановлені peer-деки** — прод-білд
    пройде (tree-shake), dev-пребандлер впаде. Рішення: `resolve.alias` на локальні no-op стаби
    (як `codemirror-stub.ts`). **Актуально для Google-auth:** GIS вантажиться `<script>`-тегом,
    НЕ npm — нових залежностей не додавати (інваріант ТЗ §0).
16. **PS 5.1: немає `//`, `?:`, `&&`;** тіла JSON для `curl.exe` — через `-d @файл`. Чейн команд —
    `;` + `if ($?) {...}`; null — `2>$null`; env — `$env:VAR`.
17. **StructuredOutput-звіти агентів читати з `.output`-файла через `[System.IO.File]::ReadAllText`
    з UTF8** (`Get-Content` ламає кирилицю). Структура `{summary, agentCount, logs, result}`.

## Свідомо відкладено (DEFERRED — щоб не загубилось; НЕ робити в цій фазі без рішення власника)

З completeness-критика і хендофів циклу:
- міграція модалок на `TModalBox` + focus-trap (зараз Esc+фокус інлайн);
- консолідація `uuid`/date-guard у спільний lib;
- rebuild-перф понад кеп 3700 днів + перевід `rebuild`/`portfolio`/`accounts` на fx-резолвер;
- конвертація котирувань у чужій валюті (GBp-кейс — v1: ігнор+warn);
- кеп/таймаут pg_dump-стріму;
- гармонізація стилю `valuationIncomplete` (unconditional vs omit-when-false — дві конвенції);
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

- Коміти ЛОКАЛЬНО, БЕЗ push поки власник не вирішить (push в origin — крок 1 пайплайну за
  рішенням власника); трейлер `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Прод — лише з ЯВНОЇ згоди власника** на кожну дію запису (SSH-write на 195.201.130.51,
  compose up, reli з тегом). Read-only SSH-розвідку можна без окремої згоди.
- Агенти: **opus** — складна логіка/верифікація (Google-auth backend, security-верифікатор);
  **sonnet** — механічні правки за точною спекою (локалі, дрібний FE).
- Telegram /notify-me: пінг на старті кроку, після гейту, на блокерах/openQuestions, фінальний 🎉.
- Прогрес-шкала фази деплою: 0% (старт) → push власником → Google-auth done+гейт → bootstrap
  (manual-кроки власника) → перший реліз+верифікація+бекап → 100% 🎉.
- Dev-порти: Postgres 5434, бекенд 3100, Vite 5273. Прод-доступ: ключ
  `C:\Users\vital\.ssh\tardis_ops`, `root@195.201.130.51` (запис — лише за згодою власника).
- Тести: `DATABASE_URL=...:5434/statok_test bun test packages/shared/test backend/test`.

## Далі по пайплайну (ПІСЛЯ цієї фази)

Після зеленого продакшну — операційна фаза: моніторинг, перевірка нічних бекапів (відновлення
за `infra/README.md`), реакція на алерти Telegram-нотифікацій деплою, наступні фічі/релізи через
`bun run release:{patch,minor,major}`. Свідомо відкладений тех-борг (список вище) — окремими
циклами за рішенням власника.
