export const shouldShowBudgetLifecycleActiveControl = (
  lifecycleWriteActive: boolean,
): boolean => lifecycleWriteActive;

export const budgetActiveStateForSubmission = (
  lifecycleWriteActive: boolean,
  selectedActiveState: boolean,
): boolean => (lifecycleWriteActive ? selectedActiveState : true);

export const budgetActiveStateForEdit = (
  storedActiveState: boolean | null | undefined,
): boolean => storedActiveState !== false;
