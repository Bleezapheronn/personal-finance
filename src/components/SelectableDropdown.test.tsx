import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectableDropdown } from "./SelectableDropdown";

vi.mock("./SearchableFilterSelect", () => ({
  SearchableFilterSelect: ({
    onIonChange,
  }: {
    onIonChange: (value: number | undefined) => void;
  }) => (
    <button type="button" onClick={() => onIonChange(undefined)}>
      Clear test selection
    </button>
  ),
}));

describe("SelectableDropdown", () => {
  it("maps a cleared selection to its empty-string value contract", () => {
    const onValueChange = vi.fn();

    render(
      <SelectableDropdown
        label="Budget snapshot"
        value="1"
        options={[{ value: "1", label: "Snapshot 1" }]}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear test selection" }),
    );

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("");
  });
});
