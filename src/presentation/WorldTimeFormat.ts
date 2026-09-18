export function formatWorldTime(worldMinutes: number | undefined): string {
  if (worldMinutes === undefined) return 'Нет данных';
  if (!Number.isFinite(worldMinutes) || worldMinutes < 0) return 'Некорректное время';

  const totalDays = worldMinutes / (24 * 60);
  const years = Math.floor(totalDays / 365);
  const dayOfYear = Math.floor(totalDays - years * 365) + 1;
  const minutesOfDay = Math.floor(worldMinutes % (24 * 60));
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;

  return `Год ${years + 1}, день ${dayOfYear}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

