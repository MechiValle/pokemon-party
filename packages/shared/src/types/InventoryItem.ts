export type ItemType =
  | "revive"
  | "repel"
  | "rare_candy"
  | "pokedoll"
  | "focus_sash"
  | "running_shoes"
  | "knife"
  | "snag_machine"
  | "underground_man";

export interface InventoryItem {
  id: string;
  playerId: string;
  type: ItemType;
}