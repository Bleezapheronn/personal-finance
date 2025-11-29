import React, { useState, useRef, useEffect } from "react";
import {
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
} from "@ionic/react";
import { chevronDown } from "ionicons/icons";
import "./SearchableFilterSelect.css";

interface SearchableFilterSelectProps {
  label: string;
  placeholder?: string;
  value: number | undefined;
  options: Array<{ id: number | undefined; name: string }>;
  onIonChange: (value: number | undefined) => void;
}

export const SearchableFilterSelect: React.FC<SearchableFilterSelectProps> = ({
  label,
  placeholder = "Select...",
  value,
  options,
  onIonChange,
}) => {
  const [searchText, setSearchText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchbarRef = useRef<HTMLIonSearchbarElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.name.toLowerCase().includes(searchText.toLowerCase())
  );

  const selectedOption = options.find((opt) => opt.id === value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchText("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus searchbar when dropdown opens
  useEffect(() => {
    if (isOpen && searchbarRef.current) {
      setTimeout(() => {
        searchbarRef.current?.getInputElement().then((el) => el.focus());
      }, 0);
    }
  }, [isOpen]);

  const handleSelect = (id: number | undefined) => {
    onIonChange(id);
    setIsOpen(false);
    setSearchText("");
  };

  const handleOpen = () => {
    setIsOpen(true);
    setSearchText("");
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Closed State - Looks like a native select */}
      {!isOpen && (
        <div
          onClick={handleOpen}
          style={{
            padding: "12px",
            border: "1px solid var(--ion-color-medium)",
            borderRadius: "4px",
            backgroundColor: "var(--ion-background-color)",
            cursor: "pointer",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.95rem",
            color: selectedOption ? "inherit" : "var(--ion-color-medium)",
          }}
        >
          <span>{selectedOption ? selectedOption.name : placeholder}</span>
          <IonIcon
            icon={chevronDown}
            style={{
              fontSize: "1.2rem",
              opacity: 0.7,
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
        </div>
      )}

      {/* Open State - Shows search + filtered options */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            backgroundColor: "var(--ion-background-color)",
            border: "1px solid var(--ion-color-medium)",
            borderRadius: "4px",
            minWidth: "100%",
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            overflow: "hidden",
          }}
        >
          {/* Searchbar at top */}
          <div style={{ borderBottom: "1px solid var(--ion-color-medium)" }}>
            <IonSearchbar
              ref={searchbarRef}
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || "")}
              placeholder={`Search ${label.toLowerCase()}...`}
              animated
              style={{
                padding: "0",
              }}
              className="searchable-filter-searchbar"
            />
          </div>

          {/* Filtered Options List */}
          <IonList
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              padding: "0",
              margin: "0",
            }}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <IonItem
                  key={option.id}
                  button
                  onClick={() => handleSelect(option.id)}
                  detail={false}
                  style={{
                    backgroundColor:
                      value === option.id
                        ? "var(--ion-color-primary-tint)"
                        : "transparent",
                    borderBottom: "1px solid var(--ion-color-light)",
                  }}
                >
                  <IonLabel>{option.name}</IonLabel>
                </IonItem>
              ))
            ) : (
              <IonItem disabled>
                <IonLabel style={{ textAlign: "center", width: "100%" }}>
                  No results found
                </IonLabel>
              </IonItem>
            )}
          </IonList>
        </div>
      )}
    </div>
  );
};
