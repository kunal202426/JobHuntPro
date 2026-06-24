export function log(level, ...args) {
  console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

export const logger = {
  info:  (...args) => log("info",  ...args),
  warn:  (...args) => log("warn",  ...args),
  error: (...args) => log("error", ...args),
};
