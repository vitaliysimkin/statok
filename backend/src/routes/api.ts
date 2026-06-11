import { Hono } from 'hono'

import { accountsRouter } from './accounts.ts'
import { assetsRouter } from './assets.ts'
import { transactionsRouter } from './transactions.ts'

/**
 * /api/* router.
 */
export const apiRouter = new Hono()

apiRouter.route('/accounts', accountsRouter)
apiRouter.route('/assets', assetsRouter)
apiRouter.route('/transactions', transactionsRouter)

apiRouter.get('/', (c) => c.json({ message: 'Statok API' }))
