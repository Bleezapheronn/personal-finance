import React, { useEffect, useState } from "react";
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonMenuButton,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonInput,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonCardTitle,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonCheckbox,
  IonIcon,
} from "@ionic/react";
import {
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
} from "ionicons/icons";
import { db } from "../db";
import type { Recipient } from "../db";

type NewRecipient = Omit<Recipient, "id">;

const RecipientsManagement: React.FC = () => {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tillNumber, setTillNumber] = useState("");
  const [paybill, setPaybill] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [deleteRecipientId, setDeleteRecipientId] = useState<number | null>(
    null
  );

  useEffect(() => {
    fetchRecipients();
  }, []);

  const fetchRecipients = async () => {
    try {
      const all = await db.recipients.toArray();
      setRecipients(all);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to load recipients");
      setShowAlert(true);
    }
  };

  const resetForm = () => {
    setRecipientId(null);
    setName("");
    setEmail("");
    setPhone("");
    setTillNumber("");
    setPaybill("");
    setAccountNumber("");
    setIsActive(true);
  };

  const handleAddOrUpdateRecipient = async () => {
    if (!name.trim()) {
      setAlertMessage("Recipient name is required");
      setShowAlert(true);
      return;
    }

    // Ensure account number is only provided when paybill is present
    if (accountNumber.trim() && !paybill.trim()) {
      setAlertMessage(
        "Enter a Paybill number before providing an Account Number"
      );
      setShowAlert(true);
      return;
    }

    const now = new Date();
    try {
      if (recipientId !== null) {
        // update existing
        await db.recipients.update(recipientId, {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          tillNumber: tillNumber.trim() || undefined,
          paybill: paybill.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          isActive,
          updatedAt: now,
        } as Partial<Recipient>);
        setAlertMessage("Recipient updated");
      } else {
        // add new
        const newRecipient: NewRecipient = {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          tillNumber: tillNumber.trim() || undefined,
          paybill: paybill.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          isActive,
          createdAt: now,
          updatedAt: now,
        };
        await db.recipients.add(newRecipient);
        setAlertMessage("Recipient added");
      }
      resetForm();
      await fetchRecipients();
      setShowAlert(true);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to save recipient");
      setShowAlert(true);
    }
  };

  const editRecipient = (r: Recipient) => {
    setRecipientId(r.id ?? null);
    setName(r.name);
    setEmail(r.email ?? "");
    setPhone(r.phone ?? "");
    setTillNumber(r.tillNumber ?? "");
    setPaybill(r.paybill ?? "");
    setAccountNumber(r.accountNumber ?? "");
    setIsActive(Boolean(r.isActive));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteRecipient = async (id?: number) => {
    if (!id) return;
    try {
      await db.recipients.delete(id);
      await fetchRecipients();
      setAlertMessage("Recipient deleted");
      setDeleteRecipientId(null);
      setShowAlert(true);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to delete recipient");
      setShowAlert(true);
    }
  };

  const toggleRecipientActive = async (r: Recipient) => {
    if (r.id == null) return;
    try {
      const now = new Date();
      await db.recipients.update(r.id, {
        isActive: !r.isActive,
        updatedAt: now,
      } as Partial<Recipient>);
      await fetchRecipients();
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to update recipient");
      setShowAlert(true);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Manage Recipients</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Add/Edit Form */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {recipientId ? "Edit Recipient" : "Add Recipient"}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonInput
                    label="Recipient Name"
                    labelPlacement="stacked"
                    placeholder="e.g., John Doe"
                    value={name}
                    onIonChange={(e) => setName(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonInput
                    label="Phone (optional)"
                    labelPlacement="stacked"
                    type="tel"
                    placeholder="e.g., 0712345678"
                    value={phone}
                    onIonChange={(e) => setPhone(e.detail.value!)}
                  />
                </IonCol>
                <IonCol>
                  <IonInput
                    label="Email (optional)"
                    labelPlacement="stacked"
                    type="email"
                    placeholder="e.g., john@example.com"
                    value={email}
                    onIonChange={(e) => setEmail(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonInput
                    label="Till Number (optional)"
                    labelPlacement="stacked"
                    placeholder="e.g., 123456"
                    value={tillNumber}
                    onIonChange={(e) => setTillNumber(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonInput
                    label="Paybill (optional)"
                    labelPlacement="stacked"
                    placeholder="e.g., 400200"
                    value={paybill}
                    onIonChange={(e) => {
                      const val = e.detail.value ?? "";
                      setPaybill(val);
                      // clear account number when paybill is removed
                      if (!val.trim()) setAccountNumber("");
                    }}
                  />
                </IonCol>
                <IonCol>
                  <IonInput
                    label="Account Number (optional)"
                    labelPlacement="stacked"
                    placeholder="e.g., 1234567890"
                    value={accountNumber}
                    onIonChange={(e) => setAccountNumber(e.detail.value!)}
                    disabled={!paybill.trim()} // only editable when paybill present
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem lines="none">
                    <IonLabel>Active</IonLabel>
                    <IonCheckbox
                      checked={isActive}
                      onIonChange={(e) =>
                        setIsActive(Boolean(e.detail.checked))
                      }
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton
                    expand="block"
                    onClick={handleAddOrUpdateRecipient}
                  >
                    {recipientId ? "Update Recipient" : "Add Recipient"}
                  </IonButton>
                </IonCol>
                {recipientId && (
                  <IonCol>
                    <IonButton
                      expand="block"
                      color="medium"
                      onClick={resetForm}
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* Recipients List */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Recipients</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {recipients.length === 0 ? (
              <p>No recipients yet. Add one to get started.</p>
            ) : (
              <IonList>
                {recipients.map((r) => (
                  <IonItem key={r.id}>
                    <IonLabel>
                      <h3>
                        <strong>{r.name}</strong>
                      </h3>
                      {(r.email ||
                        r.phone ||
                        r.tillNumber ||
                        r.paybill ||
                        r.accountNumber) && (
                        <div>
                          {r.email && <p style={{ margin: 0 }}>{r.email}</p>}
                          {r.phone && <p style={{ margin: 0 }}>{r.phone}</p>}
                          {r.tillNumber && (
                            <p style={{ margin: 0 }}>Till: {r.tillNumber}</p>
                          )}

                          {/* paybill and account on same line */}
                          {(r.paybill || r.accountNumber) && (
                            <p
                              style={{
                                display: "flex",
                                gap: 12,
                                alignItems: "center",
                                margin: 0,
                              }}
                            >
                              {r.paybill && <span>Paybill: {r.paybill}</span>}
                              {r.accountNumber && (
                                <span>Acc: {r.accountNumber}</span>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </IonLabel>

                    <IonButton
                      slot="end"
                      fill="clear"
                      size="small"
                      onClick={() => editRecipient(r)}
                      aria-label={`Edit ${r.name}`}
                      title="Edit"
                    >
                      <IonIcon icon={createOutline} />
                    </IonButton>

                    <IonButton
                      slot="end"
                      fill="clear"
                      size="small"
                      onClick={() => toggleRecipientActive(r)}
                      aria-label={
                        r.isActive
                          ? `Deactivate ${r.name}`
                          : `Activate ${r.name}`
                      }
                      title={
                        r.isActive
                          ? "Active (click to deactivate)"
                          : "Inactive (click to activate)"
                      }
                    >
                      <IonIcon
                        icon={
                          r.isActive
                            ? checkmarkCircleOutline
                            : closeCircleOutline
                        }
                      />
                    </IonButton>

                    <IonButton
                      slot="end"
                      color="danger"
                      fill="clear"
                      size="small"
                      onClick={() => setDeleteRecipientId(r.id ?? null)}
                      aria-label={`Delete ${r.name}`}
                      title="Delete"
                    >
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  </IonItem>
                ))}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        {/* Delete Confirmation Alert */}
        <IonAlert
          isOpen={!!deleteRecipientId}
          onDidDismiss={() => setDeleteRecipientId(null)}
          header={"Confirm Delete"}
          message={
            "Are you sure you want to delete this recipient? This action cannot be undone."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              cssClass: "secondary",
              handler: () => {},
            },
            {
              text: "Delete",
              handler: () => {
                if (deleteRecipientId) {
                  deleteRecipient(deleteRecipientId);
                }
              },
            },
          ]}
        />

        {/* Generic Alert for Messages */}
        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header={"Alert"}
          message={alertMessage}
          buttons={["OK"]}
        />
      </IonContent>
    </IonPage>
  );
};

export default RecipientsManagement;
