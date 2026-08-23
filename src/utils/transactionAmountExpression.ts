const MAX_TRANSACTION_AMOUNT = 999_999_999.99;

type AmountExpressionResult =
  | { kind: "valid"; value: number; isExpression: boolean }
  | { kind: "invalid" }
  | { kind: "incomplete" };

export interface AmountInputValidation {
  isValid: boolean;
  errorMessage?: string;
}

const decimalTerm = /(?:\d+(?:\.\d+)?|\.\d+)/y;

const skipWhitespace = (input: string, index: number): number => {
  while (index < input.length && /\s/.test(input[index])) index += 1;
  return index;
};

export const parseTransactionAmountExpression = (
  input: string,
): AmountExpressionResult => {
  let index = skipWhitespace(input, 0);
  if (index === input.length) return { kind: "incomplete" };

  decimalTerm.lastIndex = index;
  const firstTerm = decimalTerm.exec(input);
  if (!firstTerm || firstTerm.index !== index) return { kind: "invalid" };

  let value = Number(firstTerm[0]);
  index = skipWhitespace(input, decimalTerm.lastIndex);
  let isExpression = false;

  while (index < input.length) {
    const operator = input[index];
    if (operator !== "+" && operator !== "-") return { kind: "invalid" };
    isExpression = true;
    index = skipWhitespace(input, index + 1);
    if (index === input.length) return { kind: "incomplete" };

    decimalTerm.lastIndex = index;
    const nextTerm = decimalTerm.exec(input);
    if (!nextTerm || nextTerm.index !== index) return { kind: "invalid" };

    const term = Number(nextTerm[0]);
    value = operator === "+" ? value + term : value - term;
    index = skipWhitespace(input, decimalTerm.lastIndex);
  }

  return Number.isFinite(value)
    ? { kind: "valid", value, isExpression }
    : { kind: "invalid" };
};

export const validateTransactionAmountInput = (
  input: string,
): AmountInputValidation => {
  if (input.trim() === "") {
    return { isValid: false, errorMessage: "Amount is required." };
  }

  const result = parseTransactionAmountExpression(input);
  if (result.kind === "incomplete") {
    return { isValid: false, errorMessage: "Amount expression is incomplete." };
  }
  if (result.kind === "invalid") {
    return {
      isValid: false,
      errorMessage: "Amount must be a valid number or +/− expression.",
    };
  }
  if (result.value <= 0) {
    return { isValid: false, errorMessage: "Amount must be greater than 0." };
  }
  if (result.value > MAX_TRANSACTION_AMOUNT) {
    return { isValid: false, errorMessage: "Amount is too large." };
  }

  return { isValid: true };
};

export const resolvedTransactionAmount = (input: string): number | undefined => {
  const validation = validateTransactionAmountInput(input);
  if (!validation.isValid) return undefined;

  const result = parseTransactionAmountExpression(input);
  return result.kind === "valid" ? result.value : undefined;
};

export const resolvedExpressionDisplayValue = (
  input: string,
): string | undefined => {
  const result = parseTransactionAmountExpression(input);
  const value = resolvedTransactionAmount(input);
  return result.kind === "valid" && result.isExpression && value !== undefined
    ? value.toString()
    : undefined;
};
