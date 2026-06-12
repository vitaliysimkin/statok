import { Hono } from 'hono'

import { accountsRouter } from './accounts.ts'
import { assetsRouter } from './assets.ts'
import { transactionsRouter } from './transactions.ts'
import { portfolioRouter } from './portfolio.ts'
import { snapshotsRouter } from './snapshots.ts'
import { pricesRouter } from './prices.ts'
import { fxRouter } from './fx.ts'
import { dashboardsRouter } from './dashboards.ts'
import { exportRouter } from './export.ts'
import { backupRouter } from './backup.ts'
import { settingsRouter } from './settings.ts'

/**
 * /api/* router.
 */
export const apiRouter = new Hono()

apiRouter.route('/accounts', accountsRouter)
apiRouter.route('/assets', assetsRouter)
apiRouter.route('/transactions', transactionsRouter)
apiRouter.route('/portfolio', portfolioRouter)
apiRouter.route('/snapshots', snapshotsRouter)
apiRouter.route('/prices', pricesRouter)
apiRouter.route('/fx', fxRouter)
apiRouter.route('/dashboards', dashboardsRouter)
apiRouter.route('/export', exportRouter)
apiRouter.route('/backup', backupRouter)
apiRouter.route('/settings', settingsRouter)
