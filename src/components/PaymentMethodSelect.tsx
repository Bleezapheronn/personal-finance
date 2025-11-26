import React, { useState, useEffect } from "react";
import {
  IonButton,
  IonIcon,
  IonPopover,
  IonList,
  IonItem,
  IonLabel,
} from "@ionic/react";
import { closeCircleOutline, chevronDown } from "ionicons/icons";
import { Account, PaymentMethod } from "../db";

interface PaymentMethodSelectProps {
  label: string;
  placeholder: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  onClear: () => void;
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  error?: boolean;
}

export const PaymentMethodSelect: React.FC<PaymentMethodSelectProps> = ({
  label,
  placeholder,
  value,
  onChange,
  onClear,
  accounts,
  paymentMethods,
  error,
}) => {
  const [showPopover, setShowPopover] = useState(false);
  const [accountImageUrls, setAccountImageUrls] = useState<Map<number, string>>(
    new Map()
  );
  const [popoverEvent, setPopoverEvent] = useState<
    React.MouseEvent<HTMLButtonElement> | undefined
  >(undefined);

  const selectedPaymentMethod = paymentMethods.find((pm) => pm.id === value);
  const selectedAccount = selectedPaymentMethod
    ? accounts.find((a) => a.id === selectedPaymentMethod.accountId)
    : null;

  const groupedPaymentMethods = accounts.map((account) => ({
    account,
    methods: paymentMethods.filter((pm) => pm.accountId === account.id),
  }));

  const unlinkedMethods = paymentMethods.filter((pm) => pm.accountId == null);

  // Convert all imageBlobs to data URLs
  useEffect(() => {
    const urls = new Map<number, string>();

    accounts.forEach((account) => {
      if (account.imageBlob) {
        const url = URL.createObjectURL(account.imageBlob);
        urls.set(account.id!, url);
      }
    });

    setAccountImageUrls(urls);

    // Cleanup URLs when component unmounts
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [accounts]);

  const handleSelect = (pmId: number) => {
    onChange(pmId);
    setShowPopover(false);
  };

  const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setPopoverEvent(e);
    setShowPopover(true);
  };

  return (
    <>
      <div
        style={{
          marginBottom: "16px",
          position: "relative",
        }}
      >
        <label
          style={{
            fontSize: "0.75rem",
            fontWeight: "500",
            opacity: 0.7,
            display: "block",
            marginBottom: "4px",
          }}
        >
          {label}
        </label>
        <button
          type="button"
          onClick={handleButtonClick}
          style={{
            width: "100%",
            padding: "12px",
            border: error
              ? "1px solid var(--ion-color-danger)"
              : "1px solid var(--ion-color-medium)",
            borderRadius: "4px",
            backgroundColor: "transparent",
            color: value ? "inherit" : "var(--ion-color-medium)",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "1rem",
            fontFamily: "inherit",
          }}
        >
          <span>
            {selectedPaymentMethod && selectedAccount
              ? `${selectedAccount.name} : ${selectedPaymentMethod.name}`
              : placeholder}
          </span>
          <IonIcon icon={chevronDown} />
        </button>
      </div>

      {/* Display selected payment method with account image */}
      {selectedPaymentMethod &&
        selectedAccount &&
        accountImageUrls.get(selectedAccount.id!) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
              padding: "8px 12px",
              backgroundColor: "var(--ion-color-light)",
              borderRadius: "4px",
            }}
          >
            <img
              src={accountImageUrls.get(selectedAccount.id!)}
              alt={selectedAccount.name}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "4px",
                objectFit: "cover",
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                {selectedAccount.name}
              </div>
              <div style={{ fontSize: "0.95rem", fontWeight: "500" }}>
                {selectedPaymentMethod.name}
              </div>
            </div>
            <IonButton
              fill="clear"
              size="small"
              color="medium"
              onClick={onClear}
              aria-label={`Clear ${label.toLowerCase()}`}
              title={`Clear ${label.toLowerCase()}`}
            >
              <IonIcon icon={closeCircleOutline} />
            </IonButton>
          </div>
        )}

      {/* Custom Popover with images */}
      <IonPopover
        isOpen={showPopover}
        onDidDismiss={() => setShowPopover(false)}
        event={popoverEvent}
        side="bottom"
        alignment="start"
        style={{ "--z-index": "9999" } as React.CSSProperties}
      >
        <IonList
          style={
            {
              minWidth: "350px",
              width: "350px",
              maxHeight: "400px",
              overflowY: "auto",
              overflowX: "hidden",
              boxSizing: "border-box",
              padding: "0",
              "--padding-start": "0",
              "--padding-end": "0",
            } as React.CSSProperties
          }
        >
          {groupedPaymentMethods.map(({ account, methods }) => {
            if (methods.length === 0) return null;
            return (
              <React.Fragment key={account.id}>
                {methods.map((pm) => {
                  const imageUrl = accountImageUrls.get(account.id!);
                  return (
                    <IonItem
                      key={pm.id}
                      button
                      onClick={() => handleSelect(pm.id!)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--ion-color-light)",
                      }}
                    >
                      {imageUrl && (
                        <img
                          src={imageUrl}
                          alt={account.name}
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "4px",
                            objectFit: "cover",
                            marginRight: "12px",
                          }}
                          slot="start"
                        />
                      )}
                      <IonLabel>
                        <div style={{ fontWeight: "500", marginBottom: "4px" }}>
                          {pm.name}
                        </div>
                        <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                          {account.name}
                        </div>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </React.Fragment>
            );
          })}

          {unlinkedMethods.length > 0 && (
            <>
              {unlinkedMethods.map((pm) => (
                <IonItem
                  key={pm.id}
                  button
                  onClick={() => handleSelect(pm.id!)}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px solid var(--ion-color-light)",
                  }}
                >
                  <IonLabel>{pm.name}</IonLabel>
                </IonItem>
              ))}
            </>
          )}
        </IonList>
      </IonPopover>
    </>
  );
};
