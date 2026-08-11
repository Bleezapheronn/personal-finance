export const unpaidOccurrenceTargetAmount = (
  effectiveTarget: number,
  amountPaid: number,
): number => Math.max(0, Math.abs(effectiveTarget) - Math.abs(amountPaid));

export const shouldInitializeOccurrencePaymentForm = ({
  occurrenceKey,
  lookupDataOccurrenceKey,
  initializedOccurrenceKey,
  userEditedOccurrenceKey,
}: {
  occurrenceKey: string;
  lookupDataOccurrenceKey: string | null;
  initializedOccurrenceKey: string | null;
  userEditedOccurrenceKey: string | null;
}): boolean =>
  lookupDataOccurrenceKey === occurrenceKey &&
  initializedOccurrenceKey !== occurrenceKey &&
  userEditedOccurrenceKey !== occurrenceKey;
