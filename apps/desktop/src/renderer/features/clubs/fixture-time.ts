export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function localDateTimeToUtc(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function utcToOperatorKickoff(startsAt: string): string {
  const instant = new Date(startsAt);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = instant;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.getFullYear()}-${pad(parts.getMonth() + 1)}-${pad(parts.getDate())}T${pad(parts.getHours())}:${pad(parts.getMinutes())}`;
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
