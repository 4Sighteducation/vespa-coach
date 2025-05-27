import os
import json
# Removed: import csv 
from flask import Flask, request, jsonify
from flask_cors import CORS # Import CORS
from dotenv import load_dotenv
import requests
import logging # Add logging import

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# --- CORS Configuration ---
# Allow requests from your Knack domain
CORS(app, resources={r"/api/*": {"origins": "https://vespaacademy.knack.com"}})

# Explicitly configure the Flask app's logger
if not app.debug:
    app.logger.setLevel(logging.INFO)
    # Optional: Add a stream handler if logs still don't appear consistently
    # handler = logging.StreamHandler()
    # handler.setLevel(logging.INFO)
    # formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    # handler.setFormatter(formatter)
    # if not app.logger.handlers: # Avoid adding multiple handlers on reloads
    #     app.logger.addHandler(handler)


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
        # app.py is in 'backend' and file_path is 'knowledge_base/file.json'
        # and knowledge_base is also a subdirectory of 'backend'.
        current_dir = os.path.dirname(os.path.abspath(__file__))
        full_path = os.path.join(current_dir, file_path) # e.g. /app/backend/knowledge_base/file.json
        full_path = os.path.normpath(full_path)

        app.logger.info(f"Attempting to load JSON file from calculated path: {full_path}")
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


