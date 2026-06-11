import { z } from '@hono/zod-openapi'
import { BannerOut } from './banner'
import { CatalogServiceOut } from './catalog'
import { CleanerCardOut } from './cleaner-directory'
import { BookingOut } from './booking'

/**
 * Bespoke home aggregation (spec decision §2.2). Composes existing pieces
 * (banners, catalog, featured cleaners, bookings) into one round-trip payload.
 */

export const HomeUser = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  })
  .openapi('HomeUser')
export type HomeUser = z.infer<typeof HomeUser>

export const HomePageModel = z
  .object({
    greeting: z.string(),
    user: HomeUser,
    banners: z.array(BannerOut).default([]),
    serviceCategories: z.array(CatalogServiceOut).default([]),
    featuredCleaners: z.array(CleanerCardOut).default([]),
    activeBookings: z.array(BookingOut).default([]),
    recentBookings: z.array(BookingOut).default([]),
  })
  .openapi('HomePageModel')
export type HomePageModel = z.infer<typeof HomePageModel>

/** Build the greeting line from a first name (empty/null → generic). */
export function buildGreeting(firstName: string | null): string {
  return firstName ? `Welcome back, ${firstName}` : 'Welcome back'
}
