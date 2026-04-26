type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function emit(level: Level, message: string, ctx?: Record<string, unknown>) {
  if (order[level] < order[minLevel]) return;
  const entry = { ts: new Date().toISOString(), level, message, ...ctx };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => emit("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => emit("error", m, c),
};
