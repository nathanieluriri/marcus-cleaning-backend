# Admin TODO Features: Monitoring-First Backlog

This file tracks monitoring capabilities to add for admin accounts, with emphasis on security, abuse detection, operational visibility, and compliance-ready auditability.

## 1) Admin Authentication Monitoring

- [ ] Log every admin login attempt (success/failure, reason, email, IP, user-agent, geo hint, request ID).
- [ ] Track failed login counters per admin, per IP, and per IP range.
- [ ] Alert on brute-force patterns (N failed attempts in rolling window).
- [ ] Alert on successful login after suspicious failure streak.
- [ ] Alert on impossible travel (short-time geolocation jump).
- [ ] Alert on first-seen device/browser fingerprint for each admin.
- [ ] Alert on first login from new ASN/network.
- [ ] Track refresh-token usage anomalies (rapid refresh churn, reused invalid refresh).
- [ ] Alert when expired-access refresh flow repeatedly fails for same admin.
- [ ] Build login heatmap (hour/day patterns) for anomaly baseline.

## 2) Admin Session Monitoring

- [ ] Track active session count per admin and global active admin sessions.
- [ ] Alert on unusually high concurrent sessions for one admin.
- [ ] Log every session revocation event and trigger source (self/system/security).
- [ ] Detect and alert on token replay indicators.
- [ ] Monitor session TTL distribution and long-lived session outliers.
- [ ] Alert on session creation spikes across all admins.
- [ ] Track device-to-session mapping and unusual device churn.

## 3) Authorization and Permission Monitoring

- [ ] Log every permission template change (before/after diff, actor, timestamp).
- [ ] Log every role-permission rollout with matched/modified counts and actor.
- [ ] Alert on high-risk permission grants (write/delete/refund/admin-management actions).
- [ ] Alert when permission templates change outside approved windows.
- [ ] Detect drift between expected permission template and actual assigned permissions.
- [ ] Log denied admin requests with missing permission key and endpoint.
- [ ] Dashboard for top denied permission keys and affected admins.

## 4) Admin Action Audit Monitoring

- [ ] Centralize immutable audit logs for all admin API mutations.
- [ ] Capture actor, target entity, action type, endpoint, payload hash, and response status.
- [ ] Include correlation/request IDs to reconstruct multi-step actions.
- [ ] Track sensitive operations separately (account deletion, onboarding decisions, payouts/refunds).
- [ ] Alert on burst deletes/updates by one admin in short intervals.
- [ ] Alert when one admin touches unusually many unique entities quickly.
- [ ] Add tamper-evidence controls (append-only storage or hash chaining).

## 5) Account Lifecycle Monitoring (Admin Accounts)

- [ ] Log admin account create/deactivate/delete events with actor-target linkage.
- [ ] Alert when admin accounts are deleted/deactivated outside policy windows.
- [ ] Alert on frequent account-status flips (ACTIVE/INACTIVE/SUSPENDED churn).
- [ ] Monitor orphaned tokens after account deactivation/deletion.
- [ ] Add daily report of account lifecycle events and pending actions.

## 6) Cleaner Onboarding Review Monitoring (Admin-Driven)

- [ ] Track approve/reject rates per admin and globally.
- [ ] Alert on outlier rejection rates by an individual admin.
- [ ] Alert when rejection reasons are missing for reject actions.
- [ ] Monitor review latency from submission to admin decision.
- [ ] Dashboard for onboarding pipeline health and admin reviewer throughput.

## 7) API Health and Abuse Monitoring for Admin Endpoints

- [ ] Endpoint-level latency/error dashboards for `/v1/admins/*`.
- [ ] Alert on sustained 5xx for admin auth and permission endpoints.
- [ ] Alert on spikes in 401/403 for admin endpoints (possible attack or rollout issue).
- [ ] Monitor rate-limit hits by admin endpoint and source IP.
- [ ] Detect schema validation failure spikes (422 bursts) per endpoint.

## 8) Data Change and Integrity Monitoring

- [ ] Track high-impact data mutations initiated by admins (who/what/when).
- [ ] Alert on conflicting updates to same record in short window.
- [ ] Periodic checks for permission-template integrity and required fields.
- [ ] Monitor token-store consistency (access-refresh linkage integrity).
- [ ] Add reconciliation job metrics (processed/failed/retried lifecycle jobs).

## 9) Alerting and Escalation Controls

- [ ] Define severity tiers: info, warning, high, critical.
- [ ] Route alerts by type (security to security channel, ops to ops channel).
- [ ] Deduplicate and suppress noisy duplicates with cooldown windows.
- [ ] Add alert ownership/acknowledgement workflow.
- [ ] Track MTTA/MTTR for admin-related security incidents.
- [ ] Add runbook links per alert type.

## 10) Dashboards and Reporting

- [ ] Admin security overview dashboard (login risk, session anomalies, permission changes).
- [ ] Operational dashboard for admin endpoint reliability (latency/error/rate-limit).
- [ ] Daily audit digest (top risky actions, anomalies, failed auth trends).
- [ ] Weekly compliance digest (permission changes, sensitive actions, account lifecycle events).
- [ ] Per-admin activity profile dashboard for investigations.

## 11) Compliance and Retention

- [ ] Define retention policy for admin audit logs (hot/warm/archive).
- [ ] Add PII-aware logging policy (redaction of sensitive fields).
- [ ] Ensure audit logs are queryable by actor, target, endpoint, and date range.
- [ ] Add export capability for incident/compliance investigations.
- [ ] Enforce timezone-normalized timestamps (UTC) across all audit streams.

## 12) Implementation Foundations

- [ ] Standardize structured log schema for all admin flows.
- [ ] Add event bus/topic for security/audit events (non-blocking emit).
- [ ] Add monitoring IDs (`eventId`, `requestId`, `actorId`, `targetId`) consistently.
- [ ] Add feature flags for progressive rollout of monitoring alerts.
- [ ] Create test fixtures for anomaly scenarios (brute force, token replay, permission abuse).
- [ ] Add synthetic monitoring checks for critical admin endpoints.

## Suggested Delivery Order

1. Core audit event model + structured logging.
2. Auth/session monitoring + high-signal security alerts.
3. Permission change monitoring + rollout drift checks.
4. Admin action anomaly detection + dashboards.
5. Compliance exports, retention, and incident workflow hardening.


