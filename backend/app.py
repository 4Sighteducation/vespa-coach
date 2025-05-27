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

    student_obj10_id_from_request = data['student_object10_record_id']
    app.logger.info(f"Processing request for student_object10_record_id: {student_obj10_id_from_request}")

    # --- Phase 1: Data Gathering ---
    # Fetch Object_10 record (VESPA Results)
    student_vespa_data = get_knack_record("object_10", record_id=student_obj10_id_from_request)

    if not student_vespa_data:
        app.logger.error(f"Could not retrieve data for student_object10_record_id: {student_obj10_id_from_request} from Knack Object_10.")
        return jsonify({"error": f"Could not retrieve data for student {student_obj10_id_from_request}"}), 404
    
    app.logger.info(f"Successfully fetched Object_10 data for ID {student_obj10_id_from_request}")

    student_name = student_vespa_data.get("field_187_raw", {}).get("full", "N/A")
    student_level = student_vespa_data.get("field_568_raw", "N/A")
    current_m_cycle_str = student_vespa_data.get("field_146_raw", "0")
    try:
        current_m_cycle = int(current_m_cycle_str) if current_m_cycle_str else 0
    except ValueError:
        app.logger.warning(f"Could not parse current_m_cycle '{current_m_cycle_str}' to int. Defaulting to 0.")
        current_m_cycle = 0
    
    previous_interaction_summary = student_vespa_data.get("field_3271", "No previous summary found.")
    vespa_scores = {
        "Vision": student_vespa_data.get("field_147"), "Effort": student_vespa_data.get("field_148"),
        "Systems": student_vespa_data.get("field_149"), "Practice": student_vespa_data.get("field_150"),
        "Attitude": student_vespa_data.get("field_151"), "Overall": student_vespa_data.get("field_152"),
    }

    # Fetch and Process Object_29 (Questionnaire Qs) data
    key_individual_question_insights = ["No questionnaire data processed."] # Default
    processed_object29_data_for_llm = {} # To store structured Q&A for LLM

    if student_vespa_data.get('id') and current_m_cycle > 0:
        app.logger.info(f"Fetching Object_29 for Object_10 ID: {student_vespa_data['id']} and Cycle: {current_m_cycle}")
        filters_object29 = [
            {'field': 'field_792', 'operator': 'is', 'value': student_vespa_data['id']},
            {'field': 'field_863_raw', 'operator': 'is', 'value': str(current_m_cycle)}
        ]
        fetched_o29_data_list = get_knack_record("object_29", filters=filters_object29)
        
        if fetched_o29_data_list: # This will be a list of records
            object29_record = fetched_o29_data_list[0] # Assuming one record per student per cycle
            app.logger.info(f"Successfully fetched Object_29 record: {object29_record.get('id')}")
            
            parsed_insights = []
            if psychometric_question_details:
                for q_detail in psychometric_question_details:
                    field_id = q_detail.get('currentCycleFieldId')
                    question_text = q_detail.get('questionText', 'Unknown Question')
                    vespa_category = q_detail.get('vespaCategory', 'N/A')
                    
                    if not field_id:
                        continue

                    # Knack API often returns scores as strings; try to get numerical value.
                    # Check for field_id directly, then field_id_raw for Knack objects.
                    raw_score_value = object29_record.get(field_id)
                    if raw_score_value is None and field_id.startswith("field_"):
                         # For fields like "field_794", Knack API might return "field_794_raw" for the simple value.
                         # However, our psychometric_question_details.json currentCycleFieldId already points to the specific field.
                         # Let's assume the direct field_id contains the score or its object.
                         # If it's an object like {"value": "3"} or {"value": 3}, we need to extract it.
                         # If it's directly a string "3" or number 3, that's fine too.
                         score_obj = object29_record.get(field_id + '_raw') # Check _raw if direct access failed
                         if isinstance(score_obj, dict):
                             raw_score_value = score_obj.get('value', 'N/A')
                         elif score_obj is not None: # If _raw gives a direct value
                             raw_score_value = score_obj
                    
                    score_display = "N/A"
                    numeric_score = None
                    if raw_score_value is not None and raw_score_value != 'N/A':
                        try:
                            numeric_score = int(raw_score_value) # Scores are 1-5
                            score_display = str(numeric_score)
                        except (ValueError, TypeError):
                            score_display = str(raw_score_value) # Keep as string if not convertible
                            app.logger.warning(f"Could not parse score '{raw_score_value}' for {field_id} to int.")

                    insight_text = f"{vespa_category} - '{question_text}': Score {score_display}/5"
                    if numeric_score is not None and numeric_score <= 2: # Flag low scores (1 or 2)
                        insight_text = f"FLAG: {insight_text}"
                    parsed_insights.append(insight_text)
                    processed_object29_data_for_llm[question_text] = score_display
                
                if parsed_insights:
                    key_individual_question_insights = parsed_insights
                else:
                    key_individual_question_insights = ["Could not parse any question details from Object_29 data."]
            else:
                key_individual_question_insights = ["Psychometric question details mapping not loaded. Cannot process Object_29 data."]
        else:
            app.logger.warning(f"No data returned from Object_29 for student {student_vespa_data['id']} and cycle {current_m_cycle}.")
            key_individual_question_insights = [f"No questionnaire data found for cycle {current_m_cycle}."]
    else:
        app.logger.warning("Missing Object_10 ID or current_m_cycle is 0, skipping Object_29 fetch.")
        key_individual_question_insights = ["Skipped fetching questionnaire data (missing ID or cycle is 0)."]


    # --- Phase 2: Knowledge Base Lookup & LLM Prompt Construction (Initial Steps) ---
    def get_score_profile_text(score_value):
        if score_value is None: return "N/A"
        try:
            score = float(score_value)
            if score >= 8: return "High"
            if score >= 6: return "Medium"
            if score >= 4: return "Low"
            if score >= 0: return "Very Low"
            return "N/A"
        except (ValueError, TypeError):
            app.logger.warning(f"Could not convert score '{score_value}' to float for profile text.")
            return "N/A"

    vespa_profile_details = {}
    for element, score_value in vespa_scores.items():
        if element == "Overall": continue
        score_profile_text = get_score_profile_text(score_value)
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
            "supplementary_tutor_questions": ["Placeholder supplementary Q1"], 
            "key_individual_question_insights_from_object29": key_individual_question_insights, # Assign the processed insights
            "historical_summary_scores": {"cycle1": "N/A (Placeholder)"} 
        }

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
        "historical_summary_scores": {"cycle1": "N/A (Placeholder)"} 
    }
    
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

    app.logger.info(f"Successfully prepared response for student_object10_record_id: {student_obj10_id_from_request}")
    return jsonify(response_data)

if __name__ == '__main__':
    # Ensure the FLASK_ENV is set to development for debug mode if not using `flask run`
    # For Heroku, Gunicorn will be used as specified in Procfile
    port = int(os.environ.get('PORT', 5001))
    # When running locally with `python app.py`, debug should be True.
    # Heroku will set PORT, and debug should ideally be False in production.
    is_local_run = __name__ == '__main__' and not os.environ.get('DYNO')
    app.run(debug=is_local_run, port=port, host='0.0.0.0') 