import crypto from "node:crypto";

import { getDatabase } from "../db/connection.js";
import { getScoreSourceMode } from "../repositories/score-source-mode-repository.js";
import { ScoreService } from "./score-service.js";

type ScheduledMatch = {
  id: string;
  startsAt: string;
  status: string;
  sportSlug: string;
  competitionName: string;
  homeName: string;
  awayName: string;
};

type RunningClock = {
  matchId: string;
  startsAt: string;
  phase: string;
  running: number;
  runningSince: string | null;
  elapsedSeconds: number;
  firstHalfAddedMinutes: number | null;
  secondHalfAddedMinutes: number | null;
  scoreStatus: string;
  competitionName: string;
  homeName: string;
  awayName: string;
};

const kickoffReminderMinutes = [60, 30, 0] as const;
const schedulerIntervalMs = 15_000;

function recordNotification(matchId: string, eventKey: string, eventType: string, title: string, message: string, eventAt: string, createdAt: string) {
  getDatabase().prepare(`
    INSERT OR IGNORE INTO match_score_operator_notifications
      (id, match_id, event_key, event_type, title, message, event_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), matchId, eventKey, eventType, title, message, eventAt, createdAt);
}

function startMatchAtKickoff(match: ScheduledMatch, now: Date): boolean {
  if (getScoreSourceMode() !== "manual") return false;
  const db = getDatabase();
  const createdAt = now.toISOString();
  let transactionOpen = false;
  db.exec("BEGIN IMMEDIATE;");
  transactionOpen = true;
  try {
    if (getScoreSourceMode() !== "manual") {
      db.exec("ROLLBACK;");
      transactionOpen = false;
      return false;
    }
    const current = db.prepare(`
      SELECT m.status, m.starts_at AS startsAt, s.slug AS sportSlug
      FROM matches m JOIN competitions c ON c.id=m.competition_id
      JOIN sports s ON s.id=c.sport_id WHERE m.id=?
    `).get(match.id) as { status: string; startsAt: string; sportSlug: string } | undefined;
    if (!current || !["scheduled", "approved", "published"].includes(current.status)
      || !["football", "soccer"].includes(current.sportSlug.trim().toLowerCase())
      || !current.startsAt.includes("T") || Date.parse(current.startsAt) > now.getTime()
      || db.prepare("SELECT 1 FROM match_score_state WHERE match_id=?").get(match.id)) {
      db.exec("ROLLBACK;");
      transactionOpen = false;
      return false;
    }

    const before = { score: null, clock: null, canonicalStatus: current.status };
    const score = { homeScore: 0, awayScore: 0, status: "live", version: 1, finalResultConfirmed: false };
    const clock = { phase: "first_half", running: true, runningSince: current.startsAt, elapsedSeconds: 0, version: 1 };
    db.prepare(`INSERT INTO match_score_state
      (id,match_id,home_score,away_score,status,final_result_confirmed,version,updated_by_operator_id,last_confirmed_at,created_at,updated_at)
      VALUES (?,?,0,0,'live',0,1,NULL,NULL,?,?)`).run(crypto.randomUUID(), match.id, createdAt, createdAt);
    db.prepare(`INSERT INTO match_score_clock_state
      (match_id,phase,is_running,running_since,elapsed_seconds,version,updated_by_operator_id,created_at,updated_at)
      VALUES (?,'first_half',1,?,0,1,NULL,?,?)`).run(match.id, current.startsAt, createdAt, createdAt);
    db.prepare(`INSERT INTO match_score_audit
      (id,match_id,action,operator_id,previous_version,new_version,previous_home_score,previous_away_score,new_home_score,new_away_score,previous_status,new_status,previous_final_result_confirmed,new_final_result_confirmed,reason,metadata,created_at)
      VALUES (?,?, 'score_updated',NULL,0,1,NULL,NULL,0,0,NULL,'live',0,0,NULL,?,?)`)
      .run(crypto.randomUUID(), match.id, JSON.stringify({ operation: "automatic_kickoff_start", actor: "system", scheduledKickoff: current.startsAt }), createdAt);
    db.prepare(`INSERT INTO match_score_system_audit (id,match_id,action,previous_state,new_state,created_at) VALUES (?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), match.id, "automatic_kickoff_start", JSON.stringify(before), JSON.stringify({ score, clock, scheduledKickoff: current.startsAt }), createdAt);
    db.prepare(`INSERT OR IGNORE INTO match_score_operator_notifications
      (id,match_id,event_key,event_type,title,message,event_at,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), match.id, "match_started", "match_started",
      "Match started automatically", `${match.homeName} vs ${match.awayName} · ${match.competitionName}`,
      current.startsAt, createdAt);
    db.exec("COMMIT;");
    transactionOpen = false;
    ScoreService.notifyManualScoreUpdate(match.id, 1);
    return true;
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK;");
    throw error;
  }
}

function processKickoffReminders(matches: ScheduledMatch[], now: Date) {
  for (const match of matches) {
    const kickoff = Date.parse(match.startsAt);
    if (!Number.isFinite(kickoff)) continue;
    if (getDatabase().prepare("SELECT 1 FROM match_score_state WHERE match_id=?").get(match.id)) continue;
    const teams = `${match.homeName} vs ${match.awayName}`;
    for (const minutes of kickoffReminderMinutes) {
      const reminderAt = kickoff - minutes * 60_000;
      if (now.getTime() < reminderAt) continue;
      const eventKey = `kickoff_${minutes}_minutes`;
      const title = minutes === 0 ? "Kickoff time" : `Kickoff in ${minutes} minutes`;
      recordNotification(match.id, eventKey, eventKey, title, `${teams} · ${match.competitionName}`, new Date(reminderAt).toISOString(), now.toISOString());
    }
  }
}

function processClockMilestones(clocks: RunningClock[], now: Date) {
  const nowMs = now.getTime();
  for (const clock of clocks) {
    const elapsed = Number(clock.elapsedSeconds) + (clock.running && clock.runningSince
      ? Math.max(0, Math.floor((nowMs - Date.parse(clock.runningSince)) / 1000)) : 0);
    const teamNames = `${clock.homeName} vs ${clock.awayName}`;
    const emit = (key: string, title: string, offsetSeconds: number) => {
      const eventAt = new Date(nowMs - Math.max(0, elapsed - offsetSeconds) * 1000).toISOString();
      recordNotification(clock.matchId, key, key, title, `${teamNames} · ${clock.competitionName}`, eventAt, now.toISOString());
    };

    if (!["live", "paused"].includes(clock.scoreStatus) || !["first_half", "second_half", "paused"].includes(clock.phase)) continue;
    if ((clock.phase === "first_half" || (clock.phase === "paused" && elapsed < 2700)) && clock.firstHalfAddedMinutes === null) {
      if (elapsed >= 2100) emit("first_half_added_time_10m", "10 minutes to first-half added time", 2100);
      if (elapsed >= 2400) emit("first_half_added_time_5m", "5 minutes to first-half added time", 2400);
      if (elapsed >= 2700) emit("first_half_added_time_due", "45 minutes played · set added time", 2700);
    }
    const secondHalfEnd = 5400 + Number(clock.firstHalfAddedMinutes ?? 0) * 60;
    if ((clock.phase === "second_half" || clock.phase === "paused") && clock.secondHalfAddedMinutes === null) {
      if (elapsed >= secondHalfEnd - 600) emit("second_half_added_time_10m", "10 minutes to second-half added time", secondHalfEnd - 600);
      if (elapsed >= secondHalfEnd - 300) emit("second_half_added_time_5m", "5 minutes to second-half added time", secondHalfEnd - 300);
      if (elapsed >= secondHalfEnd) emit("second_half_added_time_due", "Second-half regulation time reached · set added time", secondHalfEnd);
    }
  }
}

/**
 * Reconcile one canonical fixture when a client reads it at/after kickoff.
 * The background scheduler remains the primary timer; this closes the short
 * startup/tick gap and ensures a sleeping backend starts the match on its
 * first fixture read without requiring an operator action.
 */
export function ensureManualScoreStartedAtKickoff(matchId: string, now = new Date()): boolean {
  if (getScoreSourceMode() !== "manual") return false;
  const match = getDatabase().prepare(`
    SELECT m.id, m.starts_at AS startsAt, m.status, lower(s.slug) AS sportSlug,
      c.name AS competitionName, h.name AS homeName, a.name AS awayName
    FROM matches m JOIN competitions c ON c.id=m.competition_id
    JOIN sports s ON s.id=c.sport_id JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id
    WHERE m.id=? AND m.status IN ('scheduled','approved','published') AND instr(m.starts_at,'T') > 0
  `).get(matchId) as ScheduledMatch | undefined;
  if (!match || Date.parse(match.startsAt) > now.getTime()
    || !["football", "soccer"].includes(match.sportSlug.trim().toLowerCase())) return false;
  return startMatchAtKickoff(match, now);
}

export function ensureDueManualScoreStartsAtKickoff(now = new Date()): string[] {
  if (getScoreSourceMode() !== "manual") return [];
  const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const due = getDatabase().prepare(`
    SELECT m.id FROM matches m
    WHERE m.status IN ('scheduled','approved','published') AND instr(m.starts_at,'T') > 0
      AND julianday(m.starts_at) BETWEEN julianday(?) AND julianday(?)
  `).all(from, now.toISOString()) as Array<{ id: string }>;
  return due.filter(({ id }) => ensureManualScoreStartedAtKickoff(id, now)).map(({ id }) => id);
}

export function runManualScoreAutomationOnce(now = new Date()) {
  const db = getDatabase();
  const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const matches = db.prepare(`
    SELECT m.id, m.starts_at AS startsAt, m.status, lower(s.slug) AS sportSlug,
      c.name AS competitionName, h.name AS homeName, a.name AS awayName
    FROM matches m JOIN competitions c ON c.id=m.competition_id
    JOIN sports s ON s.id=c.sport_id JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id
    WHERE m.status IN ('scheduled','approved','published') AND instr(m.starts_at,'T') > 0
      AND julianday(m.starts_at) BETWEEN julianday(?) AND julianday(?)
  `).all(from, to) as ScheduledMatch[];

  processKickoffReminders(matches, now);
  const started: string[] = [];
  if (getScoreSourceMode() === "manual") {
    for (const match of matches) {
      if (Date.parse(match.startsAt) > now.getTime() || !["football", "soccer"].includes(match.sportSlug)) continue;
      try { if (startMatchAtKickoff(match, now)) started.push(match.id); }
      catch (error) { console.error("[manual-score-scheduler] kickoff start failed", match.id, error); }
    }
  }

  const clocks = db.prepare(`
    SELECT ms.match_id AS matchId, m.starts_at AS startsAt, cs.phase, cs.is_running AS running,
      cs.running_since AS runningSince, cs.elapsed_seconds AS elapsedSeconds,
      cs.first_half_added_minutes AS firstHalfAddedMinutes, cs.second_half_added_minutes AS secondHalfAddedMinutes,
      ms.status AS scoreStatus, c.name AS competitionName, h.name AS homeName, a.name AS awayName
    FROM match_score_clock_state cs JOIN match_score_state ms ON ms.match_id=cs.match_id
    JOIN matches m ON m.id=cs.match_id JOIN competitions c ON c.id=m.competition_id
    JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id
    JOIN sports s ON s.id=c.sport_id
    WHERE lower(s.slug) IN ('football','soccer') AND ms.status IN ('live','paused')
      AND cs.phase IN ('first_half','second_half','paused')
  `).all() as RunningClock[];
  processClockMilestones(clocks, now);
  return { startedMatchIds: started, pendingReminderCandidates: matches.length };
}

export function startManualScoreScheduler() {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    try { runManualScoreAutomationOnce(); }
    catch (error) { console.error("[manual-score-scheduler] cycle failed", error); }
    finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, schedulerIntervalMs);
  timer.unref?.();
  console.log(`[startup] manual score automation running every ${schedulerIntervalMs / 1000}s`);
  return timer;
}
