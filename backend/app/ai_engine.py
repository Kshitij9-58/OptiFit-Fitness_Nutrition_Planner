import json

def generate_plan(data: dict):
    weight = data['weight']
    height = data['height']
    age = data['age']
    gender = data['gender'].lower()
    goal = data['fitness_goal'].lower()
    activity = data['activity_level'].lower()
    diet = data['diet_type'].lower()

    # 1. Base Metabolic Calculations
    bmr = (10 * weight) + (6.25 * height) - (5 * age) + (5 if gender == 'male' else -161)
    multipliers = {"sedentary": 1.2, "lightly active": 1.375, "active": 1.55, "very active": 1.725}
    tdee = bmr * multipliers.get(activity, 1.2)

    # 2. Advanced Macro Stratification & Caloric Targets
    if "loss" in goal:
        target_calories = tdee - 500
        protein = weight * 2.2      # Preserve muscle in deficit
        fats = (target_calories * 0.25) / 9
        carbs = (target_calories - (protein * 4) - (fats * 9)) / 4
    elif "gain" in goal or "muscle" in goal:
        target_calories = tdee + 300
        protein = weight * 2.0
        fats = (target_calories * 0.25) / 9
        carbs = (target_calories - (protein * 4) - (fats * 9)) / 4
    else: # High Performance / Maintenance
        target_calories = tdee
        protein = weight * 1.8
        carbs = (target_calories * 0.50) / 4 # High carb for explosive fuel
        fats = (target_calories - (protein * 4) - (carbs * 4)) / 9

    # 3. Dietary Routing (Veg vs Non-Veg Templates)
    meal_templates = {
        "vegetarian": {
            "breakfast": "Oatmeal with whey protein, chia seeds, and berries.",
            "lunch": "Quinoa bowl with roasted chickpeas, tofu, and spinach.",
            "dinner": "Lentil pasta with marinara and a side of steamed broccoli.",
            "snacks": "Greek yogurt with almonds and an apple."
        },
        "non-vegetarian": {
            "breakfast": "3 scrambled eggs, 2 slices whole wheat toast, and berries.",
            "lunch": "Grilled chicken breast with sweet potato and asparagus.",
            "dinner": "Baked salmon with jasmine rice and roasted zucchini.",
            "snacks": "Whey protein shake and a handful of mixed nuts."
        }
    }
    
    # Select diet logic, fallback to non-vegetarian if unrecognized
    diet_key = "vegetarian" if "veg" in diet else "non-vegetarian"
    selected_meals = meal_templates[diet_key]

    # 4. Periodized 7-Day Training Matrix
    training_matrices = {
        "weight_loss": {
            "Monday": "Full Body Resistance & 20 min LISS Cardio",
            "Tuesday": "High Intensity Interval Training (HIIT) - Sprints",
            "Wednesday": "Active Recovery (Mobility work / Light walk)",
            "Thursday": "Upper Body Circuit & Core",
            "Friday": "Lower Body Plyometrics & 20 min LISS Cardio",
            "Saturday": "Long Steady State Cardio (45 mins)",
            "Sunday": "Complete Rest & Prep"
        },
        "muscle_gain": {
            "Monday": "Heavy Push (Chest, Shoulders, Triceps) - Hypertrophy focus",
            "Tuesday": "Heavy Pull (Back, Biceps, Rear Delts)",
            "Wednesday": "Legs & Core (Squat pattern focus)",
            "Thursday": "Active Recovery (Mobility)",
            "Friday": "Upper Body Power & Speed",
            "Saturday": "Lower Body Power (Deadlift pattern focus)",
            "Sunday": "Complete Rest & Prep"
        },
        "athlete_sprinter": {
            "Monday": "Explosive CNS Work: Block Starts, Power Cleans, Heavy Squats",
            "Tuesday": "Anaerobic Capacity: 6x150m at 95% effort, full recovery",
            "Wednesday": "Active Recovery: Pool session or deep tissue mobility",
            "Thursday": "Max Velocity Mechanics: Fly 30s, plyometric bounding",
            "Friday": "Weight Room Power: Snatch, Box Jumps, Core rotation",
            "Saturday": "Extensive Tempo: 8x200m at 75% effort for aerobic baseline",
            "Sunday": "Complete Rest & CNS Recovery"
        }
    }

    # Route logic to assign the correct matrix
    if activity == "very active":
        selected_matrix = training_matrices["athlete_sprinter"]
    elif "loss" in goal:
        selected_matrix = training_matrices["weight_loss"]
    else:
        selected_matrix = training_matrices["muscle_gain"]

    # 5. Construct the Structured JSON Payload
    plan = {
        "metrics": {
            "bmr": round(bmr),
            "tdee": round(tdee)
        },
        "nutrition": {
            "daily_calories": round(target_calories),
            "macros": {
                "protein_g": round(protein),
                "carbs_g": round(carbs),
                "fats_g": round(fats)
            },
            "meals": selected_meals
        },
        "training_matrix": selected_matrix
    }
    
    return json.dumps(plan)