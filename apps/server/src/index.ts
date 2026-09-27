import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  PokemonType,
  ItemType,
  RoundEventType,
} from "@pokemon-party/shared";
import {
  sinnohBoard,
  ROUTE_ENCOUNTERS,
  POKEMON_SPECIES,
  GYM_DATA,
  isSuperEffective,
  ITEM_WHEEL,
  BIDOOF_WHEEL,
  EGG_WHEEL,
  ROUND_EVENTS,
  CHOOSABLE_EVENTS,
  pickWeightedEvent,
} from "@pokemon-party/shared";
import { prisma } from "./db/prisma";
import {
  toRoomDTO,
  toPlayerDTO,
  toPlayerPokemonDTO,
  toInventoryItemDTO,
} from "./db/serializers";

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
  },
});

const turnState = new Map<string, { playerId: string; remainingSteps: number; visitedNodes: string[] }>();

const pendingEncounters = new Map<string,{
    playerId: string;
    species: string;
    bp: number;
    type1: string;
    type2: string | null;
    isEgg?: boolean;
  }
>();

const pendingItemDecisions = new Map<string, { playerId: string; itemType: ItemType }>();

const pendingFateChoices = new Map<string, { playerId: string }>();
const movingRooms = new Set<string>();

const playerSockets = new Map<string, string>();

type BattleContext = "gym" | "rival" | "cresselia" | "darkrai";

interface PendingGymBattle {
  playerId: string;
  context: BattleContext;
  nodeId: string;
  stage: "choose_ace" | "choose_type";
  afterAction?: "battle" | "advance";
  remainingStepsAfterWin?: number;
}
const pendingGymBattles = new Map<string, PendingGymBattle>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function pickRandomNode(): string {
  return sinnohBoard.nodes[Math.floor(Math.random() * sinnohBoard.nodes.length)].id;
}

function getOpponent(context: BattleContext, nodeId: string) {
  if (context === "gym") {
    const g = GYM_DATA[nodeId];
    return { name: g.leaderName, species: g.species, bp: g.bp, type: g.type as PokemonType };
  }
  if (context === "rival") {
    return { name: "Barry", species: "Staraptor", bp: 8, type: "flying" as PokemonType };
  }
  if (context === "cresselia") {
    return { name: "Cresselia", species: "Cresselia", bp: 10, type: "psychic" as PokemonType };
  }
  return { name: "Darkrai", species: "Darkrai", bp: 10, type: "dark" as PokemonType };
}

async function resetRoundEffects(roomId: string) {
  await prisma.room.update({
    where: { id: roomId },
    data: {
      bigDiceActive: false,
      gymsClosedActive: false,
      ballShortageActive: false,
      bidoofTimeActive: false,
      blockedNodeId: null,
    },
  });
  await prisma.boardEvent.deleteMany({ where: { roomId } });
}

