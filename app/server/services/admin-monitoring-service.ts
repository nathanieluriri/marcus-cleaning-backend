/**
 * Admin monitoring: overview, auth heatmap, denied-permissions, session anomalies,
 * SLA alerts, alert read/ack, and on-demand audit export (create/status/download)
 * + audit history. Ported from `admin_monitoring_service.py`.
 *
 * The heavy analytics endpoints return well-shaped stubs (clearly marked) because
 * their exact aggregations await the ported logic. Audit export is generated
 * on-demand (no Celery): create writes a `ready` record, download returns the
 * payload/signed-url. No Hono/HTTP types here.
 *
 * See: docs/migration/10-background-and-cron.md, 06-services-and-repositories.md
 */

import { notFound } from '@/server/core/errors'
import * as monitoringRepo from '@/server/repositories/admin-monitoring-repo'

// --- analytics (stubbed, well-shaped) ---

export async function overview(): Promise<Record<string, unknown>> {
  // TODO: real implementation — aggregate auth events, active sessions, alert
  // counts, and SLA status from `admin_monitoring`.
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    totals: { logins24h: 0, failedLogins24h: 0, activeSessions: 0, openAlerts: 0 },
    sla: { breaches: 0, atRisk: 0 },
  }
}

export async function authHeatmap(): Promise<Record<string, unknown>> {
  // TODO: real implementation — bucket auth events by day-of-week / hour.
  return { buckets: [], range: { from: null, to: null } }
}

export async function deniedPermissionsTop(): Promise<Record<string, unknown>> {
  // TODO: real implementation — top denied permission keys from audit events.
  return { items: [] }
}

export async function sessionAnomalies(): Promise<Record<string, unknown>> {
  // TODO: real implementation — flag impossible-travel / concurrent-device sessions.
  return { items: [] }
}

export async function slaAlerts(args: { limit?: number; skip?: number }) {
  return monitoringRepo.listAlerts({ ...args, slaOnly: true })
}

export async function alerts(args: { limit?: number; skip?: number }) {
  return monitoringRepo.listAlerts(args)
}

export async function markAlertRead(alertId: string, adminId: string): Promise<Record<string, unknown>> {
  const updated = await monitoringRepo.setAlertFlag(alertId, 'read', adminId)
  if (!updated) throw notFound('Alert not found')
  return updated
}

export async function ackAlert(alertId: string, adminId: string): Promise<Record<string, unknown>> {
  const updated = await monitoringRepo.setAlertFlag(alertId, 'acknowledged', adminId)
  if (!updated) throw notFound('Alert not found')
  return updated
}

// --- audit history ---

export function auditHistory(args: { limit?: number; skip?: number }) {
  return monitoringRepo.listAuditEvents(args)
}

export async function auditHistoryById(eventId: string): Promise<Record<string, unknown>> {
  const ev = await monitoringRepo.getAuditEventById(eventId)
  if (!ev) throw notFound('Audit event not found')
  return ev
}

// --- audit export (on-demand) ---

export async function createAuditExport(args: {
  requestedBy: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  // On-demand: the record is written `ready` immediately (synchronous model).
  // TODO: stream the generated file to S3/Blob and store its signed URL here;
  // for very large exports switch to the cron-backed drain (doc 10).
  return monitoringRepo.createExport({ requestedBy: args.requestedBy, ...args.payload })
}

export async function getAuditExport(exportId: string): Promise<Record<string, unknown>> {
  const exp = await monitoringRepo.getExportById(exportId)
  if (!exp) throw notFound('Audit export not found')
  return exp
}

export async function downloadAuditExport(exportId: string): Promise<Record<string, unknown>> {
  const exp = await monitoringRepo.getExportById(exportId)
  if (!exp) throw notFound('Audit export not found')
  // TODO: return a signed S3/Blob URL or stream the object. JSON stub for now.
  return {
    exportId,
    status: exp.status ?? 'ready',
    format: exp.format ?? 'json',
    // Placeholder payload; real download streams the generated file.
    data: [],
    note: 'On-demand export stub — wire to S3/Blob signed URL or streamed object.',
  }
}
