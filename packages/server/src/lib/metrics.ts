import { jobStatuses } from "./periodic.js";

/**
 * Prometheus metrics, in its text format, for `GET /metrics`. Written out
 * rather than taken from a client library: counters, gauges read at scrape
 * time, and a request duration sum and count cover what "is it well" needs,
 * and the format is a few lines of text.
 *
 * Module state, like the job statuses: there is one server per process.
 */

type Labels = Record<string, string>;

interface Family {
  help: string;
  type: "counter" | "gauge";
  values: Map<string, { labels: Labels; value: number }>;
}

const families = new Map<string, Family>();
const gauges = new Map<
  string,
  { help: string; read: () => number | Promise<number> }
>();

function key(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function family(name: string, help: string, type: Family["type"]): Family {
  let found = families.get(name);
  if (!found) {
    found = { help, type, values: new Map() };
    families.set(name, found);
  }
  return found;
}

/** Adds `by` to a counter. */
export function countMetric(
  name: string,
  help: string,
  labels: Labels = {},
  by = 1,
): void {
  const f = family(name, help, "counter");
  const k = key(labels);
  const current = f.values.get(k);
  if (current) current.value += by;
  else f.values.set(k, { labels, value: by });
}

/** A gauge read when scraped, from whoever knows its value. */
export function gaugeMetric(
  name: string,
  help: string,
  read: () => number | Promise<number>,
): void {
  gauges.set(name, { help, read });
}

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function line(name: string, labels: Labels, value: number): string {
  const pairs = Object.entries(labels).map(
    ([k, v]) => `${k}="${escapeLabel(v)}"`,
  );
  return `${name}${pairs.length ? `{${pairs.join(",")}}` : ""} ${value}`;
}

export async function renderMetrics(version: string): Promise<string> {
  const out: string[] = [
    "# HELP manifesto_build_info The running version.",
    "# TYPE manifesto_build_info gauge",
    line("manifesto_build_info", { version }, 1),
    "# HELP process_uptime_seconds Seconds since the process started.",
    "# TYPE process_uptime_seconds gauge",
    line("process_uptime_seconds", {}, Math.round(process.uptime())),
    "# HELP process_resident_memory_bytes Resident memory.",
    "# TYPE process_resident_memory_bytes gauge",
    line("process_resident_memory_bytes", {}, process.memoryUsage().rss),
    "# HELP nodejs_heap_used_bytes V8 heap in use.",
    "# TYPE nodejs_heap_used_bytes gauge",
    line("nodejs_heap_used_bytes", {}, process.memoryUsage().heapUsed),
  ];
  for (const [name, f] of families) {
    out.push(`# HELP ${name} ${f.help}`, `# TYPE ${name} ${f.type}`);
    for (const { labels, value } of f.values.values()) {
      out.push(line(name, labels, value));
    }
  }
  for (const [name, gauge] of gauges) {
    out.push(`# HELP ${name} ${gauge.help}`, `# TYPE ${name} gauge`);
    try {
      out.push(line(name, {}, await gauge.read()));
    } catch {
      // A gauge that cannot be read is left out of this scrape.
    }
  }
  const jobs = jobStatuses();
  out.push(
    "# HELP manifesto_job_last_run_failed Whether a background job's last run failed.",
    "# TYPE manifesto_job_last_run_failed gauge",
    ...jobs.map((j) =>
      line(
        "manifesto_job_last_run_failed",
        { job: j.name },
        j.lastError ? 1 : 0,
      ),
    ),
    "# HELP manifesto_job_last_run_timestamp_seconds When a background job last finished.",
    "# TYPE manifesto_job_last_run_timestamp_seconds gauge",
    ...jobs
      .filter((j) => j.lastFinishedAt)
      .map((j) =>
        line(
          "manifesto_job_last_run_timestamp_seconds",
          { job: j.name },
          Math.floor(Date.parse(j.lastFinishedAt as string) / 1000),
        ),
      ),
    "# HELP manifesto_job_last_run_duration_seconds How long a background job's last run took.",
    "# TYPE manifesto_job_last_run_duration_seconds gauge",
    ...jobs
      .filter((j) => j.lastDurationMs !== null)
      .map((j) =>
        line(
          "manifesto_job_last_run_duration_seconds",
          { job: j.name },
          (j.lastDurationMs as number) / 1000,
        ),
      ),
  );
  return `${out.join("\n")}\n`;
}

/** Test seam: the registry is module state and outlives a test. */
export function resetMetrics(): void {
  families.clear();
  gauges.clear();
}
