import json
import os
import openai
from dotenv import load_dotenv
import time
import logging

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Load Environment Variables (for OPENAI_API_KEY) ---
# Assumes .env file is in the backend directory (where app.py is)
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path)
if os.getenv("OPENAI_API_KEY"):
    logging.info(f"Loaded .env file from {dotenv_path}")
else:
    # If not found next to script, try one level up (common for scripts in subdirs)
    dotenv_path_alt = os.path.join(os.path.dirname(__file__), "..", '.env')
    if os.path.exists(dotenv_path_alt):
        load_dotenv(dotenv_path_alt)
        logging.info(f"Loaded .env file from {dotenv_path_alt}")
    else:
        logging.warning(f".env file not found at {dotenv_path} or {dotenv_path_alt}. Ensure OPENAI_API_KEY is set.")


openai.api_key = os.getenv("OPENAI_API_KEY")

if not openai.api_key:
    logging.error("CRITICAL: OPENAI_API_KEY is not set. The script cannot proceed without it.")
    exit()
else:
    logging.info("OpenAI API key loaded successfully.")

# --- Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) 
# SCRIPT_DIR is Homepage/AIVESPACoach/backend/Activity_PDFs/

# The main knowledge_base directory is one level up from SCRIPT_DIR
KNOWLEDGE_BASE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "knowledge_base"))

INPUT_ACTIVITIES_KB_FILE = os.path.join(KNOWLEDGE_BASE_DIR, "vespa_activities_kb.json") 
OUTPUT_DRAFT_INSIGHTS_FILE = os.path.join(KNOWLEDGE_BASE_DIR, "draft_coaching_insights.json")

# --- Helper Functions ---
def get_llm_completion_json(prompt_messages, max_tokens=300, temperature=0.5):
    """Generic function to get JSON completion from OpenAI."""
    try:
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo", # Or your preferred model, e.g., gpt-3.5-turbo-1106 for better JSON
            messages=prompt_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            n=1,
            stop=None,
            response_format={"type": "json_object"} # Request JSON mode
        )
        content = response.choices[0].message.content.strip()
        # Attempt to parse the JSON
        parsed_json = json.loads(content)
        return parsed_json
    except json.JSONDecodeError as e:
        logging.error(f"OpenAI API returned non-JSON response or malformed JSON: {content}. Error: {e}")
        return None
    except Exception as e:
        logging.error(f"OpenAI API call failed: {e}")
        if "rate limit" in str(e).lower():
            logging.warning("Rate limit likely hit. Waiting for 60 seconds before retrying...")
            time.sleep(60)
            try:
                response = openai.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=prompt_messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    n=1,
                    stop=None,
                    response_format={"type": "json_object"}
                )
                content = response.choices[0].message.content.strip()
                parsed_json = json.loads(content)
                return parsed_json
            except Exception as e2:
                 logging.error(f"OpenAI API call failed on retry: {e2}")
                 return None
        return None

