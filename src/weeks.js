const DAY_MS = 86_400_000;

export function shiftUtcDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isUtcMonday(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return date.getUTCDay() === 1 && date.toISOString().slice(0, 10) === day;
}

export function latestCompleteWeek(now) {
  // Yesterday is still admissible. Use the Monday before yesterday's week.
  const yesterday = new Date(now.getTime() - DAY_MS);
  const daysSinceMonday = (yesterday.getUTCDay() + 6) % 7;
  return shiftUtcDay(yesterday.toISOString().slice(0, 10), -7 - daysSinceMonday);
}
