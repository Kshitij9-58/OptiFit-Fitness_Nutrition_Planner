import csv
import math

# 1. Load the dataset dynamically (No KeyErrors possible)
print("1. Loading Real Dataset...")
documents = []
# using utf-8-sig to automatically strip hidden Windows Excel characters
with open("fitness_dataset.csv", mode="r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Dynamically grabs EVERY column in your CSV, whatever it is named!
        row_text = " | ".join([f"{key}: {value}" for key, value in row.items() if key and value])
        documents.append(row_text)

# 2. Pure Python Tokenizer & Vectorizer 
def get_tokens(text):
    return text.lower().replace("|", "").replace(":", "").split()

def text_to_vector(text, all_words):
    tokens = get_tokens(text)
    return [tokens.count(word) for word in all_words]

def cosine_similarity(v1, v2):
    dot_product = sum(x * y for x, y in zip(v1, v2))
    mag1 = math.sqrt(sum(x * x for x in v1))
    mag2 = math.sqrt(sum(x * x for x in v2))
    return dot_product / (mag1 * mag2) if (mag1 * mag2) else 0

print("2. Building Vector Space Model in RAM...")
all_words = set()
for doc in documents:
    all_words.update(get_tokens(doc))
all_words = list(all_words)

doc_vectors = [text_to_vector(doc, all_words) for doc in documents]

print("3. Executing Deterministic Semantic Search...")
query = "What is the best workout schedule for a male trying to gain muscle?"
query_vector = text_to_vector(query, all_words)

best_score = -1
best_doc = None

for doc, vec in zip(documents, doc_vectors):
    score = cosine_similarity(query_vector, vec)
    if score > best_score:
        best_score = score
        best_doc = doc

print("\n--- AI Recommended Plan ---")
print(best_doc)


# --- REPLACE THE OLD CHATOLLAMA CODE WITH THIS ---

print("\n4. Generating AI Response with Llama 3...")
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage

# Initialize your local AI Coach using the new official package
llm = ChatOllama(model="llama3")

# The RAG Prompt: Forcing the AI to use ONLY your database context
system_prompt = f"""
You are the OptiFit AI Coach. Answer the user's question using ONLY the provided data context. 
Make the response sound natural, motivating, and directly address the user.

User Question: {query}

Database Context to use: {best_doc}
"""

# Send the prompt to Llama 3
response = llm.invoke([HumanMessage(content=system_prompt)])

print("\n--- Final AI Coach Response ---")
print(response.content)