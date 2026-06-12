# Statok — Production Infrastructure

## Bootstrap [manual-owner]

One-time steps before the first deploy:

1. **DNS** — create A-records pointing both `statok.simk.in.ua` and
   `api.statok.simk.in.ua` to the VPS IP.

2. **External Traefik + `web` network** — the shared dakara edge must already be
   running and the `web` Docker network must exist on the host.  Statok simply joins it;
   no separate Traefik instance is needed.

3. **Secrets file** — create `/opt/statok/.env` on the VPS (never commit this):

   ```env
   STATOK_VERSION=                # written by the deploy pipeline (sed)
   DATABASE_URL=postgresql://statok:<pw>@postgres:5432/statok
   POSTGRES_PASSWORD=<pw>
   JWT_SECRET=<random 64 hex chars>
   ADMIN_USERNAME=<username>
   ADMIN_PASSWORD=<password>
   BASE_CURRENCY=USD
   TZ=Europe/Kyiv
   CORS_ORIGINS=https://statok.simk.in.ua
   ```

4. **First deploy** — push a release tag or run manually:

   ```sh
   cd /opt/statok
   docker compose -f infra/docker-compose.yml pull
   docker compose -f infra/docker-compose.yml up -d --remove-orphans
   ```

   The backend runs DB migrations and seeds the admin user automatically on boot.

## Backup restore

To restore from a nightly encrypted backup:

```sh
# 1) decrypt with your age private key
age -d -i ~/.age/key.txt statok-YYYYMMDD-HHmm.dump.age > statok.dump

# 2) restore into the running postgres container
docker exec -i statok-postgres-1 pg_restore -U statok -d statok --clean --if-exists < statok.dump
```
