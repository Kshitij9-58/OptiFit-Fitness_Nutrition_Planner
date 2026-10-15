"""
OptiFit AI Coach.

Grounded in the user's own generated plan rather than a retrieved corpus. The
plan is small, structured, and already the thing the user is asking about, so
passing it as context is both cheaper and more accurate than retrieving over a
general dataset. Grounding substantially reduces hallucination; it does not
eliminate it, which is why the prompt tells the model to decline rather than
fill gaps, and why the endpoint will not answer at all without a profile.

Renamed from rag_engine.py on purpose: there is no retrieval here. The
retrieval stack in retrieval.py is kept for the day there is a real corpus of
guidance passages to retrieve over.

Provider is switchable so the API does not depend on a local Ollama daemon:
    OPTIFIT_COACH_PROVIDER=ollama   (default, local dev)
    OPTIFIT_COACH_PROVIDER=none     (coach disabled, rest of API unaffected)
"""

from __future__ import annotations

import json
import os

PROVIDER = os.getenv("OPTIFIT_COACH_PROVIDER", "ollama").lower()
LLM_MODEL = os.getenv("OPTIFIT_LLM_MODEL", "llama3")

DISABLED_MESSAGE = (
    "The AI coach isn't available in this environment. Your plan, metrics, and "
    "macros are all unaffected."
)
UNAVAILABLE_MESSAGE = (
    "My coaching model isn't reachable right now. Your plan and metrics are "
    "unaffected, so nothing is lost."
)

SYSTEM_PROMPT = """You are the OptiFit AI Coach, speaking to one user about the \
plan that was generated for them.

Rules:
- The plan below is your only source of truth about this user. Use it.
- If the plan does not contain what is needed to answer, say so plainly and
  suggest what they would need to track or ask a professional. Do not invent
  numbers, studies, brands, or medical claims.
- Never contradict the plan's warnings. If a warning is present, respect it.
- You are a fitness coach, not a clinician. For anything involving symptoms,
  medication, injury, or disordered eating, say it is outside what you can help
  with and point to a doctor or registered dietitian.
- Warm, direct, specific to their numbers. Two short paragraphs at most."""

USER_TEMPLATE = """This user's plan:
{plan}

Their question: {query}"""


def _summarise_plan(profile_row, plan_json: str | None) -> str:
    """Flatten the stored profile and plan into compact prompt context. The
    stored plan is a JSON string, so a failed parse must not take down chat."""
    lines = [
        f"Age: {profile_row.age}",
        f"Height: {profile_row.height} cm",
        f"Weight: {profile_row.weight} kg",
        f"Stated goal: {profile_row.fitness_goal}",
        f"Activity level: {profile_row.activity_level}",
        f"Diet: {profile_row.diet_type}",
    ]
    if not plan_json:
        lines.append("No plan has been generated yet.")
        return "\n".join(lines)

    try:
        plan = json.loads(plan_json)
    except json.JSONDecodeError:
        lines.append("Plan could not be read.")
        return "\n".join(lines)

    metrics = plan.get("metrics", {})
    nutrition = plan.get("nutrition", {})
    macros = nutrition.get("macros", {})

    lines += [
        f"BMI: {metrics.get('bmi')} ({metrics.get('bmi_category')})",
        f"BMR: {metrics.get('bmr')} kcal, TDEE: {metrics.get('tdee')} kcal",
        f"Daily target: {nutrition.get('daily_calories')} kcal",
        f"Macros: {macros.get('protein_g')}g protein, "
        f"{macros.get('carbs_g')}g carbs, {macros.get('fats_g')}g fat",
        f"Goal applied to the plan: {plan.get('applied_goal')}",
    ]

    meals = nutrition.get("meals", {})
    if meals:
        lines.append("Meals: " + "; ".join(f"{k}: {v}" for k, v in meals.items()))

    training = plan.get("training_matrix", {})
    if training:
        lines.append("Training week: "
                     + "; ".join(f"{d}: {s}" for d, s in training.items()))

    for warning in plan.get("warnings", []):
        lines.append(f"IMPORTANT WARNING ON THIS PLAN: {warning}")
    for assumption in plan.get("assumptions", []):
        lines.append(f"Assumption made: {assumption}")

    return "\n".join(lines)


def _invoke(system: str, user: str) -> str:
    if PROVIDER == "none":
        return DISABLED_MESSAGE

    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_ollama import ChatOllama

    llm = ChatOllama(model=LLM_MODEL, temperature=0.3)
    return llm.invoke([SystemMessage(content=system),
                       HumanMessage(content=user)]).content


def get_coach_response(user_query: str, profile_row, plan_json: str | None) -> str:
    """Answer a coaching question about this user's own plan."""
    if not user_query or not user_query.strip():
        return "Ask me anything about your plan: the macros, the training week, swaps."

    context = _summarise_plan(profile_row, plan_json)
    try:
        return _invoke(SYSTEM_PROMPT,
                       USER_TEMPLATE.format(plan=context, query=user_query.strip()))
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: coach generation failed: {exc}")
        return UNAVAILABLE_MESSAGE


def coach_available() -> bool:
    return PROVIDER != "none"