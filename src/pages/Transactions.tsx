import React, { useState, useEffect } from "react";
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
  IonInput, // ADD THIS
  IonFab,
  IonFabButton,
  IonToast,
} from "@ionic/react";

import { useHistory } from "react-router-dom";
import {
  createOutline,
  addOutline,
  trashOutline,
  arrowUpCircle,
  arrowDownCircle,
  closeCircle,
  closeCircleOutline,
  downloadOutline,
  cloudUploadOutline,
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
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import { exportTransactionsToCSV, downloadCSV } from "../utils/csvExport";
import { ImportModal } from "../components/ImportModal";
import "./Transactions.css";

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Filter states
  const [selectedAccountId, setSelectedAccountId] = useState<
    number | undefined
  >(undefined);
  const [selectedRecipientId, setSelectedRecipientId] = useState<
    number | undefined
  >(undefined);
  const [selectedBucketId, setSelectedBucketId] = useState<number | undefined>(
    undefined
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    number | undefined
  >(undefined);
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>("");
  const [selectedDateTo, setSelectedDateTo] = useState<string>("");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<
    number | undefined
  >(undefined);
  const [selectedDescription, setSelectedDescription] = useState<string>("");

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
        setShowSuccessToast(true);
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

      // Bucket filter
      if (selectedBucketId !== undefined) {
        const category = categories.find((c) => c.id === txn.categoryId);
        if (category?.bucketId !== selectedBucketId) return false;
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

      // Description filter
      if (selectedDescription) {
        if (
          !txn.description
            ?.toLowerCase()
            .includes(selectedDescription.toLowerCase())
        ) {
          return false;
        }
      }

      return true;
    });
  };

  const clearFilters = () => {
    setSelectedAccountId(undefined);
    setSelectedPaymentMethodId(undefined);
    setSelectedRecipientId(undefined);
    setSelectedBucketId(undefined);
    setSelectedCategoryId(undefined);
    setSelectedDateFrom("");
    setSelectedDateTo("");
    setSelectedDescription("");
  };

  // ADD THESE NEW HELPER FUNCTIONS after clearFilters():

  const clearIndividualFilter = (filterName: string) => {
    switch (filterName) {
      case "account":
        setSelectedAccountId(undefined);
        break;
      case "paymentMethod":
        setSelectedPaymentMethodId(undefined);
        break;
      case "recipient":
        setSelectedRecipientId(undefined);
        break;
      case "bucket":
        setSelectedBucketId(undefined);
        break;
      case "category":
        setSelectedCategoryId(undefined);
        break;
      case "dateFrom":
        setSelectedDateFrom("");
        break;
      case "dateTo":
        setSelectedDateTo("");
        break;
      case "description":
        setSelectedDescription("");
        break;
    }
  };

  const getActiveFilterChips = (): Array<{
    label: string;
    displayLabel: string;
    tooltip: string;
    filterName: string;
  }> => {
    const chips: Array<{
      label: string;
      displayLabel: string;
      tooltip: string;
      filterName: string;
    }> = [];

    if (selectedAccountId !== undefined) {
      const account = accounts.find((a) => a.id === selectedAccountId);
      chips.push({
        label: `Account: ${account?.name}`,
        displayLabel: account?.name || "Account",
        tooltip: "Clear Account filter",
        filterName: "account",
      });
    }

    if (selectedPaymentMethodId !== undefined) {
      const pm = paymentMethods.find((p) => p.id === selectedPaymentMethodId);
      const account = accounts.find((a) => a.id === pm?.accountId);
      chips.push({
        label: `${account?.name} - ${pm?.name}`,
        displayLabel: `${account?.name} - ${pm?.name}`,
        tooltip: "Clear Payment Method filter",
        filterName: "paymentMethod",
      });
    }

    if (selectedRecipientId !== undefined) {
      const recipient = recipients.find((r) => r.id === selectedRecipientId);
      chips.push({
        label: `Recipient: ${recipient?.name}`,
        displayLabel: recipient?.name || "Recipient",
        tooltip: "Clear Recipient filter",
        filterName: "recipient",
      });
    }

    if (selectedBucketId !== undefined) {
      const bucket = buckets.find((b) => b.id === selectedBucketId);
      chips.push({
        label: `Bucket: ${bucket?.name}`,
        displayLabel: bucket?.name || "Bucket",
        tooltip: "Clear Bucket filter",
        filterName: "bucket",
      });
    }

    if (selectedCategoryId !== undefined) {
      const category = categories.find((c) => c.id === selectedCategoryId);
      chips.push({
        label: `Category: ${category?.name}`,
        displayLabel: category?.name || "Category",
        tooltip: "Clear Category filter",
        filterName: "category",
      });
    }

    if (selectedDateFrom) {
      chips.push({
        label: `From: ${selectedDateFrom}`,
        displayLabel: selectedDateFrom,
        tooltip: "Clear From Date filter",
        filterName: "dateFrom",
      });
    }

    if (selectedDateTo) {
      chips.push({
        label: `To: ${selectedDateTo}`,
        displayLabel: selectedDateTo,
        tooltip: "Clear To Date filter",
        filterName: "dateTo",
      });
    }

    if (selectedDescription) {
      chips.push({
        label: `"${selectedDescription}"`,
        displayLabel: selectedDescription,
        tooltip: "Clear Description filter",
        filterName: "description",
      });
    }

    return chips;
  };

  const hasActiveFilters = () => {
    return (
      selectedAccountId !== undefined ||
      selectedPaymentMethodId !== undefined ||
      selectedRecipientId !== undefined ||
      selectedBucketId !== undefined ||
      selectedCategoryId !== undefined ||
      selectedDateFrom !== "" ||
      selectedDateTo !== "" ||
      selectedDescription !== ""
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

    const accountTotals = Array.from(accountTotalsMap.entries())
      .map(([accountId, total]) => {
        const account = accounts.find((a) => a.id === accountId);
        return {
          accountId,
          accountName: account?.name || "Unknown",
          total,
          imageUrl: accountImages.get(accountId),
        };
      })
      // NEW: Filter out credit accounts unless balance is negative (i.e., overdraft used)
      .filter((account) => {
        const acct = accounts.find((a) => a.id === account.accountId);
        if (acct?.isCredit) {
          // Only show credit accounts if they have negative balance (credit used)
          return account.total < 0;
        }
        return true; // Always show non-credit accounts
      });

    accountTotals.sort((a, b) => a.accountName.localeCompare(b.accountName));

    const overallTotal = accountTotals.reduce(
      (sum, account) => sum + account.total,
      0
    );

    return { accountTotals, overallTotal };
  };

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

  const { accountTotals, overallTotal } = calculateAccountTotals();
  const filteredTransactions = getFilteredTransactions();

  // Add this helper function before the return statement (after calculateAccountTotals)
  const getRecipientTransactionCount = (recipientId: number): number => {
    return filteredTransactions.filter((txn) => txn.recipientId === recipientId)
      .length;
  };

  // Add these helper functions before the return statement (after getRecipientTransactionCount):
  const getAccountsInTransactions = (): number[] => {
    const accountIds = new Set<number>();
    transactions?.forEach((txn) => {
      const pm = paymentMethods.find((p) => p.id === txn.paymentChannelId);
      if (pm?.accountId) {
        accountIds.add(pm.accountId);
      }
    });
    return Array.from(accountIds);
  };

  const getPaymentMethodsInTransactions = (): number[] => {
    const pmIds = new Set<number>();
    transactions?.forEach((txn) => {
      pmIds.add(txn.paymentChannelId);
    });
    return Array.from(pmIds);
  };

  const getBucketsInTransactions = (): number[] => {
    const bucketIds = new Set<number>();
    transactions?.forEach((txn) => {
      const category = categories.find((c) => c.id === txn.categoryId);
      if (category?.bucketId) {
        bucketIds.add(category.bucketId);
      }
    });
    return Array.from(bucketIds);
  };

  const getCategoriesInTransactions = (): number[] => {
    const catIds = new Set<number>();
    transactions?.forEach((txn) => {
      catIds.add(txn.categoryId);
    });
    return Array.from(catIds);
  };

  const getRecipientsInTransactions = (): number[] => {
    const recIds = new Set<number>();
    transactions?.forEach((txn) => {
      recIds.add(txn.recipientId);
    });
    return Array.from(recIds);
  };

  useEffect(() => {
    // Clear payment method filter when account filter changes
    // (to prevent showing incompatible payment method)
    if (selectedAccountId !== undefined) {
      setSelectedPaymentMethodId(undefined);
    }
  }, [selectedAccountId]);

  // ADD THIS NEW useEffect:
  useEffect(() => {
    // Clear category filter when bucket filter changes
    // (to prevent showing incompatible category)
    if (selectedBucketId !== undefined) {
      setSelectedCategoryId(undefined);
    }
  }, [selectedBucketId]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Transactions</IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={async () => {
                try {
                  const csv = await exportTransactionsToCSV();
                  const filename = `transactions-${
                    new Date().toISOString().split("T")[0]
                  }.csv`;
                  downloadCSV(csv, filename);
                } catch (err) {
                  console.error("Export failed:", err);
                  // Show error toast
                }
              }}
              title="Export Transactions to CSV"
            >
              <IonIcon icon={downloadOutline} />
            </IonButton>
            <IonButton
              onClick={() => setShowImportModal(true)}
              title="Import transactions from CSV"
            >
              <IonIcon icon={cloudUploadOutline} />
            </IonButton>
          </IonButtons>
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

        {/* Success Toast */}
        <IonToast
          isOpen={showSuccessToast}
          onDidDismiss={() => setShowSuccessToast(false)}
          message={successMsg}
          duration={2000}
          position="top"
          color="success"
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
          <IonCard style={{ margin: 0, marginBottom: "16px" }}>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  {accountTotals.map((account) => (
                    <IonCol
                      key={account.accountId}
                      size="2"
                      onClick={() => setSelectedAccountId(account.accountId)}
                      style={{
                        cursor: "pointer",
                        opacity:
                          selectedAccountId === account.accountId ? 1 : 0.6,
                      }}
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
                            marginLeft: "2px",
                            textAlign: "left",
                            color: account.total < 0 ? "#eb445c" : "#009688",
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
                  <IonCol
                    size="4"
                    onClick={() =>
                      selectedAccountId && setSelectedAccountId(undefined)
                    }
                    style={{
                      cursor: selectedAccountId ? "pointer" : "default",
                    }}
                  >
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          color: "#666",
                          marginBottom: "4px",
                          fontWeight: "bold",
                        }}
                      >
                        {hasActiveFilters()
                          ? "Net Total (Filtered)"
                          : "Net Total"}
                      </div>
                      <div
                        style={{
                          fontSize: "1.6rem",
                          fontWeight: "bold",
                          textAlign: "right",
                          color: overallTotal < 0 ? "#eb445c" : "#009688",
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

        {/* Filters Accordion - UPDATED HEADER WITH CHIPS ON SAME LINE */}
        {!loading && transactions && transactions.length > 0 && (
          <IonAccordionGroup style={{ marginBottom: "16px" }}>
            <IonAccordion value="filters">
              <IonItem
                slot="header"
                color="light"
                style={{
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                    flex: 1,
                  }}
                >
                  <IonLabel>Filters</IonLabel>
                  {hasActiveFilters() &&
                    getActiveFilterChips().map((chip) => (
                      <div
                        key={chip.filterName}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearIndividualFilter(chip.filterName);
                        }}
                      >
                        <IonChip
                          color="primary"
                          style={{
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            height: "24px",
                            margin: "0",
                            flexShrink: 0,
                          }}
                          title={chip.tooltip}
                        >
                          <IonLabel style={{ padding: "0 4px" }}>
                            {chip.displayLabel}
                          </IonLabel>
                          <IonIcon icon={closeCircle} />
                        </IonChip>
                      </div>
                    ))}
                </div>
              </IonItem>
              <div slot="content" style={{ padding: "16px" }}>
                <IonGrid>
                  <IonRow>
                    <IonCol size="12">
                      <div className="form-input-wrapper">
                        <label className="form-label">Description</label>
                        <div
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <IonInput
                            className="form-input"
                            type="text"
                            placeholder="Search Description..."
                            value={selectedDescription}
                            onIonInput={(e: CustomEvent) => {
                              setSelectedDescription(
                                (e.detail.value as string) || ""
                              );
                            }}
                            style={{
                              width: "100%",
                              paddingRight: selectedDescription
                                ? "44px"
                                : "12px",
                            }}
                          />
                          {selectedDescription && (
                            <button
                              onClick={(e: React.MouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedDescription("");
                              }}
                              style={{
                                position: "absolute",
                                right: "8px",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--ion-color-medium)",
                                fontSize: "1.2rem",
                                opacity: 0.7,
                                transition: "opacity 0.2s",
                                padding: "4px",
                                width: "32px",
                                height: "32px",
                              }}
                              onMouseEnter={(e: React.MouseEvent) => {
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.opacity = "1";
                              }}
                              onMouseLeave={(e: React.MouseEvent) => {
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.opacity = "0.7";
                              }}
                              title="Clear description filter"
                            >
                              <IonIcon icon={closeCircleOutline} />
                            </button>
                          )}
                        </div>
                      </div>
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Account
                      </div>
                      <SearchableFilterSelect
                        label="Account"
                        placeholder="All Accounts"
                        value={selectedAccountId}
                        options={accounts
                          .filter((a) => {
                            const accountsWithTxns =
                              getAccountsInTransactions();
                            return (
                              a.name && accountsWithTxns.includes(a.id || 0)
                            );
                          })
                          .map((a) => ({
                            id: a.id,
                            name: a.name as string,
                          }))}
                        onIonChange={setSelectedAccountId}
                      />
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Payment Method
                      </div>
                      <SearchableFilterSelect
                        label="Payment Method"
                        placeholder="All Payment Methods"
                        value={selectedPaymentMethodId}
                        options={paymentMethods
                          .filter((pm) => {
                            const pmsWithTxns =
                              getPaymentMethodsInTransactions();
                            const account = accounts.find(
                              (a) => a.id === pm.accountId
                            );

                            if (selectedAccountId !== undefined) {
                              return (
                                pm.accountId === selectedAccountId &&
                                pmsWithTxns.includes(pm.id || 0) &&
                                account?.name
                              );
                            }

                            return (
                              pmsWithTxns.includes(pm.id || 0) && account?.name
                            );
                          })
                          .map((pm) => {
                            const account = accounts.find(
                              (a) => a.id === pm.accountId
                            );
                            const currency = account?.currency
                              ? `(${account.currency})`
                              : "(—)";
                            return {
                              id: pm.id,
                              name: `${account?.name || "Unknown"} - ${
                                pm.name
                              } ${currency}`,
                            };
                          })}
                        onIonChange={setSelectedPaymentMethodId}
                      />
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Bucket
                      </div>
                      <SearchableFilterSelect
                        label="Bucket"
                        placeholder="All Buckets"
                        value={selectedBucketId}
                        options={buckets
                          .filter((b) => {
                            const bucketsWithTxns = getBucketsInTransactions();
                            return (
                              b.name && bucketsWithTxns.includes(b.id || 0)
                            );
                          })
                          .map((b) => ({
                            id: b.id,
                            name: b.name as string,
                          }))}
                        onIonChange={setSelectedBucketId}
                      />
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Category
                      </div>
                      <SearchableFilterSelect
                        label="Category"
                        placeholder="All Categories"
                        value={selectedCategoryId}
                        options={categories
                          .filter((c) => {
                            const catsWithTxns = getCategoriesInTransactions();

                            if (selectedBucketId !== undefined) {
                              return (
                                c.bucketId === selectedBucketId &&
                                catsWithTxns.includes(c.id || 0)
                              );
                            }

                            return c.name && catsWithTxns.includes(c.id || 0);
                          })
                          .map((c) => {
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId
                            );
                            return {
                              id: c.id,
                              name: `${c.name} - ${bucket?.name || "Unknown"}`,
                            };
                          })}
                        onIonChange={setSelectedCategoryId}
                      />
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Recipient
                      </div>
                      <SearchableFilterSelect
                        label="Recipient"
                        placeholder="All Recipients"
                        value={selectedRecipientId}
                        options={recipients
                          .filter((r) => {
                            const recsWithTxns = getRecipientsInTransactions();
                            return r.name && recsWithTxns.includes(r.id || 0);
                          })
                          .map((r) => ({
                            id: r.id,
                            name: r.name,
                          }))
                          .sort((a, b) => {
                            const countA = getRecipientTransactionCount(
                              a.id || 0
                            );
                            const countB = getRecipientTransactionCount(
                              b.id || 0
                            );
                            return countB - countA;
                          })}
                        onIonChange={setSelectedRecipientId}
                      />
                    </IonCol>
                  </IonRow>
                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Date From
                      </div>
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="date"
                          value={selectedDateFrom}
                          onChange={(e) => setSelectedDateFrom(e.target.value)}
                          max={selectedDateTo || undefined}
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid var(--ion-color-medium)",
                            borderRadius: "4px",
                            backgroundColor: "transparent",
                            color: "inherit",
                          }}
                        />
                        {selectedDateFrom && (
                          <button
                            onClick={(e: React.MouseEvent) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDateFrom("");
                            }}
                            style={{
                              position: "absolute",
                              right: "32px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ion-color-dark)",
                              fontSize: "1.2rem",
                              opacity: 0.7,
                              transition: "opacity 0.2s",
                              width: "18px",
                              height: "18px",
                              padding: "0",
                            }}
                            onMouseEnter={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "1";
                            }}
                            onMouseLeave={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "0.7";
                            }}
                            title="Clear Date From filter"
                          >
                            <IonIcon icon={closeCircle} />
                          </button>
                        )}
                      </div>
                    </IonCol>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Date To
                      </div>
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="date"
                          value={selectedDateTo}
                          onChange={(e) => setSelectedDateTo(e.target.value)}
                          min={selectedDateFrom || undefined}
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid var(--ion-color-medium)",
                            borderRadius: "4px",
                            backgroundColor: "transparent",
                            color: "inherit",
                          }}
                        />
                        {selectedDateTo && (
                          <button
                            onClick={(e: React.MouseEvent) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDateTo("");
                            }}
                            style={{
                              position: "absolute",
                              right: "32px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ion-color-dark)",
                              fontSize: "1.2rem",
                              opacity: 0.7,
                              transition: "opacity 0.2s",
                              width: "18px",
                              height: "18px",
                              padding: "0",
                            }}
                            onMouseEnter={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "1";
                            }}
                            onMouseLeave={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "0.7";
                            }}
                            title="Clear Date To filter"
                          >
                            <IonIcon icon={closeCircle} />
                          </button>
                        )}
                      </div>
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
                          Clear All Filters
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
                    className={`time-group-header ${
                      group === "Overdue" ? "overdue" : ""
                    }`}
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
                  <IonList style={{ borderRadius: "4px" }}>
                    {txns.map((txn) => (
                      <IonItem key={txn.id}>
                        <IonGrid>
                          <IonRow>
                            <IonCol size="1" className="date-column">
                              <h2>
                                <div className="date-column-weekday">
                                  {new Date(txn.date)
                                    .toLocaleDateString("en-US", {
                                      weekday: "short",
                                    })
                                    .toUpperCase()}
                                </div>
                                <div className="date-column-day">
                                  {new Date(txn.date).toLocaleDateString(
                                    "en-US",
                                    {
                                      day: "2-digit",
                                    }
                                  )}
                                </div>
                                <div className="date-column-month">
                                  {new Date(txn.date)
                                    .toLocaleDateString("en-US", {
                                      month: "short",
                                    })
                                    .toUpperCase()}
                                </div>
                              </h2>
                            </IonCol>
                            <IonCol size="7">
                              <IonRow>
                                {txn.description && (
                                  <h2
                                    className="item-description clickable"
                                    onClick={() => handleView(txn.id)}
                                  >
                                    <div>{txn.description}</div>
                                  </h2>
                                )}
                              </IonRow>
                              <IonRow>
                                <IonCol size="1.5">
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
                                <IonCol>
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
                                            ? "#eb445c"
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
                              </IonRow>
                            </IonCol>

                            <IonCol size="4" style={{ textAlign: "right" }}>
                              <div
                                className={`item-amount ${
                                  txn.amount + (txn.transactionCost || 0) < 0
                                    ? "expense"
                                    : "income"
                                }`}
                                style={{ textAlign: "right" }}
                              >
                                {(
                                  txn.amount + (txn.transactionCost || 0)
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                              <p style={{ margin: "0" }}>&nbsp;</p>
                              {/* Edit/Delete/Link buttons below progress bar */}
                              <IonRow className="item-actions">
                                <IonCol className="item-actions-container">
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    onClick={() => handleEdit(txn.id)}
                                    title="Edit Transaction"
                                  >
                                    <IonIcon slot="end" icon={createOutline} />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    color="danger"
                                    onClick={() => handleDeleteClick(txn.id)}
                                    title="Delete Transaction"
                                  >
                                    <IonIcon slot="end" icon={trashOutline} />
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

        <ImportModal
          isOpen={showImportModal}
          onDidDismiss={() => setShowImportModal(false)}
          onImportComplete={() => {
            setShowImportModal(false);
            // Reload transactions
            window.location.reload();
          }}
        />
      </IonContent>

      {/* FAB BUTTON FOR ADDING TRANSACTIONS */}
      <IonFab vertical="bottom" horizontal="end" slot="fixed">
        <IonFabButton
          onClick={() => history.push("/add")}
          title="Add Transaction"
        >
          <IonIcon icon={addOutline} />
        </IonFabButton>
      </IonFab>
    </IonPage>
  );
};

export default Transactions;
