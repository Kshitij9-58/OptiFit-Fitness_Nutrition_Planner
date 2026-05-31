import React, { useState } from 'react';

export default function App() {
  const [formData, setFormData] = useState({
    age: '', height: '', weight: '', gender: 'Male', activity_level: 'sedentary', fitness_goal: 'weight_loss', diet_type: 'non-vegetarian'
  });
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setPlan(null);
    try {
      const response = await fetch('http://127.0.0.1:8000/generate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(formData.age), 
          height: parseFloat(formData.height), 
          weight: parseFloat(formData.weight),
          gender: formData.gender, 
          activity_level: formData.activity_level, 
          fitness_goal: formData.fitness_goal,
          diet_type: formData.diet_type
        })
      });
      
      if (!response.ok) throw new Error('Failed to generate optimization plan.');
      
      const data = await response.json();
      // The backend now sends a deeply nested JSON string, so we parse it
      setPlan(JSON.parse(data.generated_plan));
    } catch (err) {
      setError(err.message || 'Server connection error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <header className="max-w-5xl mx-auto mb-10 border-b pb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">OptiFit AI</h1>
        <p className="text-slate-500 mt-1">Professional Workout & Nutrition Optimization Engine</p>
      </header>

      <main className="max-w-5xl mx-auto grid gap-8">
        {/* === INPUT FORM === */}
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold mb-6 text-slate-800">Biometric & Lifestyle Configurations</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Age</label><input type="number" name="age" onChange={handleChange} required className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Height (cm)</label><input type="number" name="height" onChange={handleChange} required className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Weight (kg)</label><input type="number" name="weight" onChange={handleChange} required className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Gender</label><select name="gender" onChange={handleChange} className="w-full border rounded-lg p-2.5 bg-white"><option>Male</option><option>Female</option></select></div>
            
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Activity Tier</label><select name="activity_level" onChange={handleChange} className="w-full border rounded-lg p-2.5 bg-white"><option value="sedentary">Sedentary</option><option value="lightly active">Lightly Active</option><option value="active">Active (Gym 3-5x/wk)</option><option value="very active">Athlete / Sprinter</option></select></div>
            <div><label className="block text-sm font-medium mb-1 text-slate-600">Target Goal</label><select name="fitness_goal" onChange={handleChange} className="w-full border rounded-lg p-2.5 bg-white"><option value="weight_loss">Fat Loss & Conditioning</option><option value="muscle_gain">Hypertrophy (Muscle Gain)</option><option value="maintenance">High Performance Maint.</option></select></div>
            <div className="md:col-span-2"><label className="block text-sm font-medium mb-1 text-slate-600">Dietary Preference</label><select name="diet_type" onChange={handleChange} className="w-full border rounded-lg p-2.5 bg-white"><option value="non-vegetarian">Standard (Omnivore)</option><option value="vegetarian">Plant-Based / Vegetarian</option></select></div>
            
            <div className="md:col-span-4 pt-4">
              <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:bg-slate-400 shadow-md">
                {loading ? 'Synthesizing Protocol...' : 'Generate AI Protocol'}
              </button>
            </div>
          </form>
          {error && <p className="mt-4 text-red-600 text-sm font-medium text-center">{error}</p>}
        </div>

        {/* === OUTPUT DASHBOARD === */}
        {plan && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* 1. Metrics & Macros */}
            <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-2xl font-bold mb-6 text-slate-800 border-b pb-3">Metabolic & Macronutrient Targets</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border"><p className="text-xs text-slate-500 font-bold uppercase">BMR</p><p className="text-xl font-black text-slate-800">{plan.metrics.bmr} <span className="text-sm font-normal text-slate-500">kcal</span></p></div>
                <div className="bg-slate-50 p-4 rounded-xl border"><p className="text-xs text-slate-500 font-bold uppercase">TDEE</p><p className="text-xl font-black text-slate-800">{plan.metrics.tdee} <span className="text-sm font-normal text-slate-500">kcal</span></p></div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100"><p className="text-xs text-blue-600 font-bold uppercase">Target Calories</p><p className="text-xl font-black text-blue-700">{plan.nutrition.daily_calories} <span className="text-sm font-normal text-blue-500">kcal</span></p></div>
                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100"><p className="text-xs text-emerald-600 font-bold uppercase">Protein</p><p className="text-xl font-black text-emerald-700">{plan.nutrition.macros.protein_g} <span className="text-sm font-normal text-emerald-500">g</span></p></div>
                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100"><p className="text-xs text-amber-600 font-bold uppercase">Carbs / Fats</p><p className="text-lg font-black text-amber-700">{plan.nutrition.macros.carbs_g}g / {plan.nutrition.macros.fats_g}g</p></div>
              </div>
            </div>

            {/* 2. Daily Nutritional Strategy */}
            <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-2xl font-bold mb-6 text-slate-800 border-b pb-3">Daily Meal Strategy</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(plan.nutrition.meals).map(([mealName, description]) => (
                  <div key={mealName} className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                    <h3 className="capitalize font-bold text-slate-700 mb-2">{mealName}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. 7-Day Training Matrix */}
            <div className="bg-slate-900 p-6 md:p-8 rounded-2xl shadow-lg border border-slate-800 text-slate-100">
              <h2 className="text-2xl font-bold mb-6 text-white border-b border-slate-700 pb-3">Periodized 7-Day Training Matrix</h2>
              <div className="grid grid-cols-1 gap-3">
                {Object.entries(plan.training_matrix).map(([day, workout]) => (
                  <div key={day} className="flex flex-col md:flex-row md:items-center bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                    <div className="md:w-32 font-bold text-blue-400 mb-1 md:mb-0 uppercase tracking-wide text-sm">{day}</div>
                    <div className="flex-1 text-slate-200">{workout}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}