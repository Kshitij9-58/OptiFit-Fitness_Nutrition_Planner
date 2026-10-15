from sqlalchemy import Column, DateTime, Float, Integer, String, Text, func

from .database import Base


class UserProfile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    age = Column(Integer)
    height = Column(Float)
    weight = Column(Float)
    gender = Column(String)
    activity_level = Column(String)
    fitness_goal = Column(String)
    diet_type = Column(String)

    generated_plan = Column(Text, nullable=True)

    # Supabase user uuid. Nullable on purpose: plans made before signing in,
    # or without an account at all, are still valid.
    user_id = Column(String, index=True, nullable=True)

    # JSON object of {"Monday": true, ...}. Stored server-side so ticking a
    # session on a phone shows up on a laptop, which localStorage cannot do.
    completed_days = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())