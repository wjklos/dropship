# Lunar Lander Backend Architecture

## Overview

A Rust-based event-driven backend to handle physics simulation, multiplayer synchronization, persistence, and computationally expensive operations. The frontend becomes a thin client focused on rendering and input.

---

## Why Rust Backend?

| Concern | Client-Side (Current) | Rust Backend |
|---------|----------------------|--------------|
| Physics simulation | 60Hz per client, divergence risk | Authoritative, deterministic |
| Multiplayer sync | P2P complexity, cheating risk | Server-authoritative, fair |
| Trajectory prediction | Expensive, blocks main thread | Parallel computation, cached |
| Persistence | localStorage, device-bound | Database, cross-device |
| AI opponents | Competes with rendering | Dedicated threads |
| Large worlds | Memory/GC pressure | Efficient memory, streaming |
| Anti-cheat | Impossible | Server validates all actions |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Browser  │  │ Browser  │  │ Browser  │  │ Spectator│            │
│  │ Player 1 │  │ Player 2 │  │ Player N │  │  View    │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │             │             │             │                    │
│       └─────────────┴──────┬──────┴─────────────┘                    │
│                            │                                         │
│                    WebSocket / WebRTC                                │
│                            │                                         │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│                      API GATEWAY                                     │
│                    (Rust + Axum)                                     │
│  ┌─────────────────────────┴─────────────────────────┐              │
│  │  • WebSocket upgrade & session management         │              │
│  │  • Authentication (JWT / OAuth)                   │              │
│  │  • Rate limiting                                  │              │
│  │  • Request routing                                │              │
│  └─────────────────────────┬─────────────────────────┘              │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────┐
│                      EVENT BUS                                       │
│              (Tokio broadcast / Redis Pub/Sub)                       │
│  ┌─────────────────────────┴─────────────────────────┐              │
│  │  Events: PlayerInput, PhysicsUpdate, Collision,   │              │
│  │          RocketLaunch, WeaponFired, Docking, etc. │              │
│  └──────┬──────────┬──────────┬──────────┬───────────┘              │
└─────────┼──────────┼──────────┼──────────┼───────────────────────────┘
          │          │          │          │
    ┌─────┴────┐ ┌───┴───┐ ┌────┴───┐ ┌────┴────┐
    │ Physics  │ │ Game  │ │ AI     │ │Persist- │
    │ Engine   │ │ Logic │ │ Engine │ │ ence    │
    └─────┬────┘ └───┬───┘ └────┬───┘ └────┬────┘
          │          │          │          │
          └──────────┴──────────┴──────────┘
                         │
              ┌──────────┴──────────┐
              │     DATA LAYER      │
              │  ┌───────────────┐  │
              │  │  PostgreSQL   │  │  ← Player profiles, stats, upgrades
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │    Redis      │  │  ← Session state, leaderboards, cache
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │  TimescaleDB  │  │  ← Telemetry, flight logs (optional)
              │  └───────────────┘  │
              └─────────────────────┘
```

---

## Core Services

### 1. Physics Engine Service

**Responsibility**: Authoritative physics simulation for all entities.

```rust
// Core physics loop - runs at fixed timestep (60Hz)
pub struct PhysicsEngine {
    world: World,
    entities: HashMap<EntityId, PhysicsBody>,
    config: PhysicsConfig,
    tick: u64,
}

#[derive(Clone, Debug)]
pub struct PhysicsBody {
    pub id: EntityId,
    pub entity_type: EntityType,
    pub position: Vec2,
    pub velocity: Vec2,
    pub rotation: f64,
    pub angular_velocity: f64,
    pub mass: f64,
    pub thrust: f64,
    pub fuel: f64,
}

#[derive(Clone, Debug)]
pub enum EntityType {
    Lander { player_id: PlayerId, upgrades: Vec<UpgradeId> },
    Rocket { pad_id: PadId, state: RocketState },
    Asteroid { shape: Polygon, landing_zone: Option<LandingPad> },
    Projectile { weapon_type: WeaponType, target: Option<EntityId> },
    Station { docking_ports: Vec<DockingPort> },
}

