export const THRESHOLDS = {
  cpuHigh: 85,
  cpuCritical: 95,
  latencyHigh: 250,
  latencyCritical: 350,
  errorRateHigh: 0.05,
  memoryHigh: 85,
  memoryCritical: 90,
  diskHigh: 85,
  diskCritical: 90,
  temperatureHigh: 80,
  temperatureCritical: 85,
} as const;
