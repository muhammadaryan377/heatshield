import type { OperationalPlannerOption, Site } from './site'

export type AgentTraceStage = 'observe' | 'generate' | 'constrain' | 'compare' | 'critique' | 'propose' | 'verify'

export interface AgentTraceStep {
  stage: AgentTraceStage
  status: 'complete' | 'warning' | 'blocked'
  title: string
  detail: string
  evidence: string[]
}

export interface AgentOption {
  option: OperationalPlannerOption
  suitabilityScore: number
  verifiedImprovementC?: number | null
  eligible: boolean
  constraintNotes: string[]
}

export interface AgentCritique {
  source: 'deepseek' | 'deterministic'
  supportsRecommendation: boolean
  assessment: string
  riskFlags: string[]
  missingContext: string[]
  supervisorQuestion?: string | null
}

export interface AgentWorkerDecision {
  workerId: string
  workerName: string
  role: string
  task: string
  currentArea: string
  workload?: string | null
  sunExposure?: string | null
  shadeAccess?: string | null
  waterAccess?: boolean | null
  heatIndexC?: number | null
  evidenceFreshness: 'current_hour' | 'recent_completed_hour' | 'unavailable'
  baselineObservedAt?: string | null
  candidates: AgentOption[]
  recommendedChoice: 'now' | 'better_time' | 'better_place' | 'review'
  recommendation: string
  rationale: string
  confidenceScore: number
  confidenceLevel: 'high' | 'medium' | 'low'
  confidenceFactors: string[]
  humanApprovalRequired: boolean
  trace: AgentTraceStep[]
  critique: AgentCritique
  evidenceWarnings: string[]
}

export interface AgentExecutionStep {
  order: number
  name: string
  status: 'completed' | 'current' | 'pending'
  detail: string
}

export interface AgenticHeatPlan {
  site: Site
  generatedAt: string
  timezoneName: string
  agentVersion: string
  agentMode: 'bounded_ai' | 'deterministic_agent'
  autonomyLevel: 'supervisor_gated'
  mission: string
  conditionSource?: 'fortyguard' | 'nws' | null
  conditionHeatIndexC?: number | null
  providerRequestCount: number
  activeWorkerCount: number
  approvedZoneCount: number
  evidenceCoveragePercent: number
  workers: AgentWorkerDecision[]
  executionLoop: AgentExecutionStep[]
  warnings: string[]
}
