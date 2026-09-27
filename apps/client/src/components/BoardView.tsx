import { sinnohBoard } from "@pokemon-party/shared";
import type { Player } from "@pokemon-party/shared";
import { BOARD_POSITIONS } from "@/data/boardPositions";

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7"];

interface BoardViewProps {
  players: Player[];
  highlightedNodeIds: string[];
  onNodeClick?: (nodeId: string) => void;
}

export function BoardView({ players, highlightedNodeIds, onNodeClick }: BoardViewProps) {
  const edgeSet = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  for (const node of sinnohBoard.nodes) {
    for (const conn of node.connections) {
      const key = [node.id, conn].sort().join("-");
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from: node.id, to: conn });
      }
    }
  }

  const playersByNode = new Map<string, Player[]>();
  for (const player of players) {
    const list = playersByNode.get(player.boardPosition) ?? [];
    list.push(player);
    playersByNode.set(player.boardPosition, list);
  }

  return (
    <div className="w-full overflow-x-auto border rounded">
      <svg viewBox="0 0 1460 700" className="min-w-[1460px]">
        {edges.map((edge) => {
          const from = BOARD_POSITIONS[edge.from];
          const to = BOARD_POSITIONS[edge.to];
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#fbbf24"
              strokeWidth={6}
            />
          );
        })}

        {sinnohBoard.nodes.map((node) => {
          const pos = BOARD_POSITIONS[node.id];
          const isHighlighted = highlightedNodeIds.includes(node.id);
          const fill =
            node.type === "gym" ? "#ef4444" : node.type === "pokemon_center" ? "#3b82f6" : "#ffffff";

          return (
            <g
              key={node.id}
              onClick={() => onNodeClick?.(node.id)}
              style={{ cursor: onNodeClick && isHighlighted ? "pointer" : "default" }}
            >
              <rect
                x={pos.x - 18}
                y={pos.y - 18}
                width={36}
                height={36}
                fill={fill}
                stroke={isHighlighted ? "#facc15" : "#000000"}
                strokeWidth={isHighlighted ? 5 : 2}
                transform={
                  node.type === "route" ? `rotate(45 ${pos.x} ${pos.y})` : undefined
                }
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fontSize={12}
                fontWeight="bold"
                fill={node.type === "route" ? "#000000" : "#ffffff"}
              >
                {node.id}
              </text>
            </g>
          );
        })}

        {Array.from(playersByNode.entries()).map(([nodeId, playersHere]) =>
          playersHere.map((player, i) => {
            const pos = BOARD_POSITIONS[nodeId];
            const colorIndex = players.findIndex((p) => p.id === player.id);
            return (
              <circle
                key={player.id}
                cx={pos.x - 20 + i * 14}
                cy={pos.y - 25}
                r={7}
                fill={PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]}
                stroke="#000000"
                strokeWidth={1.5}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}