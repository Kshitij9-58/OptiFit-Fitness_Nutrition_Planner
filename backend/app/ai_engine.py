"""
OptiFit plan generation.

What is actually personalised here is the calculated half: BMR, TDEE, calorie
target and macro split all respond to the user's own numbers and goal. The CSV
dataset contributes a four-way lookup on BMI band and nothing else, so it is
included as labelled supplementary guidance rather than presented as the plan.

Fixes over the previous version:
  - 'veg' in 'non-vegetarian' is True, so every user was served the vegetarian
    templates. Diet is now matched exactly.
  - Carbs could go negative for short, heavy, sedentary users in a deficit.
    Now floored, with fats absorbing the remainder.
  - A flat tdee - 500 could land under 1000 kcal. Now floored.
  - activity == 'very active' overrode the goal entirely, so a very active user
    wanting fat loss received a sprint periodisation block. Goal now leads.
  - Unrecognised activity/gender/goal strings silently fell through to defaults.
    Now normalised explicitly, with what was assumed reported back.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLAN_TABLE_PATH = HERE / "plan_table.json"

# --------------------------------------------------------------------------
# BMI band guidance, collapsed from the CSV by build_plan_table.py
# --------------------------------------------------------------------------

try:
    _TABLE = json.loads(PLAN_TABLE_PATH.read_text(encoding="utf-8"))["plans"]
except (OSError, json.JSONDecodeError, KeyError):
    print(f"WARNING: plan table not loaded from {PLAN_TABLE_PATH}. "
          f"BMI band guidance will be omitted.")
    _TABLE = {}


def bmi_value(weight_kg: float, height_cm: float) -> float:
    return weight_kg / ((height_cm / 100) ** 2)


def bmi_category(bmi: float) -> str:
    if bmi < 18.5:
        return "underweight"
    if bmi < 25:
        return "normal weight"
    if bmi < 30:
        return "overweight"
    return "obesity"


def lookup_band_guidance(gender: str, goal_key: str, band: str) -> dict | None:
    """The table is keyed gender|goal|bmi, but only the BMI segment affects the
    result, so any key with a matching band returns the same plan. Exact match
    first, then any band match, so this keeps working if the dataset is later
    rebuilt with gender or goal actually mattering."""
    exact = _TABLE.get(f"{gender}|{goal_key}|{band}")
    if exact:
        return exact
    for key, value in _TABLE.items():
        if key.endswith(f"|{band}"):
            return value
    return None


# --------------------------------------------------------------------------
# Input normalisation
# --------------------------------------------------------------------------

ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "lightly active": 1.375,
    "active": 1.55,
    "very active": 1.725,
}

GOAL_ALIASES = {
    "weight loss": "fat_loss", "fat loss": "fat_loss", "fat_burn": "fat_loss",
    "lose weight": "fat_loss", "cutting": "fat_loss",
    "muscle gain": "muscle_gain", "muscle_gain": "muscle_gain",
    "gain muscle": "muscle_gain", "bulking": "muscle_gain",
    "maintenance": "maintenance", "maintain": "maintenance",
    "performance": "maintenance",
}


def _normalise(data: dict) -> tuple[dict, list[str]]:
    """Resolve free-text inputs to known values, recording every assumption.
    Silent fallbacks are how a frontend sending 'Moderate' ends up computing a
    sedentary TDEE that nobody ever notices."""
    assumptions: list[str] = []

    raw_activity = str(data.get("activity_level", "")).strip().lower()
    if raw_activity not in ACTIVITY_MULTIPLIERS:
        assumptions.append(
            f"activity level {raw_activity!r} not recognised; assumed sedentary")
        raw_activity = "sedentary"

    raw_goal = str(data.get("fitness_goal", "")).strip().lower()
    goal = GOAL_ALIASES.get(raw_goal)
    if goal is None:
        assumptions.append(
            f"goal {raw_goal!r} not recognised; assumed maintenance")
        goal = "maintenance"

    raw_gender = str(data.get("gender", "")).strip().lower()
    if raw_gender not in {"male", "female"}:
        assumptions.append(
            f"gender {raw_gender!r} has no established BMR constant; "
            f"used the average of the male and female offsets")
        gender = "other"
    else:
        gender = raw_gender

    raw_diet = str(data.get("diet_type", "")).strip().lower()
    if raw_diet.startswith("non"):
        diet = "non-vegetarian"
    elif "vegan" in raw_diet or "veg" in raw_diet:
        diet = "vegetarian"
    else:
        assumptions.append(f"diet {raw_diet!r} not recognised; assumed no restriction")
        diet = "non-vegetarian"

    return {"activity": raw_activity, "goal": goal,
            "gender": gender, "diet": diet}, assumptions


# --------------------------------------------------------------------------
# Templates (goal and diet aware, unlike the dataset)
# --------------------------------------------------------------------------

MEAL_TEMPLATES = {
    "vegetarian": {
        "breakfast": "Oatmeal with whey protein, chia seeds, and berries.",
        "lunch": "Quinoa bowl with roasted chickpeas, tofu, and spinach.",
        "dinner": "Lentil pasta with marinara and a side of steamed broccoli.",
        "snacks": "Greek yogurt with almonds and an apple.",
    },
    "non-vegetarian": {
        "breakfast": "3 scrambled eggs, 2 slices whole wheat toast, and berries.",
        "lunch": "Grilled chicken breast with sweet potato and asparagus.",
        "dinner": "Baked salmon with jasmine rice and roasted zucchini.",
        "snacks": "Whey protein shake and a handful of mixed nuts.",
    },
}

TRAINING_MATRICES = {
    "fat_loss": {
        "Monday": "Full Body Resistance and 20 min LISS Cardio",
        "Tuesday": "High Intensity Intervals: sprints",
        "Wednesday": "Active Recovery: mobility work or light walk",
        "Thursday": "Upper Body Circuit and Core",
        "Friday": "Lower Body Plyometrics and 20 min LISS Cardio",
        "Saturday": "Long Steady State Cardio (45 mins)",
        "Sunday": "Complete Rest and Prep",
    },
    "muscle_gain": {
        "Monday": "Heavy Push: chest, shoulders, triceps, hypertrophy focus",
        "Tuesday": "Heavy Pull: back, biceps, rear delts",
        "Wednesday": "Legs and Core: squat pattern focus",
        "Thursday": "Active Recovery: mobility",
        "Friday": "Upper Body Power and Speed",
        "Saturday": "Lower Body Power: deadlift pattern focus",
        "Sunday": "Complete Rest and Prep",
    },
    "maintenance": {
        "Monday": "Full Body Strength: compound lifts, moderate volume",
        "Tuesday": "Zone 2 Cardio (40 mins)",
        "Wednesday": "Active Recovery: mobility",
        "Thursday": "Upper Body Strength and Core",
        "Friday": "Lower Body Strength",
        "Saturday": "Mixed Conditioning or sport of choice",
        "Sunday": "Complete Rest",
    },
}

# Overlays are goal-specific. Dropping sprint work into a hypertrophy block
# produced an incoherent week: heavy push on Monday, 6x150m on Tuesday.
ATHLETE_OVERLAYS = {
    "fat_loss": {
        "Tuesday": "Anaerobic Capacity: 6x150m at 95% effort, full recovery",
        "Thursday": "Max Velocity Mechanics: fly 30s, plyometric bounding",
        "Saturday": "Extensive Tempo: 8x200m at 75% effort for aerobic baseline",
    },
    "muscle_gain": {
        "Wednesday": "Legs and Core: squat pattern, plus loaded carries",
        "Friday": "Upper Body Power and Speed, plus accessory volume",
        "Sunday": "Light Mobility or Complete Rest, athlete's discretion",
    },
    "maintenance": {
        "Tuesday": "Zone 2 Cardio (60 mins) or sport practice",
        "Saturday": "Mixed Conditioning: intervals plus sport of choice",
    },
}

# --------------------------------------------------------------------------
# Energy and macros
# --------------------------------------------------------------------------

MIN_CALORIES = {"male": 1500, "female": 1200, "other": 1300}


def _energy_targets(weight: float, tdee: float, goal: str,
                    gender: str) -> tuple[float, float, float, float, list[str]]:
    notes: list[str] = []

    if goal == "fat_loss":
        target = tdee - 500
        protein = weight * 2.2          # preserve lean mass in a deficit
    elif goal == "muscle_gain":
        target = tdee + 300
        protein = weight * 2.0
    else:
        target = tdee
        protein = weight * 1.8

    floor = MIN_CALORIES[gender]
    if target < floor:
        notes.append(
            f"calculated target was below {floor} kcal and has been raised to it; "
            f"a deficit this large is not appropriate to self-prescribe")
        target = floor

    protein_kcal = protein * 4
    if protein_kcal > target * 0.5:
        protein = (target * 0.5) / 4
        notes.append("protein capped at 50% of calories to leave room for "
                     "carbohydrate and fat")
        protein_kcal = protein * 4

    if goal == "maintenance":
        carbs = (target * 0.50) / 4
        fats = max(0.0, (target - protein_kcal - carbs * 4) / 9)
    else:
        fats = (target * 0.25) / 9
        remaining = target - protein_kcal - fats * 9
        if remaining < 0:
            # fat absorbs the shortfall rather than carbs going negative
            fats = max(0.0, (target - protein_kcal) / 9)
            carbs = 0.0
            notes.append("carbohydrate floored at zero; the protein target "
                         "already consumes the calorie budget")
        else:
            carbs = remaining / 4

    return target, protein, carbs, fats, notes


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def generate_plan(data: dict) -> str:
    weight = float(data["weight"])
    height = float(data["height"])
    age = int(data["age"])

    norm, assumptions = _normalise(data)
    gender, goal, activity, diet = (
        norm["gender"], norm["goal"], norm["activity"], norm["diet"])

    # Mifflin-St Jeor
    offset = {"male": 5, "female": -161, "other": -78}[gender]
    bmr = (10 * weight) + (6.25 * height) - (5 * age) + offset
    tdee = bmr * ACTIVITY_MULTIPLIERS[activity]

    bmi = bmi_value(weight, height)
    band = bmi_category(bmi)

    warnings: list[str] = []

    # Underweight plus a fat loss goal is the one combination that should not
    # produce a deficit. The dataset happens to return a high-calorie plan here,
    # but by accident, since it ignores the goal entirely.
    if band == "underweight" and goal == "fat_loss":
        goal = "maintenance"
        warnings.append(
            "Your BMI is in the underweight range, so this plan is built around "
            "maintenance rather than a calorie deficit. If fat loss is still "
            "your goal, that is worth talking through with a doctor or a "
            "registered dietitian first.")

    target, protein, carbs, fats, macro_notes = _energy_targets(
        weight, tdee, goal, gender)
    warnings.extend(macro_notes)

    training = dict(TRAINING_MATRICES[goal])
    if activity == "very active":
        training.update(ATHLETE_OVERLAYS[goal])  # overlay matched to the goal

    band_guidance = lookup_band_guidance(gender, goal, band)
    if band_guidance and diet == "vegetarian" and not band_guidance.get(
            "meal_plan_vegetarian"):
        warnings.append(
            "The reference meal guidance for your BMI band has no vegetarian "
            "variant in the dataset, so only the meal plan above reflects your "
            "dietary preference.")

    plan = {
        "metrics": {
            "bmr": round(bmr),
            "tdee": round(tdee),
            "bmi": round(bmi, 1),
            "bmi_category": band,
        },
        "nutrition": {
            "daily_calories": round(target),
            "macros": {
                "protein_g": round(protein),
                "carbs_g": round(carbs),
                "fats_g": round(fats),
            },
            "meals": MEAL_TEMPLATES[diet],
        },
        "training_matrix": training,
        "reference_guidance": (
            {
                "basis": "BMI band only; not specific to your goal or gender",
                "exercise_schedule": band_guidance["exercise_schedule"],
                "meal_plan": (band_guidance.get("meal_plan_vegetarian")
                              or band_guidance["meal_plan"]),
            }
            if band_guidance else None
        ),
        "applied_goal": goal,
        "warnings": warnings,
        "assumptions": assumptions,
    }
    return json.dumps(plan)