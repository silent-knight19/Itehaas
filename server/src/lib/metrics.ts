export const metrics = {
  httpRequestsTotal: 0,
  httpRequestsByStatus: new Map<string, number>(),
  ciPipelinesTotal: 0,
  startTime: Date.now(),
};

export function incHttpRequest(method: string, code: number) {
  metrics.httpRequestsTotal++;
  const key = `${method} ${code}`;
  metrics.httpRequestsByStatus.set(key, (metrics.httpRequestsByStatus.get(key) || 0) + 1);
}

export function incCIPipelines() {
  metrics.ciPipelinesTotal++;
}

export function renderMetrics(): string {
  const uptime = Math.round((Date.now() - metrics.startTime) / 1000);
  let out = '';
  out += '# HELP itehaas_http_requests_total Total HTTP requests\n';
  out += '# TYPE itehaas_http_requests_total counter\n';
  out += `itehaas_http_requests_total ${metrics.httpRequestsTotal}\n`;
  out += '# HELP itehaas_uptime_seconds Uptime in seconds\n';
  out += '# TYPE itehaas_uptime_seconds gauge\n';
  out += `itehaas_uptime_seconds ${uptime}\n`;
  out += '# HELP itehaas_ci_pipelines_total Total CI pipelines queued\n';
  out += '# TYPE itehaas_ci_pipelines_total counter\n';
  out += `itehaas_ci_pipelines_total ${metrics.ciPipelinesTotal}\n`;
  out += '# HELP itehaas_http_requests_by_status HTTP requests by method and status\n';
  out += '# TYPE itehaas_http_requests_by_status counter\n';
  for (const [k, v] of metrics.httpRequestsByStatus.entries()) {
    const [method, code] = k.split(' ');
    out += `itehaas_http_requests_by_status{method="${method}",code="${code}"} ${v}\n`;
  }
  return out;
}
