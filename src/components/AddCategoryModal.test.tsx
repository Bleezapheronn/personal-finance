import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AddCategoryModal } from "./AddCategoryModal";

vi.mock("@ionic/react", () => {
  const element =
    (tag: keyof React.JSX.IntrinsicElements) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(tag, props, children);

  return {
    IonModal: ({
      isOpen,
      children,
    }: React.PropsWithChildren<{ isOpen: boolean }>) =>
      isOpen ? React.createElement("div", {}, children) : null,
    IonHeader: element("header"),
    IonToolbar: element("div"),
    IonTitle: element("h2"),
    IonButtons: element("div"),
    IonButton: ({
      children,
      onClick,
    }: React.PropsWithChildren<{ onClick?: () => void }>) =>
      React.createElement("button", { onClick }, children),
    IonContent: element("main"),
    IonGrid: element("div"),
    IonRow: element("div"),
    IonCol: element("div"),
    IonIcon: () => null,
    IonAlert: () => null,
    IonInput: ({
      placeholder,
      value,
      onIonInput,
      onIonChange,
    }: {
      placeholder?: string;
      value?: string;
      onIonInput?: (event: { detail: { value: string } }) => void;
      onIonChange?: (event: { detail: { value: string } }) => void;
    }) =>
      React.createElement("input", {
        placeholder,
        value: value ?? "",
        onInput: (event: React.FormEvent<HTMLInputElement>) =>
          onIonInput?.({ detail: { value: event.currentTarget.value } }),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onIonChange?.({ detail: { value: event.currentTarget.value } }),
      }),
  };
});

vi.mock("./SelectableDropdown", () => ({
  SelectableDropdown: ({
    onValueChange,
  }: {
    onValueChange: (value: string) => void;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => onValueChange("7"),
      },
      "Select test bucket",
    ),
}));

describe("AddCategoryModal", () => {
  test("submits the live typed name without requiring blur", async () => {
    const user = userEvent.setup();
    const onSaveCategory = vi.fn().mockResolvedValue(undefined);

    render(
      <AddCategoryModal
        isOpen
        onClose={vi.fn()}
        onCategoryAdded={vi.fn()}
        buckets={[
          {
            id: 7,
            name: "Test Bucket",
            minPercentage: 0,
            maxPercentage: 100,
            isActive: true,
            displayOrder: 0,
            excludeFromReports: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]}
        onSaveCategory={onSaveCategory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select test bucket" }));
    const nameInput = screen.getByPlaceholderText("e.g., Groceries");
    fireEvent.input(nameInput, {
      target: { value: "  Immediate Category  " },
    });
    await user.click(screen.getByRole("button", { name: "Add Category" }));

    await waitFor(() =>
      expect(onSaveCategory).toHaveBeenCalledWith(
        {
          name: "Immediate Category",
          bucketId: 7,
          description: undefined,
        },
        undefined,
      ),
    );
    expect(onSaveCategory).toHaveBeenCalledTimes(1);
  });
});
