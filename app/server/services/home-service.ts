import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as bannerRepo from '@/server/repositories/banner-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as catalogService from '@/server/services/catalog-service'
import * as directory from '@/server/services/cleaner-directory-service'
import { HomePageModel, buildGreeting } from '@/server/schemas/home'

/** Bespoke home aggregation for the customer app (spec §2.2). Composes existing repos/services. */
export async function getHome(principal: AuthPrincipal): Promise<HomePageModel> {
  const customer = await customerRepo.findById(principal.userId)
  if (!customer) throw notFound('Customer not found')

  const [banners, serviceCategories, featuredCleaners, upcoming, past] = await Promise.all([
    bannerRepo.list(),
    catalogService.listServices(),
    directory.browse({ onlyAvailableNow: false }),
    bookingRepo.getBookingsHistory({ customerId: principal.userId, scope: 'upcoming', pageSize: 5 }),
    bookingRepo.getBookingsHistory({ customerId: principal.userId, scope: 'past', pageSize: 5 }),
  ])

  return HomePageModel.parse({
    greeting: buildGreeting(customer.firstName),
    user: {
      id: String(customer._id),
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
    },
    banners: banners.filter((b) => b.active),
    serviceCategories,
    featuredCleaners: featuredCleaners.slice(0, 5),
    activeBookings: upcoming.items,
    recentBookings: past.items,
  })
}
