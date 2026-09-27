import { Writable } from "node:stream";

/**
 * Terminal rendering of the API log stream.
 *
 * The server logs through pino, which writes one JSON object per line: right for a log collector,
 * unreadable in a terminal. Outside production Fastify is handed this stream instead of stdout, so
 * every record is rewritten as one readable line. Production keeps the untouched JSON pipeline.
 *
 * Records arrive already serialized and redacted by pino, so this module only decides how to show
 * them; it never adds, hides, or re-reads application data.
 */

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
} as const;

/** Colour is for a human at a terminal; a pipe into a file or another process gets plain text. */
const COLOR_ENABLED = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const LEVEL_NAMES: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const DEFAULT_LEVEL = 30;
/** `request completed` is the message the server uses for its one-line-per-request record. */
const REQUEST_MESSAGE = "request completed";

/** Column widths. The request line is the one that gets scanned all day, so its columns line up. */
const METHOD_WIDTH = 7;
const URL_WIDTH = 46;
const DURATION_WIDTH = 9;

/** Fields the line already shows, so they are not repeated as trailing `key=value` context. */
const RENDERED_FIELDS = new Set([
  "level",
  "time",
  "pid",
  "hostname",
  "msg",
  "reqId",
  "req",
  "res",
  "responseTime",
  "errorCode",
]);

function paint(text: string, color: string): string {
  return COLOR_ENABLED ? `${color}${text}${ANSI.reset}` : text;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function timestamp(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date();
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? "INFO";
}

function levelColor(level: number): string {
  if (level >= 50) return ANSI.red;
  if (level >= 40) return ANSI.yellow;
  if (level >= 30) return ANSI.cyan;
  return ANSI.gray;
}

/** 2xx green, 3xx cyan, 4xx yellow, 5xx red — the status has to be readable before the text is. */
function statusColor(status: number): string {
  if (status >= 500) return ANSI.red;
  if (status >= 400) return ANSI.yellow;
  if (status >= 300) return ANSI.cyan;
  return ANSI.green;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? String(value);
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** `err` is pino's error serializer: a message worth reading inline, and a stack worth reading below. */
function errorLines(value: unknown): string[] {
  const error = asRecord(value);
  if (!error) return [];
  const type = stringField(error, "type");
  const message = stringField(error, "message") ?? "Unknown error";
  const stack = stringField(error, "stack");
  const lines = [paint(`${type ? `${type}: ` : ""}${message}`, ANSI.red)];
  for (const frame of stack?.split("\n").slice(1) ?? []) {
    lines.push(paint(`    ${frame.trim()}`, ANSI.gray));
  }
  return lines;
}

function formatRequest(record: Record<string, unknown>): string {
  const request = asRecord(record["req"]);
  const response = asRecord(record["res"]);
  if (!request || !response) return formatMessage(record);

  const level = numberField(record, "level") ?? DEFAULT_LEVEL;
  const status = numberField(response, "statusCode") ?? 0;
  const duration = numberField(record, "responseTime");
  const errorCode = stringField(record, "errorCode");

  const columns = [
    paint(`[${timestamp(record["time"])}]`, ANSI.gray),
    paint(levelName(level).padEnd(5), levelColor(level)),
    paint((stringField(request, "method") ?? "-").padEnd(METHOD_WIDTH), ANSI.dim),
    (stringField(request, "url") ?? "-").padEnd(URL_WIDTH),
    paint(String(status).padStart(3), statusColor(status)),
    paint(duration === null ? "" : `${duration.toFixed(0)}ms`.padStart(DURATION_WIDTH), ANSI.dim),
  ];

  return `${columns.join(" ")}${errorCode ? `  ${paint(errorCode, ANSI.yellow)}` : ""}`;
}

function formatMessage(record: Record<string, unknown>): string {
  const level = numberField(record, "level") ?? DEFAULT_LEVEL;
  const context: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (RENDERED_FIELDS.has(key) || key === "err" || value === undefined) continue;
    context.push(`${paint(`${key}=`, ANSI.gray)}${renderValue(value)}`);
  }

  const head = [
    paint(`[${timestamp(record["time"])}]`, ANSI.gray),
    paint(levelName(level).padEnd(5), levelColor(level)),
    stringField(record, "msg") ?? "",
    ...context,
  ].join(" ");

  return [head, ...errorLines(record["err"])].join("\n");
}

function render(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  let record: Record<string, unknown> | null = null;
  try {
    record = asRecord(JSON.parse(trimmed) as unknown);
  } catch {
    record = null;
  }
  // Anything that is not a JSON log object is forwarded untouched rather than swallowed.
  if (!record) return trimmed;
  return stringField(record, "msg") === REQUEST_MESSAGE ? formatRequest(record) : formatMessage(record);
}

/** Writable destination for Fastify's pino logger. Records may arrive split across chunks. */
export function createPrettyLogStream(): Writable {
  let pending = "";
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const lines = (pending + chunk.toString("utf8")).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const text = render(line);
        if (text) process.stdout.write(`${text}\n`);
      }
      callback();
    },
    final(callback) {
      const text = render(pending);
      if (text) process.stdout.write(`${text}\n`);
      callback();
    },
  });
}
