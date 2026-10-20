/**
 * TypeScript Interfaces for xT-WhatIf.
 * Exact mirror of contracts/api_Models.py and backend/app/schemas/match_contract.py.
 */

export type AgentRole = "data_scientist" | "classic_coach";

export type TeamSide = "home" | "away";

export interface PlayerNode {
  player_id: number;
  name: string;
  jersey_number: number;
  team: TeamSide;
  is_actor: boolean;
  is_keeper: boolean;
  // StatsBomb Standard Coordinates: X [0.0 - 120.0], Y [0.0 - 80.0]
  x: number;
  y: number;
  original_x?: number | null;
  original_y?: number | null;
  is_modified: boolean;
}

export interface TacticalMetrics {
  original_xt: number;
  simulated_xt: number;
  xt_delta: number;
  space_control_home_pct: number;
  optimal_pass_target_id?: number | null;
  pass_completion_prob: number;
}

export interface AgentMessage {
  message_id: string;
  agent_role: AgentRole;
  agent_name: string;
  avatar_badge: string;
  timestamp_label: string;
  headline: string;
  analysis_body: string;
  referenced_metric: string;
  highlighted_player_ids: number[];
}

export interface MatchFramePayload {
  match_id: number;
  event_uuid: string;
  minute: number;
  second: number;
  event_type: string;
  possession_team: TeamSide;
  is_counterfactual_mode: boolean;
  ball_x: number;
  ball_y: number;
  ball_end_x?: number | null;
  ball_end_y?: number | null;
  players: PlayerNode[];
  metrics: TacticalMetrics;
  agent_debate: AgentMessage[];
}

export interface CounterfactualRequest {
  match_id: number;
  event_uuid: string;
  modified_players: PlayerNode[];
}

/** POST /api/v1/cloud/stress-burst (backend/app/main.py · execute_stress_burst). */
export interface StressBurstResponse {
  status: string;
  benchmark: string;
  simulations_count: number;
  total_time_ms: number;
  average_latency_ms: number;
  throughput_simulations_per_sec: number;
  kd_tree_lookups: number;
  engine: string;
}
