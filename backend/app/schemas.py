from pydantic import BaseModel
from typing import Optional

class ProfileCreate(BaseModel):
    age: int
    height: float
    weight: float
    gender: str
    activity_level: str
    fitness_goal: str
    diet_type: str  # NEW: Enforces diet selection

class ProfileResponse(ProfileCreate):
    id: int
    generated_plan: Optional[str] = None

    class Config:
        from_attributes = True