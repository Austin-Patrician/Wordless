import { app } from "electron";
import { prepareUserDataPathAt, type UserDataPreparation } from "./user-data-path";

export type { UserDataPreparation } from "./user-data-path";

export function prepareUserDataPath(): UserDataPreparation {
  return prepareUserDataPathAt(app.getPath("appData"));
}
