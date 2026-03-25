from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from fastapi.routing import APIRoute


@dataclass(frozen=True)
class FeatureDoc:
    entity: str
    purpose: str


FEATURE_DOCS_BY_MODULE: dict[str, FeatureDoc] = {
    "api.v1.admin_features.addon_catalog": FeatureDoc(
        entity="add-on",
        purpose="Defines optional paid extras that can be attached to bookings and priced consistently.",
    ),
    "api.v1.admin_features.availability_override": FeatureDoc(
        entity="availability override",
        purpose="Lets admins temporarily override normal cleaner availability for exceptions and special schedules.",
    ),
    "api.v1.admin_features.chat_intervention": FeatureDoc(
        entity="chat intervention",
        purpose=(
            "Tracks admin intervention actions inside customer-cleaner chat threads for safety, "
            "dispute handling, and escalation audit."
        ),
    ),
    "api.v1.admin_features.claim_review": FeatureDoc(
        entity="claim review",
        purpose="Handles dispute/claim review workflows and records final approval/rejection decisions.",
    ),
    "api.v1.admin_features.cleaner_skill_equipment_tag": FeatureDoc(
        entity="cleaner skill/equipment tag",
        purpose="Manages standardized tags used to describe cleaner skills/tools for matching and search.",
    ),
    "api.v1.admin_features.concierge_booking": FeatureDoc(
        entity="concierge booking record",
        purpose="Supports admin-created bookings on behalf of customers and concierge operations.",
    ),
    "api.v1.admin_features.dynamic_pricing_rule": FeatureDoc(
        entity="dynamic pricing rule",
        purpose="Stores and updates pricing rules that adjust booking costs based on conditions.",
    ),
    "api.v1.admin_features.payout_adjustment": FeatureDoc(
        entity="payout adjustment",
        purpose="Records manual payout corrections for cleaner earnings and settlement reconciliation.",
    ),
    "api.v1.admin_features.promo_code": FeatureDoc(
        entity="promo code",
        purpose="Manages discount codes and their validation/eligibility configuration.",
    ),
    "api.v1.admin_features.service_area_boundary": FeatureDoc(
        entity="service area boundary",
        purpose="Defines geographic boundaries that determine where services are allowed.",
    ),
    "api.v1.admin_features.service_credit_ledger": FeatureDoc(
        entity="service credit ledger entry",
        purpose="Maintains customer service-credit entries and balance operations.",
    ),
    "api.v1.admin_features.service_definition": FeatureDoc(
        entity="service definition",
        purpose="Defines core service catalog items used by booking flows.",
    ),
    "api.v1.admin_features.system_broadcast": FeatureDoc(
        entity="system broadcast",
        purpose="Creates and dispatches platform-wide announcements/alerts.",
    ),
    "api.v1.admin_route": FeatureDoc(
        entity="admin operation",
        purpose="Provides admin auth, directory access, permission governance, monitoring, and operational controls.",
    ),
    "api.v1.banner": FeatureDoc(
        entity="banner",
        purpose="Manages promotional banners shown across client apps.",
    ),
    "api.v1.booking_route": FeatureDoc(
        entity="booking",
        purpose="Provides booking lifecycle operations from creation through completion.",
    ),
    "api.v1.cleaner_route": FeatureDoc(
        entity="cleaner account",
        purpose="Covers cleaner auth, profile access, onboarding submission, and session management.",
    ),
    "api.v1.customer_route": FeatureDoc(
        entity="customer operation",
        purpose="Covers customer auth, settings/profile updates, and customer-app APIs.",
    ),
    "api.v1.documents_route": FeatureDoc(
        entity="document",
        purpose="Handles upload intents, document completion, retrieval, and deletion.",
    ),
    "api.v1.notifications": FeatureDoc(
        entity="notification",
        purpose="Manages notification creation, retrieval, and read-state updates.",
    ),
    "api.v1.payments_route": FeatureDoc(
        entity="payment operation",
        purpose="Handles payment initialization, verification, and payment method operations.",
    ),
    "api.v1.place_route": FeatureDoc(
        entity="place lookup",
        purpose="Provides address/place search and detail lookup endpoints.",
    ),
    "api.v1.review": FeatureDoc(
        entity="review",
        purpose="Handles customer/cleaner review and response workflows.",
    ),
}