impl PhysicsEngine {
    pub fn tick(&mut self, dt: f64) -> Vec<PhysicsEvent> {
        let mut events = Vec::new();
        
        // Apply gravity (world-specific)
        self.apply_gravity(dt);
        
        // Apply atmosphere (if enabled)
        self.apply_drag(dt);
        self.apply_wind(dt);
        
        // Apply thrust from inputs
        self.apply_thrust(dt);
        
        // Update positions
        self.integrate(dt);
        
        // Collision detection
        events.extend(self.detect_collisions());
        
        // Terrain collision
        events.extend(self.check_terrain_collisions());
        
        self.tick += 1;
        events
    }
}
```

**Events Emitted**:
- `PhysicsUpdate { tick, entities: Vec<EntityState> }`
- `Collision { entity_a, entity_b, impact_velocity }`
- `Landing { entity_id, pad_id, outcome }`
- `OutOfBounds { entity_id }`

**Performance Target**: 1000+ entities at 60Hz on single core.

---

### 2. Game Logic Service

**Responsibility**: Game rules, scoring, phase management.

```rust
pub struct GameLogicService {
    sessions: HashMap<SessionId, GameSession>,
    event_tx: broadcast::Sender<GameEvent>,
}

pub struct GameSession {
    pub id: SessionId,
    pub world: WorldConfig,
    pub phase: GamePhase,
    pub players: HashMap<PlayerId, PlayerState>,
    pub rockets: Vec<RocketState>,
    pub pads: Vec<LandingPad>,
    pub terrain_seed: u64,
    pub start_time: Instant,
}

#[derive(Clone, Debug)]
pub enum GamePhase {
    Lobby { countdown: Option<Duration> },
    Active { tick: u64 },
    Paused { by: PlayerId },
    Completed { results: GameResults },
}

impl GameLogicService {
    pub async fn handle_event(&mut self, event: GameEvent) -> Vec<GameEvent> {
        match event {
            GameEvent::PlayerInput { player_id, input } => {
                self.validate_input(&player_id, &input)?;
                self.apply_input(&player_id, input)
            }
            GameEvent::PhysicsCollision { collision } => {
                self.process_collision(collision)
            }
            GameEvent::RocketLaunchTimer { pad_id } => {
                self.initiate_rocket_launch(pad_id)
            }
            GameEvent::RequestDocking { lander_id, target_id } => {
                self.evaluate_docking_request(lander_id, target_id)
            }
            // ...
        }
    }
    
    fn calculate_score(&self, landing: &LandingResult) -> Score {
        Score {
            base: 100,
            pad_multiplier: landing.pad.multiplier,
            fuel_bonus: (landing.fuel_remaining * 10.0) as u32,
            precision_bonus: self.precision_score(landing.offset_from_center),
            time_bonus: self.time_score(landing.flight_time),
            difficulty_multiplier: self.world_difficulty(),
        }
    }
}
```

**Events Emitted**:
- `ScoreUpdate { player_id, delta, total }`
- `PhaseChange { session_id, old_phase, new_phase }`
- `RocketLaunched { pad_id, trajectory }`
- `DockingComplete { lander_id, station_id }`

---

### 3. AI Engine Service

**Responsibility**: Computer-controlled landers, difficulty scaling.

```rust
pub struct AIEngine {
    agents: HashMap<EntityId, AIAgent>,
    difficulty: AIDifficulty,
}

pub struct AIAgent {
    pub entity_id: EntityId,
    pub personality: AIPersonality,
    pub target_pad: Option<PadId>,
    pub state: AIState,
    pub skill_level: f64,  // 0.0 - 1.0, affects precision
}

#[derive(Clone)]
pub enum AIPersonality {
    Cautious,      // Prioritizes fuel efficiency, wide margins
    Aggressive,    // Fast descents, tight margins
    Balanced,      // Middle ground
    Chaotic,       // Unpredictable, for challenge variety
}

#[derive(Clone)]
pub enum AIState {
    Orbiting { wait_until: Instant },
    SelectingTarget,
    Descending { approach: ApproachMode },
    Aborting,
    Landed,
    Crashed,
}

impl AIEngine {
    pub fn tick(&mut self, world_state: &WorldState) -> Vec<AIDecision> {
        self.agents.values_mut()
            .map(|agent| self.decide(agent, world_state))
            .collect()
    }
    
