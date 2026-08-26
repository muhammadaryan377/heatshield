from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas import CamelModel, OperationalPlannerOption, Site


class AgentTraceStep(CamelModel):
    stage: Literal['observe', 'generate', 'constrain', 'compare', 'critique', 'propose', 'verify']
    status: Literal['complete', 'warning', 'blocked']
    title: str
    detail: str
    evidence: list[str] = Field(default_factory=list)


class AgentOption(CamelModel):
    option: OperationalPlannerOption
    suitabilityScore: int = Field(ge=0, le=100)
    verifiedImprovementC: float | None = None
    eligible: bool
    constraintNotes: list[str] = Field(default_factory=list)


class AgentTemporalEvidence(CamelModel):
    status: Literal['complete', 'partial', 'unmatched', 'unavailable']
    profileDate: str | None = None
    thresholdC: float | None = None
    peakTemperatureC: float | None = None
    peakHourLocal: str | None = None
    hoursAboveThreshold: float | None = None
    persistenceHours: float | None = None
    detail: str


class AgentCritique(CamelModel):
    source: Literal['deepseek', 'deterministic'] = 'deterministic'
    supportsRecommendation: bool = True
    assessment: str
    riskFlags: list[str] = Field(default_factory=list)
    missingContext: list[str] = Field(default_factory=list)
    supervisorQuestion: str | None = None


class AgentWorkerDecision(CamelModel):
    workerId: str
    workerName: str
    role: str
    task: str
    currentArea: str
    workload: str | None = None
    sunExposure: str | None = None
    shadeAccess: str | None = None
    waterAccess: bool | None = None
    heatIndexC: float | None = None
    evidenceFreshness: Literal['current_hour', 'recent_completed_hour', 'unavailable']
    baselineObservedAt: str | None = None
    temporalEvidence: AgentTemporalEvidence | None = None
    candidates: list[AgentOption] = Field(default_factory=list)
    recommendedChoice: Literal['now', 'better_time', 'better_place', 'review']
    recommendation: str
    rationale: str
    confidenceScore: int = Field(ge=0, le=100)
    confidenceLevel: Literal['high', 'medium', 'low']
    confidenceFactors: list[str] = Field(default_factory=list)
    humanApprovalRequired: bool = True
    trace: list[AgentTraceStep] = Field(default_factory=list)
    critique: AgentCritique
    evidenceWarnings: list[str] = Field(default_factory=list)


class AgentExecutionStep(CamelModel):
    order: int
    name: str
    status: Literal['completed', 'current', 'pending']
    detail: str


class AgenticHeatPlan(CamelModel):
    site: Site
    generatedAt: str
    timezoneName: str
    agentVersion: str = 'heatshield-agent-v1'
    agentMode: Literal['bounded_ai', 'deterministic_agent'] = 'deterministic_agent'
    autonomyLevel: Literal['supervisor_gated'] = 'supervisor_gated'
    mission: str
    conditionSource: Literal['fortyguard', 'nws'] | None = None
    conditionHeatIndexC: float | None = None
    providerRequestCount: int = 0
    historicalProfileStatus: Literal['verified', 'partial', 'unavailable', 'configuration_required'] | None = None
    historicalProfileDate: str | None = None
    activeWorkerCount: int = 0
    approvedZoneCount: int = 0
    evidenceCoveragePercent: int = Field(ge=0, le=100)
    workers: list[AgentWorkerDecision] = Field(default_factory=list)
    executionLoop: list[AgentExecutionStep] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