async function applyRoundEvent(roomId: string, eventType: RoundEventType) {
  if (eventType === "item") {
    await prisma.room.update({
      where: { id: roomId },
      data: { pendingItemNodeId: pickRandomNode() },
    });
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "big_dice") {
    await prisma.room.update({ where: { id: roomId }, data: { bigDiceActive: true } });
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "paid_holiday") {
    await prisma.room.update({ where: { id: roomId }, data: { gymsClosedActive: true } });
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "ball_shortage") {
    await prisma.room.update({ where: { id: roomId }, data: { ballShortageActive: true } });
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "bidoof_time") {
    await prisma.room.update({ where: { id: roomId }, data: { bidoofTimeActive: true } });
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "psyduck_blockade") {
    const nodeId = pickRandomNode();
    await prisma.room.update({ where: { id: roomId }, data: { blockedNodeId: nodeId } });
    io.to(roomId).emit("room:event-triggered", { eventType, detail: { nodeId } });
    return;
  }

  if (eventType === "roar_of_time") {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (room && room.players.length > 0) {
      const target = room.players[Math.floor(Math.random() * room.players.length)];
      const ace = await prisma.playerPokemon.findFirst({
        where: { playerId: target.id, isAce: true },
      });
      if (ace) {
        await prisma.playerPokemon.update({
          where: { id: ace.id },
          data: { bp: Math.max(0.5, ace.bp - 2) },
        });
        const newParty = await prisma.playerPokemon.findMany({ where: { playerId: target.id } });
        io.to(roomId).emit("player:party-updated", {
          playerId: target.id,
          pokemons: newParty.map(toPlayerPokemonDTO),
        });
      }
      io.to(roomId).emit("room:event-triggered", { eventType, detail: { playerId: target.id } });
    }
    return;
  }

  if (eventType === "everyone_dies") {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (room) {
      for (const p of room.players) {
        await prisma.playerPokemon.updateMany({
          where: { playerId: p.id },
          data: { isFainted: true },
        });
        const newParty = await prisma.playerPokemon.findMany({ where: { playerId: p.id } });
        io.to(roomId).emit("player:party-updated", {
          playerId: p.id,
          pokemons: newParty.map(toPlayerPokemonDTO),
        });
      }
    }
    io.to(roomId).emit("room:event-triggered", { eventType });
    return;
  }

  if (eventType === "rival_battle") {
    const nodeId = pickRandomNode();
    await prisma.boardEvent.create({
      data: { type: "rival_battle", boardPosition: nodeId, data: {}, expiresAtRound: 0, roomId },
    });
    io.to(roomId).emit("room:event-triggered", { eventType, detail: { nodeId } });
    return;
  }

  if (eventType === "sweet_dreams") {
    const cresseliaNode = pickRandomNode();
    let darkraiNode = pickRandomNode();
    while (darkraiNode === cresseliaNode) {
      darkraiNode = pickRandomNode();
    }
    await prisma.boardEvent.create({
      data: {
        type: "cresselia",
        boardPosition: cresseliaNode,
        data: {},
        expiresAtRound: 0,
        roomId,
      },
    });
    await prisma.boardEvent.create({
      data: { type: "darkrai", boardPosition: darkraiNode, data: {}, expiresAtRound: 0, roomId },
    });
    io.to(roomId).emit("room:event-triggered", {
      eventType,
      detail: { cresseliaNode, darkraiNode },
    });
    return;
  }

  if (eventType === "egg") {
    const nodeId = pickRandomNode();
    await prisma.room.update({ where: { id: roomId }, data: { pendingEggNodeId: nodeId } });
    io.to(roomId).emit("room:event-triggered", { eventType, detail: { nodeId } });
    return;
  }

  if (eventType === "meteor") {
    const targetNode = sinnohBoard.nodes.find((n) => n.id === pickRandomNode())!;
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });

    const directHitIds: string[] = [];
    const adjacentHitIds: string[] = [];

    if (room) {
      for (const p of room.players) {
        if (p.boardPosition === targetNode.id) {
          await prisma.playerPokemon.updateMany({
            where: { playerId: p.id },
            data: { isFainted: true },
          });
          directHitIds.push(p.id);
        } else if (targetNode.connections.includes(p.boardPosition)) {
          await prisma.playerPokemon.updateMany({
            where: { playerId: p.id, isAce: true },
            data: { isFainted: true },
          });
          adjacentHitIds.push(p.id);
        }
      }

      for (const p of room.players) {
        const newParty = await prisma.playerPokemon.findMany({ where: { playerId: p.id } });
        io.to(roomId).emit("player:party-updated", {
          playerId: p.id,
          pokemons: newParty.map(toPlayerPokemonDTO),
        });
      }
    }

    io.to(roomId).emit("room:event-triggered", {
      eventType,
      detail: { nodeId: targetNode.id, directHitIds, adjacentHitIds },
    });
    return;
  }

  if (eventType === "choose_your_fate") {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (!room || room.players.length === 0) return;

    const chosen = room.players[Math.floor(Math.random() * room.players.length)];
    pendingFateChoices.set(roomId, { playerId: chosen.id });

    const socketId = playerSockets.get(chosen.id);
    if (socketId) {
      io.to(socketId).emit("event:fate-choice-needed", { options: CHOOSABLE_EVENTS });
    }

    io.to(roomId).emit("room:event-triggered", { eventType, detail: { playerId: chosen.id } });
  }
}

async function advanceTurn(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { players: { orderBy: { turnOrder: "asc" } } },
  });
  if (!room) return;

  const nextTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  const isNewRound = nextTurnIndex === 0;
  const nextRound = isNewRound ? room.round + 1 : room.round;

  const updatedRoom = await prisma.room.update({
    where: { id: room.id },
    data: { currentTurnIndex: nextTurnIndex, round: nextRound },
  });

  io.to(roomId).emit("turn:ended", {
    room: toRoomDTO(updatedRoom),
    nextPlayerId: room.players[nextTurnIndex].id,
  });

  if (isNewRound) {
    await resetRoundEffects(roomId);
    const eventType = pickWeightedEvent(ROUND_EVENTS);
    await applyRoundEvent(roomId, eventType);
  }
}

async function handleAceReassignment(
  roomId: string,
  playerId: string,
  socket: import("socket.io").Socket,
  context: BattleContext,
  nodeId: string,
  afterAction: "battle" | "advance",
  remainingStepsAfterWin?: number
): Promise<boolean> {
  const party = await prisma.playerPokemon.findMany({ where: { playerId } });
  const currentAce = party.find((p) => p.isAce);

  if (currentAce && !currentAce.isFainted) return true;

  const alive = party.filter((p) => !p.isFainted && !p.isAce);

  if (alive.length === 0) return true;

  if (alive.length === 1) {
    await prisma.playerPokemon.updateMany({ where: { playerId }, data: { isAce: false } });
    await prisma.playerPokemon.update({ where: { id: alive[0].id }, data: { isAce: true } });

    const newParty = await prisma.playerPokemon.findMany({ where: { playerId } });
    io.to(roomId).emit("player:party-updated", {
      playerId,
      pokemons: newParty.map(toPlayerPokemonDTO),
    });
    return true;
  }

  pendingGymBattles.set(roomId, {
    playerId,
    context,
    nodeId,
    stage: "choose_ace",
    afterAction,
    remainingStepsAfterWin,
  });
  socket.emit("gym:ace-choice-needed", {
    options: alive.map(toPlayerPokemonDTO),
    reason: "ace_fainted",
  });
  return false;
}