    fn decide(&self, agent: &mut AIAgent, world: &WorldState) -> AIDecision {
        match &agent.state {
            AIState::Orbiting { wait_until } => {
                if Instant::now() >= *wait_until && self.should_start_descent(agent, world) {
                    agent.state = AIState::SelectingTarget;
                }
                AIDecision::NoOp
            }
            AIState::SelectingTarget => {
                let target = self.select_target_pad(agent, world);
                agent.target_pad = Some(target);
                agent.state = AIState::Descending { 
                    approach: self.choose_approach(agent) 
                };
                AIDecision::SetTarget { pad_id: target }
            }
            AIState::Descending { approach } => {
                // Imperfect autopilot based on skill_level
                let ideal_input = self.compute_ideal_input(agent, world);
                let actual_input = self.add_imperfection(ideal_input, agent.skill_level);
                AIDecision::Input(actual_input)
            }
            // ...
        }
    }
    
    fn add_imperfection(&self, input: PlayerInput, skill: f64) -> PlayerInput {
        // Add noise inversely proportional to skill
        let noise = (1.0 - skill) * 0.1;
        PlayerInput {
            thrust: (input.thrust + rand::random::<f64>() * noise).clamp(0.0, 1.0),
            rotation: input.rotation + (rand::random::<f64>() - 0.5) * noise,
            ..input
        }
    }
}
```

**Difficulty Scaling**:
| Level | Skill | Behavior |
|-------|-------|----------|
| Easy | 0.3 | Slow, hesitant, often aborts |
| Medium | 0.6 | Competent, occasional mistakes |
| Hard | 0.85 | Near-optimal, competitive |
| Insane | 0.98 | Almost perfect, aggressive |

---

### 4. Persistence Service

**Responsibility**: Player data, game history, leaderboards.

```rust
// Using SQLx for async PostgreSQL
pub struct PersistenceService {
    pool: PgPool,
    redis: redis::Client,
}

// Player profile (PostgreSQL)
#[derive(sqlx::FromRow, Serialize, Deserialize)]
pub struct PlayerProfile {
    pub id: Uuid,
    pub username: String,
    pub email_hash: String,  // For Gravatar, not stored directly
    pub created_at: DateTime<Utc>,
    pub last_login: DateTime<Utc>,
    pub currency: i64,
    pub total_landings: i32,
    pub total_crashes: i32,
    pub total_score: i64,
}

// Unlocked upgrades (PostgreSQL)
#[derive(sqlx::FromRow)]
pub struct PlayerUpgrade {
    pub player_id: Uuid,
    pub upgrade_id: String,
    pub unlocked_at: DateTime<Utc>,
    pub equipped: bool,
}

// Flight log (TimescaleDB for time-series)
#[derive(sqlx::FromRow)]
pub struct FlightLog {
    pub id: Uuid,
    pub player_id: Uuid,
    pub session_id: Uuid,
    pub world: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub outcome: String,
    pub score: i32,
    pub fuel_used: f64,
    pub max_velocity: f64,
    pub approach_mode: String,
    // Telemetry stored as JSONB for flexibility
    pub telemetry: serde_json::Value,
}

// Leaderboard (Redis sorted sets)
impl PersistenceService {
    pub async fn update_leaderboard(&self, player_id: Uuid, score: i64) -> Result<()> {
        let mut conn = self.redis.get_async_connection().await?;
        
        // Daily leaderboard (expires at midnight UTC)
        let daily_key = format!("leaderboard:daily:{}", Utc::now().format("%Y-%m-%d"));
        conn.zadd(&daily_key, player_id.to_string(), score).await?;
        conn.expire(&daily_key, 86400 * 2).await?;  // Keep 2 days
        
        // Weekly leaderboard
        let week = Utc::now().iso_week();
        let weekly_key = format!("leaderboard:weekly:{}:{}", week.year(), week.week());
        conn.zadd(&weekly_key, player_id.to_string(), score).await?;
        
        // All-time
        conn.zadd("leaderboard:alltime", player_id.to_string(), score).await?;
        
        Ok(())
    }
    
