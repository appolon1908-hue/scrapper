export type LogContext = Record<string, unknown>;

export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context: LogContext = {},
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}
