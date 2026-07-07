# Recipients Write Dry-Run Design Review

This is a documentation-only review of
[recipients-write-dry-run-design.md](recipients-write-dry-run-design.md)
against the current Dexie-backed Recipients behavior. It does not implement
write endpoints, write adapters, server mutation handlers, UI wiring, dual
write, selected-read changes, schema changes, or data mutations.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. HTTP
remains read-only. No Recipients write dry-run endpoint is approved by this
review.

## Sources Reviewed

- `docs/recipients-write-dry-run-design.md`
- `docs/write-mutation-architecture-plan.md`
- `docs/selected-read-migration-readiness-audit.md`
- `src/pages/RecipientsManagement.tsx`
- `src/components/AddRecipientModal.tsx`
- `src/components/MergeRecipientsModal.tsx`
- `src/utils/recipientMerge.ts`
- `src/repositories/recipientRepository.ts`
- `src/repositories/transactionRepository.ts`
- `src/repositories/recipientsReadExperimentDiagnostics.ts`
- `src/db.ts`
- `server/schema/prototype-schema.sql`
- `server/src/lib/lookups.ts`

No recipient-specific test/spec files were found in the current source scan.
That means implementation should treat the current UI/component code as the
behavioral reference until tests are added.

## Overall Finding

The dry-run design matches the broad safety boundary: it is validation-only,
does not authorize writes, keeps Dexie authoritative, and correctly treats
merge as higher risk because merge mutates transaction recipient references.

Main gaps before endpoint implementation:

- Duplicate semantics are split between add/edit duplicate checks and merge
  duplicate-pair detection.
- The design says "current till/phone behavior" but current add/edit duplicate
  logic appears to check phone twice and does not check `tillNumber`.
- Update behavior does not preserve or mention `createdAt` in the proposed
  normalized summary, even though current update leaves it unchanged.
- Activate/deactivate currently updates only `isActive`, not `updatedAt`.
- Merge currently updates the primary recipient, updates transactions, and
  deletes the secondary recipient without an atomic transaction wrapper in the
  utility.
- Merge combines aliases in lower-case and may return an empty string rather
  than `undefined`; this differs from add/update optional-field normalization.
- Current delete safety depends on a usage-count map loaded by the page, not a
  repository helper that performs an atomic check immediately before deletion.
- Existing user-facing duplicate and delete alerts expose recipient names; the
  dry-run response design intentionally redacts those values. A future UI must
  decide whether server dry-run results remain redacted while local UI displays
  names from Dexie.

## Operation Review

