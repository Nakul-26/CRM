import pino from "pino";

export interface LoggerOptions {
  serviceName: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger({ serviceName, level, pretty }: LoggerOptions) {
  return pino({
    name: serviceName,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: serviceName },
    transport: pretty
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
