# Lekha Sahayak Security Specification

## Data Invariants
1. A Ledger/Item/Transaction MUST belong to a valid Company.
2. Only users with access to a Company (via `companyIds` in their profile) can read/write data for that company.
3. Users cannot modify their own `role` or `companyIds` (Admin/System only).
4. Transactions must have valid sub-sums (subTotal + GST = totalAmount).
5. GSTINs must be validated format-wise.

## Dirty Dozen Payloads
1. **The Hijack**: User A tries to create a Ledger in Company B (where they are not a member).
2. **The Promotion**: User (Sales) tries to update their own role to 'Admin'.
3. **The Data Leak**: Unauthenticated user tries to list all companies.
4. **The Ghost Field**: Creating a Company with `isPremium: true` when it's not in the schema.
5. **The Time Warp**: Creating a Transaction with a `createdAt` in the future (not `request.time`).
6. **The Orphan**: Creating a sub-collection document for a non-existent parent company.
7. **The Negative Stock**: (Handled by business logic, but rules should ensure numeric constraints if possible).
8. **The Identity Spoof**: Authenticated User A tries to read User B's profile.
9. **The Partial Update Gap**: Updating only the `totalAmount` of a transaction without updating `subTotal`.
10. **The Admin Bypass**: User tries to write to the `admins` collection directly.
11. **The State Lock Break**: Trying to delete a transaction that has been "audited" (if status system implemented).
12. **The ID Poisoning**: Using a 2KB string as a Company ID to cause resource exhaustion.

## Test Runner (Draft)
A comprehensive test suite will be implemented in `DRAFT_firestore.rules.test.ts`.