    pub async fn get_leaderboard(&self, period: LeaderboardPeriod, limit: i64) -> Result<Vec<LeaderboardEntry>> {
        let key = match period {
            LeaderboardPeriod::Daily => format!("leaderboard:daily:{}", Utc::now().format("%Y-%m-%d")),
            LeaderboardPeriod::Weekly => {
                let week = Utc::now().iso_week();
                format!("leaderboard:weekly:{}:{}", week.year(), week.week())
            }
            LeaderboardPeriod::AllTime => "leaderboard:alltime".to_string(),
        };
        
        let mut conn = self.redis.get_async_connection().await?;
        let results: Vec<(String, f64)> = conn.zrevrange_withscores(&key, 0, limit - 1).await?;
        
        // Fetch player names
        let player_ids: Vec<Uuid> = results.iter()
            .filter_map(|(id, _)| Uuid::parse_str(id).ok())
            .collect();
        
        let players = self.get_players_by_ids(&player_ids).await?;
        
        Ok(results.into_iter().enumerate().map(|(rank, (id, score))| {
            LeaderboardEntry {
                rank: rank as i32 + 1,
                player_id: Uuid::parse_str(&id).unwrap(),
                player_name: players.get(&Uuid::parse_str(&id).unwrap())
                    .map(|p| p.username.clone())
                    .unwrap_or_else(|| "Unknown".to_string()),
                score: score as i64,
            }
        }).collect())
    }
}
```

**Database Schema**:

```sql
-- PostgreSQL

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email_hash VARCHAR(64),
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ DEFAULT NOW(),
    currency BIGINT DEFAULT 0,
    total_landings INT DEFAULT 0,
    total_crashes INT DEFAULT 0,
    total_score BIGINT DEFAULT 0
);

CREATE TABLE player_upgrades (
    player_id UUID REFERENCES players(id),
    upgrade_id VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    equipped BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (player_id, upgrade_id)
);

CREATE TABLE game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    player_count INT NOT NULL,
    winner_id UUID REFERENCES players(id)
);

CREATE TABLE session_players (
    session_id UUID REFERENCES game_sessions(id),
    player_id UUID REFERENCES players(id),
    final_score INT,
    outcome VARCHAR(20),
    PRIMARY KEY (session_id, player_id)
);

-- TimescaleDB for flight telemetry
CREATE TABLE flight_logs (
    id UUID DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL,
    session_id UUID NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    world VARCHAR(20) NOT NULL,
    outcome VARCHAR(20),
    score INT,
    flight_duration_ms INT,
    fuel_used FLOAT,
    max_velocity FLOAT,
    approach_mode VARCHAR(20),
    telemetry JSONB
);

SELECT create_hypertable('flight_logs', 'time');

-- Index for player history
CREATE INDEX idx_flight_logs_player ON flight_logs (player_id, time DESC);
```

---

### 5. Session Manager

**Responsibility**: Matchmaking, session lifecycle, player connections.

```rust
pub struct SessionManager {
    sessions: DashMap<SessionId, Arc<RwLock<GameSession>>>,
    player_sessions: DashMap<PlayerId, SessionId>,
    matchmaking_queue: Arc<Mutex<VecDeque<MatchmakingRequest>>>,
}

#[derive(Clone)]
pub struct MatchmakingRequest {
    pub player_id: PlayerId,
    pub preferences: MatchPreferences,
    pub queued_at: Instant,
}

#[derive(Clone)]
pub struct MatchPreferences {
    pub world: Option<WorldId>,
    pub mode: GameMode,
    pub skill_range: (i32, i32),  // ELO-like rating range
    pub max_players: u8,
}

#[derive(Clone)]
pub enum GameMode {
    Solo,                           // Single player, AI optional
    Competitive { max_players: u8 }, // Race to land
    Cooperative { objective: CoopObjective },
    Survival { waves: u8 },         // Increasing difficulty
}

impl SessionManager {
    pub async fn create_session(&self, config: SessionConfig) -> Result<SessionId> {
        let session_id = SessionId::new();
        let session = GameSession::new(config);
        
        self.sessions.insert(session_id, Arc::new(RwLock::new(session)));
        
        // Start session tick loop
        self.spawn_session_loop(session_id);
        
        Ok(session_id)
    }
    
