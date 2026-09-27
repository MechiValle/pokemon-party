import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import type {
  Player,
  Room,
  PlayerPokemon,
  PokemonTypes,
  PokemonType,
  InventoryItem,
  ItemType,
  RoundEventType,
} from '@pokemon-party/shared';
import { sinnohBoard } from '@pokemon-party/shared';
import { BoardView } from '@/components/BoardView';

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [remainingSteps, setRemainingSteps] = useState(0);
  const [myParty, setMyParty] = useState<PlayerPokemon[]>([]);
  const [myInventory, setMyInventory] = useState<InventoryItem[]>([]);
  const [lastEncounter, setLastEncounter] = useState<string | null>(null);
  const [lastBattleResult, setLastBattleResult] = useState<string | null>(null);
  const [lastItemMessage, setLastItemMessage] = useState<string | null>(null);
  const [lastRoundEvent, setLastRoundEvent] = useState<string | null>(null);
  const [decisionNeeded, setDecisionNeeded] = useState<{
    species: string;
    bp: number;
    types: PokemonTypes;
    currentParty: PlayerPokemon[];
  } | null>(null);
  const [aceChoiceNeeded, setAceChoiceNeeded] = useState<{
    options: PlayerPokemon[];
    reason: 'before_battle' | 'ace_fainted';
  } | null>(null);
  const [typeChoiceNeeded, setTypeChoiceNeeded] =
    useState<PlayerPokemon | null>(null);
  const [itemDecisionNeeded, setItemDecisionNeeded] = useState<{
    itemType: ItemType;
    currentInventory: InventoryItem[];
  } | null>(null);
  const [fateChoiceNeeded, setFateChoiceNeeded] = useState<
    RoundEventType[] | null
  >(null);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }
    function onDisconnect() {
      setIsConnected(false);
    }
    function onConnectError(err: Error) {
      console.error('Connection error:', err.message);
    }
    function onRoomUpdated(payload: { room: Room; players: Player[] }) {
      setRoom(payload.room);
      setPlayers(payload.players);
    }
    function onRoomCancelled() {
      alert('The room was cancelled by the host');
      setRoom(null);
      setPlayers([]);
    }
    function onTurnRolled(payload: { playerId: string; diceValue: number }) {
      setDiceValue(payload.diceValue);
      setRemainingSteps(payload.diceValue);
    }
    function onTurnPlayerMoved(payload: {
      playerId: string;
      nodeId: string;
      remainingSteps: number;
    }) {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === payload.playerId
            ? { ...p, boardPosition: payload.nodeId }
            : p,
        ),
      );
      setRemainingSteps(payload.remainingSteps);
      if (payload.remainingSteps > 0 && diceValue === null) {
        setDiceValue(payload.remainingSteps);
      }
    }
    function onTurnEnded(payload: { room: Room }) {
      setRoom(payload.room);
      setDiceValue(null);
      setRemainingSteps(0);
    }
    function onEncounterOccurred(payload: {
      playerId: string;
      routeName: string;
      species: string;
      bp: number;
      autoAdded: boolean;
    }) {
      const playerName =
        players.find((p) => p.id === payload.playerId)?.name ?? 'Someone';
      setLastEncounter(
        `${playerName} found a ${payload.species} (BP ${payload.bp}) at ${payload.routeName}${
          payload.autoAdded ? '' : ' (deciding what to do...)'
        }`,
      );
    }
    function onEncounterDecisionNeeded(payload: {
      species: string;
      bp: number;
      types: PokemonTypes;
      currentParty: PlayerPokemon[];
    }) {
      setDecisionNeeded(payload);
    }
    function onPartyUpdated(payload: {
      playerId: string;
      pokemons: PlayerPokemon[];
    }) {
      if (payload.playerId === myPlayerId) {
        setMyParty(payload.pokemons);
      }
    }
    function onAceChoiceNeeded(payload: {
      options: PlayerPokemon[];
      reason: 'before_battle' | 'ace_fainted';
    }) {
      setAceChoiceNeeded(payload);
    }
    function onTypeChoiceNeeded(payload: { pokemon: PlayerPokemon }) {
      setTypeChoiceNeeded(payload.pokemon);
    }
    function onBattleResult(payload: {
      playerId: string;
      context: 'gym' | 'rival' | 'cresselia' | 'darkrai';
      playerSpecies: string;
      playerEffectiveBp: number;
      opponentName: string;
      opponentSpecies: string;
      opponentEffectiveBp: number;
      playerWon: boolean;
    }) {
      const playerName =
        players.find((p) => p.id === payload.playerId)?.name ?? 'Someone';
      setLastBattleResult(
        `${playerName}'s ${payload.playerSpecies} (${payload.playerEffectiveBp} BP) vs ${payload.opponentName}'s ${payload.opponentSpecies} (${payload.opponentEffectiveBp} BP) — ${payload.playerWon ? 'WON!' : 'lost.'}`,
      );
    }
    function onCenterHealed(payload: { playerId: string }) {
      const playerName =
        players.find((p) => p.id === payload.playerId)?.name ?? 'Someone';
      setLastItemMessage(
        `${playerName}'s party was healed at the Pokemon Center`,
      );
    }
    function onItemReceived(payload: {
      playerId: string;
      itemType: ItemType | 'nothing';
      autoAdded: boolean;
    }) {
      const playerName =
        players.find((p) => p.id === payload.playerId)?.name ?? 'Someone';
      setLastItemMessage(
        payload.itemType === 'nothing'
          ? `${playerName} got nothing this time`
          : `${playerName} received a ${payload.itemType}${
              payload.autoAdded ? '' : ' (deciding what to do...)'
            }`,
      );
    }
    function onItemDecisionNeeded(payload: {
      itemType: ItemType;
      currentInventory: InventoryItem[];
    }) {
      setItemDecisionNeeded(payload);
    }
    function onInventoryUpdated(payload: {
      playerId: string;
      items: InventoryItem[];
    }) {
      if (payload.playerId === myPlayerId) {
        setMyInventory(payload.items);
      }
    }
    function onRoomEventTriggered(payload: {
      eventType: RoundEventType;
      detail?: Record<string, unknown>;
    }) {
      const nameOf = (id: unknown) =>
        players.find((p) => p.id === id)?.name ?? 'Someone';

      let message = `Event: ${payload.eventType}`;
      if (payload.eventType === 'roar_of_time') {
        message = `Roar of Time hit ${nameOf(payload.detail?.playerId)}'s Ace (-2 BP)`;
      } else if (payload.eventType === 'psyduck_blockade') {
        message = payload.detail?.skippedTurn
          ? `Psyduck Blockade: ${nameOf(payload.detail?.playerId)}'s only path is blocked, turn skipped`
          : `Psyduck Blockade: a path is blocked at node ${payload.detail?.nodeId} this round`;
      } else if (payload.eventType === 'choose_your_fate') {
        message = `Choose Your Fate: ${nameOf(payload.detail?.playerId)} is picking the event...`;
      } else if (payload.eventType === 'everyone_dies') {
        message = 'Everyone Dies! All Pokemon fainted.';
      } else if (payload.eventType === 'item') {
        message = 'An item box appeared somewhere on the map';
      } else if (payload.eventType === 'big_dice') {
        message = 'Big Dice: rolls are doubled this round';
      } else if (payload.eventType === 'paid_holiday') {
        message = 'Paid Holiday: gyms are closed this round';
      } else if (payload.eventType === 'ball_shortage') {
        message = 'Ball Shortage: no catching this round';
      } else if (payload.eventType === 'bidoof_time') {
        message = 'Bidoof Time: every encounter is a Bidoof this round';
      } else if (payload.eventType === 'rival_battle') {
        message = `Rival Battle: Barry appeared at node ${payload.detail?.nodeId}`;
      } else if (payload.eventType === 'sweet_dreams') {
        message = `Sweet Dreams? Cresselia at ${payload.detail?.cresseliaNode}, Darkrai at ${payload.detail?.darkraiNode}`;
      } else if (payload.eventType === 'egg') {
        if (payload.detail?.hatched) {
          message = `${nameOf(payload.detail?.playerId)}'s egg hatched into a ${payload.detail?.hatched}!`;
        } else {
          message = `An egg appeared at node ${payload.detail?.nodeId}`;
        }
      } else if (payload.eventType === 'meteor') {
        message = `METEOR!!! struck node ${payload.detail?.nodeId}`;
      }
      setLastRoundEvent(message);
    }
    function onFateChoiceNeeded(payload: { options: RoundEventType[] }) {
      setFateChoiceNeeded(payload.options);
    }
    function onFateChosen(payload: {
      playerId: string;
      eventType: RoundEventType;
    }) {
      const playerName =
        players.find((p) => p.id === payload.playerId)?.name ?? 'Someone';
      setLastRoundEvent(`${playerName} chose: ${payload.eventType}`);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:updated', onRoomUpdated);
    socket.on('room:cancelled', onRoomCancelled);
    socket.on('turn:rolled', onTurnRolled);
    socket.on('turn:player-moved', onTurnPlayerMoved);
    socket.on('turn:ended', onTurnEnded);
    socket.on('encounter:occurred', onEncounterOccurred);
    socket.on('encounter:decision-needed', onEncounterDecisionNeeded);
    socket.on('player:party-updated', onPartyUpdated);
    socket.on('gym:ace-choice-needed', onAceChoiceNeeded);
    socket.on('gym:type-choice-needed', onTypeChoiceNeeded);
    socket.on('gym:battle-result', onBattleResult);
    socket.on('center:healed', onCenterHealed);
    socket.on('item:received', onItemReceived);
    socket.on('item:decision-needed', onItemDecisionNeeded);
    socket.on('player:inventory-updated', onInventoryUpdated);
    socket.on('room:event-triggered', onRoomEventTriggered);
    socket.on('event:fate-choice-needed', onFateChoiceNeeded);
    socket.on('event:fate-chosen', onFateChosen);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:updated', onRoomUpdated);
      socket.off('room:cancelled', onRoomCancelled);
      socket.off('turn:rolled', onTurnRolled);
      socket.off('turn:player-moved', onTurnPlayerMoved);
      socket.off('turn:ended', onTurnEnded);
      socket.off('encounter:occurred', onEncounterOccurred);
      socket.off('encounter:decision-needed', onEncounterDecisionNeeded);
      socket.off('player:party-updated', onPartyUpdated);
      socket.off('gym:ace-choice-needed', onAceChoiceNeeded);
      socket.off('gym:type-choice-needed', onTypeChoiceNeeded);
      socket.off('gym:battle-result', onBattleResult);
      socket.off('center:healed', onCenterHealed);
      socket.off('item:received', onItemReceived);
      socket.off('item:decision-needed', onItemDecisionNeeded);
      socket.off('player:inventory-updated', onInventoryUpdated);
      socket.off('room:event-triggered', onRoomEventTriggered);
      socket.off('event:fate-choice-needed', onFateChoiceNeeded);
      socket.off('event:fate-chosen', onFateChosen);
    };
  }, [players, myPlayerId, diceValue]);

  function handleCreateRoom() {
    socket.emit(
      'room:create',
      { hostName: 'Ash', avatar: 'red', maxPlayers: 4, vsAI: false },
      (response) => {
        if ('error' in response) {
          console.error(response.error);
          return;
        }
        setRoom(response.room);
        setPlayers(response.players);
        setMyPlayerId(response.yourPlayerId);
      },
    );
  }

  function handleJoinRoom() {
    const code = prompt('Room code?');
    if (!code) return;

    socket.emit(
      'room:join',
      { code, name: 'Misty', avatar: 'blue' },
      (response) => {
        if ('error' in response) {
          alert(response.error);
          return;
        }
        setRoom(response.room);
        setPlayers(response.players);
        setMyPlayerId(response.yourPlayerId);
      },
    );
  }

  function handleCancelRoom() {
    if (!room) return;
    socket.emit('room:cancel', { roomId: room.id }, (response) => {
      if ('error' in response) {
        alert(response.error);
        return;
      }
      setRoom(null);
      setPlayers([]);
    });
  }

  function handleStartGame() {
    if (!room) return;
    socket.emit('room:start', { roomId: room.id }, (response) => {
      if ('error' in response) {
        alert(response.error);
        return;
      }
      setRoom(response.room);
      setPlayers(response.players);
    });
  }

  function handleRollDice() {
    if (!room) return;
    socket.emit('turn:roll', { roomId: room.id }, (response) => {
      if ('error' in response) alert(response.error);
    });
  }

  function handleMove(nextNodeId: string) {
    if (!room || isMoving) return;
    setIsMoving(true);
    socket.emit('turn:move', { roomId: room.id, nextNodeId }, (response) => {
      setIsMoving(false);
      if ('error' in response) alert(response.error);
    });
  }

  function handleEncounterDecision(
    decision: 'keep_current' | 'replace' | 'discard',
    replaceId?: string,
  ) {
    if (!room) return;
    socket.emit(
      'encounter:resolve',
      { roomId: room.id, decision, replacePokemonId: replaceId },
      (response) => {
        if ('error' in response) alert(response.error);
      },
    );
    setDecisionNeeded(null);
  }

  function handleChooseAce(pokemonId: string) {
    if (!room) return;
    socket.emit(
      'gym:choose-ace',
      { roomId: room.id, pokemonId },
      (response) => {
        if ('error' in response) alert(response.error);
      },
    );
    setAceChoiceNeeded(null);
  }

  function handleChooseType(type: PokemonType) {
    if (!room) return;
    socket.emit('gym:choose-type', { roomId: room.id, type }, (response) => {
      if ('error' in response) alert(response.error);
    });
    setTypeChoiceNeeded(null);
  }

  function handleItemDecision(
    decision: 'keep_current' | 'replace' | 'discard',
    replaceId?: string,
  ) {
    if (!room) return;
    socket.emit(
      'item:resolve',
      { roomId: room.id, decision, replaceItemId: replaceId },
      (response) => {
        if ('error' in response) alert(response.error);
      },
    );
    setItemDecisionNeeded(null);
  }

  function handleChooseFate(eventType: RoundEventType) {
    if (!room) return;
    socket.emit(
      'event:choose-fate',
      { roomId: room.id, eventType },
      (response) => {
        if ('error' in response) alert(response.error);
      },
    );
    setFateChoiceNeeded(null);
  }

  const me = players.find((p) => p.id === myPlayerId);
  const currentTurnPlayer = room ? players[room.currentTurnIndex] : undefined;
  const isMyTurn = currentTurnPlayer?.id === myPlayerId;
  const myNode = me
    ? sinnohBoard.nodes.find((n) => n.id === me.boardPosition)
    : undefined;
  const isWaitingOnMe =
    !!decisionNeeded ||
    !!aceChoiceNeeded ||
    !!typeChoiceNeeded ||
    !!itemDecisionNeeded ||
    !!fateChoiceNeeded;

  return (
    <div className='min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-4'>
      <h1 className='text-2xl font-bold'>Pokemon Party</h1>
      <p>
        Server status:{' '}
        <span className={isConnected ? 'text-green-500' : 'text-red-500'}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </p>

      {!room && (
        <div className='flex gap-2'>
          <Button onClick={handleCreateRoom}>Create Room</Button>
          <Button onClick={handleJoinRoom} variant='outline'>
            Join Room
          </Button>
        </div>
      )}

      {room && room.status === 'waiting' && (
        <>
          <p>
            Room code: {room.code} — Status: {room.status}
          </p>
          <ul>
            {players.map((p) => (
              <li key={p.id}>
                {p.name} ({p.avatar})
              </li>
            ))}
          </ul>
          <div className='flex gap-2'>
            <Button onClick={handleCancelRoom} variant='destructive'>
              Cancel Room
            </Button>
            <Button onClick={handleStartGame}>Start Game</Button>
          </div>
        </>
      )}

      {room && room.status === 'playing' && (
        <div className='w-full max-w-6xl flex flex-col items-center gap-4'>
          <p>Round: {room.round}</p>
          <p>
            Current turn: <strong>{currentTurnPlayer?.name}</strong>
            {isMyTurn && " (that's you!)"}
          </p>
          <p className='text-xs text-muted-foreground'>
            Active effects: {room.bigDiceActive && 'Big Dice '}
            {room.gymsClosedActive && 'Paid Holiday '}
            {room.ballShortageActive && 'Ball Shortage '}
            {room.bidoofTimeActive && 'Bidoof Time '}
            {room.blockedNodeId && `Psyduck@${room.blockedNodeId} `}
            {room.pendingItemNodeId && `Item@${room.pendingItemNodeId} `}
            {room.pendingEggNodeId && `Egg@${room.pendingEggNodeId} `}
            {!room.bigDiceActive &&
              !room.gymsClosedActive &&
              !room.ballShortageActive &&
              !room.bidoofTimeActive &&
              !room.blockedNodeId &&
              !room.pendingItemNodeId &&
              !room.pendingEggNodeId &&
              'none'}
          </p>
          <ul>
            {players.map((p) => (
              <li key={p.id}>
                {p.name}: {p.boardPosition} — Medals: {p.gymsWon.length}
              </li>
            ))}
          </ul>

          {lastEncounter && <p className='text-sm italic'>{lastEncounter}</p>}
          {lastBattleResult && (
            <p className='text-sm italic'>{lastBattleResult}</p>
          )}
          {lastItemMessage && (
            <p className='text-sm italic'>{lastItemMessage}</p>
          )}
          {lastRoundEvent && (
            <p className='text-sm italic font-semibold'>{lastRoundEvent}</p>
          )}

          <BoardView
            players={players}
            highlightedNodeIds={
              isMyTurn &&
              diceValue !== null &&
              remainingSteps > 0 &&
              myNode &&
              !isWaitingOnMe
                ? myNode.connections
                : []
            }
            onNodeClick={
              isMyTurn &&
              diceValue !== null &&
              remainingSteps > 0 &&
              !isWaitingOnMe &&
              !isMoving
                ? handleMove
                : undefined
            }
          />

          <div>
            <p className='font-semibold'>My party:</p>
            <ul>
              {myParty.map((poke) => (
                <li key={poke.id}>
                  {poke.isEgg
                    ? `Egg (${poke.eggStepsRemaining} steps left)`
                    : `${poke.species} — BP ${poke.bp} — ${poke.types.join('/')}`}
                  {poke.isAce && ' (Ace)'}
                  {poke.isFainted && ' (fainted)'}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className='font-semibold'>My inventory:</p>
            <ul>
              {myInventory.map((item) => (
                <li key={item.id}>{item.type}</li>
              ))}
            </ul>
          </div>

          {isMyTurn && diceValue === null && !isWaitingOnMe && (
            <Button onClick={handleRollDice}>Roll Dice</Button>
          )}

          {isMyTurn &&
            diceValue !== null &&
            remainingSteps > 0 &&
            !isWaitingOnMe && (
              <p>
                Rolled a {diceValue}. Steps remaining: {remainingSteps}. Click a
                highlighted node on the board to move.
              </p>
            )}

          {decisionNeeded && (
            <div className='flex flex-col items-center gap-2 border p-4 rounded'>
              <p>
                A wild {decisionNeeded.species} (BP {decisionNeeded.bp},{' '}
                {decisionNeeded.types.join('/')}) appeared! Your party is full.
              </p>
              <div className='flex gap-2'>
                {decisionNeeded.currentParty.map((poke) => (
                  <Button
                    key={poke.id}
                    variant='outline'
                    onClick={() => handleEncounterDecision('replace', poke.id)}
                  >
                    Replace {poke.isEgg ? 'Egg' : poke.species}
                  </Button>
                ))}
                <Button
                  variant='destructive'
                  onClick={() => handleEncounterDecision('discard')}
                >
                  Discard new Pokemon
                </Button>
              </div>
            </div>
          )}

          {aceChoiceNeeded && (
            <div className='flex flex-col items-center gap-2 border p-4 rounded'>
              <p>
                {aceChoiceNeeded.reason === 'ace_fainted'
                  ? 'Your Ace fainted! Choose the new Ace:'
                  : 'Choose which Pokemon will be your Ace for this battle:'}
              </p>
              <div className='flex gap-2'>
                {aceChoiceNeeded.options.map((poke) => (
                  <Button
                    key={poke.id}
                    onClick={() => handleChooseAce(poke.id)}
                  >
                    {poke.species} (BP {poke.bp})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {typeChoiceNeeded && (
            <div className='flex flex-col items-center gap-2 border p-4 rounded'>
              <p>Choose which type to attack with:</p>
              <div className='flex gap-2'>
                {typeChoiceNeeded.types.map((t) => (
                  <Button key={t} onClick={() => handleChooseType(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {itemDecisionNeeded && (
            <div className='flex flex-col items-center gap-2 border p-4 rounded'>
              <p>
                You received a {itemDecisionNeeded.itemType}! Your bag is full.
              </p>
              <div className='flex gap-2'>
                {itemDecisionNeeded.currentInventory.map((item) => (
                  <Button
                    key={item.id}
                    variant='outline'
                    onClick={() => handleItemDecision('replace', item.id)}
                  >
                    Replace {item.type}
                  </Button>
                ))}
                <Button
                  variant='destructive'
                  onClick={() => handleItemDecision('discard')}
                >
                  Discard new item
                </Button>
              </div>
            </div>
          )}

          {fateChoiceNeeded && (
            <div className='flex flex-col items-center gap-2 border p-4 rounded'>
              <p>Choose Your Fate! Pick which event happens this round:</p>
              <div className='flex flex-wrap gap-2 justify-center'>
                {fateChoiceNeeded.map((eventType) => (
                  <Button
                    key={eventType}
                    onClick={() => handleChooseFate(eventType)}
                  >
                    {eventType}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
