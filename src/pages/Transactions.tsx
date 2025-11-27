import React, { useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonList,
  IonItem,
  IonText,
  IonSpinner,
  IonButton,
  IonIcon,
  useIonViewWillEnter,
  IonGrid,
  IonRow,
  IonCol,
  IonAvatar,
  IonImg,
  IonChip,
  IonLabel,
  IonCard,
  IonCardContent,
  IonAlert,
  IonAccordion,
  IonAccordionGroup,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";

import { useHistory } from "react-router-dom";
import {
  createOutline,
  trashOutline,
  arrowUpCircle,
  arrowDownCircle,
  closeCircleOutline,
} from "ionicons/icons";
import {
  db,
  Transaction,
  Category,
  PaymentMethod,
  Recipient,
  Bucket,
  Account,
} from "../db";

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountImages, setAccountImages] = useState<Map<number, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<
    number | undefined
  >(undefined);
  const [isTransferDelete, setIsTransferDelete] = useState(false);

  // Filter states
  const [selectedAccountId, setSelectedAccountId] = useState<
    number | undefined
  >(undefined);
  const [selectedRecipientId, setSelectedRecipientId] = useState<
    number | undefined
  >(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    number | undefined
  >(undefined);
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>("");
  const [selectedDateTo, setSelectedDateTo] = useState<string>("");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<
    number | undefined
  >(undefined);

  const history = useHistory();

  const fetchTransactions = async () => {
    setLoading(true);

    try {
      const [allTransactions, cats, bkts, pms, recs, accs] = await Promise.all([
        db.transactions.toArray(),
        db.categories.toArray(),
        db.buckets.toArray(),
        db.paymentMethods.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
      ]);

      setCategories(cats);
      setBuckets(bkts);
      setPaymentMethods(pms);
      setRecipients(recs);
      setAccounts(accs);

      // Convert account image blobs to URLs
      const imageMap = new Map<number, string>();
      for (const acc of accs) {
        if (acc.id && acc.imageBlob) {
          const url = URL.createObjectURL(acc.imageBlob);
          imageMap.set(acc.id, url);
        }
      }
      setAccountImages(imageMap);

      // Sort descending by date and time, then by total amount (lowest to highest)
      const sortedTransactions = allTransactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateB !== dateA) {
          return dateB - dateA;
        }
        const totalA = a.amount + (a.transactionCost || 0);
        const totalB = b.amount + (b.transactionCost || 0);

        const isAIncoming = totalA >= 0;
        const isBIncoming = totalB >= 0;

        if (isAIncoming && !isBIncoming) return -1;
        if (!isAIncoming && isBIncoming) return 1;

        return totalA - totalB;
      });

      setTransactions(sortedTransactions);
      setError("");
    } catch (err) {
      setError("Failed to load transactions.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // This hook runs every time the page is about to enter and become active
  useIonViewWillEnter(() => {
    fetchTransactions();
  });

  // Handler to navigate to Transaction Details page with transaction ID
  const handleView = (id?: number) => {
    if (id !== undefined) {
      history.push(`/transaction-details/${id}`);
    }
  };

  // Handler to navigate to Edit Transaction page
  const handleEdit = (id?: number) => {
    if (id !== undefined) {
      history.push(`/edit/${id}`);
    }
  };

  // Handler to delete a transaction with confirmation
  const handleDeleteClick = async (id?: number) => {
    if (id === undefined) return;
    const isTransfer = await isTransferTransaction(id);
    setIsTransferDelete(isTransfer);
    setTransactionToDelete(id);
    setShowDeleteConfirm(true);
  };

  // Add this helper to check if transaction is a transfer
  const isTransferTransaction = async (id: number): Promise<boolean> => {
    try {
      const txn = await db.transactions.get(id);
      return txn?.isTransfer ?? false;
    } catch {
      return false;
    }
  };

  const handleConfirmDelete = async () => {
    if (transactionToDelete === undefined) return;
    try {
      // Get the transaction to check if it's a transfer
      const txnToDelete = await db.transactions.get(transactionToDelete);

      if (txnToDelete?.isTransfer && txnToDelete?.transferPairId) {
        // Delete both transactions in the pair
        await db.transactions.delete(transactionToDelete);
        await db.transactions.delete(txnToDelete.transferPairId);

        setSuccessMsg(
          "Transfer transaction deleted successfully! Both paired transactions were removed."
        );
      } else {
        // Delete single transaction
        await db.transactions.delete(transactionToDelete);
        setSuccessMsg("Transaction deleted successfully!");
      }

      fetchTransactions(); // refresh after delete
      setShowDeleteConfirm(false);
      setTransactionToDelete(undefined);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error("Error deleting transaction:", err);
      setError("Error deleting transaction.");
      setShowDeleteConfirm(false);
    }
  };

  // Helper to get category name
  const getCategoryName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.name || "—";
  };

  // Helper to get bucket name from category
  const getBucketName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat?.bucketId) {
      const bucket = buckets.find((b) => b.id === cat.bucketId);
      return bucket?.name || "";
    }
    return "";
  };

  // Helper to get payment method name
  const getPaymentMethodName = (paymentChannelId: number) => {
    const pm = paymentMethods.find((p) => p.id === paymentChannelId);
    return pm?.name || "—";
  };

  // Helper to get recipient name
  const getRecipientName = (recipientId: number) => {
    const rec = recipients.find((r) => r.id === recipientId);
    return rec?.name || "—";
  };

  // Helper to get account image for a transaction
  const getAccountImage = (paymentChannelId: number) => {
    const pm = paymentMethods.find((p) => p.id === paymentChannelId);
    if (pm?.accountId && accountImages.has(pm.accountId)) {
      return accountImages.get(pm.accountId);
    }
    return undefined;
  };

  const getTransactionAccountId = (
    paymentChannelId: number
  ): number | undefined => {
    const pm = paymentMethods.find((p) => p.id === paymentChannelId);
    return pm?.accountId;
  };

  // Apply all filters
  const getFilteredTransactions = () => {
    if (!transactions) return [];

    return transactions.filter((txn) => {
      // Account filter
      if (selectedAccountId !== undefined) {
        const accountId = getTransactionAccountId(txn.paymentChannelId);
        if (accountId !== selectedAccountId) return false;
      }

      // Payment Method filter
      if (selectedPaymentMethodId !== undefined) {
        if (txn.paymentChannelId !== selectedPaymentMethodId) return false;
      }

      // Recipient filter
      if (selectedRecipientId !== undefined) {
        if (txn.recipientId !== selectedRecipientId) return false;
      }

      // Category filter
      if (selectedCategoryId !== undefined) {
        if (txn.categoryId !== selectedCategoryId) return false;
      }

      // Date from filter
      if (selectedDateFrom) {
        const txnDate = new Date(txn.date).toISOString().split("T")[0];
        if (txnDate < selectedDateFrom) return false;
      }

      // Date to filter
      if (selectedDateTo) {
        const txnDate = new Date(txn.date).toISOString().split("T")[0];
        if (txnDate > selectedDateTo) return false;
      }

      return true;
    });
  };

  const clearFilters = () => {
    setSelectedAccountId(undefined);
    setSelectedPaymentMethodId(undefined);
    setSelectedRecipientId(undefined);
    setSelectedCategoryId(undefined);
    setSelectedDateFrom("");
    setSelectedDateTo("");
  };

  const hasActiveFilters = () => {
    return (
      selectedAccountId !== undefined ||
      selectedPaymentMethodId !== undefined ||
      selectedRecipientId !== undefined ||
      selectedCategoryId !== undefined ||
      selectedDateFrom !== "" ||
      selectedDateTo !== ""
    );
  };

  const calculateAccountTotals = () => {
    const transactionsToUse = getFilteredTransactions();

    if (
      !transactionsToUse ||
      transactionsToUse.length === 0 ||
      accounts.length === 0
    ) {
      return { accountTotals: [], overallTotal: 0 };
    }

    const accountTotalsMap = new Map<number, number>();

    transactionsToUse.forEach((txn) => {
      const pm = paymentMethods.find((p) => p.id === txn.paymentChannelId);
      if (pm?.accountId) {
        const netAmount = txn.amount + (txn.transactionCost || 0);
        const currentTotal = accountTotalsMap.get(pm.accountId) || 0;
        accountTotalsMap.set(pm.accountId, currentTotal + netAmount);
      }
    });

    const accountTotals = Array.from(accountTotalsMap.entries()).map(
      ([accountId, total]) => {
        const account = accounts.find((a) => a.id === accountId);
        return {
          accountId,
          accountName: account?.name || "Unknown",
          total,
          imageUrl: accountImages.get(accountId),
        };
      }
    );

    accountTotals.sort((a, b) => a.accountName.localeCompare(b.accountName));

    const overallTotal = accountTotals.reduce(
      (sum, account) => sum + account.total,
      0
    );

    return { accountTotals, overallTotal };
  };

  const filteredTransactions = getFilteredTransactions();
  const { accountTotals, overallTotal } = calculateAccountTotals();

  // Add this helper function before the return statement
  const getTimeGroup = (dateString: string): string => {
    const txnDate = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const txnDateOnly = new Date(txnDate);
    txnDateOnly.setHours(0, 0, 0, 0);

    // Get the day of week for today
    const todayDay = today.getDay();

    // Calculate start of this week (Sunday)
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - todayDay);
    thisWeekStart.setHours(0, 0, 0, 0);

    // Calculate start of last week
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    // Check which group the transaction belongs to
    if (txnDateOnly >= thisWeekStart) {
      return "This Week";
    } else if (txnDateOnly >= lastWeekStart) {
      return "Last Week";
    } else if (
      txnDate.getMonth() === today.getMonth() &&
      txnDate.getFullYear() === today.getFullYear()
    ) {
      return "This Month";
    } else {
      // Return month and year for previous months
      return txnDate.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
    }
  };

  // Group transactions by time period
  const groupedTransactions = () => {
    const groups = new Map<string, Transaction[]>();
    const groupOrder = ["This Week", "Last Week", "This Month"];

    filteredTransactions.forEach((txn) => {
      const group = getTimeGroup(txn.date.toString());
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(txn);
    });

    // Sort the groups
    const sortedGroups: Array<[string, Transaction[]]> = [];

    // Add groups in fixed order
    groupOrder.forEach((group) => {
      if (groups.has(group)) {
        sortedGroups.push([group, groups.get(group)!]);
      }
    });

    // Add remaining groups (previous months) in reverse chronological order
    const remainingGroups = Array.from(groups.entries())
      .filter(([group]) => !groupOrder.includes(group))
      .sort((a, b) => {
        // Parse month/year and sort in reverse order
        const dateA = new Date(a[0] + " 1");
        const dateB = new Date(b[0] + " 1");
        return dateB.getTime() - dateA.getTime();
      });

    sortedGroups.push(...remainingGroups);

    return sortedGroups;
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Transactions</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Delete Confirmation Alert */}
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => setShowDeleteConfirm(false)}
          header="Confirm Delete"
          message={
            isTransferDelete
              ? "Are you sure you want to delete this transfer transaction? This will remove both the outgoing and incoming transactions. This action cannot be undone."
              : "Are you sure you want to delete this transaction? This action cannot be undone."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => {
                setShowDeleteConfirm(false);
                setTransactionToDelete(undefined);
                setIsTransferDelete(false);
              },
            },
            {
              text: "Delete",
              role: "destructive",
              handler: handleConfirmDelete,
            },
          ]}
        />

        {successMsg && (
          <IonText color="success">
            <p
              style={{
                padding: "12px",
                backgroundColor: "var(--ion-color-success-tint)",
                borderRadius: "4px",
                marginBottom: "16px",
              }}
            >
              {successMsg}
            </p>
          </IonText>
        )}

        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}

        {!loading && transactions && transactions.length > 0 && (
          <IonCard>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  {accountTotals.map((account) => (
                    <IonCol
                      key={account.accountId}
                      size={accountTotals.length > 3 ? "2" : "3"}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "left",
                            gap: "4px",
                            marginBottom: "4px",
                          }}
                        >
                          {account.imageUrl && (
                            <IonAvatar
                              style={{ width: "20px", height: "20px" }}
                            >
                              <IonImg src={account.imageUrl} alt="Account" />
                            </IonAvatar>
                          )}
                          <div style={{ fontSize: "0.9rem", color: "#666" }}>
                            {account.accountName}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: "1.4rem",
                            fontWeight: "bold",
                            marginLeft: "18px",
                            textAlign: "left",
                            color: account.total < 0 ? "#D44619" : "#009688",
                          }}
                        >
                          {account.total.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                    </IonCol>
                  ))}
                  <IonCol size="4">
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          color: "#666",
                          marginBottom: "4px",
                          fontWeight: "bold",
                        }}
                      >
                        {hasActiveFilters()
                          ? "Filtered Net Total"
                          : "Net Total"}
                      </div>
                      <div
                        style={{
                          fontSize: "1.6rem",
                          fontWeight: "bold",
                          textAlign: "right",
                          color: overallTotal < 0 ? "#D44619" : "#009688",
                        }}
                      >
                        {overallTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        )}

        {/* Filters Accordion */}
        {!loading && transactions && transactions.length > 0 && (
          <IonAccordionGroup style={{ marginBottom: "16px" }}>
            <IonAccordion value="filters">
              <IonItem slot="header" color="light">
                <IonLabel>
                  <strong>Filters</strong>
                  {hasActiveFilters() && (
                    <IonChip
                      color="primary"
                      style={{ marginLeft: "8px", fontSize: "0.75rem" }}
                    >
                      <IonLabel>Active</IonLabel>
                    </IonChip>
                  )}
                </IonLabel>
              </IonItem>
              <div slot="content" style={{ padding: "16px" }}>
                <IonGrid>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <IonSelect
                        label="Account"
                        labelPlacement="stacked"
                        fill="outline"
                        placeholder="All Accounts"
                        value={selectedAccountId}
                        onIonChange={(e) =>
                          setSelectedAccountId(
                            e.detail.value as number | undefined
                          )
                        }
                      >
                        {accounts.map((account) => (
                          <IonSelectOption key={account.id} value={account.id}>
                            {account.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <IonSelect
                        label="Payment Method"
                        labelPlacement="stacked"
                        fill="outline"
                        placeholder="All Payment Methods"
                        value={selectedPaymentMethodId}
                        onIonChange={(e) =>
                          setSelectedPaymentMethodId(
                            e.detail.value as number | undefined
                          )
                        }
                      >
                        {paymentMethods.map((pm) => (
                          <IonSelectOption key={pm.id} value={pm.id}>
                            {pm.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <IonSelect
                        label="Recipient"
                        labelPlacement="stacked"
                        fill="outline"
                        placeholder="All Recipients"
                        value={selectedRecipientId}
                        onIonChange={(e) =>
                          setSelectedRecipientId(
                            e.detail.value as number | undefined
                          )
                        }
                      >
                        {recipients.map((recipient) => (
                          <IonSelectOption
                            key={recipient.id}
                            value={recipient.id}
                          >
                            {recipient.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <IonSelect
                        label="Category"
                        labelPlacement="stacked"
                        fill="outline"
                        placeholder="All Categories"
                        value={selectedCategoryId}
                        onIonChange={(e) =>
                          setSelectedCategoryId(
                            e.detail.value as number | undefined
                          )
                        }
                      >
                        {categories.map((category) => (
                          <IonSelectOption
                            key={category.id}
                            value={category.id}
                          >
                            {category.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <label
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          display: "block",
                          marginBottom: "4px",
                        }}
                      >
                        Date From
                      </label>
                      <input
                        type="date"
                        value={selectedDateFrom}
                        onChange={(e) => setSelectedDateFrom(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--ion-color-medium)",
                          borderRadius: "4px",
                          backgroundColor: "transparent",
                          color: "inherit",
                        }}
                      />
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <label
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          display: "block",
                          marginBottom: "4px",
                        }}
                      >
                        Date To
                      </label>
                      <input
                        type="date"
                        value={selectedDateTo}
                        onChange={(e) => setSelectedDateTo(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--ion-color-medium)",
                          borderRadius: "4px",
                          backgroundColor: "transparent",
                          color: "inherit",
                        }}
                      />
                    </IonCol>
                  </IonRow>
                  {hasActiveFilters() && (
                    <IonRow>
                      <IonCol size="12">
                        <IonButton
                          expand="block"
                          fill="outline"
                          color="medium"
                          onClick={clearFilters}
                        >
                          <IonIcon icon={closeCircleOutline} />
                          Clear Filters
                        </IonButton>
                      </IonCol>
                    </IonRow>
                  )}
                </IonGrid>
              </div>
            </IonAccordion>
          </IonAccordionGroup>
        )}

        {!loading &&
          filteredTransactions &&
          filteredTransactions.length === 0 && (
            <IonText>
              {hasActiveFilters()
                ? "No transactions match the selected filters."
                : "No transactions found."}
            </IonText>
          )}
        {!loading &&
          filteredTransactions &&
          filteredTransactions.length > 0 && (
            <>
              {groupedTransactions().map(([group, txns]) => (
                <div key={group} style={{ marginBottom: "24px" }}>
                  <h3
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: "bold",
                      color: "#999",
                      margin: "16px 0 8px 0",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {group}
                  </h3>
                  <IonList>
                    {txns.map((txn) => (
                      <IonItem key={txn.id}>
                        <IonGrid>
                          <IonRow>
                            <IonCol size="1" style={{ textAlign: "center" }}>
                              <h2
                                style={{
                                  textAlign: "center",
                                  lineHeight: "1.2",
                                  color: "#666",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "1.6rem",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {new Date(txn.date)
                                    .toLocaleDateString("en-US", {
                                      month: "short",
                                    })
                                    .toUpperCase()}
                                </div>
                                <div
                                  style={{
                                    fontSize: "3.2rem",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {new Date(txn.date).toLocaleDateString(
                                    "en-US",
                                    {
                                      day: "2-digit",
                                    }
                                  )}
                                </div>
                              </h2>
                            </IonCol>
                            <IonCol size="11">
                              <IonRow>
                                {txn.description && (
                                  <h2
                                    style={{
                                      color: "rgb(68, 124, 224)",
                                      fontSize: "1.5rem",
                                      fontWeight: "bold",
                                      lineHeight: "1.2",
                                      cursor: "pointer",
                                    }}
                                    onClick={() => handleView(txn.id)}
                                  >
                                    <div>{txn.description}</div>
                                  </h2>
                                )}
                              </IonRow>
                              <IonRow>
                                <IonCol size="1">
                                  <IonAvatar
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                      cursor: "pointer",
                                    }}
                                    title={getPaymentMethodName(
                                      txn.paymentChannelId
                                    )}
                                  >
                                    {getAccountImage(txn.paymentChannelId) ? (
                                      <IonImg
                                        src={getAccountImage(
                                          txn.paymentChannelId
                                        )}
                                        alt={getPaymentMethodName(
                                          txn.paymentChannelId
                                        )}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          backgroundColor: "#ccc",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "0.8rem",
                                        }}
                                      >
                                        {getPaymentMethodName(
                                          txn.paymentChannelId
                                        ).charAt(0)}
                                      </div>
                                    )}
                                  </IonAvatar>
                                </IonCol>
                                <IonCol size="5">
                                  <div
                                    style={{
                                      color: "#666",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <IonIcon
                                      icon={
                                        txn.amount +
                                          (txn.transactionCost || 0) <
                                        0
                                          ? arrowUpCircle
                                          : arrowDownCircle
                                      }
                                      style={{
                                        color:
                                          txn.amount +
                                            (txn.transactionCost || 0) <
                                          0
                                            ? "#D44619"
                                            : "#009688",
                                        fontSize: "1.2rem",
                                      }}
                                    />
                                    {getRecipientName(txn.recipientId)}
                                  </div>
                                  <div>
                                    {getBucketName(txn.categoryId) && (
                                      <IonChip
                                        color="secondary"
                                        style={{
                                          fontSize: "0.75rem",
                                          height: "22px",
                                        }}
                                      >
                                        <IonLabel>
                                          {getBucketName(txn.categoryId)}
                                        </IonLabel>
                                      </IonChip>
                                    )}
                                    <IonChip
                                      color="primary"
                                      style={{
                                        fontSize: "0.85rem",
                                        height: "24px",
                                      }}
                                    >
                                      <IonLabel>
                                        {getCategoryName(txn.categoryId)}
                                      </IonLabel>
                                    </IonChip>
                                  </div>
                                </IonCol>
                                <IonCol size="4">
                                  <div
                                    style={{
                                      color:
                                        txn.amount +
                                          (txn.transactionCost || 0) <
                                        0
                                          ? "#D44619"
                                          : "#009688",
                                      fontSize: "1.8rem",
                                      fontWeight: "bold",
                                      lineHeight: "1.2",
                                      textAlign: "right",
                                    }}
                                  >
                                    {(
                                      txn.amount + (txn.transactionCost || 0)
                                    ).toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </div>
                                </IonCol>
                                <IonCol size="2">
                                  <IonButton
                                    fill="clear"
                                    onClick={() => handleEdit(txn.id)}
                                  >
                                    <IonIcon
                                      slot="icon-only"
                                      icon={createOutline}
                                    />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    color="danger"
                                    onClick={() => handleDeleteClick(txn.id)}
                                  >
                                    <IonIcon
                                      slot="icon-only"
                                      icon={trashOutline}
                                    />
                                  </IonButton>
                                </IonCol>
                              </IonRow>
                            </IonCol>
                          </IonRow>
                        </IonGrid>
                      </IonItem>
                    ))}
                  </IonList>
                </div>
              ))}
            </>
          )}
      </IonContent>
    </IonPage>
  );
};

export default Transactions;
