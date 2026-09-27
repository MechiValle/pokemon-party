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

const turnState = new Map<string,{ playerId: string; remainingSteps: number; visitedNodes: string[] }>();

const pendingEncounters = new Map<string,{ playerId: string; species: string; bp: number; type1: string; type2: string | null }>();

const pendingItemDecisions = new Map<string, { playerId: string; itemType: ItemType }>();

const pendingFateChoices = new Map<string, { playerId: string }>();

const playerSockets = new Map<string, string>();

interface PendingGymBattle {
  playerId: string;
  nodeId: string;
  stage: "choose_ace" | "choose_type";
  afterAction?: "battle" | "advance";
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
}

async function applyRoundEvent(roomId: string, eventType: RoundEventType) {
  if (eventType === "item") {
    const randomNode = sinnohBoard.nodes[Math.floor(Math.random() * sinnohBoard.nodes.length)];
    await prisma.room.update({ where: { id: roomId }, data: { pendingItemNodeId: randomNode.id } });
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
    const randomNode = sinnohBoard.nodes[Math.floor(Math.random() * sinnohBoard.nodes.length)];
    await prisma.room.update({ where: { id: roomId }, data: { blockedNodeId: randomNode.id } });
    io.to(roomId).emit("room:event-triggered", {
      eventType,
      detail: { nodeId: randomNode.id },
    });
    return;
  }

  if (eventType === "roar_of_time") {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
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
      io.to(roomId).emit("room:event-triggered", {
        eventType,
        detail: { playerId: target.id },
      });
    }
    return;
  }

  if (eventType === "everyone_dies") {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
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

  if (eventType === "choose_your_fate") {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
    if (!room || room.players.length === 0) return;

    const chosen = room.players[Math.floor(Math.random() * room.players.length)];
    pendingFateChoices.set(roomId, { playerId: chosen.id });

    const socketId = playerSockets.get(chosen.id);
    if (socketId) {
      io.to(socketId).emit("event:fate-choice-needed", { options: CHOOSABLE_EVENTS });
    }

    io.to(roomId).emit("room:event-triggered", {
      eventType,
      detail: { playerId: chosen.id },
    });
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
  nodeId: string,
  afterAction: "battle" | "advance"
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

  pendingGymBattles.set(roomId, { playerId, nodeId, stage: "choose_ace", afterAction });
  socket.emit("gym:ace-choice-needed", {
    options: alive.map(toPlayerPokemonDTO),
    reason: "ace_fainted",
  });
  return false;
}

async function resolveGymBattle(
  roomId: string,
  playerId: string,
  nodeId: string,
  ace: { id: string; species: string; bp: number; type1: string; type2: string | null },
  attackType: PokemonType,
  socket: import("socket.io").Socket
): Promise<boolean> {
  const gym = GYM_DATA[nodeId];

  const playerEffectiveBp = ace.bp * (isSuperEffective(attackType, gym.type) ? 2 : 1);
  const gymEffectiveBp = gym.bp * (isSuperEffective(gym.type, attackType) ? 2 : 1);

  const playerWon = Math.random() * (playerEffectiveBp + gymEffectiveBp) < playerEffectiveBp;

  if (playerWon) {
    await prisma.playerPokemon.update({
      where: { id: ace.id },
      data: { bp: Math.min(10, ace.bp + 0.5) },
    });
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (player && !player.gymsWon.includes(nodeId)) {
      await prisma.player.update({
        where: { id: playerId },
        data: { gymsWon: { push: nodeId } },
      });
    }
  } else {
    await prisma.playerPokemon.update({
      where: { id: ace.id },
      data: { isFainted: true },
    });
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
    gymNodeId: nodeId,
    leaderName: gym.leaderName,
    playerSpecies: ace.species,
    playerEffectiveBp,
    gymSpecies: gym.species,
    gymEffectiveBp,
    playerWon,
  });

  if (!playerWon) {
    return await handleAceReassignment(roomId, playerId, socket, nodeId, "advance");
  }

  return true;
}

async function tryBattleWithAce(
  roomId: string,
  playerId: string,
  nodeId: string,
  ace: { id: string; species: string; bp: number; type1: string; type2: string | null },
  socket: import("socket.io").Socket
): Promise<boolean> {
  if (ace.type2) {
    pendingGymBattles.set(roomId, { playerId, nodeId, stage: "choose_type" });
    socket.emit("gym:type-choice-needed", { pokemon: toPlayerPokemonDTO(ace as any) });
    return false;
  }
  return await resolveGymBattle(roomId, playerId, nodeId, ace, ace.type1 as PokemonType, socket);
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

      const room = await prisma.room.findUnique({ where: { id: payload.roomId } });

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

        const alive = currentParty.filter((p) => !p.isFainted);

        if (alive.length === 0) {
          await advanceTurn(payload.roomId);
          callback({ success: true });
          return;
        }

        if (alive.length === 1) {
          await prisma.playerPokemon.updateMany({
            where: { playerId: updatedPlayer.id },
            data: { isAce: false },
          });
          await prisma.playerPokemon.update({
            where: { id: alive[0].id },
            data: { isAce: true },
          });

          const newParty = await prisma.playerPokemon.findMany({
            where: { playerId: updatedPlayer.id },
          });
          io.to(payload.roomId).emit("player:party-updated", {
            playerId: updatedPlayer.id,
            pokemons: newParty.map(toPlayerPokemonDTO),
          });

          const ace = newParty.find((p) => p.id === alive[0].id)!;
          const battleResolved = await tryBattleWithAce(
            payload.roomId,
            updatedPlayer.id,
            finalNode.id,
            ace,
            socket
          );
          if (battleResolved) {
            await advanceTurn(payload.roomId);
          }
          callback({ success: true });
          return;
        }

        pendingGymBattles.set(payload.roomId, {
          playerId: updatedPlayer.id,
          nodeId: finalNode.id,
          stage: "choose_ace",
          afterAction: "battle",
        });
        socket.emit("gym:ace-choice-needed", {
          options: alive.map(toPlayerPokemonDTO),
          reason: "before_battle",
        });
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

      const resolved = await tryBattleWithAce(
        payload.roomId,
        pending.playerId,
        pending.nodeId,
        ace,
        socket
      );
      if (resolved) {
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

      const resolved = await resolveGymBattle(
        payload.roomId,
        pending.playerId,
        pending.nodeId,
        ace,
        payload.type,
        socket
      );
      if (resolved) {
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