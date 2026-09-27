export interface Player {
  id: string;
  name: string;
  avatar: string;
  roomId: string;
  turnOrder: number;
  boardPosition: string;
  medals: number;
  gymsWon: string[];
}