import { Hono } from 'hono'

/**
 * /api/* router stub.
 * Real sub-routers (accounts, assets, transactions, …) mounted in later tasks.
 */
export const apiRouter = new Hono()

// TODO ST-014+: mount sub-routers here
// apiRouter.route('/accounts', accountsRouter)
// apiRouter.route('/assets', assetsRouter)
// etc.

apiRouter.get('/', (c) => c.json({ message: 'Statok API' }))
