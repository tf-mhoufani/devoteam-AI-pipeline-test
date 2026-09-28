import type { LogEntry } from "#types/schema";
import type { PipelineContext } from "#types/pipeline";

export const createLog = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: "2023-10-01T12:00:00Z",
  cpu_usage: 50,
  memory_usage: 40,
  latency_ms: 100,
  disk_usage: 30,
  network_in_kbps: 1000,
  network_out_kbps: 1000,
  io_wait: 2,
  thread_count: 10,
  active_connections: 5,
  error_rate: 0.01,
  uptime_seconds: 3600,
  temperature_celsius: 50,
  power_consumption_watts: 200,
  service_status: {
    database: "online",
    api_gateway: "online",
    cache: "online",
  },
  ...overrides,
});

export const withLogs = (logs: LogEntry[]): PipelineContext => ({ logs });
