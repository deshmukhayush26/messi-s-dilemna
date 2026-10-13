// server/services/timerService.ts
import { db } from '../db';
import { EventTimer, TimerActionLog, TimerStatus } from '../types';
import crypto from 'node:crypto';

export class TimerService {
  /**
   * Retrieves current authoritative timer state.
   * Auto-detects countdown expiry and updates database state.
   */
  async getTimerState(): Promise<EventTimer> {
    const row = await db.queryOne('SELECT * FROM event_timer WHERE id = ?', ['global']);
    if (!row) {
      throw new Error('Event timer record not initialized in database.');
    }

    const now = Date.now();
    let currentStatus: TimerStatus = row.status as TimerStatus;
    let computedRemainingSec = row.remaining_duration_sec;

    if (currentStatus === 'running') {
      if (row.end_timestamp) {
        const endMs = new Date(row.end_timestamp).getTime();
        const diff = Math.floor((endMs - now) / 1000);

        if (diff <= 0) {
          // Timer naturally expired
          currentStatus = 'expired';
          computedRemainingSec = 0;

          const nowIso = new Date().toISOString();
          await db.execute(`
            UPDATE event_timer 
            SET status = 'expired', remaining_duration_sec = 0, last_updated_at = ?, version = version + 1
            WHERE id = 'global'
          `, [nowIso]);

          // Record auto-expiry in action log
          await this.logAction(
            'system',
            'auto_expire',
            0,
            'running',
            'expired',
            'Timer reached 0 seconds and expired automatically.'
          );
        } else {
          computedRemainingSec = diff;
        }
      }
    } else if (currentStatus === 'expired') {
      computedRemainingSec = 0;
    } else if (currentStatus === 'not_started') {
      computedRemainingSec = row.initial_duration_sec;
    } else if (currentStatus === 'paused') {
      computedRemainingSec = row.remaining_duration_sec;
    }

    return {
      id: row.id,
      status: currentStatus,
      initialDurationSec: row.initial_duration_sec,
      remainingDurationSec: row.remaining_duration_sec,
      startTimestamp: row.start_timestamp,
      endTimestamp: row.end_timestamp,
      lastUpdatedAt: row.last_updated_at,
      lastUpdatedBy: row.last_updated_by,
      version: row.version,
      remainingSeconds: computedRemainingSec,
    };
  }

