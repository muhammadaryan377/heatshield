from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel, Site


DomainModule = Literal['workforce', 'enterprise', 'agriculture', 'urban']


class DomainAgentRequest(CamelModel):
    module: DomainModule
    granularityMeters: int = 100
    thresholdC: float = Field(default=35.0, ge=-30.0, le=70.0)

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('HeatShield agent granularity must be 60, 80, or 100 meters.')
        return self


class DomainAgentEvidence(CamelModel):
    id: str
    label: str
    source: str
    status: Literal['verified', 'partial', 'context', 'unavailable']
    detail: str


class DomainAgentCandidate(CamelModel):
    id: str
    label: str
    entityType: str
    priorityScore: int = Field(ge=0, le=100)
    eligible: bool = True
    temperatureC: float | None = None
    deltaC: float | None = None
    metricLabel: str | None = None
    metricValue: str | None = None
    rationale: str
    constraints: list[str] = Field(default_factory=list)
    nextRoute: str


class DomainAgentCritique(CamelModel):
    source: Literal['deepseek', 'deterministic'] = 'deterministic'
    supportsRecommendation: bool = True
    assessment: str
    riskFlags: list[str] = Field(default_factory=list)
    missingContext: list[str] = Field(default_factory=list)


class DomainAgentDecision(CamelModel):
    recommendedCandidateId: str | None = None
    action: str
    rationale: str
    confidenceScore: int = Field(ge=0, le=100)
    confidenceLevel: Literal['high', 'medium', 'low']
    humanApprovalRequired: bool = True
    nextRoute: str
    critique: DomainAgentCritique


class DomainAgentTraceStep(CamelModel):
    order: int
    stage: Literal['observe', 'rank', 'constrain', 'critique', 'propose', 'verify']
    status: Literal['complete', 'warning', 'blocked']
    title: str
    detail: str


class DomainAgentPlan(CamelModel):
    module: DomainModule
    site: Site
    audience: str
    mission: str
    generatedAt: str
    agentMode: Literal['bounded_ai', 'deterministic_agent']
    evidenceCoveragePercent: int = Field(ge=0, le=100)
    providerRequestCount: int = 0
    evidence: list[DomainAgentEvidence] = Field(default_factory=list)
    candidates: list[DomainAgentCandidate] = Field(default_factory=list)
    decision: DomainAgentDecision
    trace: list[DomainAgentTraceStep] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
