export type AccountImageChange =
  | { action: "set"; file: File }
  | { action: "remove" };
