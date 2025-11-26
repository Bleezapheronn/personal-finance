export interface TransactionFormData {
  selectedDate: string;
  selectedTime: string;
  amount: string;
  description: string;
  categoryId?: number;
  paymentMethodId?: number;
  recipientId?: number;
  transferToPaymentMethodId?: number;
  transactionType: "expense" | "income" | "transfer";
}

export interface ValidationErrors {
  date?: boolean;
  time?: boolean;
  amount?: boolean;
  description?: boolean;
  category?: boolean;
  paymentMethod?: boolean;
  recipient?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationErrors;
  errorMessage?: string;
}

/**
 * Validates the transaction form data
 */
export const validateTransactionForm = (
  formData: TransactionFormData
): ValidationResult => {
  const errors: ValidationErrors = {};

  // Basic required fields
  if (!formData.selectedDate) errors.date = true;
  if (!formData.selectedTime) errors.time = true;
  if (!formData.amount) errors.amount = true;
  if (!formData.description || !formData.description.trim())
    errors.description = true;

  // Transfer-specific validation
  if (formData.transactionType === "transfer") {
    if (formData.paymentMethodId == null) errors.paymentMethod = true;
    if (formData.transferToPaymentMethodId == null) errors.recipient = true;

    if (formData.paymentMethodId === formData.transferToPaymentMethodId) {
      return {
        isValid: false,
        errors,
        errorMessage:
          "Source and destination payment methods must be different.",
      };
    }
  } else {
    // Regular transaction validation (income/expense)
    if (formData.categoryId == null) errors.category = true;
    if (formData.paymentMethodId == null) errors.paymentMethod = true;
    if (formData.recipientId == null) errors.recipient = true;
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    errors,
    errorMessage: isValid ? undefined : "Please fill in all required fields.",
  };
};

/**
 * Validates that the date and time are not in the future
 */
export const validateDateTime = (
  dateTimeString: string
): { isValid: boolean; errorMessage?: string } => {
  const selectedDateTime = new Date(dateTimeString);
  const now = new Date();

  if (isNaN(selectedDateTime.getTime())) {
    return {
      isValid: false,
      errorMessage: "Invalid date or time format.",
    };
  }

  if (selectedDateTime > now) {
    return {
      isValid: false,
      errorMessage: "Date and time cannot be in the future.",
    };
  }

  return { isValid: true };
};

/**
 * Validates that the amount is a positive number
 */
export const validateAmount = (
  amount: string
): { isValid: boolean; errorMessage?: string } => {
  const numericAmount = parseFloat(amount);

  if (isNaN(numericAmount)) {
    return {
      isValid: false,
      errorMessage: "Amount must be a valid number.",
    };
  }

  if (numericAmount <= 0) {
    return {
      isValid: false,
      errorMessage: "Amount must be a positive number.",
    };
  }

  return { isValid: true };
};

/**
 * Validates exchange rate (if provided)
 */
export const validateExchangeRate = (
  exchangeRate: string
): { isValid: boolean; errorMessage?: string } => {
  if (!exchangeRate || exchangeRate.trim() === "") {
    return { isValid: true }; // Optional field
  }

  const numericRate = parseFloat(exchangeRate);

  if (isNaN(numericRate)) {
    return {
      isValid: false,
      errorMessage: "Exchange rate must be a valid number.",
    };
  }

  if (numericRate <= 0) {
    return {
      isValid: false,
      errorMessage: "Exchange rate must be a positive number.",
    };
  }

  return { isValid: true };
};
