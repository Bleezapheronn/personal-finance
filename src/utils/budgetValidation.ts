export interface ValidationErrors {
  [key: string]: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationErrors;
  errorMessage?: string;
}

/**
 * Validates the entire budget form
 */
export const validateBudgetForm = (data: {
  description: string;
  amount: string;
  dueDate: string;
  categoryId?: number;
  accountId?: number; // CHANGED from paymentMethodId
  recipientId?: number;
  frequency: string;
  dayOfMonth?: string;
  intervalDays?: string;
}): ValidationResult => {
  const errors: ValidationErrors = {};
  const errorMessages: string[] = [];

  // Validate description
  if (!data.description || !data.description.trim()) {
    errors.description = true;
    errorMessages.push("Description is required");
  }

  // Validate amount
  if (!data.amount || !data.amount.trim()) {
    errors.amount = true;
    errorMessages.push("Amount is required");
  }

  // Validate dueDate
  if (!data.dueDate) {
    errors.dueDate = true;
    errorMessages.push("Due date is required");
  } else {
    const dueDateObj = new Date(data.dueDate);
    if (isNaN(dueDateObj.getTime())) {
      errors.dueDate = true;
      errorMessages.push("Invalid due date");
    }
  }

  // Validate categoryId
  if (!data.categoryId) {
    errors.category = true;
    errorMessages.push("Category is required");
  }

  // Validate accountId - CHANGED from paymentMethodId
  if (!data.accountId) {
    errors.account = true;
    errorMessages.push("Account is required");
  }

  // Validate frequency-specific fields
  if (data.frequency === "monthly") {
    if (!data.dayOfMonth || !data.dayOfMonth.trim()) {
      errors.dayOfMonth = true;
      errorMessages.push("Day of month is required for monthly frequency");
    } else {
      const day = parseInt(data.dayOfMonth, 10);
      if (isNaN(day) || day < 1 || day > 31) {
        errors.dayOfMonth = true;
        errorMessages.push("Day of month must be between 1 and 31");
      }
    }
  }

  if (data.frequency === "custom") {
    if (!data.intervalDays || !data.intervalDays.trim()) {
      errors.intervalDays = true;
      errorMessages.push("Interval days is required for custom frequency");
    } else {
      const days = parseInt(data.intervalDays, 10);
      if (isNaN(days) || days < 1) {
        errors.intervalDays = true;
        errorMessages.push("Interval days must be a positive number");
      }
    }
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    errors,
    errorMessage: errorMessages.join("; "),
  };
};

/**
 * Validates the amount field
 */
export const validateAmount = (amount: string): ValidationResult => {
  const errors: ValidationErrors = {};

  if (!amount || !amount.trim()) {
    errors.amount = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Amount is required",
    };
  }

  const numericAmount = parseFloat(amount);

  if (isNaN(numericAmount)) {
    errors.amount = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Amount must be a valid number",
    };
  }

  if (numericAmount <= 0) {
    errors.amount = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Amount must be greater than 0",
    };
  }

  return {
    isValid: true,
    errors,
  };
};

/**
 * Validates the description field
 */
export const validateDescription = (description: string): ValidationResult => {
  const errors: ValidationErrors = {};

  if (!description || !description.trim()) {
    errors.description = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Description is required",
    };
  }

  if (description.trim().length < 3) {
    errors.description = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Description must be at least 3 characters",
    };
  }

  if (description.trim().length > 100) {
    errors.description = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Description must not exceed 100 characters",
    };
  }

  return {
    isValid: true,
    errors,
  };
};

/**
 * Validates due date is not in the past
 */
export const validateDueDateNotInPast = (dueDate: string): ValidationResult => {
  const errors: ValidationErrors = {};

  if (!dueDate) {
    errors.dueDate = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Due date is required",
    };
  }

  const dueDateObj = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dueDateObj < today) {
    errors.dueDate = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Due date cannot be in the past",
    };
  }

  return {
    isValid: true,
    errors,
  };
};

/**
 * Validates transaction cost (optional, but if provided must be valid)
 */
export const validateTransactionCost = (cost: string): ValidationResult => {
  const errors: ValidationErrors = {};

  if (!cost || !cost.trim()) {
    // Transaction cost is optional, so empty is valid
    return {
      isValid: true,
      errors,
    };
  }

  const numericCost = parseFloat(cost);

  if (isNaN(numericCost)) {
    errors.transactionCost = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Transaction cost must be a valid number",
    };
  }

  if (numericCost < 0) {
    errors.transactionCost = true;
    return {
      isValid: false,
      errors,
      errorMessage: "Transaction cost cannot be negative",
    };
  }

  return {
    isValid: true,
    errors,
  };
};
