export type RoomStatus = "waiting" | "playing" | "finished";

export interface Room {
  id: string;
  code: string;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  vsAI: boolean;
  currentTurnIndex: number;
  round: number;
  bigDiceActive: boolean;
  gymsClosedActive: boolean;
  ballShortageActive: boolean;
  bidoofTimeActive: boolean;
  blockedNodeId: string | null;
  pendingItemNodeId: string | null;
  pendingEggNodeId: string | null;
}