  /**
   * Starts or resumes the event timer.
   */
  async startTimer(durationMinutes?: number, organizerName?: string): Promise<EventTimer> {
    const current = await this.getTimerState();
    const now = new Date();
    const nowIso = now.toISOString();
    const actor = organizerName || 'Lead Case Coordinator';

    let durationSec = current.remainingSeconds;
    const newStatus: TimerStatus = 'running';
    let actionName = 'start';

    if (current.status === 'not_started') {
      actionName = 'start';
      durationSec = (durationMinutes ? Math.round(durationMinutes * 60) : current.initialDurationSec) || 3600;
      const endIso = new Date(now.getTime() + durationSec * 1000).toISOString();

      await db.execute(`
        UPDATE event_timer
        SET status = 'running',
            initial_duration_sec = ?,
            remaining_duration_sec = ?,
            start_timestamp = ?,
            end_timestamp = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [durationSec, durationSec, nowIso, endIso, nowIso, actor]);
    } else if (current.status === 'paused') {
      actionName = 'resume';
      durationSec = Math.max(1, current.remainingDurationSec);
      const endIso = new Date(now.getTime() + durationSec * 1000).toISOString();

      await db.execute(`
        UPDATE event_timer
        SET status = 'running',
            end_timestamp = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [endIso, nowIso, actor]);
    } else if (current.status === 'expired') {
      actionName = 'restart';
      durationSec = (durationMinutes ? Math.round(durationMinutes * 60) : current.initialDurationSec) || 1800;
      const endIso = new Date(now.getTime() + durationSec * 1000).toISOString();

      await db.execute(`
        UPDATE event_timer
        SET status = 'running',
            remaining_duration_sec = ?,
            start_timestamp = ?,
            end_timestamp = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [durationSec, nowIso, endIso, nowIso, actor]);
    } else {
      // Already running; if custom duration requested, update remaining
      if (durationMinutes && durationMinutes > 0) {
        durationSec = Math.round(durationMinutes * 60);
        const endIso = new Date(now.getTime() + durationSec * 1000).toISOString();
        await db.execute(`
          UPDATE event_timer
          SET end_timestamp = ?,
              remaining_duration_sec = ?,
              last_updated_at = ?,
              last_updated_by = ?,
              version = version + 1
          WHERE id = 'global'
        `, [endIso, durationSec, nowIso, actor]);
        actionName = 'adjust_duration';
      }
    }

    await this.logAction(actor, actionName, 0, current.status, newStatus, `Timer set to ${Math.round(durationSec / 60)} minutes.`);
    return this.getTimerState();
  }

  /**
   * Pauses the timer and freezes remaining seconds.
   */
  async stopTimer(organizerName?: string): Promise<EventTimer> {
    const current = await this.getTimerState();
    if (current.status !== 'running') {
      return current; // already stopped / paused
    }

    const nowIso = new Date().toISOString();
    const frozenSec = Math.max(0, current.remainingSeconds);
    const actor = organizerName || 'Lead Case Coordinator';

    await db.execute(`
      UPDATE event_timer
      SET status = 'paused',
          remaining_duration_sec = ?,
          end_timestamp = NULL,
          last_updated_at = ?,
          last_updated_by = ?,
          version = version + 1
      WHERE id = 'global'
    `, [frozenSec, nowIso, actor]);

    await this.logAction(actor, 'stop', 0, current.status, 'paused', `Timer paused with ${Math.round(frozenSec / 60)}m ${frozenSec % 60}s remaining.`);
    return this.getTimerState();
  }

  /**
   * Alias for stopTimer (pauses the timer).
   */
  async pauseTimer(organizerName?: string): Promise<EventTimer> {
    return this.stopTimer(organizerName);
  }

  /**
   * Resumes a paused timer.
   */
  async resumeTimer(organizerName?: string): Promise<EventTimer> {
    return this.startTimer(undefined, organizerName);
  }

  /**
   * Adds additional time (in minutes) to the event countdown.
   */
  async addTime(arg1: number | string, arg2?: string | number): Promise<EventTimer> {
    let minutes: number;
    let actor: string;

    if (typeof arg1 === 'number') {
      minutes = arg1;
      actor = typeof arg2 === 'string' ? arg2 : 'Lead Case Coordinator';
    } else if (typeof arg2 === 'number') {
      minutes = arg2;
      actor = arg1 || 'Lead Case Coordinator';
    } else {
      minutes = Number(arg1) || 15;
      actor = String(arg2 || 'Lead Case Coordinator');
    }

    if (!minutes || minutes <= 0 || isNaN(minutes)) {
      throw new Error('Additional duration must be greater than zero minutes.');
    }

    const current = await this.getTimerState();
    const addSec = Math.round(minutes * 60);
    const now = new Date();
    const nowIso = now.toISOString();

    let newStatus: TimerStatus = current.status;

    if (current.status === 'running') {
      const parsedEnd = current.endTimestamp ? new Date(current.endTimestamp).getTime() : NaN;
      const baseMs = !isNaN(parsedEnd) ? parsedEnd : now.getTime();
      const newEndIso = new Date(baseMs + addSec * 1000).toISOString();
      const updatedRemaining = Math.max(0, Math.floor((new Date(newEndIso).getTime() - now.getTime()) / 1000));

      await db.execute(`
        UPDATE event_timer
        SET end_timestamp = ?,
            remaining_duration_sec = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [newEndIso, updatedRemaining, nowIso, actor]);
    } else if (current.status === 'paused') {
      const newRemaining = current.remainingDurationSec + addSec;
      await db.execute(`
        UPDATE event_timer
        SET remaining_duration_sec = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [newRemaining, nowIso, actor]);
    } else if (current.status === 'not_started') {
      const newDuration = current.initialDurationSec + addSec;
      await db.execute(`
        UPDATE event_timer
        SET initial_duration_sec = ?,
            remaining_duration_sec = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [newDuration, newDuration, nowIso, actor]);
    } else if (current.status === 'expired') {
      newStatus = 'running';
      const endIso = new Date(now.getTime() + addSec * 1000).toISOString();

      await db.execute(`
        UPDATE event_timer
        SET status = 'running',
            remaining_duration_sec = ?,
            start_timestamp = ?,
            end_timestamp = ?,
            last_updated_at = ?,
            last_updated_by = ?,
            version = version + 1
        WHERE id = 'global'
      `, [addSec, nowIso, endIso, nowIso, actor]);
    }

    await this.logAction(actor, 'add_time', addSec, current.status, newStatus, `Added ${minutes} minutes to event timer.`);
    return this.getTimerState();
  }

