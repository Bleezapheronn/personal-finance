import React, { useState, useEffect, useCallback } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonText,
  IonInput,
  IonItem,
  IonIcon,
  IonToast,
  IonList,
  IonCard,
  IonCardContent,
} from "@ionic/react";
import { close, trash } from "ionicons/icons";
import {
  db,
  Budget,
  Category,
  Bucket,
  PaymentMethod,
  Transaction,
} from "../db";

interface BudgetOccurrence {
  budgetId: number;
  budget: Budget;
  dueDate: Date;
  amountPaid: number;
  isCompleted: boolean;
  timeGroup: string;
  linkedTransactions: Transaction[];
}

interface CompleteBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgetOccurrence: BudgetOccurrence;
  onComplete: () => void;
}

export const CompleteBudgetModal: React.FC<CompleteBudgetModalProps> = ({
  isOpen,
  onClose,
  budgetOccurrence,
  onComplete,
}) => {
  const [transactionReference, setTransactionReference] = useState("");
  const [transactionTime, setTransactionTime] = useState("");
  const [transactionAmount, setTransactionAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // Load lookup data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLookupData();
    }
  }, [isOpen]);

  const loadLookupData = async () => {
    try {
      const [cats, bkts, pms] = await Promise.all([
        db.categories.toArray(),
        db.buckets.toArray(),
        db.paymentMethods.toArray(),
      ]);

      setCategories(cats);
      setBuckets(bkts);
      setPaymentMethods(pms);
    } catch (err) {
      console.error("Failed to load lookup data:", err);
    }
  };

  const getRemainingAmount = useCallback((): number => {
    const totalBudgetAmount =
      budgetOccurrence.budget.amount +
      (budgetOccurrence.budget.transactionCost || 0);
    const amountPaid = budgetOccurrence.amountPaid;

    // Work with absolute values for comparison
    const totalAbsAmount = Math.abs(totalBudgetAmount);
    const paidAbsAmount = Math.abs(amountPaid);

    // Calculate remaining as positive value
    const remainingAbs = totalAbsAmount - paidAbsAmount;

    // Return the remaining amount (positive means still need to pay)
    return remainingAbs;
  }, [
    budgetOccurrence.budget.amount,
    budgetOccurrence.budget.transactionCost,
    budgetOccurrence.amountPaid,
  ]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTransactionReference("");
      setTransactionTime("");
      // Pre-fill with remaining amount (use absolute value)
      const remaining = getRemainingAmount();
      setTransactionAmount(Math.abs(remaining).toString());
      // Pre-fill transaction cost with budget's transaction cost if available
      setTransactionCost(
        budgetOccurrence.budget.transactionCost
          ? Math.abs(budgetOccurrence.budget.transactionCost).toString()
          : ""
      );
      setErrorMsg("");
      setSuccessMsg("");
    }
  }, [isOpen, getRemainingAmount, budgetOccurrence.budget.transactionCost]);

  const getBucketName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    return buckets.find((b) => b.id === cat?.bucketId)?.name || "";
  };

  const getPaymentMethodName = (paymentMethodId: number) =>
    paymentMethods.find((p) => p.id === paymentMethodId)?.name || "—";

  const handleAddTransaction = async () => {
    setErrorMsg("");

    // Validate inputs
    if (!transactionTime) {
      setErrorMsg("Transaction time is required");
      return;
    }

    if (!transactionAmount || transactionAmount.trim() === "") {
      setErrorMsg("Transaction amount is required");
      return;
    }

    const amount = parseFloat(transactionAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg("Transaction amount must be a positive number");
      return;
    }

    // Validate transaction cost if provided
    let cost: number | undefined = undefined;
    if (transactionCost && transactionCost.trim() !== "") {
      cost = parseFloat(transactionCost);
      if (isNaN(cost) || cost < 0) {
        setErrorMsg("Transaction cost must be a positive number or empty");
        return;
      }
      if (cost === 0) {
        cost = undefined; // Don't store zero costs
      }
    }

    try {
      setLoading(true);

      // Parse transaction time
      const transactionDate = new Date(transactionTime);
      if (isNaN(transactionDate.getTime())) {
        setErrorMsg("Invalid transaction time");
        return;
      }

      // Check if transaction date is in future (not allowed)
      const now = new Date();
      if (transactionDate > now) {
        setErrorMsg("Transaction date cannot be in the future");
        return;
      }

      // Calculate signed amount based on budget type
      const signedAmount =
        budgetOccurrence.budget.amount < 0
          ? -Math.abs(amount)
          : Math.abs(amount);

      // Calculate signed transaction cost if it exists
      let signedCost: number | undefined = undefined;
      if (cost !== undefined) {
        signedCost =
          budgetOccurrence.budget.amount < 0 ? -Math.abs(cost) : Math.abs(cost);
      }

      // Create transaction with occurrenceDate
      const newTransaction: Omit<Transaction, "id"> = {
        categoryId: budgetOccurrence.budget.categoryId,
        paymentChannelId: budgetOccurrence.budget.paymentChannelId,
        recipientId: budgetOccurrence.budget.recipientId || 0,
        date: transactionDate,
        amount: signedAmount,
        transactionCost: signedCost,
        transactionReference: transactionReference.trim() || undefined,
        budgetId: budgetOccurrence.budgetId,
        occurrenceDate: budgetOccurrence.dueDate,
      };

      await db.transactions.add(newTransaction);

      setSuccessMsg("Transaction added successfully!");
      setShowSuccessToast(true);

      // Reset form
      setTransactionReference("");
      setTransactionTime("");
      setTransactionAmount("");
      setTransactionCost("");

      // Notify parent to reload
      setTimeout(() => {
        onComplete();
      }, 500);
    } catch (error) {
      console.error("Error adding transaction:", error);
      setErrorMsg("Failed to add transaction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLinkedTransaction = async (txnId: number) => {
    try {
      await db.transactions.delete(txnId);
      onComplete();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      setErrorMsg("Failed to delete transaction");
    }
  };

  const remaining = getRemainingAmount();

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Payment</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonGrid>
          {/* Budget Details Card */}
          <IonRow>
            <IonCol>
              <IonCard>
                <IonCardContent>
                  <h2 style={{ margin: "0 0 12px 0" }}>
                    {budgetOccurrence.budget.description}
                  </h2>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                      fontSize: "0.9rem",
                      color: "#666",
                    }}
                  >
                    <span>
                      {getBucketName(budgetOccurrence.budget.categoryId)} •{" "}
                      {getPaymentMethodName(
                        budgetOccurrence.budget.paymentChannelId
                      )}
                    </span>
                    <span>{budgetOccurrence.dueDate.toLocaleDateString()}</span>
                  </div>

                  {/* Progress section */}
                  <div
                    style={{
                      backgroundColor: "#f5f5f5",
                      padding: "12px",
                      borderRadius: "4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "8px",
                      }}
                    >
                      <span style={{ fontSize: "0.9rem", fontWeight: "bold" }}>
                        Progress
                      </span>
                      <span
                        style={{
                          fontSize: "1.1rem",
                          fontWeight: "bold",
                          color:
                            budgetOccurrence.budget.amount < 0
                              ? "#D44619"
                              : "#009688",
                        }}
                      >
                        {Math.abs(budgetOccurrence.amountPaid).toLocaleString(
                          undefined,
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}{" "}
                        /{" "}
                        {Math.abs(
                          budgetOccurrence.budget.amount +
                            (budgetOccurrence.budget.transactionCost || 0)
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>

                    {/* Remaining / Completed / Overpaid */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.85rem",
                      }}
                    >
                      <span
                        style={{
                          color:
                            remaining > 0
                              ? "#FF9800" // Orange for remaining
                              : remaining === 0
                              ? "#4CAF50" // Green for completed
                              : "#9C27B0", // Purple for overpaid
                        }}
                      >
                        {remaining > 0
                          ? "Remaining"
                          : remaining === 0
                          ? "Completed"
                          : "Overpaid"}
                      </span>
                      <span
                        style={{
                          fontWeight: "bold",
                          color:
                            remaining > 0
                              ? "#FF9800" // Orange for remaining
                              : remaining === 0
                              ? "#4CAF50" // Green for completed
                              : "#9C27B0", // Purple for overpaid
                        }}
                      >
                        {Math.abs(remaining).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>

          {/* Error message */}
          <IonRow>
            <IonCol>
              {errorMsg && (
                <IonText color="danger" style={{ fontSize: "0.9rem" }}>
                  {errorMsg}
                </IonText>
              )}
            </IonCol>
          </IonRow>

          {/* Transaction Date/Time */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Transaction Date/Time</label>
                <IonInput
                  className="form-input"
                  type="datetime-local"
                  value={transactionTime}
                  onIonChange={(e) => setTransactionTime(e.detail.value ?? "")}
                  disabled={loading}
                />
              </div>
            </IonCol>

            {/* Transaction Reference (optional) */}
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">
                  Transaction Reference (optional)
                </label>
                <IonInput
                  className="form-input"
                  type="text"
                  placeholder="e.g. M-Pesa Ref, Check #"
                  value={transactionReference}
                  onIonChange={(e) =>
                    setTransactionReference(e.detail.value ?? "")
                  }
                  disabled={loading}
                />
              </div>
            </IonCol>
          </IonRow>

          {/* Transaction Amount */}
          <IonRow>
            <IonCol size="8">
              <div className="form-input-wrapper">
                <label className="form-label">Transaction Amount</label>
                <IonInput
                  className="form-input"
                  type="number"
                  placeholder="e.g. 1,000"
                  value={transactionAmount}
                  onIonChange={(e) =>
                    setTransactionAmount(e.detail.value ?? "")
                  }
                  disabled={loading}
                  step="0.01"
                  inputMode="decimal"
                />
              </div>
            </IonCol>

            {/* Transaction Cost (optional) */}
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">
                  Transaction Cost (optional)
                </label>
                <IonInput
                  className="form-input"
                  type="number"
                  placeholder="e.g. 13.00"
                  value={transactionCost}
                  onIonChange={(e) => setTransactionCost(e.detail.value ?? "")}
                  disabled={loading}
                  step="0.01"
                  inputMode="decimal"
                />
              </div>
            </IonCol>
          </IonRow>

          {/* Add Transaction Button */}
          <IonRow>
            <IonCol>
              <IonButton
                expand="block"
                color="primary"
                onClick={handleAddTransaction}
                disabled={loading}
              >
                Add Payment
              </IonButton>
            </IonCol>
          </IonRow>

          {/* Linked Transactions Section */}
          {budgetOccurrence.linkedTransactions.length > 0 && (
            <>
              <IonRow>
                <IonCol>
                  <h3
                    style={{
                      marginTop: "24px",
                      marginBottom: "12px",
                      fontSize: "0.9rem",
                      fontWeight: "bold",
                      color: "#999",
                      textTransform: "uppercase",
                    }}
                  >
                    Linked Payments (
                    {budgetOccurrence.linkedTransactions.length})
                  </h3>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonList>
                    {budgetOccurrence.linkedTransactions.map((txn) => {
                      // Calculate total amount including transaction cost
                      const totalAmount =
                        txn.amount + (txn.transactionCost || 0);
                      return (
                        <IonItem key={txn.id}>
                          <IonGrid style={{ width: "100%", padding: 0 }}>
                            <IonRow>
                              <IonCol size="7">
                                <div style={{ fontSize: "0.9rem" }}>
                                  <div style={{ fontWeight: "bold" }}>
                                    {txn.date.toLocaleDateString()}{" "}
                                    {txn.date.toLocaleTimeString("en-US", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "0.85rem",
                                      color: "#666",
                                    }}
                                  >
                                    {txn.transactionReference || "No reference"}
                                  </div>
                                </div>
                              </IonCol>
                              <IonCol size="4" style={{ textAlign: "right" }}>
                                <div
                                  style={{
                                    fontWeight: "bold",
                                    color:
                                      totalAmount < 0 ? "#D44619" : "#009688",
                                  }}
                                >
                                  {Math.abs(totalAmount).toLocaleString(
                                    undefined,
                                    {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    }
                                  )}
                                </div>
                              </IonCol>
                              <IonCol size="1" style={{ textAlign: "right" }}>
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  color="danger"
                                  onClick={() =>
                                    handleDeleteLinkedTransaction(txn.id!)
                                  }
                                >
                                  <IonIcon icon={trash} />
                                </IonButton>
                              </IonCol>
                            </IonRow>
                          </IonGrid>
                        </IonItem>
                      );
                    })}
                  </IonList>
                </IonCol>
              </IonRow>
            </>
          )}
        </IonGrid>
      </IonContent>

      {/* Success Toast */}
      <IonToast
        isOpen={showSuccessToast}
        onDidDismiss={() => setShowSuccessToast(false)}
        message={successMsg}
        duration={2000}
        position="top"
        color="success"
      />
    </IonModal>
  );
};
