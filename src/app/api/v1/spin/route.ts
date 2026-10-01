import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { getCustomerUserIdFromRequest } from '@/lib/identity';

import { error as logError } from '@/lib/logger';

interface SpinResult {
  id: string;
  prize_type: string;
  prize_value: number;
  is_winner: boolean;
}

interface SpinData {
  can_spin: boolean;
  remaining_spins: number;
  last_result: SpinResult | null;
}

// Prizes configuration
const PRIZES = [
  { value: 50, weight: 30 },   // 50 points - 30%
  { value: 100, weight: 20 },  // 100 points - 20%
  { value: 20, weight: 20 },   // 20 points - 20%
  { value: 75, weight: 15 },   // 75 points - 15%
  { value: 30, weight: 10 },   // 30 points - 10%
  { value: 150, weight: 3 },   // 150 points - 3%
  { value: 200, weight: 1 },  // 200 points - 1%
  { value: 10, weight: 1 },   // 10 points - 1%
];

function getRandomPrize() {
  const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
  // SECURITY: weighted-random must use a CSPRNG. `Math.random()` is
  // predictable and would let a determined client pick the highest-value
  // outcome every time. `crypto.randomInt` is a uniform random over
  // `[min, max)` sourced from /dev/urandom.
  let remaining = crypto.randomInt(0, totalWeight);

  for (const prize of PRIZES) {
    remaining -= prize.weight;
    if (remaining <= 0) {
      return prize.value;
    }
  }
  return PRIZES[0].value;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getCustomerUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get spin count info
    const userResult = await query(
      `SELECT spin_count_today, last_spin_at FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userResult.rows[0];
    const today = new Date().toDateString();
    const lastSpinDate = user.last_spin_at
      ? new Date(user.last_spin_at).toDateString()
      : null;

    // Reset count if new day
    let remainingSpins = 0;
    if (lastSpinDate !== today) {
      remainingSpins = 3; // 3 spins per day
    } else {
      remainingSpins = Math.max(0, 3 - user.spin_count_today);
    }

    // Get last result
    const lastResult = await query(
      `SELECT id, prize_type, prize_value, is_winner, created_at
       FROM spin_results
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const response: SpinData = {
      can_spin: remainingSpins > 0,
      remaining_spins: remainingSpins,
      last_result: lastResult.rows[0]?.created_at
        ? {
            id: lastResult.rows[0].id,
            prize_type: lastResult.rows[0].prize_type,
            prize_value: lastResult.rows[0].prize_value,
            is_winner: lastResult.rows[0].is_winner,
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    logError('Spin GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get spin data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCustomerUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user can spin
    const userResult = await query(
      `SELECT spin_count_today, last_spin_at FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userResult.rows[0];
    const today = new Date().toDateString();
    const lastSpinDate = user.last_spin_at
      ? new Date(user.last_spin_at).toDateString()
      : null;

    let canSpin = false;
    if (lastSpinDate !== today) {
      canSpin = true;
    } else if (user.spin_count_today < 3) {
      canSpin = true;
    }

    if (!canSpin) {
      return NextResponse.json(
        { success: false, error: 'No spins remaining today' },
        { status: 400 }
      );
    }

    // Determine prize
    const prizeValue = getRandomPrize();
    const isWinner = prizeValue >= 50; // Only 50+ points count as "wins"

    // Save spin result
    const result = await query(
      `INSERT INTO spin_results (user_id, prize_type, prize_value, is_winner)
       VALUES ($1, $2, $3, $4)
       RETURNING id, prize_type, prize_value, is_winner`,
      [userId, 'points', prizeValue, isWinner]
    );

    // Update user spin count and add points if won
    if (lastSpinDate !== today) {
      // New day, reset count
      await query(
        `UPDATE users 
         SET spin_count_today = 1, 
             last_spin_at = NOW(),
             loyalty_points = loyalty_points + $1
         WHERE id = $2`,
        [prizeValue, userId]
      );
    } else {
      await query(
        `UPDATE users 
         SET spin_count_today = spin_count_today + 1,
             loyalty_points = loyalty_points + $1
         WHERE id = $2`,
        [prizeValue, userId]
      );
    }

    // Log loyalty transaction
    await query(
      `INSERT INTO loyalty_transactions (user_id, points, type, reason)
       VALUES ($1, $2, 'earn', 'عجلة الحظ')`,
      [userId, prizeValue]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: result.rows[0].id,
        prize_type: result.rows[0].prize_type,
        prize_value: result.rows[0].prize_value,
        is_winner: result.rows[0].is_winner,
      },
    });
  } catch (error) {
    logError('Spin POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to spin' },
      { status: 500 }
    );
  }
}
