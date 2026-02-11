module.exports = {
    projectConfig: {
        database_url: process.env.DATABASE_URL || 'postgres://medusa:medusa@localhost:5432/medusa',
        database_type: 'postgres',
        store_cors: process.env.STORE_CORS || '*',
        admin_cors: process.env.ADMIN_CORS || '*',
        jwt_secret: process.env.JWT_SECRET || 'supersecret',
        cookie_secret: process.env.COOKIE_SECRET || 'supersecret',
        redis_url: process.env.REDIS_URL || undefined,
    },
    plugins: [
        'medusa-fulfillment-manual',
        'medusa-payment-manual',
    ],
    modules: {
        eventBus: {
            resolve: '@medusajs/event-bus-local',
        },
        cacheService: {
            resolve: '@medusajs/cache-inmemory',
        },
    },
};