    pub async fn join_session(&self, player_id: PlayerId, session_id: SessionId) -> Result<()> {
        let session = self.sessions.get(&session_id)
            .ok_or(Error::SessionNotFound)?;
        
        let mut session = session.write().await;
        
        if session.players.len() >= session.max_players {
            return Err(Error::SessionFull);
        }
        
        session.add_player(player_id)?;
        self.player_sessions.insert(player_id, session_id);
        
        // Broadcast player joined
        self.broadcast(session_id, GameEvent::PlayerJoined { player_id }).await;
        
        Ok(())
    }
    
    pub async fn matchmake(&self) -> Vec<SessionId> {
        let mut queue = self.matchmaking_queue.lock().await;
        let mut created_sessions = Vec::new();
        
        // Group compatible requests
        let groups = self.group_compatible_requests(&queue);
        
        for group in groups {
            if group.len() >= 2 || group.iter().any(|r| r.preferences.mode == GameMode::Solo) {
                let session_id = self.create_session_for_group(&group).await?;
                created_sessions.push(session_id);
                
                // Remove matched players from queue
                queue.retain(|r| !group.iter().any(|g| g.player_id == r.player_id));
            }
        }
        
        created_sessions
    }
}
```

---

## Event System

### Event Types

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameEvent {
    // Player actions
    PlayerInput { player_id: PlayerId, input: PlayerInput },
    PlayerJoined { player_id: PlayerId },
    PlayerLeft { player_id: PlayerId, reason: LeaveReason },
    
    // Physics events
    PhysicsUpdate { tick: u64, states: Vec<EntityState> },
    Collision { entity_a: EntityId, entity_b: EntityId, velocity: f64 },
    TerrainCollision { entity_id: EntityId, outcome: CollisionOutcome },
    
    // Game events
    LandingSuccess { player_id: PlayerId, pad_id: PadId, score: Score },
    LandingFailed { player_id: PlayerId, reason: FailureReason },
    RocketLaunched { pad_id: PadId, rocket_id: EntityId },
    DockingInitiated { lander_id: EntityId, target_id: EntityId },
    DockingComplete { lander_id: EntityId, target_id: EntityId },
    
    // Combat events (Phase 4)
    WeaponFired { entity_id: EntityId, weapon: WeaponType, target: Vec2 },
    ProjectileHit { projectile_id: EntityId, target_id: EntityId, damage: f64 },
    ShieldDepleted { entity_id: EntityId },
    
    // Session events
    PhaseChange { session_id: SessionId, phase: GamePhase },
    CountdownTick { remaining: Duration },
    SessionEnded { results: GameResults },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlayerInput {
    pub sequence: u64,           // For reconciliation
    pub thrust: f64,             // 0.0 - 1.0
    pub rotation: f64,           // -1.0 (left) to 1.0 (right)
    pub abort: bool,
    pub fire_weapon: Option<WeaponType>,
    pub target_pad: Option<PadId>,
}
```

### Event Flow

```
Client Input
    │
    ▼
┌─────────────────┐
│  API Gateway    │ ─── Validate, rate limit
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Event Bus     │ ─── Broadcast to services
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐ ┌───────┐  ┌──────────┐
│Physics│ │ Game  │  │Persistence│
│Engine │ │ Logic │  │ Service  │
└───┬───┘ └───┬───┘  └────┬─────┘
    │         │           │
    └────┬────┘           │
         │                │
         ▼                │
┌─────────────────┐       │
│  State Update   │ ◄─────┘
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Broadcast to    │
│ All Clients     │
└─────────────────┘
```

---

## Client-Server Protocol

### WebSocket Messages

```typescript
// Client → Server
type ClientMessage = 
  | { type: 'input', data: PlayerInput }
  | { type: 'join_session', data: { sessionId: string } }
  | { type: 'leave_session' }
  | { type: 'chat', data: { message: string } }
  | { type: 'request_state' }  // Full state resync
  | { type: 'ping', timestamp: number };

// Server → Client
type ServerMessage =
  | { type: 'state_update', tick: number, entities: EntityState[] }
  | { type: 'event', event: GameEvent }
  | { type: 'full_state', state: GameState }
  | { type: 'error', code: string, message: string }
  | { type: 'pong', clientTimestamp: number, serverTimestamp: number };
```

### State Synchronization

**Server-Authoritative Model**:

1. Client sends input with sequence number
2. Server processes input, updates physics
3. Server broadcasts state update to all clients
4. Clients reconcile local prediction with server state

