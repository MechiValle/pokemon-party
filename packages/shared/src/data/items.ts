import type { ItemType } from "../types/InventoryItem";

export const ITEM_TYPES: ItemType[] = [
  "revive",
  "repel",
  "rare_candy",
  "pokedoll",
  "focus_sash",
  "running_shoes",
  "knife",
  "snag_machine",
  "underground_man",
];

export type ItemWheelResult = ItemType | "nothing";

export const ITEM_WHEEL: ItemWheelResult[] = [...ITEM_TYPES, "nothing"];