async function resolveBattle(
  roomId: string,
  playerId: string,
  context: BattleContext,
  nodeId: string,
  ace: { id: string; species: string; bp: number; type1: string; type2: string | null },
  attackType: PokemonType,
  socket: import("socket.io").Socket,
  remainingStepsAfterWin?: number
): Promise<{ advance: boolean }> {
  const opponent = getOpponent(context, nodeId);

  const playerEffectiveBp = ace.bp * (isSuperEffective(attackType, opponent.type) ? 2 : 1);
  const opponentEffectiveBp = opponent.bp * (isSuperEffective(opponent.type, attackType) ? 2 : 1);

  const playerWon = Math.random() * (playerEffectiveBp + opponentEffectiveBp) < playerEffectiveBp;

  if (!playerWon) {
    await prisma.playerPokemon.update({ where: { id: ace.id }, data: { isFainted: true } });
  } else if (context === "gym") {
    await prisma.playerPokemon.update({
      where: { id: ace.id },
      data: { bp: Math.min(10, ace.bp + 0.5) },
    });
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (player && !player.gymsWon.includes(nodeId)) {
      await prisma.player.update({ where: { id: playerId }, data: { gymsWon: { push: nodeId } } });
    }
  }

  const newParty = await prisma.playerPokemon.findMany({ where: { playerId } });
  io.to(roomId).emit("player:party-updated", {
    playerId,
    pokemons: newParty.map(toPlayerPokemonDTO),
  });

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { players: { orderBy: { turnOrder: "asc" } } },
  });
  if (room) {
    io.to(roomId).emit("room:updated", {
      room: toRoomDTO(room),
      players: room.players.map(toPlayerDTO),
    });
  }

  io.to(roomId).emit("gym:battle-result", {
    playerId,
    context,
    nodeId,
    playerSpecies: ace.species,
    playerEffectiveBp,
    opponentName: opponent.name,
    opponentSpecies: opponent.species,
    opponentEffectiveBp,
    playerWon,
  });

  if (!playerWon) {
    const resolved = await handleAceReassignment(
      roomId,
      playerId,
      socket,
      context,
      nodeId,
      "advance"
    );
    return { advance: resolved };
  }

  if (context === "rival") {
    await prisma.boardEvent.deleteMany({ where: { roomId, type: "rival_battle" } });
    if (remainingStepsAfterWin && remainingStepsAfterWin > 0) {
      turnState.set(roomId, { playerId, remainingSteps: remainingStepsAfterWin, visitedNodes: [nodeId] });
      io.to(roomId).emit("turn:player-moved", {
        playerId,
        nodeId,
        remainingSteps: remainingStepsAfterWin,
      });
      return { advance: false };
    }
    return { advance: true };
  }

  if (context === "cresselia" || context === "darkrai") {
    await prisma.boardEvent.deleteMany({ where: { roomId, type: context } });

    const currentParty = await prisma.playerPokemon.findMany({ where: { playerId } });
    if (currentParty.length < 3) {
      await prisma.playerPokemon.create({
        data: {
          playerId,
          species: opponent.species,
          type1: opponent.type,
          type2: null,
          bp: opponent.bp,
          isAce: currentParty.length === 0,
        },
      });
      const finalParty = await prisma.playerPokemon.findMany({ where: { playerId } });
      io.to(roomId).emit("player:party-updated", {
        playerId,
        pokemons: finalParty.map(toPlayerPokemonDTO),
      });
      return { advance: true };
    }

    pendingEncounters.set(roomId, {
      playerId,
      species: opponent.species,
      bp: opponent.bp,
      type1: opponent.type,
      type2: null,
    });
    socket.emit("encounter:decision-needed", {
      species: opponent.species,
      bp: opponent.bp,
      types: [opponent.type],
      currentParty: currentParty.map(toPlayerPokemonDTO),
    });
    return { advance: false };
  }

  return { advance: true };
}

async function tryBattleWithAce(
  roomId: string,
  playerId: string,
  context: BattleContext,
  nodeId: string,
  ace: { id: string; species: string; bp: number; type1: string; type2: string | null },
  socket: import("socket.io").Socket,
  remainingStepsAfterWin?: number
): Promise<boolean> {
  if (ace.type2) {
    pendingGymBattles.set(roomId, {
      playerId,
      context,
      nodeId,
      stage: "choose_type",
      remainingStepsAfterWin,
    });
    socket.emit("gym:type-choice-needed", { pokemon: toPlayerPokemonDTO(ace as any) });
    return false;
  }
  const result = await resolveBattle(
    roomId,
    playerId,
    context,
    nodeId,
    ace,
    ace.type1 as PokemonType,
    socket,
    remainingStepsAfterWin
  );
  return result.advance;
}

