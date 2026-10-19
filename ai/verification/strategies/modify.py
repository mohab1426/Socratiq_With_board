"""
Modify Verification Strategy: Checks if the student can modify or adapt their solution.
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from ai.verification.models import (
    VerificationChallengeRequest,
    VerificationRequest,
    VerificationType,
)
from ai.verification.strategies.base import BaseVerificationStrategy

_CHALLENGE_SYSTEM = """You are an expert pedagogy system designing an 'Adaptation / Modification' verification question.
Given a student's work on an assignment, propose a specific variation, constraint change, or edge case involving concept ({concept}).
Ask them what modifications they would need to make to their solution and why.

Requirements:
- Propose a realistic modification (e.g. changing an assumption, optimizing for memory, handling negative inputs).
- Ask how their approach or code would change.
- Define 2-3 clear criteria for what constitutes a valid modification.
"""

_EVALUATION_SYSTEM = """You are an expert pedagogical evaluator assessing a student's proposed modification.
Determine whether the student understands how changing constraints impacts their implementation and conceptual model.

Evaluation Outcomes:
- PASS: The student correctly identified the necessary changes and accurately explained the rationale.
- PARTIAL: The student identified some changes but missed a key detail or side effect.
- NEEDS_RETRY: The student's proposed modification breaks the logic or reveals a misconception.
- INSUFFICIENT_EVIDENCE: The response is evasive, off-topic, or too vague to evaluate.

Scoring:
- PASS: score >= 0.8
- PARTIAL: score 0.5 to 0.79
- NEEDS_RETRY: score 0.1 to 0.49
- INSUFFICIENT_EVIDENCE: score 0.0

Evaluate each rubric criterion individually and provide constructive student feedback.
"""


class ModifyStrategy(BaseVerificationStrategy):
    verification_type = VerificationType.MODIFY

    def build_challenge_prompt(self, request: VerificationChallengeRequest) -> list:
        system = SystemMessage(content=_CHALLENGE_SYSTEM.format(concept=request.concept))
        human = (
            f"Concept: {request.concept}\n"
            f"Assignment Context: {request.course_context or 'N/A'}\n\n"
            f"Student's Original Work:\n{request.student_work}\n\n"
            "Generate the modification challenge question and 2-3 rubric criteria."
        )
        return [system, HumanMessage(content=human)]

    def build_evaluation_prompt(self, request: VerificationRequest) -> list:
        criteria_str = "\n".join(f"- {c}" for c in request.criteria) if request.criteria else "(Standard modification criteria)"
        system = SystemMessage(content=_EVALUATION_SYSTEM)
        human = (
            f"Concept: {request.concept}\n"
            f"Challenge Question: {request.challenge_question}\n"
            f"Rubric Criteria:\n{criteria_str}\n\n"
            f"Original Work:\n{request.original_attempt or '(None)'}\n\n"
            f"Student's Modification Response:\n{request.student_response}\n\n"
            "Evaluate the student's proposed modification thoroughly."
        )
        return [system, HumanMessage(content=human)]