def get_feature_doc_for_module(module_name: str | None) -> FeatureDoc | None:
    if not module_name:
        return None
    for prefix, feature_doc in FEATURE_DOCS_BY_MODULE.items():
        if module_name == prefix or module_name.startswith(prefix + "."):
            return feature_doc
    return None


def get_feature_purpose_for_route(*, module_name: str | None) -> str | None:
    feature_doc = get_feature_doc_for_module(module_name)
    if feature_doc is None:
        return None
    return feature_doc.purpose


def _path_rule(*, method: str, path: str) -> str | None:
    if path == "/v1/home":
        return "Returns the customer home payload (personalized sections, quick actions, and dashboard widgets)."
    if path == "/v1/bookings/cleaners":
        return "Lists available cleaners for booking flow using filter/sort parameters provided by the customer app."
    if path == "/v1/bookings/cleaners/{cleaner_id}":
        return "Returns full cleaner profile details used by the booking detail screen before confirmation."
    if path == "/v1/bookings/cleaners/{cleaner_id}/reviews":
        return "Returns paginated cleaner reviews to support trust/quality decisions before booking."
    if path == "/v1/bookings/services/{service_id}/extras":
        return "Lists selectable extras/add-ons for the chosen service so customer can build final booking scope."
    if path == "/v1/bookings/create":
        return "Creates a booking from the customer app contract payload and returns booking confirmation data."

    if path == "/v1/settings":
        return "Returns consolidated customer settings snapshot (notifications, security, sessions, legal/account state)."
    if path == "/v1/settings/sessions/revoke-others":
        return "Revokes all other customer sessions to secure account after suspicious activity or shared-device use."
    if path == "/v1/settings/sessions/revoke-all":
        return "Revokes every customer session across devices."
    if path == "/v1/settings/sessions/logout":
        return "Logs out the current customer session only."
    if path == "/v1/settings/notifications":
        return "Updates notification preference settings (channels, quiet hours, and enable/disable flags)."
    if path == "/v1/settings/security":
        return "Updates security preferences such as biometric and two-factor toggles."
    if path == "/v1/settings/account/deactivate":
        return "Creates/schedules customer account deactivation request and returns effective lifecycle status."
    if path == "/v1/settings/account/delete":
        return "Creates/schedules customer account deletion request after confirmation checks."

    if path == "/v1/notifications":
        return "Returns customer notification feed with current read/unread state."
    if path == "/v1/notifications/read-all":
        return "Marks all notifications as read for the current customer."
    if path == "/v1/notifications/{notification_id}/read":
        return "Marks one notification as read for the current customer."
    if path == "/v1/notifications/{notification_id}":
        return "Deletes one notification from the customer feed."

    if path == "/v1/customers/me":
        if method == "GET":
            return "Returns the authenticated customer profile used by account screens."
        return "Updates editable customer profile fields (name, phone, avatar, etc.)."
    if path == "/v1/customers/me/addresses":
        if method == "GET":
            return "Lists saved addresses for quick booking checkout."
        return "Creates a new saved address for the customer account."
    if path == "/v1/customers/me/addresses/{address_id}":
        if method == "DELETE":
            return "Deletes a saved address."
        return "Partially updates a saved address record."
    if path == "/v1/customers/me/addresses/{address_id}/set-default":
        return "Marks a saved address as default for future booking prefill."
    if path == "/v1/customers/password-reset/request":
        return "Accepts password reset request and triggers reset workflow handling."

    if path == "/v1/cleaners/me":
        return "Returns authenticated cleaner profile and onboarding state."
    if path == "/v1/cleaners/onboarding":
        return "Creates or updates cleaner onboarding profile data used for admin approval review."

    if path.endswith("/accept"):
        return "Marks booking as accepted by assigned cleaner and advances lifecycle status."
    if path.endswith("/complete"):
        return "Marks booking as completed by cleaner after service delivery."
    if path.endswith("/acknowledge"):
        return "Marks completion as acknowledged by customer to finalize booking completion flow."

    if "/monitoring/overview" in path:
        return "Returns admin monitoring overview KPIs (auth, alerts, audit activity, and operational health)."
    if "/monitoring/auth/heatmap" in path:
        return "Returns auth activity heatmap for anomaly/trend analysis."
    if "/monitoring/sessions/anomalies" in path:
        return "Returns detected suspicious session patterns for admin investigation."
    if "/monitoring/permissions/denied-top" in path:
        return "Returns most frequently denied permission checks to identify role-template gaps."
    if "/monitoring/alerts/sla" in path:
        return "Returns SLA metrics for alert acknowledgement/response times."
    if "/monitoring/alerts/" in path and path.endswith("/ack"):
        return "Acknowledges an alert with optional note for incident tracking."
    if "/monitoring/alerts/" in path and path.endswith("/read"):
        return "Updates read/unread state for a monitoring alert."
    if "/monitoring/audit/history" in path and "{event_id}" not in path:
        return "Returns paginated audit event history for admin actions and security traceability."
    if "/monitoring/audit/history/{event_id}" in path:
        return "Returns details for a single audit event including actor/target/action context."
    if "/monitoring/audit/export/" in path and path.endswith("/download"):
        return "Downloads a generated monitoring audit export file."
    if "/monitoring/audit/export/" in path and "{export_id}" in path and not path.endswith("/download"):
        return "Returns generation status/metadata for a specific audit export job."
    if "/monitoring/audit/export" in path and "{export_id}" not in path:
        return "Starts an audit export job using requested filters/time window."

    if "/reports/users/signups-trend" in path:
        return "Returns time-series signup trend grouped by selected interval for growth analytics."
    if "/reports/users/summary" in path:
        return "Returns aggregate user growth and distribution summary metrics."

    if "/onboarding/queue" in path:
        return "Returns cleaners currently awaiting onboarding review with queue-ready metadata."
    if "/cleaners/{cleaner_id}/onboarding-review" in path:
        return "Approves/rejects cleaner onboarding and records review outcome."
    if path == "/v1/admins/customers":
        return "Returns admin customer directory list with filtering and pagination support."
    if path == "/v1/admins/customers/{customer_id}/places":
        return "Returns saved customer places as normalized PlaceOut objects for admin-assisted booking location selection."
    if "/customers/{customer_id}" in path:
        return "Returns detailed customer profile for admin support/moderation context."
    if path == "/v1/admins/cleaners":
        return "Returns admin cleaner directory list with filtering and pagination support."
    if "/cleaners/{cleaner_id}" in path:
        return "Returns detailed cleaner profile for admin review/support operations."
    if path == "/v1/admins/users/autocomplete":
        return (
            "Returns unified customer/cleaner search suggestions by email, name, or exact id; "
            "used by concierge and support pickers."
        )

    if "/access/permission-groups" in path and method == "GET":
        return "Returns built-in and custom permission groups available for elevation requests."
    if "/access/permission-groups" in path and method == "POST":
        return "Creates a reusable custom permission group that reviewers/admins can apply later."
    if "/access/request-elevation" in path and method == "POST":
        return "Submits an admin privilege elevation request with requested permissions and justification."
    if "/access/request-elevation/status" in path:
        return "Returns latest elevation-request status for current admin (pending/approved/rejected + notes)."
    if "/access/requests" in path and method == "GET":
        return "Returns reviewer list of admin elevation requests for triage and decisioning."
    if "/access/requests/" in path and path.endswith("/decision"):
        return "Saves reviewer decision on an elevation request (approve/reject with optional edited grants)."

    if "/permissions/catalog" in path:
        return "Builds runtime permission catalog from registered routes so frontend can render permission-aware UI."
    if "/permission-templates/" in path and path.endswith("/preview"):
        return "Previews permission-template diff before rollout (additions/removals/invalid entries)."
    if "/permission-templates/" in path and path.endswith("/rollout-impact"):
        return "Estimates affected accounts before permission-template rollout."
    if "/permission-templates/" in path and path.endswith("/rollout"):
        return "Rolls out selected permission template to all accounts in target role."
    if "/permission-templates/" in path:
        return "Returns/updates role-level permission template used as source of permission assignments."

    if path == "/v1/admins/profile":
        return "Returns the authenticated admin profile and assigned permissions."
    if path == "/v1/admins/concierge-bookings/create-booking":
        return (
            "Creates a booking using the standard booking payload on behalf of a customer and "
            "enforces cleaner allow-admin-selection before creating the concierge tracking record."
        )
    if path == "/v1/admins/login":
        return "Authenticates admin credentials and returns token pair/profile."
    if path == "/v1/admins/refresh":
        return "Refreshes admin token pair using refresh token flow."

    if path.endswith("/google/auth"):
        return "Starts Google OAuth login and redirects user to consent screen."
    if path.endswith("/auth/callback"):
        return "Processes OAuth callback, creates/links local user, and returns login redirect."
    if path.endswith("/login") or path.endswith("/sign-in"):
        return "Authenticates credentials and returns token pair with user context."
    if path.endswith("/signup") or path.endswith("/sign-up"):
        return "Creates a new account and returns initial access/refresh tokens."
    if path.endswith("/refresh"):
        return "Issues a new token pair from a valid refresh token."
    if path.endswith("/sessions/revoke-others"):
        return "Revokes all other sessions while preserving the current one."
    if path.endswith("/sessions/revoke-all"):
        return "Revokes all active sessions for the current identity."
    if path.endswith("/sessions/logout"):
        return "Revokes the current session tokens and logs out the caller."

    return None


