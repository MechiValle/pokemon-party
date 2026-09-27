import type { Board } from "../types/Board";

// Small test board used to validate movement and turn logic
// before the real Sinnoh map is digitized.
export const testBoard: Board = {
  id: "test-board",
  name: "Test Board",
  startNodeId: "node-a",
  nodes: [
    { id: "node-a", type: "pokemon_center", connections: ["node-b"] },
    {
      id: "node-b",
      type: "route",
      connections: ["node-a", "node-c", "node-d"],
      routeName: "Test Route 1",
    },
    { id: "node-c", type: "pokemon_center", connections: ["node-b", "node-e"] },
    {
      id: "node-d",
      type: "route",
      connections: ["node-b", "node-e"],
      routeName: "Test Route 2",
    },
    { id: "node-e", type: "gym", connections: ["node-c", "node-d"] },
  ],
};