| Operation | Current Dexie behavior | Dry-run design expectation | Match / gap / unknown | Risk | Recommended correction |
| --- | --- | --- | --- | --- | --- |
| Create recipient | `AddRecipientModal` requires trimmed `name`; requires `paybill` when `accountNumber` is present; checks duplicate name/phone/paybill+account; checks alias collisions; trims optional fields to `undefined`; sets `isActive: true`, `createdAt`, and `updatedAt`; lets Dexie generate `id`. | Validate proposed new recipient, normalize fields, report duplicate and alias collision counts, report timestamp behavior, do not reserve ID. | Mostly match. Duplicate and alias behavior need exact specification. | Medium | Document exact duplicate categories and keep create response from claiming an ID. Add tests before endpoint work. |
| Update recipient | `AddRecipientModal` loads existing fields; applies same name/account/paybill and duplicate checks excluding current ID; checks alias collisions excluding current ID; trims optional fields to `undefined`; updates fields plus `updatedAt`; leaves `createdAt` unchanged. | Confirm target exists, normalize fields, compute duplicate/alias collisions excluding target ID, report field presence changes, report `updatedAt` would change. | Mostly match, but design should explicitly say `createdAt` remains unchanged on update. | Medium | Add `createdAtWouldChange: false` or equivalent for update dry-run summaries. |
| Activate/deactivate | `handleToggleRecipientActive` toggles `isActive`; `handleDeactivateRecipient` sets `isActive: false`; neither path explicitly updates `updatedAt`. | Validate target exists, report current/proposed active state and no-op status; deactivation reports usage count as informational. | Partial match. Timestamp semantics differ from create/update and are not called out. | Low | Document that current activate/deactivate does not update `updatedAt`; decide later whether to preserve or intentionally change that behavior. |
| Delete recipient | Page computes recipient transaction counts from loaded transactions. If count is 0, delete is confirmed and `db.recipients.delete(id)` runs. If count > 0 and active, UI offers deactivation. If count > 0 and inactive, deletion is blocked. | Validate target exists, compute transaction usage, allow unused delete, block used delete, suggest deactivation for used active recipient. | Match at behavior level. | Medium | Endpoint dry-run should compute usage from the current authoritative source at request time, not trust a client count. |
| Merge recipients | `MergeRecipientsModal` chooses primary by higher transaction count, with first recipient winning ties. `mergeRecipients` keeps primary name/isActive, fills missing contact/description fields from secondary, combines aliases, updates all transactions from secondary to primary, deletes secondary, and returns transaction count. | Validate primary/secondary exist and differ; report transaction count for secondary; report whether primary choice follows current UI convention; summarize merged field presence and alias handling; do not mutate recipients or transactions. | Match on broad intent. High-risk details need sharper treatment. | High | Keep merge dry-run separate from simple recipient dry-runs. Require explicit transaction-reference mutation approval before any real merge endpoint. Consider requiring exact primary/secondary IDs rather than auto-picking on server. |

## Validation Rules Review

| Area | Current behavior | Design expectation | Match / gap / unknown | Risk | Recommended correction |
| --- | --- | --- | --- | --- | --- |
| Required fields | `name.trim()` is required. | `name` required after trimming. | Match. | Low | None. |
| Optional fields | `aliases`, `email`, `phone`, `tillNumber`, `paybill`, `accountNumber`, and `description` are trimmed and stored as `undefined` when empty on create/update. | Optional text fields trim and become absent when empty. | Match. | Low | Response should report presence only, not values. |
| Account number dependency | `accountNumber.trim()` requires `paybill.trim()`. | `accountNumber` requires non-empty `paybill`. | Match. | Low | None. |
| Email/phone/payment shapes | No strict regex validation is visible in current modal. | Do not invent strict shape validation silently; warnings only if documented. | Match. | Low | Keep shape warnings non-blocking unless a future UI validation change is approved. |
| Add/edit duplicate check | `checkForDuplicateRecipient` checks exact case-insensitive name, phone equality, paybill+account equality, then repeats the same phone check under a "till number" comment. It does not appear to compare `tillNumber`. | Design says compare name, phone, paybill+account, and current till/phone behavior as implemented. | Gap / ambiguity. | Medium | Document a result category split: `duplicateNameCandidates`, `duplicatePhoneCandidates`, `duplicatePaybillAccountCandidates`, and `duplicateTillCandidates` as unknown/not currently enforced until corrected or intentionally preserved. |
| Merge duplicate detection | `findAllDuplicatePairs` uses name-only similarity: exact case-insensitive name or Levenshtein distance <= 2 for names up to 15 chars. It explicitly does not use phone/paybill/till/email. | Design asks whether duplicate counts should follow add/edit checks, merge algorithm, or both. | Known split. | Medium | Dry-run should report add/edit duplicate candidates and merge duplicate candidates separately. Do not collapse them into one `duplicateCandidates` count without a definition. |
| Alias parsing | Alias checks split on `;`, lowercase, trim, and ignore empty aliases. Add/update stores the original trimmed string, not the normalized lowercase list. | Alias input semicolon-separated, lowercased for comparison, trimmed, ignores empty aliases. | Partial match. | Medium | Clarify that comparison normalizes aliases, but persisted create/update value preserves the trimmed input string. |
| Alias collisions | Add/update scans all recipients, excluding current ID on edit, and blocks if any existing alias exactly matches a normalized proposed alias. It does not appear to compare proposed aliases against recipient names. | Alias collisions across other recipients are validation errors. | Mostly match. | Low | If needed later, explicitly decide whether alias-vs-name collisions are in or out of scope. |
| Timestamp behavior | Create sets `createdAt` and `updatedAt`. Update sets `updatedAt`. Activate/deactivate do not explicitly update `updatedAt`. Merge sets primary `updatedAt`. Delete does not set timestamps. | Design says create/update timestamp behavior; activate/deactivate timestamp behavior is not explicit. | Gap. | Medium | Add per-action timestamp expectations before implementation. |
| ID handling | Create uses Dexie auto-increment ID. Update/toggle/delete/merge require existing IDs from UI state. | Create must not accept existing ID; other actions require IDs. | Match. | Low | Dry-run should validate numeric finite IDs and not reserve IDs. |

