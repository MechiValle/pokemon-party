export type BoardEventType = "rival_battle" | "sweet_dreams";

export interface BoardEvent {
  id: string;
  roomId: string;
  type: BoardEventType;
  boardPosition: number;
  data: Record<string, unknown>;
  expiresAtRound: number;
}