  /**
   * Resets the event timer back to not_started with a default or configured duration.
   */
  async resetTimer(organizerName?: string, durationMinutes: number = 60): Promise<EventTimer> {
    const current = await this.getTimerState();
    const durationSec = Math.max(60, Math.round(durationMinutes * 60));
    const nowIso = new Date().toISOString();
    const actor = organizerName || 'Lead Case Coordinator';

    await db.execute(`
      UPDATE event_timer
      SET status = 'not_started',
          initial_duration_sec = ?,
          remaining_duration_sec = ?,
          start_timestamp = NULL,
          end_timestamp = NULL,
          last_updated_at = ?,
          last_updated_by = ?,
          version = version + 1
      WHERE id = 'global'
    `, [durationSec, durationSec, nowIso, actor]);

    await this.logAction(actor, 'reset', 0, current.status, 'not_started', `Timer reset with initial duration of ${durationMinutes} minutes.`);
    return this.getTimerState();
  }

  /**
   * Verifies if deck submissions are currently permitted under authoritative timer rules.
   */
  async checkSubmissionAllowed(): Promise<{ allowed: boolean; reason?: string; remainingSeconds: number; status: TimerStatus }> {
    const timer = await this.getTimerState();

    if (timer.status === 'not_started') {
      return {
        allowed: false,
        reason: 'Event timer has not started yet. Deck submissions are not currently open.',
        remainingSeconds: timer.remainingSeconds,
        status: timer.status,
      };
    }

    if (timer.status === 'paused') {
      return {
        allowed: false,
        reason: 'Submissions are temporarily paused by the event organizers.',
        remainingSeconds: timer.remainingSeconds,
        status: timer.status,
      };
    }

    if (timer.status === 'expired' || timer.remainingSeconds <= 0) {
      return {
        allowed: false,
        reason: 'The submission window has closed. The event timer has expired.',
        remainingSeconds: 0,
        status: 'expired',
      };
    }

    return {
      allowed: true,
      remainingSeconds: timer.remainingSeconds,
      status: timer.status,
    };
  }

  /**
   * Retrieves the timer action audit log.
   */
  async getTimerActionLogs(): Promise<TimerActionLog[]> {
    const rows = await db.query(`
      SELECT * FROM timer_action_log ORDER BY timestamp DESC LIMIT 100
    `);

    return rows.map((r) => ({
      id: r.id,
      organizerId: r.organizer_id,
      action: r.action,
      durationAddedSec: r.duration_added_sec,
      previousState: r.previous_state as TimerStatus,
      newState: r.new_state as TimerStatus,
      timestamp: r.timestamp,
      notes: r.notes,
    }));
  }

  async getActionLogs(): Promise<TimerActionLog[]> {
    return this.getTimerActionLogs();
  }

  private async logAction(
    organizerId: string,
    action: string,
    durationAddedSec: number,
    previousState: TimerStatus,
    newState: TimerStatus,
    notes?: string
  ): Promise<void> {
    const logId = `tlog_${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    await db.execute(`
      INSERT INTO timer_action_log (
        id, organizer_id, action, duration_added_sec, previous_state, new_state, timestamp, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [logId, organizerId, action, durationAddedSec, previousState, newState, nowIso, notes || null]);
  }
}

export const activeTimerService = new TimerService();
