export const normalizeRecipientName = (value) =>
  value.trim().replace(/\s+/gu, " ");

export const recipientNameMatchKey = (value) =>
  normalizeRecipientName(value).toLowerCase();
