/**
 * Background Worker for scheduled tasks
 * Run with: npx tsx scripts/worker.ts
 * Or add to PM2 ecosystem.config.cjs
 */

import { pool } from '../src/lib/db';
import { sendPushToUser } from '../src/lib/push';
import { processBroadcasts } from '../src/lib/broadcasts/worker';
import { registerQueueWorkers, closeQueueWorkers, isQueueEnabled } from '../src/lib/queue';

interface ScheduledTask {
  name: string;
  interval: number; // milliseconds
  handler: () => Promise<void>;
}

const tasks: ScheduledTask[] = [
  {
    name: 'cleanup-expired-otps',
    interval: 60 * 60 * 1000, // 1 hour
    handler: cleanupExpiredOtps,
  },
  {
    name: 'cleanup-old-notifications',
    interval: 24 * 60 * 60 * 1000, // 24 hours
    handler: cleanupOldNotifications,
  },
  {
    name: 'send-daily-digest',
    interval: 24 * 60 * 60 * 1000, // 24 hours
    handler: sendDailyDigest,
  },
  {
    name: 'check-pending-orders',
    interval: 5 * 60 * 1000, // 5 minutes
    handler: checkPendingOrders,
  },
  {
    name: 'process-broadcasts',
    interval: 60 * 1000, // 1 minute
    handler: processBroadcasts,
  },
  {
    // Phase 2 / P1: coupons auto-expire by `expires_at`, but the read-time
    // filter is the only thing that hides them — the row stays
    // `is_active=true` forever, which inflates analytics. Flip to
    // `is_active=false` on a 1-hour cadence (matches cleanupExpiredOtps).
    name: 'deactivate-expired-coupons',
    interval: 60 * 60 * 1000, // 1 hour
    handler: deactivateExpiredCoupons,
  },
];

async function cleanupExpiredOtps(): Promise<void> {
  console.log('[Worker] Cleaning up expired OTPs...');
  try {
    const result = await pool.query(
      'DELETE FROM user_otps WHERE expires_at < NOW() - INTERVAL \'1 hour\''
    );
    console.log(`[Worker] Deleted ${result.rowCount} expired OTPs`);
  } catch (error) {
    console.error('[Worker] Failed to cleanup OTPs:', error);
  }
}

async function cleanupOldNotifications(): Promise<void> {
  console.log('[Worker] Cleaning up old notifications...');
  try {
    const result = await pool.query(
      'DELETE FROM notifications WHERE created_at < NOW() - INTERVAL \'30 days\' AND is_read = TRUE'
    );
    console.log(`[Worker] Deleted ${result.rowCount} old notifications`);
  } catch (error) {
    console.error('[Worker] Failed to cleanup notifications:', error);
  }
}

async function sendDailyDigest(): Promise<void> {
  console.log('[Worker] Sending daily digest...');
  try {
    // Get users with active push subscriptions who ordered in last 7 days
    const users = await pool.query(`
      SELECT DISTINCT u.id, u.name
      FROM users u
      INNER JOIN push_subscriptions ps ON ps.user_id = u.id
      INNER JOIN orders o ON o.user_id = u.id
      WHERE o.created_at > NOW() - INTERVAL '7 days'
      AND o.created_at < NOW() - INTERVAL '1 day'
    `);

    for (const user of users.rows) {
      await sendPushToUser(user.id, {
        title: 'مرحباً بك من جديد! 🛒',
        body: 'لم تتصفح طلباتك اليوم؟ تحقق من عروضنا الجديدة!',
        url: '/catalog',
        tag: 'daily-digest',
      });
    }
    console.log(`[Worker] Sent daily digest to ${users.rows.length} users`);
  } catch (error) {
    console.error('[Worker] Failed to send daily digest:', error);
  }
}

async function checkPendingOrders(): Promise<void> {
  console.log('[Worker] Checking pending orders...');
  try {
    // Find orders stuck in 'pending' status for more than 30 minutes
    const pendingOrders = await pool.query(`
      SELECT o.id, o.user_id
      FROM orders o
      WHERE o.status = 'pending'
      AND o.created_at < NOW() - INTERVAL '30 minutes'
      AND o.payment_status = 'pending'
    `);

    for (const order of pendingOrders.rows) {
      // Send reminder to complete payment
      await sendPushToUser(order.user_id, {
        title: 'لديك طلب معلق! ⏰',
        body: 'لم تكتمل عملية الدفع. أكمل طلبك الآن!',
        url: `/orders/${order.id}`,
        tag: 'pending-order',
      });
    }
    console.log(`[Worker] Checked ${pendingOrders.rows.length} pending orders`);
  } catch (error) {
    console.error('[Worker] Failed to check pending orders:', error);
  }
}

async function deactivateExpiredCoupons(): Promise<void> {
  console.log('[Worker] Deactivating expired coupons…');
  try {
    // Mirrors the read-time filter in /api/v1/coupons + analytics queries:
    //   WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())
    // Only flips rows that still claim to be active; never touches
    // already-deactivated or no-expiry rows.
    const result = await pool.query(
      `UPDATE coupons
          SET is_active = false
        WHERE is_active = true
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        RETURNING id`
    );
    console.log(`[Worker] Deactivated ${result.rowCount ?? 0} expired coupons`);
  } catch (error) {
    console.error('[Worker] Failed to deactivate expired coupons:', error);
  }
}

async function runWorker(): Promise<void> {
  console.log('[Worker] Starting background worker...');

  // Phase 10.8: register BullMQ workers for queued notifications.
  // When REDIS_URL is unset, this is a no-op and the enqueue helpers
  // fall back to synchronous execution.
  if (isQueueEnabled()) {
    const result = registerQueueWorkers();
    console.log(
      `[Worker] Registered ${result.workers} queue worker(s) for ` +
        `${result.queues} queue(s) (Redis-backed).`,
    );
  } else {
    console.log(
      '[Worker] Queue disabled (REDIS_URL not set). Notifications will run synchronously.',
    );
  }

  // Run each task on its own interval
  for (const task of tasks) {
    // Run immediately on startup
    try {
      await task.handler();
    } catch (error) {
      console.error(`[Worker] ${task.name} failed:`, error);
    }
    
    // Then run on interval
    setInterval(async () => {
      try {
        await task.handler();
      } catch (error) {
        console.error(`[Worker] ${task.name} failed:`, error);
      }
    }, task.interval);
  }

  console.log('[Worker] All tasks scheduled. Press Ctrl+C to stop.');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down...');
  await closeQueueWorkers();
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Received SIGTERM...');
  await closeQueueWorkers();
  await pool.end();
  process.exit(0);
});

// Start the worker
runWorker().catch((error) => {
  console.error('[Worker] Fatal error:', error);
  process.exit(1);
});
