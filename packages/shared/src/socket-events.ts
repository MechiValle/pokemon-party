import type { Room } from "./types/Room";
import type { Player } from "./types/Player";
import type { PlayerPokemon, PokemonType, PokemonTypes } from "./types/PlayerPokemon";
import type { InventoryItem, ItemType } from "./types/InventoryItem";
import type { ItemWheelResult } from "./data/items";
import type { RoundEventType } from "./data/roundEvents";

interface RoomJoinedResponse {
  room: Room;
  players: Player[];
  yourPlayerId: string;
}

export interface ClientToServerEvents {
  "room:create": (
    payload: { hostName: string; avatar: string; maxPlayers: number; vsAI: boolean },
    callback: (response: RoomJoinedResponse | { error: string }) => void
  ) => void;

  "room:join": (
    payload: { code: string; name: string; avatar: string },
    callback: (response: RoomJoinedResponse | { error: string }) => void
  ) => void;

  "room:cancel": (
    payload: { roomId: string },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "room:start": (
    payload: { roomId: string },
    callback: (response: { room: Room; players: Player[] } | { error: string }) => void
  ) => void;

  "turn:roll": (
    payload: { roomId: string },
    callback: (response: { diceValue: number } | { error: string }) => void
  ) => void;

  "turn:move": (
    payload: { roomId: string; nextNodeId: string },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "encounter:resolve": (
    payload: {
      roomId: string;
      decision: "keep_current" | "replace" | "discard";
      replacePokemonId?: string;
    },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "gym:choose-ace": (
    payload: { roomId: string; pokemonId: string },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "gym:choose-type": (
    payload: { roomId: string; type: PokemonType },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "item:resolve": (
    payload: {
      roomId: string;
      decision: "keep_current" | "replace" | "discard";
      replaceItemId?: string;
    },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;

  "event:choose-fate": (
    payload: { roomId: string; eventType: RoundEventType },
    callback: (response: { success: true } | { error: string }) => void
  ) => void;
}

export interface ServerToClientEvents {
  "room:updated": (payload: { room: Room; players: Player[] }) => void;
  "room:cancelled": () => void;
  "turn:rolled": (payload: { playerId: string; diceValue: number }) => void;
  "turn:player-moved": (payload: {
    playerId: string;
    nodeId: string;
    remainingSteps: number;
  }) => void;
  "turn:ended": (payload: { room: Room; nextPlayerId: string }) => void;

  "encounter:occurred": (payload: {
    playerId: string;
    routeName: string;
    species: string;
    bp: number;
    types: PokemonTypes;
    autoAdded: boolean;
  }) => void;

  "encounter:decision-needed": (payload: {
    species: string;
    bp: number;
    types: PokemonTypes;
    currentParty: PlayerPokemon[];
  }) => void;

  "player:party-updated": (payload: { playerId: string; pokemons: PlayerPokemon[] }) => void;

  "gym:ace-choice-needed": (payload: {
    options: PlayerPokemon[];
    reason: "before_battle" | "ace_fainted";
  }) => void;
  "gym:type-choice-needed": (payload: { pokemon: PlayerPokemon }) => void;
  "gym:battle-result": (payload: {
    playerId: string;
    gymNodeId: string;
    leaderName: string;
    playerSpecies: string;
    playerEffectiveBp: number;
    gymSpecies: string;
    gymEffectiveBp: number;
    playerWon: boolean;
  }) => void;

  "center:healed": (payload: { playerId: string }) => void;
  "item:received": (payload: { playerId: string; itemType: ItemWheelResult; autoAdded: boolean }) => void;
  "item:decision-needed": (payload: {
    itemType: ItemType;
    currentInventory: InventoryItem[];
  }) => void;
  "player:inventory-updated": (payload: { playerId: string; items: InventoryItem[] }) => void;

  "room:event-triggered": (payload: {
    eventType: RoundEventType;
    detail?: Record<string, unknown>;
  }) => void;
  "event:fate-choice-needed": (payload: { options: RoundEventType[] }) => void;
  "event:fate-chosen": (payload: { playerId: string; eventType: RoundEventType }) => void;
}