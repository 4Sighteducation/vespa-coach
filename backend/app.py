import os
import json
# Removed: import csv 
from flask import Flask, request, jsonify
from flask_cors import CORS # Import CORS
from dotenv import load_dotenv
import requests

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# --- CORS Configuration ---
# Allow requests from your Knack domain
CORS(app, resources={r"/api/*": {"origins": "https://vespaacademy.knack.com"}})

# --- Configuration ---
KNACK_APP_ID = os.getenv('KNACK_APP_ID')
KNACK_API_KEY = os.getenv('KNACK_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
# SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY') # For later use

KNACK_BASE_URL = f"https://api.knack.com/v1/objects"

# --- Helper Functions ---

def load_json_file(file_path):
    """Loads a JSON file from the specified path."""
    try:
        # Correct path relative to app.py location
        full_path = os.path.join(os.path.dirname(__file__), file_path)
        with open(full_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # If the JSON is structured with a top-level "records" key (like Knack exports)
            if isinstance(data, dict) and 'records' in data and isinstance(data['records'], list):
                app.logger.info(f"Extracted {len(data['records'])} records from JSON file: {full_path}")
                return data['records'] # Return the list of records directly
            app.logger.info(f"Loaded JSON file (not in Knack 'records' format): {full_path}")
            return data # Return the loaded data as is (e.g. for psychometric_question_details)
    except FileNotFoundError:
        app.logger.error(f"Knowledge base file not found: {full_path}")
        return None
    except json.JSONDecodeError:
        app.logger.error(f"Error decoding JSON from file: {full_path}")
        return None
    except Exception as e:
        app.logger.error(f"An unexpected error occurred while loading JSON file {full_path}: {e}")
        return None

# Removed: load_csv_file function as it's no longer needed

def get_knack_record(object_key, record_id=None, filters=None):
    """
    Fetches records from a Knack object.
    - If record_id is provided, fetches a specific record.
    - If filters are provided, fetches records matching the filters.
    """
    if not KNACK_APP_ID or not KNACK_API_KEY:
        app.logger.error("Knack App ID or API Key is missing.")
        return None

    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    
    if record_id:
        url = f"{KNACK_BASE_URL}/{object_key}/records/{record_id}"
        action = "fetch specific record"
    elif filters:
        url = f"{KNACK_BASE_URL}/{object_key}/records"
        if filters:
            url += f"?filters={json.dumps(filters)}"
        action = f"fetch records with filters: {filters}"
    else: # Fetch all records for an object if no ID or filters. Be cautious with this.
        url = f"{KNACK_BASE_URL}/{object_key}/records"
        action = "fetch all records"


    app.logger.info(f"Attempting to {action} from Knack: object_key={object_key}")

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()  # Raises an HTTPError for bad responses (4XX or 5XX)
        
        app.logger.info(f"Knack API response status: {response.status_code} for object {object_key}")
        # Knack returns a single record directly, or a 'records' array for multiple
        data = response.json()
        if record_id:
            return data # Single record
        else: # Multiple records or filtered list
            return data.get('records', []) # Return list of records, or empty list if 'records' key not found
            
    except requests.exceptions.HTTPError as e:
        app.logger.error(f"HTTP error fetching Knack data for object {object_key}: {e}")
        app.logger.error(f"Response content: {response.content}")
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request exception fetching Knack data for object {object_key}: {e}")
    except json.JSONDecodeError:
        app.logger.error(f"JSON decode error for Knack response from object {object_key}. Response: {response.text}")
    return None


# --- Load Knowledge Bases ---
# These paths are relative to the 'backend' directory where app.py is located.
psychometric_question_details = load_json_file('knowledge_base/psychometric_question_details.json')
question_id_to_text_mapping = load_json_file('knowledge_base/question_id_to_text_mapping.json')
# Changed from reporttext.csv to reporttext.json
report_text_data = load_json_file('knowledge_base/reporttext.json') # Object_33 content

if not psychometric_question_details:
    app.logger.warning("Psychometric question details KB is empty or failed to load.")
if not question_id_to_text_mapping:
    app.logger.warning("Question ID to text mapping KB is empty or failed to load.")
if not report_text_data:
    # This will now be a list of records if loaded correctly, or None/empty if not.
    app.logger.warning("Report text data (Object_33 from reporttext.json) is empty or failed to load.")
else:
    app.logger.info(f"Loaded {len(report_text_data)} records from reporttext.json")


@app.route('/api/v1/coaching_suggestions', methods=['POST'])
def coaching_suggestions():
    app.logger.info("Received request for /api/v1/coaching_suggestions")
    data = request.get_json()

    if not data or 'student_object10_record_id' not in data:
        app.logger.error("Missing 'student_object10_record_id' in request.")
        return jsonify({"error": "Missing 'student_object10_record_id'"}), 400

    student_object10_record_id = data['student_object10_record_id']
    app.logger.info(f"Processing request for student_object10_record_id: {student_object10_record_id}")

    # --- Phase 1: Data Gathering ---
    # Fetch Object_10 record (VESPA Results)
    student_vespa_data = get_knack_record("object_10", record_id=student_object10_record_id)

    if not student_vespa_data:
        app.logger.error(f"Could not retrieve data for student_object10_record_id: {student_object10_record_id} from Knack Object_10.")
        return jsonify({"error": f"Could not retrieve data for student {student_object10_record_id}"}), 404
    
    app.logger.info(f"Successfully fetched Object_10 data: {student_vespa_data}")

    # Extract key fields from student_vespa_data (Object_10)
    # Ensure to use .get() with defaults to avoid KeyError if fields are missing
    student_name = student_vespa_data.get("field_187_raw", {}).get("full", "N/A")
    student_level = student_vespa_data.get("field_568_raw", "N/A") # e.g. "Level 3"
    current_m_cycle_str = student_vespa_data.get("field_146_raw", "0")
    try:
        current_m_cycle = int(current_m_cycle_str) if current_m_cycle_str else 0
    except ValueError:
        app.logger.warning(f"Could not parse current_m_cycle '{current_m_cycle_str}' to int. Defaulting to 0.")
        current_m_cycle = 0
    
    previous_interaction_summary = student_vespa_data.get("field_3271", "No previous summary found.")
    
    # VESPA scores - use field names directly from your README Object_10 mapping
    # Current cycle scores are field_147 to field_152
    vespa_scores = {
        "Vision": student_vespa_data.get("field_147"),
        "Effort": student_vespa_data.get("field_148"),
        "Systems": student_vespa_data.get("field_149"),
        "Practice": student_vespa_data.get("field_150"),
        "Attitude": student_vespa_data.get("field_151"),
        "Overall": student_vespa_data.get("field_152"),
    }

    # --- Phase 2: Knowledge Base Lookup & LLM Prompt Construction (Initial Steps) ---
    
    # Helper to determine score profile (Very Low, Low, Medium, High)
    def get_score_profile_text(score_value):
        if score_value is None: return "N/A"
        try:
            score = float(score_value) # Knack scores can sometimes be strings
            if score >= 8: return "High"
            if score >= 6: return "Medium"
            if score >= 4: return "Low"
            if score >= 0: return "Very Low" # Assuming 0 is the lowest possible score
            return "N/A"
        except (ValueError, TypeError):
            app.logger.warning(f"Could not convert score '{score_value}' to float for profile text.")
            return "N/A"

    vespa_profile_details = {}
    for element, score_value in vespa_scores.items():
        if element == "Overall": continue # Handle Overall separately as per README structure
        
        score_profile_text = get_score_profile_text(score_value)
        
        # Find matching entry in report_text_data (from reporttext.json)
        # field_848: Level, field_844: Category (VESPA element), field_842: ShowForScore
        # Knack raw fields often end with _raw, but the values from JSON might be direct.
        # The reporttext.json you provided has direct values for field_848, field_844, field_842
        matching_report_text = None
        if report_text_data:
            for record in report_text_data:
                if (record.get('field_848') == student_level and 
                    record.get('field_844') == element and 
                    record.get('field_842') == score_profile_text):
                    matching_report_text = record
                    break
        
        vespa_profile_details[element] = {
            "score_1_to_10": score_value if score_value is not None else "N/A",
            "score_profile_text": score_profile_text,
            "report_text_for_student": matching_report_text.get('field_845', "Content not found.") if matching_report_text else "Content not found.",
            "report_questions_for_student": matching_report_text.get('field_846', "Questions not found.") if matching_report_text else "Questions not found.",
            "report_suggested_tools_for_student": matching_report_text.get('field_847', "Tools not found.") if matching_report_text else "Tools not found.",
            "primary_tutor_coaching_comments": matching_report_text.get('field_853', "Coaching comments not found.") if matching_report_text else "Coaching comments not found.",
            "supplementary_tutor_questions": ["Placeholder supplementary Q1"], # TODO: Implement logic
            "key_individual_question_insights_from_object29": ["Placeholder insights from Object_29"], # TODO: Implement logic
            "historical_summary_scores": {"cycle1": "N/A (Placeholder)"} # TODO: Implement logic
        }

    # Handle Overall VESPA profile separately
    overall_score_value = vespa_scores.get("Overall")
    overall_score_profile_text = get_score_profile_text(overall_score_value)
    matching_overall_report_text = None
    if report_text_data:
        for record in report_text_data:
            if (record.get('field_848') == student_level and 
                record.get('field_844') == "Overall" and 
                record.get('field_842') == overall_score_profile_text):
                matching_overall_report_text = record
                break
    
    vespa_profile_details["Overall"] = {
        "score_1_to_10": overall_score_value if overall_score_value is not None else "N/A",
        "score_profile_text": overall_score_profile_text,
        "report_text_for_student": matching_overall_report_text.get('field_845', "Content not found.") if matching_overall_report_text else "Content not found.",
        "primary_tutor_coaching_comments": matching_overall_report_text.get('field_853', "Coaching comments not found.") if matching_overall_report_text else "Coaching comments not found.",
        "historical_summary_scores": {"cycle1": "N/A (Placeholder)"} # TODO: Implement logic
    }
    
    # TODO: Fetch Object_29 (Questionnaire Qs) based on student_object10_record_id and current_m_cycle
    # TODO: Fetch Object_112 (Academic Profile) - requires linkage
    # TODO: Logic for "supplementary_tutor_questions"
    # TODO: Logic for "key_individual_question_insights_from_object29"
    # TODO: Logic for "historical_summary_scores"
    # TODO: Logic for "overall_framing_statement_for_tutor"
    # TODO: Logic for "general_introductory_questions_for_tutor"
    # TODO: LLM integration

    # --- Prepare Response ---
    response_data = {
        "student_name": student_name,
        "student_level": student_level,
        "current_cycle": current_m_cycle,
        "vespa_profile": vespa_profile_details,
        "academic_profile_summary": [
            {"subject": "Academic Subject (Placeholder)", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A"}
        ],
        "overall_framing_statement_for_tutor": {
            "id": "default_response_placeholder",
            "statement": "This is a placeholder framing statement for the tutor."
        },
        "general_introductory_questions_for_tutor": [
            "How has your week been going regarding your studies? (Placeholder)"
        ],
        "llm_generated_summary_and_suggestions": {
            "conversation_openers": ["Let's talk about your VESPA scores. (Placeholder)"],
            "key_discussion_points": ["Consider your VESPA profile. (Placeholder)"],
            "suggested_next_steps_for_tutor": ["Discuss strategies based on the profile. (Placeholder)"]
        },
        "previous_interaction_summary": previous_interaction_summary
    }

    app.logger.info(f"Successfully prepared response for student_object10_record_id: {student_object10_record_id}")
    return jsonify(response_data)

if __name__ == '__main__':
    # Ensure the FLASK_ENV is set to development for debug mode if not using `flask run`
    # For Heroku, Gunicorn will be used as specified in Procfile
    port = int(os.environ.get('PORT', 5001))
    # When running locally with `python app.py`, debug should be True.
    # Heroku will set PORT, and debug should ideally be False in production.
    is_local_run = __name__ == '__main__' and not os.environ.get('DYNO')
    app.run(debug=is_local_run, port=port, host='0.0.0.0') 