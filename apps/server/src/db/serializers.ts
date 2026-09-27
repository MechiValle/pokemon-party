import type {
  Room as PrismaRoom,
  Player as PrismaPlayer,
  PlayerPokemon as PrismaPlayerPokemon,
  InventoryItem as PrismaInventoryItem,
} from "@prisma/client";
import type {
  Room,
  RoomStatus,
  Player,
  PlayerPokemon,
  PokemonType,
  PokemonTypes,
  InventoryItem,
  ItemType,
} from "@pokemon-party/shared";

export function toRoomDTO(room: PrismaRoom): Room {
  return {
    ...room,
    status: room.status as RoomStatus,
  };
}

export function toPlayerDTO(player: PrismaPlayer): Player {
  return player;
}

export function toPlayerPokemonDTO(pokemon: PrismaPlayerPokemon): PlayerPokemon {
  const types: PokemonTypes = pokemon.type2
    ? [pokemon.type1 as PokemonType, pokemon.type2 as PokemonType]
    : [pokemon.type1 as PokemonType];

  return {
    id: pokemon.id,
    playerId: pokemon.playerId,
    species: pokemon.species,
    types,
    bp: pokemon.bp,
    isAce: pokemon.isAce,
    isFainted: pokemon.isFainted,
    isEgg: pokemon.isEgg,
    eggStepsRemaining: pokemon.eggStepsRemaining,
    heldItemId: pokemon.heldItemId,
  };
}

export function toInventoryItemDTO(item: PrismaInventoryItem): InventoryItem {
  return {
    id: item.id,
    playerId: item.playerId,
    type: item.type as ItemType,
  };
}