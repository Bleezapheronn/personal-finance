import React, { useState } from "react";
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonInput, IonButton, IonItem, IonLabel, IonToast } from "@ionic/react";

const AddTransaction: React.FC = () => {
  const [transactionName, setTransactionName] = useState("");
  const [amount, setAmount] = useState<number | string>("");
  const [date, setDate] = useState("");
  const [showToast, setShowToast] = useState(false);

  const handleSubmit = () => {
    // Here you would typically handle the submission to your data management service
    console.log("Transaction added:", { transactionName, amount, date });
    setShowToast(true);
    // Reset form fields
    setTransactionName("");
    setAmount("");
    setDate("");
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Transaction</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonItem>
          <IonLabel position="floating">Transaction Name</IonLabel>
          <IonInput value={transactionName} onIonChange={e => setTransactionName(e.detail.value!)} />
        </IonItem>
        <IonItem>
          <IonLabel position="floating">Amount</IonLabel>
          <IonInput type="number" value={amount} onIonChange={e => setAmount(e.detail.value!)} />
        </IonItem>
        <IonItem>
          <IonLabel position="floating">Date</IonLabel>
          <IonInput type="date" value={date} onIonChange={e => setDate(e.detail.value!)} />
        </IonItem>
        <IonButton expand="full" onClick={handleSubmit}>Add Transaction</IonButton>
        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message="Transaction added successfully!"
          duration={2000}
        />
      </IonContent>
    </IonPage>
  );
};

export default AddTransaction;