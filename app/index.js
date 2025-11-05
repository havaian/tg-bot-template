require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');

// Import logger
require('./logger');

// Import Redis service
const redisService = require('./services/redisService');

// Import the translation helper
require('./utils/i18nHelper');

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN', 'MONGO_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    global.logger.logError(new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`));
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        global.logger.logInfo('✅ MongoDB', { database: process.env.MONGO_URI.split('/').pop() });
    })
    .catch(err => {
        global.logger.logError(err, { context: 'MongoDB connection failed' });
        process.exit(1);
    });

// Connect to Redis
const initializeRedis = async () => {
    try {
        const connected = await redisService.connect();
        if (!connected) {
            global.logger.logError('Failed to connect to Redis - continuing without Redis state management');
        }
    } catch (error) {
        global.logger.logError('Redis initialization error:', error);
    }
};

// Setup middleware
bot.use(session());

// Language detection middleware
const { detectUserLanguage } = require('./i18n/middleware');
bot.use(detectUserLanguage);

// Enhanced logging middleware
bot.use(async (ctx, next) => {
    try {
        if (ctx.message && ctx.message.text) {
            // Log user message with state if available from middleware
            global.logger.logUserMessage(ctx.from, ctx.message.text, ctx.userState);
        }

        // Log callback queries
        if (ctx.callbackQuery) {
            global.logger.logAction('callback_query', {
                userId: ctx.from.id,
                username: ctx.from.username,
                data: ctx.callbackQuery.data,
                userState: ctx.userState?.current
            });
        }

        return next();
    } catch (error) {
        global.logger.logError(error, ctx, { context: 'Logging middleware error' });
        return next();
    }
});

// ==================== Error Handling ====================

bot.catch((err, ctx) => {
    global.logger.logError('Bot error:', ctx, err);

    if (ctx && ctx.reply) {
        ctx.reply(t(ctx, 'errors.general')).catch(() => {
            // Ignore reply errors
        });
    }
});

// ==================== Graceful Shutdown ====================

process.once('SIGINT', async () => {
    global.logger.logInfo('Received SIGINT. Graceful shutdown...');

    try {
        await bot.stop('SIGINT');
        await redisService.disconnect();
        await mongoose.connection.close();
        global.logger.logInfo('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        global.logger.logError('Error during shutdown:', {}, error);
        process.exit(1);
    }
});

process.once('SIGTERM', async () => {
    global.logger.logInfo('Received SIGTERM. Graceful shutdown...');

    try {
        await bot.stop('SIGTERM');
        await redisService.disconnect();
        await mongoose.connection.close();
        global.logger.logInfo('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        global.logger.logError('Error during shutdown:', {}, error);
        process.exit(1);
    }
});

// ==================== Bot Launch ====================

const launchBot = async () => {
    try {
        // Initialize Redis first
        await initializeRedis();

        // Launch bot
        await bot.launch();
        global.logger.logInfo('🤖 Bot started successfully');

        // Enable graceful stop
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));

    } catch (error) {
        global.logger.logError('Failed to launch bot:', error);
        process.exit(1);
    }
};

// Start the bot
launchBot();