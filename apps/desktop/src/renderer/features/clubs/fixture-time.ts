export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function localDateTimeToUtc(date: string, time: string): string | undefined {
  if (!date || !time) {
    return undefined;
  }

  const localDate = new Date(`${date}T${time}`);
  if (Number.isNaN(localDate.getTime())) {
    return undefined;
  }

  return localDate.toISOString();
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
