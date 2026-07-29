import { describe, expect, it, vi, beforeEach } from 'vitest'

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.STORAGE_BACKEND ??= 'local'
process.env.APP_DEEP_LINK_SCHEME ??= 'marcuscleaning'

vi.mock('@/server/core/push/fcm', () => ({
  isConfigured: vi.fn(() => true),
  send: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/server/repositories/device-repo', () => ({
  listActiveFor: vi.fn(async () => [{ token: 'device-token' }]),
  disableToken: vi.fn(async () => {}),
}))

vi.mock('@/server/repositories/notifications-repo', () => ({
  countUnread: vi.fn(async () => 0),
  insert: vi.fn(async (doc: Record<string, unknown>) => ({ id: 'n1', ...doc })),
}))

import * as fcm from '@/server/core/push/fcm'
import { push } from '@/server/services/notification-dispatch'

describe('push — data passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fcm.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(fcm.send as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
  })

  it('keeps missingStep reachable in the data map sent to fcm.send', async () => {
    await push('u1', 'cleaner', {
      title: 'More info required',
      body: 'Please upload a document',
      data: {
        type: 'application.more_info_required',
        applicationId: 'a1',
        missingStep: 'documents',
      },
    })

    expect(fcm.send).toHaveBeenCalledTimes(1)
    const sent = (fcm.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sent.data.missingStep).toBe('documents')
    expect(sent.data.route).toBe('/signup/verification')
  })
})