# --- Main Processing Logic ---
def main():
    logging.info(f"Starting generation of draft coaching insights from: {INPUT_ACTIVITIES_KB_FILE}")

    try:
        with open(INPUT_ACTIVITIES_KB_FILE, 'r', encoding='utf-8') as f_activities:
            activities_data = json.load(f_activities)
    except FileNotFoundError:
        logging.error(f"Input file not found: {INPUT_ACTIVITIES_KB_FILE}")
        return
    except json.JSONDecodeError:
        logging.error(f"Error decoding JSON from: {INPUT_ACTIVITIES_KB_FILE}")
        return
    
    draft_insights = []
    processed_activity_names = set() # To avoid duplicate insights from activities with same name

    for i, activity in enumerate(activities_data):
        activity_name = activity.get("name", "Unknown Activity")
        activity_summary = activity.get("long_summary", "")
        activity_research_basis = activity.get("research_basis", "")

        logging.info(f"\nProcessing activity {i+1}/{len(activities_data)}: '{activity_name}'")

        if activity_name in processed_activity_names:
            logging.info(f"Skipping '{activity_name}' as an insight has likely already been generated for it.")
            continue

        if not activity_summary or activity_summary == "LLM Error" or len(activity_summary) < 50:
            logging.warning(f"Skipping '{activity_name}' due to missing or insufficient long summary.")
            continue

        prompt_system = "You are an expert in educational psychology, coaching methodologies, and pedagogical research. Your task is to analyze the provided information about a student activity and extract or infer potential underlying coaching principles or research insights that a tutor could leverage."
        prompt_user = f"""Consider the following educational activity:
Activity Name: "{activity_name}"
VESPA Element: "{activity.get("vespa_element", "N/A")}"
Stated Research Basis (if any): "{activity_research_basis if activity_research_basis and activity_research_basis not in ['Not specified in text', 'LLM Error', ''] else 'None explicitly stated.'}"
Activity Summary: "{activity_summary}"

Based on the summary and any stated research basis:
1.  **Identify a Core Principle/Insight:** What is a core educational theory, psychological principle, or coaching concept that seems to be leveraged or addressed by this activity? (e.g., "Growth Mindset," "Spaced Repetition," "Goal Setting Theory," "Scaffolding," "Locus of Control"). If the stated research basis is clear and relevant, use or build upon that. If not, infer from the summary. Formulate this as a concise name for the insight.
2.  **Describe the Principle/Insight:** Briefly describe this principle in 1-2 sentences.
3.  **Implications for Tutor:** In 2-3 sentences, explain how a tutor could practically apply or discuss this principle when coaching a student, especially in relation to this activity or similar situations. What kinds of questions could they ask, or what points could they make?
4.  **Suggest Keywords:** List 5-7 relevant keywords for this insight as a simple comma-separated string.

Please format your response as a single, valid JSON object with the EXACT keys: "insight_name", "insight_description", "implications_for_tutor", "keywords_list_str".

Example for an activity about breaking tasks down:
{{
  "insight_name": "Task Chunking and Scaffolding",
  "insight_description": "Breaking down large, overwhelming tasks into smaller, manageable steps (chunking) and providing support to build up to more complex skills (scaffolding) are effective pedagogical strategies.",
  "implications_for_tutor": "If a student feels overwhelmed by a large project, the tutor can help them apply chunking to identify the first small steps. They can also discuss how mastering smaller components builds confidence for larger challenges, which is a form of scaffolding learning.",
  "keywords_list_str": "task management, chunking, scaffolding, project planning, motivation, overwhelm, Vygotsky"
}}
"""
        messages = [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": prompt_user}
        ]

        logging.info(f"Generating insight for '{activity_name}'...")
        llm_response_json = get_llm_completion_json(messages, max_tokens=450, temperature=0.6)

        if llm_response_json:
            try:
                # Validate expected keys from LLM
                insight_name = llm_response_json.get("insight_name")
                insight_description = llm_response_json.get("insight_description")
                implications_for_tutor = llm_response_json.get("implications_for_tutor")
                keywords_str = llm_response_json.get("keywords_list_str", "")
                
                if insight_name and insight_description and implications_for_tutor:
                    keywords_list = [k.strip() for k in keywords_str.split(',') if k.strip()]
                    
                    draft_insights.append({
                        "id": f"insight_{activity.get('id', i).lower().replace(' ', '_')}", # Create a unique ID
                        "name": insight_name,
                        "description": insight_description,
                        "implications_for_tutor": implications_for_tutor,
                        "keywords": keywords_list,
                        "derived_from_activity_id": activity.get('id'),
                        "derived_from_activity_name": activity_name
                    })
                    processed_activity_names.add(activity_name) # Mark as processed
                    logging.info(f"Successfully generated insight: '{insight_name}'")
                else:
                    logging.warning(f"LLM response for '{activity_name}' was missing one or more required fields. Response: {llm_response_json}")
            except Exception as e:
                logging.error(f"Error processing LLM response for '{activity_name}': {e}. Response: {llm_response_json}")
        else:
            logging.warning(f"No valid JSON response from LLM for '{activity_name}'.")
        
        time.sleep(1) # Small delay to respect API rate limits

    # Save the draft insights to a new JSON file
    try:
        with open(OUTPUT_DRAFT_INSIGHTS_FILE, 'w', encoding='utf-8') as outfile:
            json.dump(draft_insights, outfile, indent=2, ensure_ascii=False)
        logging.info(f"Draft coaching insights generation complete. Output written to: {OUTPUT_DRAFT_INSIGHTS_FILE}")
    except Exception as e:
        logging.error(f"Error writing output JSON file '{OUTPUT_DRAFT_INSIGHTS_FILE}': {e}", exc_info=True)

if __name__ == "__main__":
    main()