```rust
// Server-side input processing
pub struct InputBuffer {
    inputs: VecDeque<TimestampedInput>,
    last_processed: u64,
}

impl InputBuffer {
    pub fn process(&mut self, server_tick: u64) -> Vec<PlayerInput> {
        // Process all inputs up to current server tick
        let inputs: Vec<_> = self.inputs
            .iter()
            .filter(|i| i.tick <= server_tick && i.tick > self.last_processed)
            .map(|i| i.input.clone())
            .collect();
        
        self.last_processed = server_tick;
        
        // Discard old inputs
        self.inputs.retain(|i| i.tick > server_tick - 60);
        
        inputs
    }
}
```

```typescript
// Client-side prediction & reconciliation
class ClientPrediction {
  private pendingInputs: PlayerInput[] = [];
  private lastServerTick: number = 0;
  
  applyInput(input: PlayerInput) {
    // Apply locally for immediate feedback
    this.localState = this.physics.apply(this.localState, input);
    
    // Store for reconciliation
    this.pendingInputs.push(input);
    
    // Send to server
    this.socket.send({ type: 'input', data: input });
  }
  
  reconcile(serverState: EntityState, serverTick: number) {
    // Discard acknowledged inputs
    this.pendingInputs = this.pendingInputs.filter(
      i => i.sequence > serverState.lastProcessedInput
    );
    
    // Start from server state
    let state = serverState;
    
    // Re-apply pending inputs
    for (const input of this.pendingInputs) {
      state = this.physics.apply(state, input);
    }
    
    // Smooth correction if difference is small
    if (this.distance(state, this.localState) < SNAP_THRESHOLD) {
      this.localState = this.lerp(this.localState, state, 0.1);
    } else {
      // Snap to correct position
      this.localState = state;
    }
  }
}
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KUBERNETES CLUSTER                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     INGRESS (nginx)                          │   │
│  │  • TLS termination                                           │   │
│  │  • WebSocket upgrade                                         │   │
│  │  • Load balancing                                            │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────────────────────┼───────────────────────────────────┐ │
│  │                     SERVICE MESH                               │ │
│  │                                                                │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │ │
│  │  │ Gateway  │  │ Gateway  │  │ Gateway  │  │ Gateway  │      │ │
│  │  │ Pod 1    │  │ Pod 2    │  │ Pod 3    │  │ Pod N    │      │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │ │
│  │       └─────────────┴──────┬──────┴─────────────┘             │ │
│  │                            │                                   │ │
│  │  ┌─────────────────────────┴─────────────────────────────┐    │ │
│  │  │                    REDIS CLUSTER                       │    │ │
│  │  │  • Pub/Sub for events                                  │    │ │
│  │  │  • Session state                                       │    │ │
│  │  │  • Leaderboards                                        │    │ │
│  │  └───────────────────────────────────────────────────────┘    │ │
│  │                                                                │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │ │
│  │  │ Physics  │  │ Physics  │  │ Physics  │  ← Sharded by      │ │
│  │  │ Worker 1 │  │ Worker 2 │  │ Worker N │    session         │ │
│  │  └──────────┘  └──────────┘  └──────────┘                    │ │
│  │                                                                │ │
│  │  ┌──────────┐  ┌──────────┐                                   │ │
│  │  │ AI       │  │ AI       │  ← Scales with AI player count   │ │
│  │  │ Worker 1 │  │ Worker 2 │                                   │ │
│  │  └──────────┘  └──────────┘                                   │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     DATA LAYER                               │   │
│  │                                                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│  │  │ PostgreSQL   │  │ PostgreSQL   │  │ TimescaleDB  │      │   │
│  │  │ Primary      │  │ Replica      │  │ (Telemetry)  │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Scaling Strategy

| Component | Scaling Trigger | Strategy |
|-----------|-----------------|----------|
| Gateway | Connections > 1000/pod | Horizontal, sticky sessions |
| Physics Worker | Sessions > 10/pod | Shard by session |
| AI Worker | AI entities > 50/pod | Horizontal |
| PostgreSQL | Read load | Read replicas |
| Redis | Memory > 70% | Cluster mode |

---

## Migration Path

### Phase 1: Hybrid (Client Heavy)

Keep existing client-side physics, add backend for:
- Authentication
- Player profiles
- Leaderboards
- Flight log persistence

```
Client (current):
  • Physics simulation
  • Autopilot
  • Rendering

