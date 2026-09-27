export type RoundEventType =
  | "item"
  | "big_dice"
  | "paid_holiday"
  | "ball_shortage"
  | "bidoof_time"
  | "roar_of_time"
  | "psyduck_blockade"
  | "everyone_dies"
  | "choose_your_fate";

export interface RoundEventDef {
  type: RoundEventType;
  weight: number;
}

export const ROUND_EVENTS: RoundEventDef[] = [
  { type: "item", weight: 10 },
  { type: "big_dice", weight: 10 },
  { type: "paid_holiday", weight: 10 },
  { type: "ball_shortage", weight: 10 },
  { type: "bidoof_time", weight: 10 },
  { type: "roar_of_time", weight: 10 },
  { type: "psyduck_blockade", weight: 10 },
  { type: "everyone_dies", weight: 2 },
  { type: "choose_your_fate", weight: 10 },
];

export const CHOOSABLE_EVENTS: RoundEventType[] = ROUND_EVENTS.map((e) => e.type).filter(
  (t) => t !== "choose_your_fate"
);

export function pickWeightedEvent(events: RoundEventDef[]): RoundEventType {
  const total = events.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const e of events) {
    if (roll < e.weight) return e.type;
    roll -= e.weight;
  }
  return events[events.length - 1].type;
}