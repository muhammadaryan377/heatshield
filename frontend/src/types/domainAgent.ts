import type { Site } from './site'

export type DomainModule = 'workforce' | 'enterprise' | 'agriculture' | 'urban'

export interface DomainAgentRequest {
  module: DomainModule
  granularityMeters: 60 | 80 | 100
  thresholdC: number
}

export interface DomainAgentEvidence {
  id: string
  label: string
  source: string
  status: 'verified' | 'partial' | 'context' | 'unavailable'
  detail: string
}

export interface DomainAgentCandidate {
  id: string
  label: string
  entityType: string
  priorityScore: number
  eligible: boolean
  temperatureC?: number | null
  deltaC?: number | null
  metricLabel?: string | null
  metricValue?: string | null
  rationale: string
  constraints: string[]
  nextRoute: string
}

export interface DomainAgentCritique {
  source: 'deepseek' | 'deterministic'
  supportsRecommendation: boolean
  assessment: string
  riskFlags: string[]
  missingContext: string[]
}

export interface DomainAgentDecision {
  recommendedCandidateId?: string | null
  action: string
  rationale: string
  confidenceScore: number
  confidenceLevel: 'high' | 'medium' | 'low'
  humanApprovalRequired: boolean
  nextRoute: string
  critique: DomainAgentCritique
}

export interface DomainAgentTraceStep {
  order: number
  stage: 'observe' | 'rank' | 'constrain' | 'critique' | 'propose' | 'verify'
  status: 'complete' | 'warning' | 'blocked'
  title: string
  detail: string
}

export interface DomainAgentPlan {
  module: DomainModule
  site: Site
  audience: string
  mission: string
  generatedAt: string
  agentMode: 'bounded_ai' | 'deterministic_agent'
  evidenceCoveragePercent: number
  providerRequestCount: number
  evidence: DomainAgentEvidence[]
  candidates: DomainAgentCandidate[]
  decision: DomainAgentDecision
  trace: DomainAgentTraceStep[]
  warnings: string[]
}
