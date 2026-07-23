import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableFilterSelect } from "./SearchableFilterSelect";

vi.mock("@ionic/react", () => ({
  IonIcon: () => null,
  IonItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  IonLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  IonList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  IonSearchbar: () => null,
}));

describe("SearchableFilterSelect", () => {
  it("clears a selected value without submitting the containing form", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <SearchableFilterSelect
          label="Budget snapshot"
          value={0}
          options={[{ id: 0, name: "Snapshot 1" }]}
          onIonChange={onChange}
        />
      </form>,
    );

    const clearButton = screen.getByTitle("Clear selection");
    expect(clearButton).toHaveAttribute("type", "button");

    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
