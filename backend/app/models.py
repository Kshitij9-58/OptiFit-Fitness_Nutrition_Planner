from sqlalchemy import Column, Integer, String, Float, Text
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
    diet_type = Column(String)  # NEW: Tracks Veg vs. Non-Veg
    
    generated_plan = Column(Text, nullable=True)