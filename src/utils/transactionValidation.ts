export interface TransactionFormData {
  selectedDate: string;
  selectedTime: string;
  amount: string;
  description: string;
  categoryId?: number;
  accountId?: number; // CHANGED from paymentMethodId
  recipientId?: number;
  transferRecipientId?: number;
  transferToAccountId?: number; // CHANGED from transferToPaymentMethodId
  transactionType: "expense" | "income" | "transfer";
}

export interface ValidationErrors {
  date?: boolean;
  time?: boolean;
  amount?: boolean;
  description?: boolean;
  recipient?: boolean;
  category?: boolean;
  account?: boolean; // CHANGED from paymentMethod
  transferRecipient?: boolean;
  transferToAccount?: boolean; // CHANGED from transferToPaymentMethod
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationErrors;
  errorMessage?: string;
}

/**
 * Validates the transaction form data
 */
export const validateTransactionForm = (data: {
  selectedDate: string;
  selectedTime: string;
  amount: string;
  description: string;
  categoryId: number | undefined;
  accountId: number | undefined; // CHANGED from paymentMethodId
  recipientId: number | undefined;
  transferRecipientId?: number | undefined;
  transferToAccountId?: number | undefined; // CHANGED from transferToPaymentMethodId
  transactionType: "income" | "expense" | "transfer";
}): ValidationResult => {
  const errors: ValidationErrors = {};

  // Date validation
  if (!data.selectedDate || data.selectedDate.trim() === "") {
    errors.date = true;
  }

  // Time validation
  if (!data.selectedTime || data.selectedTime.trim() === "") {
    errors.time = true;
  }

  // Amount validation
  if (!data.amount || data.amount.trim() === "") {
    errors.amount = true;
  } else {
    const numAmount = parseFloat(data.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      errors.amount = true;
    }
  }

  // Description validation
  if (!data.description || data.description.trim() === "") {
    errors.description = true;
  }

  // Category validation
  if (!data.categoryId) {
    errors.category = true;
  }

  // Account validation - CHANGED from paymentMethod
  if (!data.accountId) {
    errors.account = true;
  }

  // Recipient validation
  if (!data.recipientId) {
    errors.recipient = true;
  }

  // Transfer-specific validations
  if (data.transactionType === "transfer") {
    if (!data.transferRecipientId) {
      errors.transferRecipient = true;
    }

    if (!data.transferToAccountId) {
      errors.transferToAccount = true;
    }

    // Ensure different accounts for transfer - CHANGED from paymentMethods
    if (
      data.accountId &&
      data.transferToAccountId &&
      data.accountId === data.transferToAccountId
    ) {
      errors.transferToAccount = true;
      return {
        isValid: false,
        errors,
        errorMessage:
          "Transfer must use different accounts for source and destination.",
      };
    }

    // Ensure different recipients for transfer
    if (
      data.recipientId &&
      data.transferRecipientId &&
      data.recipientId === data.transferRecipientId
    ) {
      errors.transferRecipient = true;
      return {
        isValid: false,
        errors,
        errorMessage: "Transfer payer and recipient must be different.",
      };
    }
  }

  const isValid = Object.keys(errors).length === 0;
  const errorMessage = isValid
    ? undefined
    : "Please fill in all required fields correctly.";

  return { isValid, errors, errorMessage };
};

/**
 * Validates that the date and time are not in the future
 */
export const validateDateTime = (dateTimeString: string): ValidationResult => {
  try {
    const date = new Date(dateTimeString);

    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        errors: { date: true, time: true },
        errorMessage: "Invalid date or time format.",
      };
    }

    // Optional: Check if date is not in the future
    const now = new Date();
    if (date > now) {
      return {
        isValid: false,
        errors: { date: true, time: true },
        errorMessage: "Transaction date cannot be in the future.",
      };
    }

    return { isValid: true, errors: {} };
  } catch {
    return {
      isValid: false,
      errors: { date: true, time: true },
      errorMessage: "Invalid date or time.",
    };
  }
};

/**
 * Validates that the amount is a positive number
 */
export const validateAmount = (amount: string): ValidationResult => {
  if (!amount || amount.trim() === "") {
    return {
      isValid: false,
      errors: { amount: true },
      errorMessage: "Amount is required.",
    };
  }

  const numAmount = parseFloat(amount);

  if (isNaN(numAmount)) {
    return {
      isValid: false,
      errors: { amount: true },
      errorMessage: "Amount must be a valid number.",
    };
  }

  if (numAmount <= 0) {
    return {
      isValid: false,
      errors: { amount: true },
      errorMessage: "Amount must be greater than 0.",
    };
  }

  if (numAmount > 999999999.99) {
    return {
      isValid: false,
      errors: { amount: true },
      errorMessage: "Amount is too large.",
    };
  }

  return { isValid: true, errors: {} };
};

/**
 * Validates transaction cost (if provided)
 */
export const validateTransactionCost = (cost: string): ValidationResult => {
  if (!cost || cost.trim() === "") {
    // Transaction cost is optional
    return { isValid: true, errors: {} };
  }

  const numCost = parseFloat(cost);

  if (isNaN(numCost)) {
    return {
      isValid: false,
      errors: {},
      errorMessage: "Transaction cost must be a valid number.",
    };
  }

  if (numCost < 0) {
    return {
      isValid: false,
      errors: {},
      errorMessage: "Transaction cost cannot be negative.",
    };
  }

  if (numCost > 999999.99) {
    return {
      isValid: false,
      errors: {},
      errorMessage: "Transaction cost is too large.",
    };
  }

  return { isValid: true, errors: {} };
};

/**
 * Validates description length and content
 */
export const validateDescription = (description: string): ValidationResult => {
  if (!description || description.trim() === "") {
    return {
      isValid: false,
      errors: { description: true },
      errorMessage: "Description is required.",
    };
  }

  if (description.trim().length < 2) {
    return {
      isValid: false,
      errors: { description: true },
      errorMessage: "Description must be at least 2 characters.",
    };
  }

  if (description.length > 500) {
    return {
      isValid: false,
      errors: { description: true },
      errorMessage: "Description cannot exceed 500 characters.",
    };
  }

  return { isValid: true, errors: {} };
};
