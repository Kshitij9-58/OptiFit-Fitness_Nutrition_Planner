from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# Constrained at the edge rather than normalised later. A frontend sending
# "Moderate" or "get shredded" now gets a 422 naming the field, instead of
# silently computing a sedentary TDEE that nobody notices.

Gender = Literal["male", "female", "other"]
ActivityLevel = Literal["sedentary", "lightly active", "active", "very active"]
FitnessGoal = Literal["weight loss", "muscle gain", "maintenance"]
DietType = Literal["vegetarian", "non-vegetarian"]


class ProfileCreate(BaseModel):
    age: int = Field(ge=13, le=100, description="years")
    height: float = Field(ge=100, le=250, description="centimetres")
    weight: float = Field(ge=30, le=300, description="kilograms")
    gender: Gender
    activity_level: ActivityLevel
    fitness_goal: FitnessGoal
    diet_type: DietType


class ProfileResponse(ProfileCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    generated_plan: Optional[str] = None
    completed_days: Optional[str] = None   # JSON string, parsed by the client


class ProfileSummary(BaseModel):
    """Enough to list past plans without shipping every plan in full."""
    id: int
    fitness_goal: str
    weight: float
    daily_calories: Optional[int] = None
    created_at: Optional[str] = None


class ProgressUpdate(BaseModel):
    completed_days: dict[str, bool] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    profile_id: int = Field(description="the profile this question is about")


class ChatResponse(BaseModel):
    response: str
    grounded_in_profile_id: int


class HealthResponse(BaseModel):
    status: str
    coach_available: bool
    plan_table_entries: int
    details: dict[str, Any] = {}