export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getTimeZoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function localDateTimeToUtc(date: string, time: string, timeZone = getBrowserTimeZone()): string | undefined {
  if (!date || !time) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(`${date}T${time}`);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const localParts = getTimeZoneParts(new Date(localAsUtc), timeZone);
  const firstOffset = Date.UTC(localParts.year, localParts.month - 1, localParts.day, localParts.hour, localParts.minute, localParts.second) - localAsUtc;
  const candidate = new Date(localAsUtc - firstOffset);
  const correctedParts = getTimeZoneParts(candidate, timeZone);
  const correctedOffset = Date.UTC(correctedParts.year, correctedParts.month - 1, correctedParts.day, correctedParts.hour, correctedParts.minute, correctedParts.second) - candidate.getTime();
  const result = new Date(localAsUtc - correctedOffset);
  return Number.isNaN(result.getTime()) ? undefined : result.toISOString();
}

export function parseOperatorKickoff(value: string): { date: string; time: string } | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, day, month, year, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}`;
  const parsed = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59) {
    return undefined;
  }
  return { date, time };
}

export function utcToOperatorKickoff(startsAt: string, timeZone = getBrowserTimeZone()): string {
  const parts = getTimeZoneParts(new Date(startsAt), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatFixtureDateTime(startsAt: string): string {
  const instant = new Date(startsAt);
  if (Number.isNaN(instant.getTime())) {
    return "Invalid kickoff";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(instant);
}