# --- Function to fetch Academic Profile (Object_112) ---
def get_academic_profile(student_email, student_name_from_obj10, student_obj10_id_log_ref):
    app.logger.info(f"Starting academic profile fetch for student (Obj10 ID: {student_obj10_id_log_ref}), Email: '{student_email}', Name: '{student_name_from_obj10}'.")
    
    academic_profile_record = None
    subjects_summary_from_email_link = []
    profile_found_via_email = False

    # Attempt 1: Fetch via email linkage (Object_10.email -> Object_3.id -> Object_112.field_3070)
    if student_email:
        app.logger.info(f"Attempting to fetch Object_112 via email link for: {student_email}")
        filters_object3 = [{'field': 'field_70', 'operator': 'is', 'value': student_email}]
        user_accounts = get_knack_record("object_3", filters=filters_object3)

        if user_accounts:
            user_account_record = user_accounts[0]
            user_account_id = user_account_record.get('id')
            if user_account_id:
                app.logger.info(f"Found User Account (Object_3) ID: {user_account_id} for email: {student_email}")
                filters_object112_email_link = [{'field': 'field_3070_raw', 'operator': 'is', 'value': user_account_id}]
                homepage_profiles_email_link = get_knack_record("object_112", filters=filters_object112_email_link)
                
                if not homepage_profiles_email_link:
                    app.logger.info(f"No Object_112 profile found with field_3070_raw for account ID {user_account_id}. Trying 'field_3070'.")
                    filters_object112_email_link_alt = [{'field': 'field_3070', 'operator': 'is', 'value': user_account_id}]
                    homepage_profiles_email_link = get_knack_record("object_112", filters=filters_object112_email_link_alt)

                if homepage_profiles_email_link:
                    academic_profile_record = homepage_profiles_email_link[0]
                    profile_found_via_email = True
                    app.logger.info(f"Successfully fetched Homepage Profile (Object_112) ID: {academic_profile_record.get('id')} via email link.")
                    # Try parsing subjects from this email-linked profile
                    subjects_summary_from_email_link = parse_subjects_from_profile_record(academic_profile_record)
                    # Check if the parsed subjects are meaningful (not just the default "No academic subjects...")
                    if not subjects_summary_from_email_link or (len(subjects_summary_from_email_link) == 1 and subjects_summary_from_email_link[0]["subject"].startswith("No academic subjects")):
                        app.logger.info(f"Email-linked Object_112 record ID {academic_profile_record.get('id')} yielded no valid subjects. Will attempt name fallback.")
                        academic_profile_record = None # Nullify to allow name fallback
                    else:
                        app.logger.info(f"Email-linked Object_112 record ID {academic_profile_record.get('id')} yielded valid subjects. Using this profile.")
                else:
                    app.logger.info(f"No Object_112 profile found via email link for User Account ID: {user_account_id} (email: {student_email}).")
            else:
                app.logger.warning(f"User account found for email {student_email}, but it's missing an ID.")
        else:
            app.logger.info(f"No user account (Object_3) found for email: {student_email}.")
    else:
        app.logger.info(f"No student email provided. Skipping email-based Object_112 search.")

    # Attempt 2: Fallback to fetch by student name if email attempt failed OR yielded no valid subjects
    if not academic_profile_record and student_name_from_obj10 and student_name_from_obj10 != "N/A":
        log_reason = "profile not found via email" if not profile_found_via_email else "email-linked profile had no valid subjects"
        app.logger.info(f"Attempting Object_112 fallback search by student name ('{student_name_from_obj10}') because: {log_reason}.")
        filters_object112_name = [{'field': 'field_3066', 'operator': 'is', 'value': student_name_from_obj10}]
        homepage_profiles_name_search = get_knack_record("object_112", filters=filters_object112_name)
        
        if homepage_profiles_name_search:
            academic_profile_record = homepage_profiles_name_search[0]
            app.logger.info(f"Successfully fetched Homepage Profile (Object_112) ID: {academic_profile_record.get('id')} via NAME fallback.")
            # Parse subjects from this name-fallback profile
            subjects_summary = parse_subjects_from_profile_record(academic_profile_record)
            return subjects_summary # Return subjects from name fallback
        else:
            app.logger.warning(f"Fallback search: No Homepage Profile (Object_112) found for student name: '{student_name_from_obj10}'.")
            # If email also failed and name fallback failed, return the empty/default from email attempt or new default
            return subjects_summary_from_email_link if subjects_summary_from_email_link else [{"subject": "Academic profile not found.", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A"}]
    elif academic_profile_record:
        # This means email link was successful and yielded valid subjects
        app.logger.info("Object_112 record from email link was valid. Using its subjects.")
        return subjects_summary_from_email_link
    else:
        app.logger.warning(f"All attempts to fetch and parse Object_112 failed decisively (email: '{student_email}', name: '{student_name_from_obj10}').")
        return [{"subject": "Academic profile not found.", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A"}]


# Helper function to parse subjects from a given academic_profile_record
def parse_subjects_from_profile_record(academic_profile_record):
    if not academic_profile_record:
        app.logger.error("parse_subjects_from_profile_record called with no record.")
        return [] # Or a default indicating no data

    app.logger.info(f"Parsing subjects for Object_112 record ID: {academic_profile_record.get('id')}. Record (first 500 chars): {str(academic_profile_record)[:500]}")
    subjects_summary = []
    # Subject fields are field_3080 (Sub1) to field_3094 (Sub15)
    for i in range(1, 16):
        field_id_subject_json = f"field_30{79+i}" # field_3080 to field_3094
        subject_json_str = academic_profile_record.get(field_id_subject_json)
        if subject_json_str is None:
            subject_json_str = academic_profile_record.get(f"{field_id_subject_json}_raw")

        app.logger.debug(f"For Obj112 ID {academic_profile_record.get('id')}, field {field_id_subject_json}: Data type: {type(subject_json_str)}, Content (brief): '{str(subject_json_str)[:100]}...'")
        
        if subject_json_str and isinstance(subject_json_str, str) and subject_json_str.strip().startswith('{'):
            app.logger.info(f"Attempting to parse JSON for {field_id_subject_json}: '{subject_json_str[:200]}...'")
            try:
                subject_data = json.loads(subject_json_str)
                app.logger.info(f"Parsed subject_data for {field_id_subject_json}: {subject_data}")
                summary_entry = {
                    "subject": subject_data.get("subject") or subject_data.get("subject_name") or subject_data.get("subjectName") or subject_data.get("name", "N/A"),
                    "currentGrade": subject_data.get("currentGrade") or subject_data.get("current_grade") or subject_data.get("cg") or subject_data.get("currentgrade", "N/A"),
                    "targetGrade": subject_data.get("targetGrade") or subject_data.get("target_grade") or subject_data.get("tg") or subject_data.get("targetgrade", "N/A"),
                    "effortGrade": subject_data.get("effortGrade") or subject_data.get("effort_grade") or subject_data.get("eg") or subject_data.get("effortgrade", "N/A")
                }
                if summary_entry["subject"] != "N/A" and summary_entry["subject"] is not None:
                    subjects_summary.append(summary_entry)
                    app.logger.debug(f"Added subject: {summary_entry['subject']}")
                else:
                    app.logger.info(f"Skipped adding subject for {field_id_subject_json} as subject name was invalid or N/A. Parsed data: {subject_data}")
            except json.JSONDecodeError as e:
                app.logger.warning(f"JSONDecodeError for {field_id_subject_json}: {e}. Content: '{subject_json_str[:100]}...'")
        elif subject_json_str:
            app.logger.info(f"Field {field_id_subject_json} was not empty but not a valid JSON string start: '{subject_json_str[:100]}...'")

    if not subjects_summary:
        app.logger.info(f"No valid subject JSONs parsed from Object_112 record {academic_profile_record.get('id')}. Returning default message list.")
        return [{"subject": "No academic subjects parsed from profile.", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A"}]
    
    app.logger.info(f"Successfully parsed {len(subjects_summary)} subjects from Object_112 record {academic_profile_record.get('id')}.")
    return subjects_summary


# --- Load Knowledge Bases ---
# These paths are relative to the 'backend' directory where app.py is located.
psychometric_question_details = load_json_file('knowledge_base/psychometric_question_details.json')
question_id_to_text_mapping = load_json_file('knowledge_base/question_id_to_text_mapping.json')
# Changed from reporttext.csv to reporttext.json
report_text_data = load_json_file('knowledge_base/reporttext.json') # Object_33 content
coaching_kb = load_json_file('knowledge_base/coaching_questions_knowledge_base.json')

if not psychometric_question_details:
    app.logger.warning("Psychometric question details KB is empty or failed to load.")
if not question_id_to_text_mapping:
    app.logger.warning("Question ID to text mapping KB is empty or failed to load.")
if not report_text_data:
    # This will now be a list of records if loaded correctly, or None/empty if not.
    app.logger.warning("Report text data (Object_33 from reporttext.json) is empty or failed to load.")
else:
    app.logger.info(f"Loaded {len(report_text_data)} records from reporttext.json")

if not coaching_kb:
    app.logger.warning("Coaching Questions Knowledge Base (coaching_questions_knowledge_base.json) is empty or failed to load.")
else:
    app.logger.info("Successfully loaded Coaching Questions Knowledge Base.")


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

    student_name_for_profile_lookup = student_vespa_data.get("field_187_raw", {}).get("full", "N/A")
    # Extract student email from Object_10 for linking to Object_3 and then Object_112
    student_email_obj = student_vespa_data.get("field_197_raw") # This is usually an object e.g. {'email': 'student@example.com'}
    student_email = None
    if isinstance(student_email_obj, dict) and 'email' in student_email_obj:
        student_email = student_email_obj['email']
    elif isinstance(student_email_obj, str): # Less common but handle if it's just a string
        student_email = student_email_obj
    
    if not student_email:
        app.logger.warning(f"Student email (field_197_raw) not found or in unexpected format in Object_10 ID: {student_obj10_id_from_request}. Academic profile may be unavailable.")
        # student_email will be None, and get_academic_profile will handle it

    student_level = student_vespa_data.get("field_568_raw", "N/A")
    current_m_cycle_str = student_vespa_data.get("field_146_raw", "0")
    try:
        current_m_cycle = int(current_m_cycle_str) if current_m_cycle_str else 0
    except ValueError:
        app.logger.warning(f"Could not parse current_m_cycle '{current_m_cycle_str}' to int. Defaulting to 0.")
        current_m_cycle = 0
    
    # Previous interaction summary from field_3271
    previous_interaction_summary = student_vespa_data.get("field_3271", "No previous AI coaching summary found.")

    # Current VESPA scores (1-10 scale)
    vespa_scores = {
        "Vision": student_vespa_data.get("field_147"), "Effort": student_vespa_data.get("field_148"),
        "Systems": student_vespa_data.get("field_149"), "Practice": student_vespa_data.get("field_150"),
        "Attitude": student_vespa_data.get("field_151"), "Overall": student_vespa_data.get("field_152"),
    }

    # Historical Cycle Scores (1-10 scale)
    historical_scores = {
        "cycle1": {
            "Vision": student_vespa_data.get("field_155"), "Effort": student_vespa_data.get("field_156"),
            "Systems": student_vespa_data.get("field_157"), "Practice": student_vespa_data.get("field_158"),
            "Attitude": student_vespa_data.get("field_159"), "Overall": student_vespa_data.get("field_160"),
        },
        "cycle2": {
            "Vision": student_vespa_data.get("field_161"), "Effort": student_vespa_data.get("field_162"),
            "Systems": student_vespa_data.get("field_163"), "Practice": student_vespa_data.get("field_164"),
            "Attitude": student_vespa_data.get("field_165"), "Overall": student_vespa_data.get("field_166"),
        },
        "cycle3": {
            "Vision": student_vespa_data.get("field_167"), "Effort": student_vespa_data.get("field_168"),
            "Systems": student_vespa_data.get("field_169"), "Practice": student_vespa_data.get("field_170"),
            "Attitude": student_vespa_data.get("field_171"), "Overall": student_vespa_data.get("field_172"),
        }
    }

    # Student Reflections & Goals from Object_10
    student_reflections_and_goals = {
        "rrc1_comment": student_vespa_data.get("field_2302"),
        "rrc2_comment": student_vespa_data.get("field_2303"),
        "rrc3_comment": student_vespa_data.get("field_2304"),
        "goal1": student_vespa_data.get("field_2499"),
        "goal2": student_vespa_data.get("field_2493"),
        "goal3": student_vespa_data.get("field_2494"),
    }
    # Ensure None values are replaced with a more JSON-friendly "N/A" or "Not specified"
    for key, value in student_reflections_and_goals.items():
        if value is None:
            student_reflections_and_goals[key] = "Not specified"
    
    app.logger.info(f"Object_10 Reflections and Goals: {student_reflections_and_goals}")


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
            "supplementary_tutor_questions": [], # Initialize as empty list
            "key_individual_question_insights_from_object29": [], # Initialize as empty list
            "historical_summary_scores": {} 
        }
        # Populate historical_summary_scores for each element
        for cycle_num_str, cycle_data in historical_scores.items():
            cycle_key = f"cycle{cycle_num_str[-1]}" # e.g. "cycle1"
            score = cycle_data.get(element)
            vespa_profile_details[element]["historical_summary_scores"][cycle_key] = score if score is not None else "N/A"
        
        # Assign specific insights for this VESPA element
        element_specific_insights = []
        if key_individual_question_insights and isinstance(key_individual_question_insights, list) and key_individual_question_insights[0] != "No questionnaire data processed." and key_individual_question_insights[0] != "Psychometric question details mapping not loaded. Cannot process Object_29 data." and not key_individual_question_insights[0].startswith("No questionnaire data found for cycle") and not key_individual_question_insights[0].startswith("Skipped fetching questionnaire data"):
            for insight in key_individual_question_insights:
                 # Ensure insight is a string before calling .startswith()
                if isinstance(insight, str) and insight.upper().startswith(element.upper()): # Case-insensitive match on element
                    element_specific_insights.append(insight)
        vespa_profile_details[element]["key_individual_question_insights_from_object29"] = element_specific_insights if element_specific_insights else ["No specific insights for this category from questionnaire."]

        # Populate supplementary_tutor_questions from coaching_kb
        supplementary_questions = []
        if coaching_kb and coaching_kb.get('vespaSpecificCoachingQuestions'):
            element_data = coaching_kb['vespaSpecificCoachingQuestions'].get(element, {})
            if element_data: # Check if the element itself exists
                level_specific_questions = element_data.get(student_level, {}) # Get questions for student's level
                if not level_specific_questions and student_level == "Level 3": # Fallback for Level 3 if specific L3 not found but L2 might exist
                    app.logger.info(f"No Level 3 specific questions for {element}, trying Level 2 as fallback.")
                    level_specific_questions = element_data.get("Level 2", {})
                elif not level_specific_questions and student_level == "Level 2": # Fallback for Level 2 if specific L2 not found but L3 might exist
                    app.logger.info(f"No Level 2 specific questions for {element}, trying Level 3 as fallback.")
                    level_specific_questions = element_data.get("Level 3", {})
                
                # score_profile_text is "High", "Medium", "Low", "Very Low"
                profile_questions = level_specific_questions.get(score_profile_text, [])
                supplementary_questions.extend(profile_questions)
        
        vespa_profile_details[element]["supplementary_tutor_questions"] = supplementary_questions if supplementary_questions else ["No supplementary questions found for this profile."]


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
        "historical_summary_scores": {} 
    }
    # Populate historical_summary_scores for Overall
    for cycle_num_str, cycle_data in historical_scores.items():
        cycle_key = f"cycle{cycle_num_str[-1]}"
        score = cycle_data.get("Overall")
        vespa_profile_details["Overall"]["historical_summary_scores"][cycle_key] = score if score is not None else "N/A"

    
    # Fetch Academic Profile Data (Object_112)
    academic_profile_summary_data = get_academic_profile(student_email, student_name_for_profile_lookup, student_obj10_id_from_request)

    # Populate general introductory questions and overall framing statement from coaching_kb
    general_intro_questions = ["No general introductory questions found."]
    if coaching_kb and coaching_kb.get('generalIntroductoryQuestions'):
        general_intro_questions = coaching_kb['generalIntroductoryQuestions']
        if not general_intro_questions: # Ensure it's not an empty list from KB
            general_intro_questions = ["No general introductory questions found in KB."]
    
    overall_framing_statement = {"id": "default_framing", "statement": "No specific framing statement matched or available."}
    if coaching_kb and coaching_kb.get('conditionalFramingStatements'):
        # Basic logic: use the first one if available, or implement conditionLogic if defined
        # For now, let's take the first one as a default if any exist, or a specific one by ID if needed.
        # The README implies `conditionLogic` needs evaluation - this is a placeholder for that.
        # Defaulting to a "default_response" or the first available conditional statement.
        
        default_statement_found = False
        for stmt in coaching_kb['conditionalFramingStatements']:
            if stmt.get('id') == 'default_response': # As per example in README API response
                overall_framing_statement = {"id": stmt['id'], "statement": stmt.get('statement', "Default statement text missing.")}
                default_statement_found = True
                break
        if not default_statement_found and coaching_kb['conditionalFramingStatements']:
            # Fallback to the first conditional statement if default_response is not found
            first_stmt = coaching_kb['conditionalFramingStatements'][0]
            overall_framing_statement = {"id": first_stmt.get('id', 'unknown_conditional'), "statement": first_stmt.get('statement', "Conditional statement text missing.")}
        elif not coaching_kb['conditionalFramingStatements']:
            app.logger.info("No conditional framing statements found in KB.")
            # Keep the initial default if none are in KB

    # --- Prepare Response ---
    response_data = {
        "student_name": student_name_for_profile_lookup,
        "student_level": student_level,
        "current_cycle": current_m_cycle,
        "vespa_profile": vespa_profile_details,
        "academic_profile_summary": academic_profile_summary_data, # Use fetched data
        "student_reflections_and_goals": student_reflections_and_goals,
        "overall_framing_statement_for_tutor": overall_framing_statement, # Use populated statement
        "general_introductory_questions_for_tutor": general_intro_questions, # Use populated questions
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