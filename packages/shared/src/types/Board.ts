export type BoardNodeType = "route" | "gym" | "pokemon_center";

export interface BoardNode {
  id: string;
  type: BoardNodeType;
  connections: string[];
  routeName?: string;
  gymLeaderName?: string;
}

export interface Board {
  id: string;
  name: string;
  startNodeId: string;
  nodes: BoardNode[];
}