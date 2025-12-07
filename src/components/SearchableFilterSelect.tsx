import React, { useState, useRef, useEffect } from "react";
import {
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
} from "@ionic/react";
import { chevronDown, closeCircle } from "ionicons/icons";
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

  // NEW: Handle clear button click
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onIonChange(undefined);
    setSearchText("");
    // Keep dropdown open if it was already open
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              opacity: 0.7,
              position: "relative", // ADD THIS
            }}
          >
            {/* NEW: Clear button - only show if value is selected */}
            {selectedOption && (
              <button
                onClick={handleClear}
                style={{
                  position: "absolute", // ADD THIS - remove from flex flow
                  left: "-20px",
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
                  width: "18px", // CHANGE: explicit width to match chevron area
                  height: "18px", // CHANGE: explicit height to match chevron area
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
                }}
                title="Clear selection"
              >
                <IonIcon icon={closeCircle} />
              </button>
            )}
            <div style={{ width: "24px" }}>
              {" "}
              {/* ADD THIS spacer to keep chevron position consistent */}
              <IonIcon
                icon={chevronDown}
                style={{
                  fontSize: "1.2rem",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </div>
          </div>
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