async function startBattleFlow(
  roomId: string,
  playerId: string,
  context: BattleContext,
  nodeId: string,
  socket: import("socket.io").Socket,
  remainingStepsAfterWin?: number
): Promise<{ advance: boolean; skippedNoParty: boolean }> {
  const party = await prisma.playerPokemon.findMany({ where: { playerId } });
  const alive = party.filter((p) => !p.isFainted);

  if (alive.length === 0) {
    return { advance: true, skippedNoParty: true };
  }

  if (alive.length === 1) {
    await prisma.playerPokemon.updateMany({ where: { playerId }, data: { isAce: false } });
    await prisma.playerPokemon.update({ where: { id: alive[0].id }, data: { isAce: true } });

    const newParty = await prisma.playerPokemon.findMany({ where: { playerId } });
    io.to(roomId).emit("player:party-updated", {
      playerId,
      pokemons: newParty.map(toPlayerPokemonDTO),
    });

    const ace = newParty.find((p) => p.id === alive[0].id)!;
    const advance = await tryBattleWithAce(
      roomId,
      playerId,
      context,
      nodeId,
      ace,
      socket,
      remainingStepsAfterWin
    );
    return { advance, skippedNoParty: false };
  }

  pendingGymBattles.set(roomId, {
    playerId,
    context,
    nodeId,
    stage: "choose_ace",
    afterAction: "battle",
    remainingStepsAfterWin,
  });
  socket.emit("gym:ace-choice-needed", {
    options: alive.map(toPlayerPokemonDTO),
    reason: "before_battle",
  });
  return { advance: false, skippedNoParty: false };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("room:create", async (payload, callback) => {
    try {
      const room = await prisma.room.create({
        data: {
          code: generateRoomCode(),
          hostId: socket.id,
          maxPlayers: payload.maxPlayers,
          vsAI: payload.vsAI,
          players: {
            create: {
              name: payload.hostName,
              avatar: payload.avatar,
              turnOrder: 0,
            },
          },
        },
        include: { players: { orderBy: { turnOrder: "asc" } } },
      });

      socket.join(room.id);
      socket.data.playerId = room.players[0].id;
      playerSockets.set(room.players[0].id, socket.id);

      callback({
        room: toRoomDTO(room),
        players: room.players.map(toPlayerDTO),
        yourPlayerId: room.players[0].id,
      });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not create the room" });
    }
  });

  socket.on("room:join", async (payload, callback) => {
    try {
      const room = await prisma.room.findUnique({
        where: { code: payload.code.toUpperCase() },
        include: { players: { orderBy: { turnOrder: "asc" } } },
      });

      if (!room) {
        callback({ error: "Room not found" });
        return;
      }
      if (room.status !== "waiting") {
        callback({ error: "This game has already started" });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        callback({ error: "Room is full" });
        return;
      }

      const newPlayer = await prisma.player.create({
        data: {
          name: payload.name,
          avatar: payload.avatar,
          turnOrder: room.players.length,
          roomId: room.id,
        },
      });

      socket.join(room.id);
      socket.data.playerId = newPlayer.id;
      playerSockets.set(newPlayer.id, socket.id);

      const allPlayers = [...room.players, newPlayer];
      const roomDTO = toRoomDTO(room);
      const playersDTO = allPlayers.map(toPlayerDTO);

      io.to(room.id).emit("room:updated", { room: roomDTO, players: playersDTO });
      callback({ room: roomDTO, players: playersDTO, yourPlayerId: newPlayer.id });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not join the room" });
    }
  });

  socket.on("room:cancel", async (payload, callback) => {
    try {
      const room = await prisma.room.findUnique({ where: { id: payload.roomId } });
      if (!room) {
        callback({ error: "Room not found" });
        return;
      }
      if (room.hostId !== socket.id) {
        callback({ error: "Only the host can cancel the room" });
        return;
      }
      if (room.status !== "waiting") {
        callback({ error: "Cannot cancel a room that already started" });
        return;
      }

      io.to(room.id).emit("room:cancelled");
      io.socketsLeave(room.id);
      await prisma.room.delete({ where: { id: room.id } });

      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not cancel the room" });
    }
  });

  socket.on("room:start", async (payload, callback) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: payload.roomId },
        include: { players: { orderBy: { turnOrder: "asc" } } },
      });
      if (!room) {
        callback({ error: "Room not found" });
        return;
      }
      if (room.hostId !== socket.id) {
        callback({ error: "Only the host can start the game" });
        return;
      }
      if (room.status !== "waiting") {
        callback({ error: "Game already started" });
        return;
      }

      const minPlayers = room.vsAI ? 1 : 2;
      if (room.players.length < minPlayers) {
        callback({ error: `Need at least ${minPlayers} players to start` });
        return;
      }

      const updatedRoom = await prisma.room.update({
        where: { id: room.id },
        data: { status: "playing" },
      });

      const roomDTO = toRoomDTO(updatedRoom);
      const playersDTO = room.players.map(toPlayerDTO);

      io.to(room.id).emit("room:updated", { room: roomDTO, players: playersDTO });
      callback({ room: roomDTO, players: playersDTO });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not start the game" });
    }
  });

  socket.on("turn:roll", async (payload, callback) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: payload.roomId },
        include: { players: { orderBy: { turnOrder: "asc" } } },
      });
      if (!room) {
        callback({ error: "Room not found" });
        return;
      }
      if (room.status !== "playing") {
        callback({ error: "Game has not started yet" });
        return;
      }
      if (pendingFateChoices.has(room.id)) {
        callback({ error: "Waiting for Choose Your Fate to be resolved" });
        return;
      }

      const currentPlayer = room.players[room.currentTurnIndex];
      if (!currentPlayer || currentPlayer.id !== socket.data.playerId) {
        callback({ error: "It's not your turn" });
        return;
      }
      if (turnState.has(room.id)) {
        callback({ error: "You already rolled this turn" });
        return;
      }

      const currentNode = sinnohBoard.nodes.find((n) => n.id === currentPlayer.boardPosition);
      const availableConnections = currentNode
        ? currentNode.connections.filter((id) => id !== room.blockedNodeId)
        : [];

      if (currentNode && availableConnections.length === 0) {
        io.to(room.id).emit("room:event-triggered", {
          eventType: "psyduck_blockade",
          detail: { playerId: currentPlayer.id, skippedTurn: true },
        });
        await advanceTurn(room.id);
        callback({ error: "Psyduck is blocking your only path — turn skipped" });
        return;
      }

      const rivalEvent = await prisma.boardEvent.findFirst({
        where: { roomId: room.id, type: "rival_battle", boardPosition: currentPlayer.boardPosition },
      });

      if (rivalEvent) {
        const { advance, skippedNoParty } = await startBattleFlow(
          room.id,
          currentPlayer.id,
          "rival",
          currentPlayer.boardPosition,
          socket,
          undefined
        );
        if (skippedNoParty) {
          await advanceTurn(room.id);
        } else if (advance) {
          await advanceTurn(room.id);
        }
        callback({ error: "You must battle Barry before moving" });
        return;
      }

      const baseRoll = Math.floor(Math.random() * 6) + 1;
      const diceValue = room.bigDiceActive ? baseRoll * 2 : baseRoll;

      turnState.set(room.id, {
        playerId: currentPlayer.id,
        remainingSteps: diceValue,
        visitedNodes: [currentPlayer.boardPosition],
      });

      io.to(room.id).emit("turn:rolled", { playerId: currentPlayer.id, diceValue });
      callback({ diceValue });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not roll the dice" });
    }
  });

    socket.on("turn:move", async (payload, callback) => {
    if (movingRooms.has(payload.roomId)) {
      callback({ error: "A move is already being processed" });
      return;
    }
    movingRooms.add(payload.roomId);
    try {
      const pending = turnState.get(payload.roomId);
      if (!pending || pending.playerId !== socket.data.playerId) {
        callback({ error: "You have no pending move" });
        return;
      }

      const player = await prisma.player.findUnique({ where: { id: pending.playerId } });
      if (!player) {
        callback({ error: "Player not found" });
        return;
      }

      let room = await prisma.room.findUnique({ where: { id: payload.roomId } });

      const currentNode = sinnohBoard.nodes.find((n) => n.id === player.boardPosition);
      if (!currentNode || !currentNode.connections.includes(payload.nextNodeId)) {
        callback({ error: "Invalid move" });
        return;
      }
      if (room?.blockedNodeId === payload.nextNodeId) {
        callback({ error: "That path is blocked by Psyduck this round" });
        return;
      }

      const updatedPlayer = await prisma.player.update({
        where: { id: player.id },
        data: { boardPosition: payload.nextNodeId },
      });

      pending.remainingSteps -= 1;
      pending.visitedNodes.push(updatedPlayer.boardPosition);

      const activeEgg = await prisma.playerPokemon.findFirst({
        where: { playerId: updatedPlayer.id, isEgg: true },
      });
      if (activeEgg && activeEgg.eggStepsRemaining !== null) {
        const stepsLeft = activeEgg.eggStepsRemaining - 1;
        if (stepsLeft <= 0) {
          const hatched = EGG_WHEEL[Math.floor(Math.random() * EGG_WHEEL.length)];
          const hatchedTypes = POKEMON_SPECIES[hatched.species];
          await prisma.playerPokemon.update({
            where: { id: activeEgg.id },
            data: {
              species: hatched.species,
              type1: hatchedTypes[0],
              type2: hatchedTypes[1] ?? null,
              bp: hatched.bp,
              isEgg: false,
              eggStepsRemaining: null,
            },
          });
          io.to(payload.roomId).emit("room:event-triggered", {
            eventType: "egg",
            detail: { playerId: updatedPlayer.id, hatched: hatched.species },
          });
        } else {
          await prisma.playerPokemon.update({
            where: { id: activeEgg.id },
            data: { eggStepsRemaining: stepsLeft },
          });
        }
        const newParty = await prisma.playerPokemon.findMany({ where: { playerId: updatedPlayer.id } });
        io.to(payload.roomId).emit("player:party-updated", {
          playerId: updatedPlayer.id,
          pokemons: newParty.map(toPlayerPokemonDTO),
        });
      }

      const rivalEvent = await prisma.boardEvent.findFirst({
        where: { roomId: payload.roomId, type: "rival_battle", boardPosition: updatedPlayer.boardPosition },
      });

      if (rivalEvent) {
        const stepsLeftover = pending.remainingSteps;
        turnState.delete(payload.roomId);

        io.to(payload.roomId).emit("turn:player-moved", {
          playerId: updatedPlayer.id,
          nodeId: updatedPlayer.boardPosition,
          remainingSteps: 0,
        });

        const { advance, skippedNoParty } = await startBattleFlow(
          payload.roomId,
          updatedPlayer.id,
          "rival",
          updatedPlayer.boardPosition,
          socket,
          stepsLeftover
        );

        if (skippedNoParty || advance) {
          await advanceTurn(payload.roomId);
        }
        callback({ success: true });
        return;
      }

      if (pending.remainingSteps > 0) {
        io.to(payload.roomId).emit("turn:player-moved", {
          playerId: updatedPlayer.id,
          nodeId: updatedPlayer.boardPosition,
          remainingSteps: pending.remainingSteps,
        });
        callback({ success: true });
        return;
      }

      turnState.delete(payload.roomId);

      io.to(payload.roomId).emit("turn:player-moved", {
        playerId: updatedPlayer.id,
        nodeId: updatedPlayer.boardPosition,
        remainingSteps: 0,
      });

      room = await prisma.room.findUnique({ where: { id: payload.roomId } });

      if (room?.pendingItemNodeId && pending.visitedNodes.includes(room.pendingItemNodeId)) {
        await prisma.room.update({
          where: { id: payload.roomId },
          data: { pendingItemNodeId: null },
        });

        const rolledItem = ITEM_WHEEL[Math.floor(Math.random() * ITEM_WHEEL.length)];

        if (rolledItem === "nothing") {
          io.to(payload.roomId).emit("item:received", {
            playerId: updatedPlayer.id,
            itemType: "nothing",
            autoAdded: true,
          });
        } else {
          const currentInventory = await prisma.inventoryItem.findMany({
            where: { playerId: updatedPlayer.id },
          });

          if (currentInventory.length < 6) {
            await prisma.inventoryItem.create({
              data: { playerId: updatedPlayer.id, type: rolledItem },
            });
            const newInventory = await prisma.inventoryItem.findMany({
              where: { playerId: updatedPlayer.id },
            });
            io.to(payload.roomId).emit("item:received", {
              playerId: updatedPlayer.id,
              itemType: rolledItem,
              autoAdded: true,
            });
            io.to(payload.roomId).emit("player:inventory-updated", {
              playerId: updatedPlayer.id,
              items: newInventory.map(toInventoryItemDTO),
            });
          } else {
            pendingItemDecisions.set(payload.roomId, {
              playerId: updatedPlayer.id,
              itemType: rolledItem,
            });
            io.to(payload.roomId).emit("item:received", {
              playerId: updatedPlayer.id,
              itemType: rolledItem,
              autoAdded: false,
            });
            socket.emit("item:decision-needed", {
              itemType: rolledItem,
              currentInventory: currentInventory.map(toInventoryItemDTO),
            });
            callback({ success: true });
            return;
          }
        }
      }

      if (room?.pendingEggNodeId && pending.visitedNodes.includes(room.pendingEggNodeId)) {
        await prisma.room.update({
          where: { id: payload.roomId },
          data: { pendingEggNodeId: null },
        });

        const currentParty = await prisma.playerPokemon.findMany({
          where: { playerId: updatedPlayer.id },
        });

        if (currentParty.length < 3) {
          await prisma.playerPokemon.create({
            data: {
              playerId: updatedPlayer.id,
              species: "Egg",
              type1: "normal",
              type2: null,
              bp: 0,
              isEgg: true,
              eggStepsRemaining: 10,
              isAce: currentParty.length === 0,
            },
          });
          const newParty = await prisma.playerPokemon.findMany({
            where: { playerId: updatedPlayer.id },
          });
          io.to(payload.roomId).emit("player:party-updated", {
            playerId: updatedPlayer.id,
            pokemons: newParty.map(toPlayerPokemonDTO),
          });
        } else {
          pendingEncounters.set(payload.roomId, {
            playerId: updatedPlayer.id,
            species: "Egg",
            bp: 0,
            type1: "normal",
            type2: null,
            isEgg: true,
          });
          socket.emit("encounter:decision-needed", {
            species: "Egg",
            bp: 0,
            types: ["normal"],
            currentParty: currentParty.map(toPlayerPokemonDTO),
          });
          callback({ success: true });
          return;
        }
      }

      const cresseliaEvent = await prisma.boardEvent.findFirst({
        where: { roomId: payload.roomId, type: "cresselia", boardPosition: updatedPlayer.boardPosition },
      });
      const darkraiEvent = await prisma.boardEvent.findFirst({
        where: { roomId: payload.roomId, type: "darkrai", boardPosition: updatedPlayer.boardPosition },
      });

      if (cresseliaEvent || darkraiEvent) {
        const context: BattleContext = cresseliaEvent ? "cresselia" : "darkrai";
        const currentParty = await prisma.playerPokemon.findMany({
          where: { playerId: updatedPlayer.id },
        });
        const alive = currentParty.filter((p) => !p.isFainted);

        if (alive.length === 0) {
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        const { advance } = await startBattleFlow(
          payload.roomId,
          updatedPlayer.id,
          context,
          updatedPlayer.boardPosition,
          socket
        );
        if (advance) {
          await advanceTurn(payload.roomId);
        }
        callback({ success: true });
        return;
      }

      const finalNode = sinnohBoard.nodes.find((n) => n.id === updatedPlayer.boardPosition);

      if (finalNode?.type === "gym") {
        if (room?.gymsClosedActive) {
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        const currentParty = await prisma.playerPokemon.findMany({
          where: { playerId: updatedPlayer.id },
        });

        if (currentParty.length === 0 || updatedPlayer.gymsWon.includes(finalNode.id)) {
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        const { advance, skippedNoParty } = await startBattleFlow(
          payload.roomId,
          updatedPlayer.id,
          "gym",
          finalNode.id,
          socket
        );
        if (skippedNoParty || advance) {
          await advanceTurn(payload.roomId);
        }
        callback({ success: true });
        return;
      }

      if (finalNode?.type === "pokemon_center") {
        await prisma.playerPokemon.updateMany({
          where: { playerId: updatedPlayer.id, isFainted: true },
          data: { isFainted: false },
        });

        const healedParty = await prisma.playerPokemon.findMany({
          where: { playerId: updatedPlayer.id },
        });
        io.to(payload.roomId).emit("center:healed", { playerId: updatedPlayer.id });
        io.to(payload.roomId).emit("player:party-updated", {
          playerId: updatedPlayer.id,
          pokemons: healedParty.map(toPlayerPokemonDTO),
        });

        const rolledItem = ITEM_WHEEL[Math.floor(Math.random() * ITEM_WHEEL.length)];

        if (rolledItem === "nothing") {
          io.to(payload.roomId).emit("item:received", {
            playerId: updatedPlayer.id,
            itemType: "nothing",
            autoAdded: true,
          });
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        const currentInventory = await prisma.inventoryItem.findMany({
          where: { playerId: updatedPlayer.id },
        });

        if (currentInventory.length < 6) {
          await prisma.inventoryItem.create({
            data: { playerId: updatedPlayer.id, type: rolledItem },
          });

          const newInventory = await prisma.inventoryItem.findMany({
            where: { playerId: updatedPlayer.id },
          });

          io.to(payload.roomId).emit("item:received", {
            playerId: updatedPlayer.id,
            itemType: rolledItem,
            autoAdded: true,
          });
          io.to(payload.roomId).emit("player:inventory-updated", {
            playerId: updatedPlayer.id,
            items: newInventory.map(toInventoryItemDTO),
          });

          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        pendingItemDecisions.set(payload.roomId, {
          playerId: updatedPlayer.id,
          itemType: rolledItem,
        });

        io.to(payload.roomId).emit("item:received", {
          playerId: updatedPlayer.id,
          itemType: rolledItem,
          autoAdded: false,
        });
        socket.emit("item:decision-needed", {
          itemType: rolledItem,
          currentInventory: currentInventory.map(toInventoryItemDTO),
        });

        callback({ success: true });
        return;
      }

      if (finalNode?.type === "route" && finalNode.routeName) {
        if (room?.ballShortageActive) {
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        const encounterPool = room?.bidoofTimeActive
          ? BIDOOF_WHEEL
          : ROUTE_ENCOUNTERS[finalNode.routeName];
        const picked = encounterPool[Math.floor(Math.random() * encounterPool.length)];
        const speciesTypes = POKEMON_SPECIES[picked.species];

        const currentParty = await prisma.playerPokemon.findMany({
          where: { playerId: updatedPlayer.id },
        });

        if (currentParty.length < 3) {
          await prisma.playerPokemon.create({
            data: {
              playerId: updatedPlayer.id,
              species: picked.species,
              type1: speciesTypes[0],
              type2: speciesTypes[1] ?? null,
              bp: picked.bp,
              isAce: currentParty.length === 0,
            },
          });

          const newParty = await prisma.playerPokemon.findMany({
            where: { playerId: updatedPlayer.id },
          });

          io.to(payload.roomId).emit("encounter:occurred", {
            playerId: updatedPlayer.id,
            routeName: finalNode.routeName,
            species: picked.species,
            bp: picked.bp,
            types: speciesTypes,
            autoAdded: true,
          });
          io.to(payload.roomId).emit("player:party-updated", {
            playerId: updatedPlayer.id,
            pokemons: newParty.map(toPlayerPokemonDTO),
          });

          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        pendingEncounters.set(payload.roomId, {
          playerId: updatedPlayer.id,
          species: picked.species,
          bp: picked.bp,
          type1: speciesTypes[0],
          type2: speciesTypes[1] ?? null,
        });

        io.to(payload.roomId).emit("encounter:occurred", {
          playerId: updatedPlayer.id,
          routeName: finalNode.routeName,
          species: picked.species,
          bp: picked.bp,
          types: speciesTypes,
          autoAdded: false,
        });

        socket.emit("encounter:decision-needed", {
          species: picked.species,
          bp: picked.bp,
          types: speciesTypes,
          currentParty: currentParty.map(toPlayerPokemonDTO),
        });

        callback({ success: true });
        return;
      }

      await advanceTurn(payload.roomId);
      callback({ success: true });
        } catch (err) {
      console.error(err);
      callback({ error: "Could not move" });
    } finally {
      movingRooms.delete(payload.roomId);
    }
  });

  socket.on("encounter:resolve", async (payload, callback) => {
    try {
      const pending = pendingEncounters.get(payload.roomId);
      if (!pending || pending.playerId !== socket.data.playerId) {
        callback({ error: "No pending encounter for you" });
        return;
      }

      if (payload.decision === "replace") {
        if (!payload.replacePokemonId) {
          callback({ error: "Missing replacePokemonId" });
          return;
        }

        const replaced = await prisma.playerPokemon.findUnique({
          where: { id: payload.replacePokemonId },
        });
        const wasAce = replaced?.isAce ?? false;

        await prisma.playerPokemon.delete({ where: { id: payload.replacePokemonId } });
        await prisma.playerPokemon.create({
          data: {
            playerId: pending.playerId,
            species: pending.species,
            type1: pending.type1,
            type2: pending.type2,
            bp: pending.bp,
            isAce: wasAce,
            isEgg: pending.isEgg ?? false,
            eggStepsRemaining: pending.isEgg ? 10 : null,
          },
        });
      }

      pendingEncounters.delete(payload.roomId);

      const newParty = await prisma.playerPokemon.findMany({
        where: { playerId: pending.playerId },
      });
      io.to(payload.roomId).emit("player:party-updated", {
        playerId: pending.playerId,
        pokemons: newParty.map(toPlayerPokemonDTO),
      });

      await advanceTurn(payload.roomId);
      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not resolve the encounter" });
    }
  });

  socket.on("gym:choose-ace", async (payload, callback) => {
    try {
      const pending = pendingGymBattles.get(payload.roomId);
      if (!pending || pending.stage !== "choose_ace" || pending.playerId !== socket.data.playerId) {
        callback({ error: "No pending ace choice" });
        return;
      }

      await prisma.playerPokemon.updateMany({
        where: { playerId: pending.playerId },
        data: { isAce: false },
      });
      await prisma.playerPokemon.update({
        where: { id: payload.pokemonId },
        data: { isAce: true },
      });

      pendingGymBattles.delete(payload.roomId);

      const newParty = await prisma.playerPokemon.findMany({
        where: { playerId: pending.playerId },
      });
      io.to(payload.roomId).emit("player:party-updated", {
        playerId: pending.playerId,
        pokemons: newParty.map(toPlayerPokemonDTO),
      });

      if (pending.afterAction === "advance") {
        await advanceTurn(payload.roomId);
        callback({ success: true });
        return;
      }

      const ace = newParty.find((p) => p.id === payload.pokemonId);
      if (!ace) {
        callback({ error: "Pokemon not found" });
        return;
      }

      const advance = await tryBattleWithAce(
        payload.roomId,
        pending.playerId,
        pending.context,
        pending.nodeId,
        ace,
        socket,
        pending.remainingStepsAfterWin
      );
      if (advance) {
        await advanceTurn(payload.roomId);
      }
      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not choose ace" });
    }
  });

  socket.on("gym:choose-type", async (payload, callback) => {
    try {
      const pending = pendingGymBattles.get(payload.roomId);
      if (!pending || pending.stage !== "choose_type" || pending.playerId !== socket.data.playerId) {
        callback({ error: "No pending type choice" });
        return;
      }

      pendingGymBattles.delete(payload.roomId);

      const ace = await prisma.playerPokemon.findFirst({
        where: { playerId: pending.playerId, isAce: true },
      });
      if (!ace) {
        callback({ error: "Ace not found" });
        return;
      }

      const result = await resolveBattle(
        payload.roomId,
        pending.playerId,
        pending.context,
        pending.nodeId,
        ace,
        payload.type,
        socket,
        pending.remainingStepsAfterWin
      );
      if (result.advance) {
        await advanceTurn(payload.roomId);
      }
      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not choose type" });
    }
  });

  socket.on("item:resolve", async (payload, callback) => {
    try {
      const pending = pendingItemDecisions.get(payload.roomId);
      if (!pending || pending.playerId !== socket.data.playerId) {
        callback({ error: "No pending item decision for you" });
        return;
      }

      if (payload.decision === "replace") {
        if (!payload.replaceItemId) {
          callback({ error: "Missing replaceItemId" });
          return;
        }
        await prisma.inventoryItem.delete({ where: { id: payload.replaceItemId } });
        await prisma.inventoryItem.create({
          data: { playerId: pending.playerId, type: pending.itemType },
        });
      }

      pendingItemDecisions.delete(payload.roomId);

      const newInventory = await prisma.inventoryItem.findMany({
        where: { playerId: pending.playerId },
      });
      io.to(payload.roomId).emit("player:inventory-updated", {
        playerId: pending.playerId,
        items: newInventory.map(toInventoryItemDTO),
      });

      await advanceTurn(payload.roomId);
      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not resolve the item" });
    }
  });

  socket.on("event:choose-fate", async (payload, callback) => {
    try {
      const pending = pendingFateChoices.get(payload.roomId);
      if (!pending || pending.playerId !== socket.data.playerId) {
        callback({ error: "No pending fate choice for you" });
        return;
      }
      if (!CHOOSABLE_EVENTS.includes(payload.eventType)) {
        callback({ error: "Invalid event choice" });
        return;
      }

      pendingFateChoices.delete(payload.roomId);

      io.to(payload.roomId).emit("event:fate-chosen", {
        playerId: pending.playerId,
        eventType: payload.eventType,
      });

      await applyRoundEvent(payload.roomId, payload.eventType);
      callback({ success: true });
    } catch (err) {
      console.error(err);
      callback({ error: "Could not choose fate" });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});