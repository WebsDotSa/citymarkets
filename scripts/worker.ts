/**
 * Background Worker for scheduled tasks
 * Run with: npx tsx scripts/worker.ts
 * Or add to PM2 ecosystem.config.cjs
 */

import { pool } from '../src/lib/db';
import { sendPushToUser } from '../src/lib/push';
import { processBroadcasts } from '../src/lib/broadcasts/worker';
import { cleanupOldPageViews } from '../src/lib/analytics/page-views-retention';
import { deleteFromR2, r2KeyFromUrl } from '../src/lib/r2';
// Deep-import (NOT the @/lib/queue barrel) because the barrel starts
// with `import "server-only"` which throws when the file is loaded by
// plain tsx outside of Next.js — the worker is a long-lived Node
// process, not an App-Router route. See src/lib/queue/index.ts.
import { registerQueueWorkers, closeQueueWorkers } from '../src/lib/queue/workers';
import { isQueueEnabled } from '../src/lib/queue/redis';

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
  {
    // PCP-148: page_views is append-only analytics at ~120 rows/day with
    // 7 indexes. Without a retention policy it grows to ~28 MB in a year.
    // Window is read from public.page_views_retention_days() (default 90
    // days) so future tuning is a one-line migration, not a code change.
    name: 'cleanup-old-page-views',
    interval: 24 * 60 * 60 * 1000, // 24 hours
    handler: cleanupOldPageViewsTask,
  },
  {
    // Direct order voice note cleanup: delete files from R2 after 3 days
    // and null the URLs so they're not accessible on the order detail page.
    name: 'cleanup-voice-notes',
    interval: 60 * 60 * 1000, // 1 hour
    handler: cleanupVoiceNotes,
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
  // The `notifications` table was dropped in migration 093 (orphan
  // cleanup) but this function still references it. Guard with a
  // information_schema check so the worker doesn't spam errors
  // every cycle; remove this function entirely if notifications
  // are confirmed gone for good.
  console.log('[Worker] Cleaning up old notifications...');
  try {
    const exists = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications' LIMIT 1"
    );
    if (exists.rowCount === 0) {
      console.log('[Worker] notifications table gone (migration 093) — skipping');
      return;
    }
    const result = await pool.query(
      "DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days' AND is_read = TRUE"
    );
    console.log(`[Worker] Deleted ${result.rowCount} old notifications`);
  } catch (error) {
    console.error('[Worker] Failed to cleanup notifications:', error);
  }
}

async function cleanupOldPageViewsTask(): Promise<void> {
  console.log('[Worker] Cleaning up old page views...');
  try {
    const result = await cleanupOldPageViews();
    console.log(
      `[Worker] Deleted ${result.deleted} page_views older than ${result.retentionDays} days (cutoff=${result.cutoffIso})`
    );
  } catch (error) {
    console.error('[Worker] Failed to cleanup page views:', error);
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

async function cleanupVoiceNotes(): Promise<void> {
  console.log('[Worker] Cleaning up old voice notes…');
  try {
    // Find direct orders (type='direct') that were delivered or cancelled
    // more than 3 days ago by checking order_status_logs.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);

    const ordersToCleanup = await pool.query(
      `SELECT DISTINCT o.id, o.voice_note_url
       FROM orders o
       WHERE o.type = 'direct'
         AND o.voice_note_url IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM order_status_logs osl
           WHERE osl.order_id = o.id
             AND osl.new_status IN ('delivered', 'cancelled')
             AND osl.created_at < $1
         )`,
      [cutoff]
    );

    let deletedCount = 0;
    for (const order of ordersToCleanup.rows) {
      try {
        // Delete from R2
        if (order.voice_note_url) {
          const key = r2KeyFromUrl(order.voice_note_url);
          if (key) {
            await deleteFromR2(key);
          }
        }
        // Null the URL in the database
        await pool.query(
          'UPDATE orders SET voice_note_url = NULL WHERE id = $1',
          [order.id]
        );
        deletedCount++;
      } catch (err) {
        console.error(`[Worker] Failed to cleanup voice note for order ${order.id}:`, err);
      }
    }

    // Also cleanup direct_order_messages audio
    const messagesToCleanup = await pool.query(
      `SELECT DISTINCT dom.id, dom.audio_url
       FROM direct_order_messages dom
       WHERE dom.audio_url IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM order_status_logs osl
           WHERE osl.order_id = dom.order_id
             AND osl.new_status IN ('delivered', 'cancelled')
             AND osl.created_at < $1
         )`,
      [cutoff]
    );

    for (const msg of messagesToCleanup.rows) {
      try {
        const key = r2KeyFromUrl(msg.audio_url);
        if (key) {
          await deleteFromR2(key);
        }
        await pool.query(
          'UPDATE direct_order_messages SET audio_url = NULL WHERE id = $1',
          [msg.id]
        );
        deletedCount++;
      } catch (err) {
        console.error(`[Worker] Failed to cleanup message audio ${msg.id}:`, err);
      }
    }

    console.log(`[Worker] Cleaned up ${deletedCount} voice notes older than 3 days`);
  } catch (error) {
    console.error('[Worker] Failed to cleanup voice notes:', error);
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
