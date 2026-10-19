"""
Explain Verification Strategy: Checks if the student can explain why their solution works.
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from ai.verification.models import (
    VerificationChallengeRequest,
    VerificationRequest,
    VerificationType,
)
from ai.verification.strategies.base import BaseVerificationStrategy

_CHALLENGE_SYSTEM = """You are an expert pedagogy system designing a 'Conceptual Explanation' verification question.
Given a student's completed or partially completed work on an assignment, design a targeted question asking them to explain the core mechanics or reasoning behind a key concept ({concept}).

Requirements:
- Target the concept specifically: {concept}.
- Ask them to explain *why* something is done this way, or how a specific component functions.
- Do NOT ask trivia or rote definitions; ask about their actual implementation or reasoning.
- Define 2-3 clear criteria for what constitutes a sound explanation.
"""

_EVALUATION_SYSTEM = """You are an expert pedagogical evaluator assessing a student's conceptual explanation.
Determine whether the student truly understands the underlying concept or if they are repeating superficial phrases.

Evaluation Outcomes:
- PASS: The student clearly understands the mechanism, causal relationship, and rationale.
- PARTIAL: The student understands the general idea but has minor imprecisions or omissions.
- NEEDS_RETRY: The student shows fundamental misconceptions or incorrect causal reasoning.
- INSUFFICIENT_EVIDENCE: The response is evasive, off-topic, or too short/vague to evaluate.

Scoring:
- PASS: score >= 0.8
- PARTIAL: score 0.5 to 0.79
- NEEDS_RETRY: score 0.1 to 0.49
- INSUFFICIENT_EVIDENCE: score 0.0

Evaluate each rubric criterion individually and provide constructive student feedback.
"""


class ExplainStrategy(BaseVerificationStrategy):
    verification_type = VerificationType.EXPLAIN

    def build_challenge_prompt(self, request: VerificationChallengeRequest) -> list:
        system = SystemMessage(content=_CHALLENGE_SYSTEM.format(concept=request.concept))
        human = (
            f"Concept: {request.concept}\n"
            f"Assignment Context: {request.course_context or 'N/A'}\n\n"
            f"Student's Work:\n{request.student_work}\n\n"
            "Generate the explanation challenge question and 2-3 rubric criteria."
        )
        return [system, HumanMessage(content=human)]

    def build_evaluation_prompt(self, request: VerificationRequest) -> list:
        criteria_str = "\n".join(f"- {c}" for c in request.criteria) if request.criteria else "(Standard conceptual criteria)"
        system = SystemMessage(content=_EVALUATION_SYSTEM)
        human = (
            f"Concept: {request.concept}\n"
            f"Challenge Question: {request.challenge_question}\n"
            f"Rubric Criteria:\n{criteria_str}\n\n"
            f"Original Work Reference:\n{request.original_attempt or '(None)'}\n\n"
            f"Student's Explanation Response:\n{request.student_response}\n\n"
            "Evaluate the student's response thoroughly."
        )
        return [system, HumanMessage(content=human)]
