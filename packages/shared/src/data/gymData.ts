import type { PokemonType } from "../types/PlayerPokemon";

export interface GymData {
  leaderName: string;
  species: string;
  bp: number;
  type: PokemonType;
}

export const GYM_DATA: Record<string, GymData> = {
  g: { leaderName: "Roark", species: "Cranidos", bp: 6, type: "rock" },
  "3": { leaderName: "Gardenia", species: "Roserade", bp: 7, type: "grass" },
  i: { leaderName: "Fantina", species: "Mismagius", bp: 7, type: "ghost" },
  r: { leaderName: "Maylene", species: "Lucario", bp: 7, type: "fighting" },
  k: { leaderName: "Crasher Wake", species: "Floatzel", bp: 8, type: "water" },
  b: { leaderName: "Byron", species: "Bastiodon", bp: 8, type: "steel" },
  "7": { leaderName: "Candice", species: "Froslass", bp: 8, type: "ice" },
  m: { leaderName: "Volkner", species: "Electivire", bp: 9, type: "electric" },
};