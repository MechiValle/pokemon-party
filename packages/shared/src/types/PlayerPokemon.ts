export type PokemonType =
  | "normal" | "fire" | "water" | "electric" | "grass" | "ice"
  | "fighting" | "poison" | "ground" | "flying" | "psychic"
  | "bug" | "rock" | "ghost" | "dragon" | "dark" | "steel" | "fairy";

export type PokemonTypes = [PokemonType] | [PokemonType, PokemonType];

export interface PlayerPokemon {
  id: string;
  playerId: string;
  species: string;
  types: PokemonTypes;
  bp: number;
  isAce: boolean;
  isFainted: boolean;
  heldItemId: string | null;
}