import * as generic from '@/server/repositories/admin-features/_generic-repo'
import type { BookingAddon } from '@/server/schemas/booking'
import type { ChecklistTask } from '@/server/schemas/job-session'

/**
 * Build a job's checklist from the booking's service definition and add-ons.
 *
 * The tasks are admin-editable content: a `service_definitions` or
 * `addon_catalog` document may carry a `checklist` array (strings, or
 * `{ id, label }` objects). Where an entry has no checklist, the add-on's own
 * title becomes a single task so nothing the customer paid for is invisible to
 * the cleaner. A service with no configured checklist falls back to a generic
 * set rather than handing the cleaner an empty screen.
 */

const SERVICE_DEFS = 'service_definitions'
const ADDON_CATALOG = 'addon_catalog'

const FALLBACK_TASKS = [
  'Dust and wipe all surfaces',
  'Vacuum floors',
  'Mop hard floors',
  'Clean and sanitise bathroom',
  'Clean kitchen surfaces',
  'Empty bins',
]

function slugify(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return slug || `task-${index + 1}`
}

/** Read a `checklist` field that may be string[] or {id,label}[]. */
function readChecklist(doc: Record<string, unknown> | null): Array<{ id?: string; label: string }> {
  const raw = doc?.checklist ?? doc?.tasks
  if (!Array.isArray(raw)) return []
  const out: Array<{ id?: string; label: string }> = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim()) out.push({ label: entry.trim() })
    else if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>
      const label = typeof e.label === 'string' ? e.label : typeof e.title === 'string' ? e.title : null
      if (label) out.push({ id: typeof e.id === 'string' ? e.id : undefined, label })
    }
  }
  return out
}

function docTitle(doc: Record<string, unknown> | null, fallback: string): string {
  const title = doc?.title ?? doc?.name
  return typeof title === 'string' && title.length > 0 ? title : fallback
}

/** Compose the full checklist for a booking. Task ids are unique within the list. */
export async function buildChecklist(args: {
  serviceId: string | null
  addons: BookingAddon[]
}): Promise<ChecklistTask[]> {
  const tasks: ChecklistTask[] = []
  const seen = new Set<string>()

  const push = (label: string, addonId: string | null, preferredId?: string) => {
    let id = preferredId ?? slugify(label, tasks.length)
    let n = 2
    while (seen.has(id)) id = `${preferredId ?? slugify(label, tasks.length)}-${n++}`
    seen.add(id)
    tasks.push({ taskId: id, label, addonId, done: false, doneAt: null })
  }

  const service = args.serviceId ? await generic.getDocById(SERVICE_DEFS, args.serviceId) : null
  const serviceTasks = readChecklist(service)
  if (serviceTasks.length > 0) {
    for (const t of serviceTasks) push(t.label, null, t.id)
  } else {
    for (const label of FALLBACK_TASKS) push(label, null)
  }

  for (const addon of args.addons) {
    const doc = await generic.getDocById(ADDON_CATALOG, addon.addonId)
    const addonTasks = readChecklist(doc)
    if (addonTasks.length > 0) {
      for (const t of addonTasks) push(t.label, addon.addonId, t.id)
    } else {
      push(docTitle(doc, 'Extra service'), addon.addonId)
    }
  }

  return tasks
}