Backend (new):
  • Auth (JWT)
  • Profile CRUD
  • Score submission
  • Leaderboard queries
```

### Phase 2: Server-Authoritative Single Player

Move physics to server, keep client for rendering:
- All physics on server
- Client does prediction + reconciliation
- AI opponents run on server

```
Client:
  • Input capture
  • Prediction
  • Rendering
  • Reconciliation

Backend:
  • Authoritative physics
  • Game logic
  • AI engine
  • Persistence
```

### Phase 3: Full Multiplayer

Complete server-authoritative multiplayer:
- Matchmaking
- Session management
- Real-time sync
- Combat systems

---

## Technology Stack

### Backend

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Rust + Tokio | Performance, safety, async |
| Web Framework | Axum | Modern, tower ecosystem |
| WebSocket | tokio-tungstenite | Async WebSocket |
| Database | SQLx + PostgreSQL | Type-safe queries, reliability |
| Cache | Redis | Pub/sub, leaderboards, sessions |
| Serialization | serde + MessagePack | Fast binary protocol |
| Auth | JWT + argon2 | Stateless, secure passwords |

### Infrastructure

| Concern | Technology | Rationale |
|---------|------------|-----------|
| Container | Docker | Standard, reproducible |
| Orchestration | Kubernetes | Scaling, self-healing |
| Ingress | nginx-ingress | WebSocket support |
| Monitoring | Prometheus + Grafana | Metrics, dashboards |
| Logging | Loki | Log aggregation |
| Tracing | Jaeger | Distributed tracing |

### Development

| Tool | Purpose |
|------|---------|
| cargo-watch | Auto-reload in dev |
| sqlx-cli | Database migrations |
| docker-compose | Local dev environment |
| k3d | Local Kubernetes |

---

## Revised Feature Effort Estimates

With backend support, some features become easier, others require more coordination:

| Feature | Client-Only | With Backend | Notes |
|---------|-------------|--------------|-------|
| Rocket Launches | Medium | **Easy** | Server manages timing, trajectories |
| Scrolling Terrain | High | **Medium** | Server generates/streams chunks |
| Mars Atmosphere | Medium | Medium | Physics on server |
| Asteroid Field | High | **Medium** | Server handles all collision |
| Rough Terrain | Medium | Medium | Terrain gen on server |
| Damage/Comm | Low | Low | Visual only, client-side |
| Return to Orbit | Medium | Medium | Same complexity |
| Orbital Docking | Very High | **High** | Server-authoritative helps |
| Weapons | Very High | **High** | Server prevents cheating |
| Abort Secondary | Low | Low | Logic stays similar |
| Lander Upgrades | High | **Medium** | Server validates, persists |
| **AI Opponents** | N/A | **Medium** | Only possible with backend |
| **Multiplayer** | N/A | **High** | Only possible with backend |
| **Leaderboards** | N/A | **Low** | Simple with Redis |
| **Profiles** | N/A | **Low** | Basic CRUD |

---

## Open Questions

1. **Hosting**: Self-hosted Kubernetes vs managed (AWS EKS, GCP GKE)?
2. **Region**: Single region initially, or multi-region from start?
3. **Cost Model**: How to fund infrastructure? Ads, cosmetics, subscription?
4. **Latency Budget**: What's acceptable? 50ms? 100ms? Affects architecture.
5. **Offline Play**: Support offline single-player, or always-online?
6. **Moderation**: How to handle toxic players in multiplayer?
7. **Replay System**: Store inputs for replay, or too much storage?

---

## Next Steps

1. **Set up Rust workspace** with basic Axum server
2. **Define protobuf/MessagePack schemas** for client-server protocol
3. **Implement auth service** (JWT, player profiles)
4. **Create database migrations** for core tables
5. **Build WebSocket handler** with ping/pong
6. **Port physics engine** to Rust (or keep TypeScript initially)
7. **Add Redis** for pub/sub and leaderboards
8. **Create Docker Compose** for local development
9. **Set up CI/CD** pipeline

---

*Document created: January 2025*
*For: Lunar Lander v4.0+ Backend*
