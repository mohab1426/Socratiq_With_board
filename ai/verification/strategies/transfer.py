"""
Transfer Verification Strategy: Checks if the student can apply the concept in a novel domain.
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from ai.verification.models import (
    VerificationChallengeRequest,
    VerificationRequest,
    VerificationType,
)
from ai.verification.strategies.base import BaseVerificationStrategy

_CHALLENGE_SYSTEM = """You are an expert pedagogy system designing a 'Conceptual Transfer' verification question.
Given a student's demonstrated competence on concept ({concept}), design a novel scenario in a different setting or application.
Ask the student how the principles of ({concept}) apply to this new scenario.

Requirements:
- Propose a new, plausible problem setting distinct from their current assignment.
- Ask how the underlying principles of ({concept}) apply.
- Define 2-3 clear criteria for evaluating conceptual transfer.
"""

_EVALUATION_SYSTEM = """You are an expert pedagogical evaluator assessing a student's conceptual transfer.
Determine whether the student can abstract the core principles of the concept and apply them correctly to a novel domain.

Evaluation Outcomes:
- PASS: The student successfully transferred the concept, identifying the correct mapping and nuances.
- PARTIAL: The student transferred the core intuition but struggled with some specifics or mappings.
- NEEDS_RETRY: The student failed to transfer the concept or misapplied it completely.
- INSUFFICIENT_EVIDENCE: The response is evasive, off-topic, or too vague to evaluate.

Scoring:
- PASS: score >= 0.8
- PARTIAL: score 0.5 to 0.79
- NEEDS_RETRY: score 0.1 to 0.49
- INSUFFICIENT_EVIDENCE: score 0.0

Evaluate each rubric criterion individually and provide constructive student feedback.
"""


class TransferStrategy(BaseVerificationStrategy):
    verification_type = VerificationType.TRANSFER

    def build_challenge_prompt(self, request: VerificationChallengeRequest) -> list:
        system = SystemMessage(content=_CHALLENGE_SYSTEM.format(concept=request.concept))
        human = (
            f"Concept: {request.concept}\n"
            f"Current Assignment Context: {request.course_context or 'N/A'}\n\n"
            f"Student's Demonstrated Work:\n{request.student_work}\n\n"
            "Generate the transfer challenge question and 2-3 rubric criteria."
        )
        return [system, HumanMessage(content=human)]

    def build_evaluation_prompt(self, request: VerificationRequest) -> list:
        criteria_str = "\n".join(f"- {c}" for c in request.criteria) if request.criteria else "(Standard transfer criteria)"
        system = SystemMessage(content=_EVALUATION_SYSTEM)
        human = (
            f"Concept: {request.concept}\n"
            f"Novel Scenario Challenge: {request.challenge_question}\n"
            f"Rubric Criteria:\n{criteria_str}\n\n"
            f"Student's Transfer Response:\n{request.student_response}\n\n"
            "Evaluate the student's conceptual transfer thoroughly."
        )
        return [system, HumanMessage(content=human)]
