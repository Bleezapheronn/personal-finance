import { Recipient, db } from "../db";

export const listRecipients = async (): Promise<Recipient[]> => {
  return db.recipients.toArray();
};

export const listActiveRecipients = async (): Promise<Recipient[]> => {
  const recipients = await listRecipients();
  return recipients.filter((recipient) => recipient.isActive !== false);
};

export const getRecipientById = async (
  id: number,
): Promise<Recipient | undefined> => {
  return db.recipients.get(id);
};