## Transaction Reference Safety

Current delete behavior is reference-safe at the UI level because recipients
with transaction usage are not deleted. Current merge behavior is intentionally
not reference-neutral: it updates every transaction with the secondary
recipient ID to the primary recipient ID, then deletes the secondary recipient.

Risk level: high for merge, medium for delete.

Recommended corrections before implementation:

- Delete dry-run must compute transaction usage server-side at request time.
- Merge dry-run must remain separate and must clearly report
  `wouldUpdateTransactionReferences: true` plus affected transaction count.
- A real merge endpoint must not be bundled with the first recipient dry-run
  implementation unless separately approved.
- No dry-run response should include transaction rows, transaction
  descriptions, transaction references, amounts, or recipient contact details.

## User-Facing Warnings And Errors

Current UI messages include recipient names in duplicate/delete alerts and
contact values in normal list rendering. The dry-run response design forbids
names/contact details by default. That is a good API boundary, but a future UI
must handle the mismatch intentionally:

- API dry-run response: IDs, counts, booleans, safe result codes only.
- Browser UI may display names already loaded from Dexie or selected-read paths
  if the screen is explicitly approved to do so.
- Server logs and API responses should not include names, aliases, emails,
  phone numbers, till numbers, paybill values, account numbers, descriptions,
  or raw rows.

## Implementation Blockers

Do not implement Recipients dry-run endpoints until these are resolved or
explicitly accepted:

- Define duplicate-count categories precisely.
- Decide whether the duplicate "till number" behavior is a bug to preserve,
  a bug to fix later, or an unknown that dry-run should report separately.
- Define whether dry-run compares against disposable SQLite, Dexie, or both.
- Define timestamp behavior per action, especially activate/deactivate.
- Define merge as a separate high-risk dry-run because it implies future
  transaction-reference mutation.
- Define whether merge dry-run should accept caller-provided primary/secondary
  IDs only or compute the current UI "higher transaction count wins" choice.
- Define whether alias comparison should preserve current case-insensitive
  alias-only collision behavior exactly.
- Add tests or a fixture-based diagnostic for recipient validation parity.

## Recommended Design Corrections

Update the dry-run design before endpoint work to state:

- Add/edit duplicate checks and merge duplicate detection are different today.
- Duplicate candidate counts should be split by category.
- Update dry-run should report `createdAtWouldChange: false` and
  `updatedAtWouldChange: true`.
- Activate/deactivate dry-run should report that current Dexie behavior changes
  `isActive` only and does not explicitly update `updatedAt`.
- Merge dry-run should include `wouldUpdateTransactionReferences: true` and
  should be blocked from real implementation until a transaction-reference
  mutation plan is approved.
- Dry-run responses must remain redacted even if the current UI shows names or
  contact values from local state.

## Review Conclusion

The Recipients dry-run design is safe as a planning artifact and correctly
forbids writes. It should not move to endpoint implementation yet. The next
useful step is to revise the design with the duplicate/timestamp/merge
corrections above, then add lightweight validation parity tests or diagnostics
before any server route is written.

Status note: the design has since been revised to narrow the first future
implementation slice to create/update/activate/deactivate dry-runs only.
Delete and merge dry-runs remain deferred.
