# Prompt 02 — Вимоги → ТЗ (інша «професія»)

**Роль агента:** product manager / business analyst. Профі-скіл: **`product-management:write-spec`** (за потреби доповнити `design:design-handoff` для UI-частини).

**Вхід:** `specs/requirements.md` (дистильовані відповіді з Prompt 01) + `research/deployment-blueprint.md`.

**Завдання:** перетворити узгоджені вимоги на повноцінне **ТЗ / PRD** → `specs/statok-tz.md`.

**Структура ТЗ:**
1. **Контекст і цілі** — проблема, для кого, межі (single-user, self-hosted).
2. **Goals / Non-goals** — що НЕ робимо у v1 (напр. multi-user, банк-синк).
3. **Фази й scope** — Фаза 1 (інвестиції/портфель MVP), Фаза 2 (витрати/аналітика). Чіткий MVP-cut.
4. **Функціональні вимоги** — по модулях: активи, транзакції, котирування/FX, дивіденди, метрики дохідності, net-worth історія, дашборди, експорт. Кожна — з acceptance criteria.
5. **Модель даних** — сутності (Account, Asset, Position, Transaction, PriceQuote, FxRate, Category…), гроші як integer minor units + currency code.
6. **Нефункціональні** — приватність, бекапи, продуктивність, локалізація (укр/eng), валюти.
7. **Архітектура** — стек із блюпринту (Bun/Hono/Drizzle/Postgres + Vue3/Vite/nginx), інтеграції котирувань/FX.
8. **Розбивка на епіки/задачі** — нумерований бэклог, придатний для роздачі підагентам (кожна задача: назва, опис, файли, acceptance).
9. **Ризики / відкриті питання.**

**Стиль:** конкретика й acceptance criteria, без води. ТЗ має бути достатнім, щоб менеджер-агент (Prompt 03) роздав роботу підагентам без додаткових уточнень.

**Вихід:** `specs/statok-tz.md` + `tasks/backlog.md` (плоский список задач з ID). Далі → Prompt 03.
