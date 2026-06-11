import { notFound } from '@/server/core/errors'
import * as bannerRepo from '@/server/repositories/banner-repo'
import type { BannerCreateRequest, BannerUpdateRequest, BannerOut } from '@/server/schemas/banner'

/**
 * Banner CRUD business logic.
 * Ported from `banner_service.py`. No HTTP types here.
 * Reads are open to authenticated users; mutations are admin-only (enforced at the route guard).
 * See: docs/migration/06-services-and-repositories.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export async function listBanners(): Promise<BannerOut[]> {
  return bannerRepo.list()
}

export async function getBanner(id: string): Promise<BannerOut> {
  const banner = await bannerRepo.getById(id)
  if (!banner) throw notFound('Banner not found')
  return banner
}

export async function createBanner(payload: BannerCreateRequest): Promise<BannerOut> {
  const ts = nowEpoch()
  return bannerRepo.insert({
    title: payload.title,
    imageUrl: payload.imageUrl,
    linkUrl: payload.linkUrl ?? null,
    description: payload.description ?? null,
    active: payload.active ?? true,
    sortOrder: payload.sortOrder ?? 0,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

export async function updateBanner(id: string, payload: BannerUpdateRequest): Promise<BannerOut> {
  const patch: Record<string, unknown> = { lastUpdated: nowEpoch() }
  if (payload.title !== undefined) patch.title = payload.title
  if (payload.imageUrl !== undefined) patch.imageUrl = payload.imageUrl
  if (payload.linkUrl !== undefined) patch.linkUrl = payload.linkUrl
  if (payload.description !== undefined) patch.description = payload.description
  if (payload.active !== undefined) patch.active = payload.active
  if (payload.sortOrder !== undefined) patch.sortOrder = payload.sortOrder
  const updated = await bannerRepo.update(id, patch)
  if (!updated) throw notFound('Banner not found')
  return updated
}

export async function deleteBanner(id: string): Promise<void> {
  const deleted = await bannerRepo.remove(id)
  if (!deleted) throw notFound('Banner not found')
}