def _default_summary(*, method: str, path: str, entity: str) -> str:
    if method == "GET":
        if "{" in path and "}" in path:
            return f"Fetches a single {entity} by id for detail view, edit forms, or follow-up actions."
        return f"Lists {entity} records with optional filters/pagination for dashboard/table views."
    if method == "POST":
        return f"Creates a new {entity} record and returns the created object."
    if method == "PATCH":
        return f"Partially updates an existing {entity} without replacing the full record."
    if method == "PUT":
        return f"Replaces/upserts {entity} data using the provided payload."
    if method == "DELETE":
        return f"Deletes the targeted {entity} and removes it from active listings."
    return f"Handles `{method} {path}`."


def build_endpoint_summary(*, method: str, path: str, module_name: str | None) -> str:
    method_upper = method.upper()
    explicit = _path_rule(method=method_upper, path=path)
    if explicit:
        return explicit

    feature_doc = get_feature_doc_for_module(module_name)
    entity = feature_doc.entity if feature_doc else "resource"
    return _default_summary(method=method_upper, path=path, entity=entity)


def build_endpoint_description(*, method: str, path: str, module_name: str | None) -> str:
    summary = build_endpoint_summary(method=method, path=path, module_name=module_name)
    purpose = get_feature_purpose_for_route(module_name=module_name)
    if purpose:
        return f"Feature purpose: {purpose} {summary}"
    return summary


def apply_feature_docs_to_routes(routes: Iterable[object]) -> None:
    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.path.startswith("/v1/"):
            continue
        methods = sorted((route.methods or set()) - {"HEAD", "OPTIONS"})
        if not methods:
            continue
        primary_method = methods[0]
        module_name = getattr(route.endpoint, "__module__", None)
        route.summary = build_endpoint_summary(
            method=primary_method,
            path=route.path,
            module_name=module_name,
        )
        route.description = build_endpoint_description(
            method=primary_method,
            path=route.path,
            module_name=module_name,
        )
