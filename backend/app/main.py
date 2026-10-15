import json
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import ai_engine, auth, coach, database, models, schemas

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="OptiFit API")

# allow_origins=["*"] with allow_credentials=True is invalid per the CORS spec:
# browsers reject credentialed requests against a wildcard origin. Auth tokens
# travel in the Authorization header rather than cookies, so credentials stay
# off and origins are listed explicitly.
_origins = os.getenv(
    "OPTIFIT_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


def _get_profile(profile_id: int, db: Session) -> models.UserProfile:
    profile = db.query(models.UserProfile).filter(
        models.UserProfile.id == profile_id).first()
    if profile is None:
        raise HTTPException(status_code=404, detail=f"No profile {profile_id}")
    return profile


def _assert_may_write(profile: models.UserProfile, user: auth.AuthUser | None) -> None:
    """A plan owned by an account may only be changed by that account. A plan
    with no owner stays editable by anyone holding its link, which is what
    makes anonymous use work."""
    if profile.user_id and (user is None or user.id != profile.user_id):
        raise HTTPException(status_code=403, detail="That plan belongs to another account.")


@app.get("/health", response_model=schemas.HealthResponse)
def health():
    """Reports what is actually wired up, so a misconfigured deploy shows here
    rather than failing at first use."""
    return schemas.HealthResponse(
        status="ok",
        coach_available=coach.coach_available(),
        plan_table_entries=len(ai_engine._TABLE),
        details={
            "coach_provider": coach.PROVIDER,
            "auth_enabled": str(auth.auth_enabled).lower(),
        },
    )


@app.post("/generate/", response_model=schemas.ProfileResponse)
def create_plan(profile: schemas.ProfileCreate,
                db: Session = Depends(database.get_db),
                user: auth.AuthUser | None = auth.OptionalUser):
    ai_plan = ai_engine.generate_plan(profile.model_dump())
    db_profile = models.UserProfile(
        **profile.model_dump(),
        generated_plan=ai_plan,
        user_id=user.id if user else None,
    )
    db.add(db_profile)
    db.commit()
    db.refresh(db_profile)
    return db_profile


@app.get("/api/profile/{profile_id}", response_model=schemas.ProfileResponse)
def get_profile(profile_id: int, db: Session = Depends(database.get_db)):
    return _get_profile(profile_id, db)


@app.get("/api/my-plans", response_model=list[schemas.ProfileSummary])
def my_plans(db: Session = Depends(database.get_db),
             user: auth.AuthUser = auth.RequiredUser):
    """Every plan this account has made, newest first."""
    rows = (db.query(models.UserProfile)
              .filter(models.UserProfile.user_id == user.id)
              .order_by(models.UserProfile.id.desc())
              .limit(50)
              .all())
    return [
        schemas.ProfileSummary(
            id=r.id,
            fitness_goal=r.fitness_goal,
            weight=r.weight,
            daily_calories=_calories_of(r.generated_plan),
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]


def _calories_of(plan_json: str | None) -> int | None:
    if not plan_json:
        return None
    try:
        return json.loads(plan_json).get("nutrition", {}).get("daily_calories")
    except json.JSONDecodeError:
        return None


@app.patch("/api/profile/{profile_id}/progress", response_model=schemas.ProfileResponse)
def update_progress(profile_id: int, body: schemas.ProgressUpdate,
                    db: Session = Depends(database.get_db),
                    user: auth.AuthUser | None = auth.OptionalUser):
    """Tick sessions off. Stored server-side so progress follows the account
    across devices instead of living in one browser."""
    profile = _get_profile(profile_id, db)
    _assert_may_write(profile, user)
    profile.completed_days = json.dumps(body.completed_days)
    db.commit()
    db.refresh(profile)
    return profile


@app.patch("/api/profile/{profile_id}/claim", response_model=schemas.ProfileResponse)
def claim_profile(profile_id: int,
                  db: Session = Depends(database.get_db),
                  user: auth.AuthUser = auth.RequiredUser):
    """Attach an ownerless plan to the account that just signed in, so a plan
    built before signing up is not lost at the moment of signing up."""
    profile = _get_profile(profile_id, db)
    if profile.user_id and profile.user_id != user.id:
        raise HTTPException(status_code=403, detail="That plan belongs to another account.")
    profile.user_id = user.id
    db.commit()
    db.refresh(profile)
    return profile


@app.post("/api/chat", response_model=schemas.ChatResponse)
def chat_with_coach(request: schemas.ChatRequest,
                    db: Session = Depends(database.get_db)):
    """Answers about one user's own plan. The profile id is required: without
    it the coach has no idea who it is talking to."""
    profile = _get_profile(request.profile_id, db)
    answer = coach.get_coach_response(request.query, profile, profile.generated_plan)
    return schemas.ChatResponse(response=answer, grounded_in_profile_id=profile.id)