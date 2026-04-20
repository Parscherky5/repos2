import { Context, MiddlewareFn } from 'telegraf';
import { userService } from '../services/UserService';
import { rateLimitCheck, isEmergencyStopActive } from '../redis';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Automatically registers (or updates) a Telegram user in the database
 * on every incoming update that has a `from` field.
 */
export function userRegistrationMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (from) {
      try {
        await userService.getOrCreate(
          String(from.id),
          from.username ?? null,
          from.first_name
        );
      } catch (err) {
        logger.error('User registration middleware error', {
          userId: from.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return next();
  };
}

/**
 * Blocks banned users from interacting with the bot.
 */
export function bannedUserMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();

    try {
      const banned = await userService.isBanned(String(from.id));
      if (banned) {
        await ctx.reply('🚫 You have been banned from using this service.');
        return;
      }
    } catch (err) {
      logger.error('Banned-user middleware error', {
        userId: from.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return next();
  };
}

/**
 * Simple Redis-backed rate limiter: max 30 messages per user per 60 seconds.
 * Falls back to allowing the request when Redis is unavailable.
 */
export function rateLimitMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();

    const allowed = await rateLimitCheck(`rate:${from.id}`, 30, 60);
    if (!allowed) {
      await ctx.reply('⏳ You are sending messages too quickly. Please slow down.');
      return;
    }

    return next();
  };
}

/**
 * Global emergency stop middleware.
 * Admins always pass through; non-admins are blocked when emergency stop is active.
 */
export function emergencyStopMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = String(ctx.from?.id);
    const adminIds = config.bot.adminIds as string[];
    if (adminIds.includes(userId)) return next();

    const active = await isEmergencyStopActive();
    if (active) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('⛔ Sistem şu an bakımda.').catch(() => {});
        return;
      }
      await ctx.reply('🔧 Sistem şu an bakımda. Lütfen daha sonra tekrar deneyin.').catch(() => {});
      return;
    }
    return next();
  };
}

