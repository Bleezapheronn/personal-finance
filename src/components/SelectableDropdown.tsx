import React from "react";
import { SearchableFilterSelect } from "./SearchableFilterSelect";

interface SelectableDropdownProps {
  label: string;
  placeholder?: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}

export const SelectableDropdown: React.FC<SelectableDropdownProps> = ({
  label,
  placeholder = "Select...",
  value,
  options,
  onValueChange,
}) => {
  const valueIndex = options.findIndex((opt) => opt.value === value);

  return (
    <SearchableFilterSelect
      label={label}
      placeholder={placeholder}
      value={valueIndex >= 0 ? valueIndex : undefined}
      options={options.map((opt, idx) => ({
        id: idx,
        name: opt.label,
      }))}
      onIonChange={(selectedId) => {
        if (selectedId !== undefined && options[selectedId]) {
          onValueChange(options[selectedId].value);
        }
      }}
    />
  );
};
