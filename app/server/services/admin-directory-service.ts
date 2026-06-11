/**
 * Admin directory: list/get customers & cleaners, onboarding queue, autocomplete,
 * onboarding review, and admin-side customer places. Ported from the directory
 * portion of `admin_service.py`. No Hono/HTTP types here.
 *
 * See: docs/migration/06-services-and-repositories.md
 */

import { notFound } from '@/server/core/errors'
import * as directoryRepo from '@/server/repositories/admin-directory-repo'

interface ListArgs {
  limit?: number
  skip?: number
  search?: string
}

export function listCustomers(args: ListArgs) {
  return directoryRepo.listCustomers(args)
}

export async function getCustomer(id: string): Promise<Record<string, unknown>> {
  const c = await directoryRepo.getCustomerById(id)
  if (!c) throw notFound('Customer not found')
  return c
}

export async function getCustomerPlaces(customerId: string): Promise<Record<string, unknown>> {
  // TODO: real implementation — resolve the customer's saved addresses/places
  // via saved-address-repo + place-service once those land. Returning the
  // customer's stored places field (if any) for now.
  const c = await directoryRepo.getCustomerById(customerId)
  if (!c) throw notFound('Customer not found')
  const places = (c.places as unknown) ?? (c.savedAddresses as unknown) ?? []
  return { customer_id: customerId, items: Array.isArray(places) ? places : [] }
}

export async function addCustomerPlace(args: {
  customerId: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  // TODO: real implementation — create a saved address (resolve place_id) via
  // saved-address-service. For now we verify the customer exists and echo back.
  const c = await directoryRepo.getCustomerById(args.customerId)
  if (!c) throw notFound('Customer not found')
  return { customer_id: args.customerId, ...args.payload, created: true }
}

export function listCleaners(args: ListArgs) {
  return directoryRepo.listCleaners(args)
}

export function listOnboardingQueue(args: ListArgs) {
  return directoryRepo.listOnboardingQueue(args)
}

export async function getCleaner(id: string): Promise<Record<string, unknown>> {
  const c = await directoryRepo.getCleanerById(id)
  if (!c) throw notFound('Cleaner not found')
  return c
}

export async function reviewCleanerOnboarding(args: {
  cleanerId: string
  reviewerId: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const updated = await directoryRepo.updateCleanerOnboardingReview(args.cleanerId, {
    ...args.payload,
    onboardingReviewedBy: args.reviewerId,
    onboardingReviewedAt: Math.floor(Date.now() / 1000),
  })
  if (!updated) throw notFound('Cleaner not found')
  return updated
}

export function autocompleteUsers(args: { search: string; limit?: number }) {
  return directoryRepo.autocompleteUsers(args.search, args.limit)
}
