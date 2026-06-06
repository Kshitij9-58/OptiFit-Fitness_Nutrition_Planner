from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import your local modules including the new rag_engine
from . import models, database, schemas, ai_engine, rag_engine

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="OptiFit AI API")

# CORS Security Block
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# --- 1. The Core Generation Endpoint ---
@app.post("/generate/", response_model=schemas.ProfileResponse)
def create_plan(profile: schemas.ProfileCreate, db: Session = Depends(database.get_db)):
    ai_plan = ai_engine.generate_plan(profile.model_dump())
    db_profile = models.UserProfile(**profile.model_dump(), generated_plan=ai_plan)
    db.add(db_profile)
    db.commit()
    db.refresh(db_profile)
    return db_profile

# --- 2. ADD THIS: The New Chat Request Schema ---
class ChatRequest(BaseModel):
    query: str
    plan_context: str

# --- 3. ADD THIS: The New AI Coach Chat Endpoint ---
@app.post("/chat/")
def chat_with_coach(request: ChatRequest):
    try:
        ai_reply = rag_engine.get_coach_response(request.query, request.plan_context)
        return {"reply": ai_reply}
    except Exception as e:
        return {"error": str(e)}