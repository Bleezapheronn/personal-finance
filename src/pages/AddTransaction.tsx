import React, { useState } from "react";
import { useHistory } from "react-router-dom";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonText,
} from "@ionic/react";
import { db, Transaction } from "../db"; // adjust import path as necessary

const AddTransaction: React.FC = () => {
  const history = useHistory();

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [category, setCategory] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [description, setDescription] = useState("");
  const [recipient, setRecipient] = useState("");

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    // Basic validation example
    if (!date || !amount || !category || !paymentMode) {
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    // Combine date and time strings into one datetime string
    const combinedDateTimeString = `${date}T${time}`;

    // Parse combined date-time string into a Date object
    const selectedDateTime = new Date(combinedDateTimeString);

    // Current date-time for validation
    const now = new Date();

    // Validate date-time is not in the future
    if (selectedDateTime > now) {
      setErrorMsg("Date and time cannot be in the future.");
      return;
    }

    // Amount must be positive number
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMsg("Amount must be a positive number.");
      return;
    }

    // Construct transaction object
    const transaction = {
      date: selectedDateTime,
      amount: numericAmount,
      transactionCost: parseFloat(transactionCost),
      category,
      paymentMode,
      paymentChannel,
      description,
      recipient,
    };

    try {
      await db.transactions.add(transaction);
      setErrorMsg("");
      setSuccessMsg("Transaction added successfully!");
      console.log("Transaction added:", transaction);

      // Reset form after submission
      setDate("");
      setTime("");
      setAmount("");
      setTransactionCost("");
      setCategory("");
      setPaymentMode("");
      setPaymentChannel("");
      setDescription("");
      setRecipient("");

      // Redirect to Transactions page (assumed route is /tab1)
      history.push("/tab1"); // Adjust to your routing path for Transactions page
    } catch (error) {
      setErrorMsg("Failed to add transaction. Please try again.");
      console.error("Error adding transaction:", error);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Transaction</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <form onSubmit={handleSubmit}>
          {errorMsg && <IonText color="danger">{errorMsg}</IonText>}
          {successMsg && <IonText color="success">{successMsg}</IonText>}
          <IonItem>
            <IonLabel position="stacked">Date</IonLabel>
            <IonInput
              type="date"
              value={date}
              onIonChange={(e) => setDate(e.detail.value!)}
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Time</IonLabel>
            <IonInput
              type="time"
              value={time}
              onIonChange={(e) => setTime(e.detail.value!)}
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Description</IonLabel>
            <IonInput
              type="text"
              value={description}
              onIonChange={(e) => setDescription(e.detail.value!)}
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Recipient</IonLabel>
            <IonInput
              type="text"
              value={recipient}
              onIonChange={(e) => setRecipient(e.detail.value!)}
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Category</IonLabel>
            <IonSelect
              value={category}
              onIonChange={(e) => setCategory(e.detail.value!)}
            >
              <IonSelectOption value="rent-housing">
                Rent & Housing
              </IonSelectOption>
              <IonSelectOption value="utilities">Utilities</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Payment Mode</IonLabel>
            <IonSelect
              value={paymentMode}
              onIonChange={(e) => setPaymentMode(e.detail.value!)}
            >
              <IonSelectOption value="mpesa">M-Pesa</IonSelectOption>
              <IonSelectOption value="bank">Equity</IonSelectOption>
              <IonSelectOption value="paypal">PayPal</IonSelectOption>
              <IonSelectOption value="ziidi">ZiiDi</IonSelectOption>
              <IonSelectOption value="cash">Cash</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Channel</IonLabel>
            <IonSelect
              value={paymentChannel}
              onIonChange={(e) => setPaymentChannel(e.detail.value!)}
            >
              <IonSelectOption value="buy_goods">Buy Goods</IonSelectOption>
              <IonSelectOption value="mpesa_direct">
                M-Pesa Direct
              </IonSelectOption>
              <IonSelectOption value="pay_bill">Pay Bill</IonSelectOption>
              <IonSelectOption value="paypal">PayPal</IonSelectOption>
              <IonSelectOption value="received_money">
                Received Money
              </IonSelectOption>
              <IonSelectOption value="send_money">Send Money</IonSelectOption>
              <IonSelectOption value="visa">Visa</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Amount</IonLabel>
            <IonInput
              type="number"
              value={amount}
              onIonChange={(e) => setAmount(e.detail.value!)}
              inputMode="decimal"
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">Cost</IonLabel>
            <IonInput
              type="number"
              value={transactionCost}
              onIonChange={(e) => setTransactionCost(e.detail.value!)}
              inputMode="decimal"
            />
          </IonItem>
          <IonButton
            type="submit"
            expand="block"
            color="primary"
            className="ion-margin-top"
          >
            Add Transaction
          </IonButton>
        </form>
      </IonContent>
    </IonPage>
  );
};

export default AddTransaction;
