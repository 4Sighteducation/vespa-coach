import os
import json
# Removed: import csv 
from flask import Flask, request, jsonify
from flask_cors import CORS # Import CORS
from dotenv import load_dotenv
import requests
import logging # Add logging import
import openai # Import the OpenAI library
import time # Add time for cache expiry

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

# --- Cache for School VESPA Averages ---
# Simple in-memory cache with TTL
SCHOOL_AVERAGES_CACHE = {}
CACHE_TTL_SECONDS = 3600  # 1 hour

# Initialize OpenAI client
if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY
else:
    app.logger.warning("OPENAI_API_KEY not found in environment variables. LLM features will be disabled.")

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

def get_knack_record(object_key, record_id=None, filters=None, page=1, rows_per_page=1000):
    """
    Fetches records from a Knack object.
    - If record_id is provided, fetches a specific record.
    - If filters are provided, fetches records matching the filters.
    - Handles pagination for fetching multiple records.
    """
    if not KNACK_APP_ID or not KNACK_API_KEY:
        app.logger.error("Knack App ID or API Key is missing.")
        return None

    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    
    params = {'page': page, 'rows_per_page': rows_per_page}
    if filters:
        params['filters'] = json.dumps(filters)

    if record_id:
        url = f"{KNACK_BASE_URL}/{object_key}/records/{record_id}"
        action = "fetch specific record"
        current_params = {} # No params for specific record ID fetch typically
    else:
        url = f"{KNACK_BASE_URL}/{object_key}/records"
        action = f"fetch records (page {page}) with filters: {filters if filters else 'None'}"
        current_params = params

    app.logger.info(f"Attempting to {action} from Knack: object_key={object_key}, URL={url}, Params={current_params}")

    try:
        response = requests.get(url, headers=headers, params=current_params)
        response.raise_for_status()  # Raises an HTTPError for bad responses (4XX or 5XX)
        
        app.logger.info(f"Knack API response status: {response.status_code} for object {object_key} (page {page})")
        data = response.json()
        return data # Return the full response which includes 'current_page', 'total_pages', 'records'
            
    except requests.exceptions.HTTPError as e:
        app.logger.error(f"HTTP error fetching Knack data for object {object_key} (page {page}): {e}")
        app.logger.error(f"Response content: {response.content}")
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request exception fetching Knack data for object {object_key} (page {page}): {e}")
    except json.JSONDecodeError:
        app.logger.error(f"JSON decode error for Knack response from object {object_key} (page {page}). Response: {response.text}")
    return None


# --- Function to fetch Academic Profile (Object_112) ---
def get_academic_profile(actual_student_obj3_id, student_name_for_fallback, student_obj10_id_log_ref):
    app.logger.info(f"Starting academic profile fetch. Target Student's Object_3 ID: '{actual_student_obj3_id}', Fallback Name: '{student_name_for_fallback}', Original Obj10 ID for logging: {student_obj10_id_log_ref}.")
    
    academic_profile_record = None
    subjects_summary = []

    # Attempt 1: Fetch Object_112 using actual_student_obj3_id against Object_112.field_3064 (UserId - Short Text field)
    if actual_student_obj3_id:
        app.logger.info(f"Attempt 1: Fetching Object_112 where field_3064 (UserId Text) is '{actual_student_obj3_id}'.")
        filters_obj112_via_field3064 = [{'field': 'field_3064', 'operator': 'is', 'value': actual_student_obj3_id}]
        obj112_response_attempt1 = get_knack_record("object_112", filters=filters_obj112_via_field3064)

        temp_profiles_list_attempt1 = []
        if obj112_response_attempt1 and isinstance(obj112_response_attempt1, dict) and \
           'records' in obj112_response_attempt1 and isinstance(obj112_response_attempt1['records'], list):
            temp_profiles_list_attempt1 = obj112_response_attempt1['records']
            app.logger.info(f"Attempt 1: Found {len(temp_profiles_list_attempt1)} candidate profiles via field_3064.")
        else:
            app.logger.info(f"Attempt 1: Knack response for field_3064 query was not in expected format or no records. Response: {str(obj112_response_attempt1)[:200]}")

        if temp_profiles_list_attempt1: # Check if list is not empty
            if isinstance(temp_profiles_list_attempt1[0], dict):
                academic_profile_record = temp_profiles_list_attempt1[0]
                app.logger.info(f"Attempt 1 SUCCESS: Found Object_112 record ID {academic_profile_record.get('id')} using field_3064 with Obj3 ID '{actual_student_obj3_id}'. Profile Name: {academic_profile_record.get('field_3066')}")
                subjects_summary = parse_subjects_from_profile_record(academic_profile_record)
                if not subjects_summary or (len(subjects_summary) == 1 and subjects_summary[0]["subject"].startswith("No academic subjects")):
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3064) yielded no valid subjects. Will try other methods.")
                    academic_profile_record = None 
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3064) has valid subjects. Using this profile.")
                    return subjects_summary
            else:
                app.logger.warning(f"Attempt 1: First item in profiles_via_field3064 is not a dict: {type(temp_profiles_list_attempt1[0])}")
        else:
            app.logger.info(f"Attempt 1 FAILED (empty list): No Object_112 profile found where field_3064 (UserId Text) is '{actual_student_obj3_id}'.")

    # Attempt 2: Fetch Object_112 using actual_student_obj3_id against Object_112.field_3070 (Account Connection field)
    if not academic_profile_record and actual_student_obj3_id: 
        app.logger.info(f"Attempt 2: Fetching Object_112 where field_3070 (Account Connection) is '{actual_student_obj3_id}'.")
        filters_obj112_via_field3070 = [{'field': 'field_3070_raw', 'operator': 'is', 'value': actual_student_obj3_id}]
        obj112_response_attempt2 = get_knack_record("object_112", filters=filters_obj112_via_field3070)
        
        temp_profiles_list_attempt2 = []
        if not (obj112_response_attempt2 and isinstance(obj112_response_attempt2, dict) and 'records' in obj112_response_attempt2 and isinstance(obj112_response_attempt2['records'], list) and obj112_response_attempt2['records']):
            app.logger.info(f"Attempt 2 (field_3070_raw): No records or unexpected format. Trying 'field_3070' (non-raw). Response: {str(obj112_response_attempt2)[:200]}" )
            filters_obj112_via_field3070_alt = [{'field': 'field_3070', 'operator': 'is', 'value': actual_student_obj3_id}]
            obj112_response_attempt2 = get_knack_record("object_112", filters=filters_obj112_via_field3070_alt)

        if obj112_response_attempt2 and isinstance(obj112_response_attempt2, dict) and \
           'records' in obj112_response_attempt2 and isinstance(obj112_response_attempt2['records'], list):
            temp_profiles_list_attempt2 = obj112_response_attempt2['records']
            app.logger.info(f"Attempt 2: Found {len(temp_profiles_list_attempt2)} candidate profiles via field_3070 logic.")

        if temp_profiles_list_attempt2: # Check if list is not empty
            if isinstance(temp_profiles_list_attempt2[0], dict):
                academic_profile_record = temp_profiles_list_attempt2[0]
                app.logger.info(f"Attempt 2 SUCCESS: Found Object_112 record ID {academic_profile_record.get('id')} using field_3070 (Account Connection) with Obj3 ID '{actual_student_obj3_id}'. Profile Name: {academic_profile_record.get('field_3066')}")
                subjects_summary = parse_subjects_from_profile_record(academic_profile_record)
                if not subjects_summary or (len(subjects_summary) == 1 and subjects_summary[0]["subject"].startswith("No academic subjects")):
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3070) yielded no valid subjects. Will try name fallback.")
                    academic_profile_record = None 
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3070) has valid subjects. Using this profile.")
                    return subjects_summary
            else:
                app.logger.warning(f"Attempt 2: First item in profiles_via_field3070 is not a dict: {type(temp_profiles_list_attempt2[0])}")
        else:
            app.logger.info(f"Attempt 2 FAILED (empty list): No Object_112 profile found where field_3070 (Account Connection) is '{actual_student_obj3_id}'.")

    # Attempt 3: Fallback to fetch by student name
    if not academic_profile_record and student_name_for_fallback and student_name_for_fallback != "N/A":
        app.logger.info(f"Attempt 3: Fallback search for Object_112 by student name ('{student_name_for_fallback}') via field_3066.")
        filters_object112_name = [{'field': 'field_3066', 'operator': 'is', 'value': student_name_for_fallback}]
        obj112_response_attempt3 = get_knack_record("object_112", filters=filters_object112_name)
        
        temp_profiles_list_attempt3 = []
        if obj112_response_attempt3 and isinstance(obj112_response_attempt3, dict) and \
           'records' in obj112_response_attempt3 and isinstance(obj112_response_attempt3['records'], list):
            temp_profiles_list_attempt3 = obj112_response_attempt3['records']
            app.logger.info(f"Attempt 3: Found {len(temp_profiles_list_attempt3)} candidate profiles via name fallback.")

        if temp_profiles_list_attempt3: # Check if list is not empty
            if isinstance(temp_profiles_list_attempt3[0], dict):
                academic_profile_record = temp_profiles_list_attempt3[0]
                app.logger.info(f"Attempt 3 SUCCESS: Found Object_112 record ID {academic_profile_record.get('id')} via NAME fallback ('{student_name_for_fallback}'). Profile Name: {academic_profile_record.get('field_3066')}")
                subjects_summary = parse_subjects_from_profile_record(academic_profile_record)
                if not subjects_summary or (len(subjects_summary) == 1 and subjects_summary[0]["subject"].startswith("No academic subjects")):
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via name fallback) yielded no valid subjects.")
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via name fallback) has valid subjects. Using this profile.")
                    return subjects_summary
            else:
                app.logger.warning(f"Attempt 3: First item in homepage_profiles_name_search is not a dict: {type(temp_profiles_list_attempt3[0])}")
        else:
            app.logger.warning(f"Attempt 3 FAILED (empty list): Fallback search: No Object_112 found for student name: '{student_name_for_fallback}'.")
    
    app.logger.warning(f"All attempts to fetch Object_112 failed (Student's Obj3 ID: '{actual_student_obj3_id}', Fallback name: '{student_name_for_fallback}').")
    return [{"subject": "Academic profile not found by any method.", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A"}]


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


# --- Function to Generate Student Summary with LLM (Now with active LLM call) ---
def generate_student_summary_with_llm(student_data_dict):
    app.logger.info(f"Attempting to generate LLM summary for student: {student_data_dict.get('student_name', 'N/A')}")
    
    if not OPENAI_API_KEY:
        app.logger.error("OpenAI API key is not configured. Cannot generate LLM summary.")
        # Fallback to a more informative placeholder if API key is missing
        return f"LLM summary for {student_data_dict.get('student_name', 'N/A')} is unavailable (AI key not configured). Key data would be summarized here."

    student_level = student_data_dict.get('student_level', 'N/A')
    student_name = student_data_dict.get('student_name', 'Unknown Student')
    current_cycle = student_data_dict.get('current_cycle', 'N/A')

    # Construct a detailed prompt for the LLM
    prompt_parts = []
    prompt_parts.append(f"The following data is for student '{student_name}' (Level: {student_level}, Current Cycle: {current_cycle}).")

    # VESPA Profile
    prompt_parts.append("\n--- VESPA Profile (Vision, Effort, Systems, Practice, Attitude) ---")
    if student_data_dict.get('vespa_profile'):
        for element, details in student_data_dict['vespa_profile'].items():
            prompt_parts.append(f"- {element}: Score {details.get('score_1_to_10', 'N/A')}/10 ({details.get('score_profile_text', 'N/A')})")
            report_text_raw = details.get('primary_tutor_coaching_comments', '') 
            if report_text_raw and report_text_raw != "Coaching comments not found.":
                 report_text_clean = report_text_raw[:150].replace('\n', ' ')
                 ellipsis = '...' if len(report_text_raw) > 150 else ''
                 prompt_parts.append(f"  Tutor Note ({element}): {report_text_clean}{ellipsis}")

    # Academic Profile
    prompt_parts.append("\n--- Academic Profile (First 3 Subjects) ---")
    if student_data_dict.get('academic_profile_summary'):
        profile_data = student_data_dict['academic_profile_summary']
        if isinstance(profile_data, list) and profile_data and profile_data[0].get('subject') and not profile_data[0]["subject"].startswith("Academic profile not found") and not profile_data[0]["subject"].startswith("No academic subjects"):
            for subject_info in profile_data[:3]: # Limit to first 3 subjects for brevity
                prompt_parts.append(f"- Subject: {subject_info.get('subject', 'N/A')}, Current: {subject_info.get('currentGrade', 'N/A')}, Target: {subject_info.get('targetGrade', 'N/A')}, Effort: {subject_info.get('effortGrade', 'N/A')}")
        else:
            prompt_parts.append("  No detailed academic profile summary available or profile indicates issues.")

    # Reflections and Goals (Current Cycle Focus)
    prompt_parts.append("\n--- Student Reflections & Goals (Current Cycle Focus) ---")
    reflections_goals_found = False
    if student_data_dict.get('student_reflections_and_goals'):
        reflections = student_data_dict['student_reflections_and_goals']
        # current_cycle is already defined from student_data_dict
        current_rrc_key = f"rrc{current_cycle}_comment"
        current_goal_key = f"goal{current_cycle}"

        if reflections.get(current_rrc_key) and reflections[current_rrc_key] != "Not specified":
            rrc_text_clean = str(reflections[current_rrc_key])[:200].replace('\n', ' ')
            prompt_parts.append(f"- Current Reflection (RRC{current_cycle}): {rrc_text_clean}...")
            reflections_goals_found = True
        if reflections.get(current_goal_key) and reflections[current_goal_key] != "Not specified":
            goal_text_clean = str(reflections[current_goal_key])[:200].replace('\n', ' ')
            prompt_parts.append(f"- Current Goal ({current_goal_key.replace('_',' ').upper()}): {goal_text_clean}...")
            reflections_goals_found = True
        
        if not reflections_goals_found:
            if reflections.get('rrc1_comment') and reflections['rrc1_comment'] != "Not specified":
                rrc1_text_clean = str(reflections['rrc1_comment'])[:200].replace('\n', ' ')
                prompt_parts.append(f"- RRC1 Reflection: {rrc1_text_clean}...")
                reflections_goals_found = True
            if reflections.get('goal1') and reflections['goal1'] != "Not specified":
                goal1_text_clean = str(reflections['goal1'])[:200].replace('\n', ' ')
                prompt_parts.append(f"- Goal1: {goal1_text_clean}...")
                reflections_goals_found = True

    if not reflections_goals_found:
        prompt_parts.append("  No specific current reflections or goals provided, or no fallback RRC1/Goal1 data.")

    # Key Insights from Questionnaire (Object_29) - pick a few flagged ones if available
    prompt_parts.append("\n--- Key Questionnaire Insights (Flagged Low Scores from Object_29) ---")
    flagged_insights = []
    if student_data_dict.get('vespa_profile'):
        for element_details in student_data_dict['vespa_profile'].values():
            insights = element_details.get('key_individual_question_insights_from_object29', [])
            for insight in insights:
                if isinstance(insight, str) and insight.startswith("FLAG:"):
                    flagged_insights.append(insight.replace('\n', ' '))
    
    if flagged_insights:
        for i, fi_insight in enumerate(flagged_insights[:2]): # Max 2 flagged insights
            prompt_parts.append(f"  - {fi_insight}")
    else:
        prompt_parts.append("  No specific low-score questionnaire insights flagged from Object_29 data.")
        
    # NEW: Top and Bottom 3 questions from Object_29
    prompt_parts.append("\n--- Top & Bottom Scoring Questionnaire Questions (Object_29) ---")
    obj29_highlights = student_data_dict.get("object29_question_highlights")
    if obj29_highlights:
        if obj29_highlights.get("top_3"):
            prompt_parts.append("  Top Scoring Questions (1-5 scale):")
            for q_data in obj29_highlights["top_3"]:
                prompt_parts.append(f"    - Score {q_data['score']}/5 ({q_data['category']}): \"{q_data['text']}\"")
        else:
            prompt_parts.append("  No top scoring questions data available.")
        
        if obj29_highlights.get("bottom_3"):
            prompt_parts.append("  Bottom Scoring Questions (1-5 scale):")
            for q_data in obj29_highlights["bottom_3"]:
                prompt_parts.append(f"    - Score {q_data['score']}/5 ({q_data['category']}): \"{q_data['text']}\"")
        else:
            prompt_parts.append("  No bottom scoring questions data available.")
    else:
        prompt_parts.append("  No top/bottom question highlight data processed for Object_29.")
        
    # Previous Interaction Summary
    prev_summary = student_data_dict.get('previous_interaction_summary')
    if prev_summary and prev_summary != "No previous AI coaching summary found.":
        prompt_parts.append("\n--- Previous AI Interaction Summary (For Context) ---")
        prev_summary_clean = str(prev_summary)[:300].replace('\n', ' ')
        prompt_parts.append(f"  {prev_summary_clean}...")

    prompt_parts.append("\n--- TASK FOR THE AI ACADEMIC MENTOR ---")
    prompt_parts.append("Based ONLY on the data provided above, provide a concise (2-3 sentences, max 100-120 words) 'AI Student Snapshot' for the student's TUTOR.")
    prompt_parts.append("This snapshot should highlight 1-2 key strengths and 1-2 primary areas for development or discussion, strongly rooted in the VESPA principles (Vision, Effort, Systems, Practice, Attitude).")
    prompt_parts.append("Pay close attention to any explicit 'Reflections' (RRC comments) or 'Goals' provided by the student for the current cycle, as these are direct insights into their thinking.") # Emphasized RRC/Goals
    prompt_parts.append("The tone should be objective, analytical, and supportive, aimed at helping the tutor quickly grasp the student's profile to effectively prepare for a coaching conversation focused on student ownership.")
    prompt_parts.append("Frame your insights to help the tutor ask open-ended questions (inspired by the style in the `coaching_questions_knowledge_base.json`) and guide the student towards self-assessment and finding their own solutions (e.g., how they compare to the `100 statements - 2023.txt`).")
    prompt_parts.append("The ultimate aim of the tutor's conversation is to co-create an action plan with the student and use techniques like the 1-10 commitment scale ('How likely are you to stick to these goals?' -> 'What could move that score to an 8 or 9?').")
    prompt_parts.append("IMPORTANT: Do NOT directly ask questions TO THE STUDENT or give direct advice TO THE STUDENT in this summary. Instead, provide insights and talking points that will help the TUTOR facilitate these conversations effectively. Do not use conversational filler like 'Okay, let's look at...'.")
    
    prompt_to_send = "\n".join(prompt_parts)
    app.logger.info(f"Generated LLM Prompt (first 500 chars): {prompt_to_send[:500]}")
    app.logger.info(f"Generated LLM Prompt (last 500 chars): {prompt_to_send[-500:]}")
    app.logger.info(f"Total LLM Prompt length: {len(prompt_to_send)} characters")

    system_message_content = (
        f"You are a professional academic mentor with significant experience working with school-age students, "
        f"specifically at {student_level} (Level 2 is GCSE age 14-16, Level 3 is A-Level/Post-16 age 16-18). "
        f"Your responses should reflect this understanding. You are assisting a tutor who is preparing for a "
        f"coaching session with a student, guided by the VESPA (Vision, Effort, Systems, Practice, Attitude) framework. "
        f"The tutor aims to foster student ownership, encourage self-reflection, and co-create action plans. "
        f"Your role is to provide a concise data-driven summary to the TUTOR to support this process."
    )

    try:
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[
                {"role": "system", "content": system_message_content},
                {"role": "user", "content": prompt_to_send}
            ],
            max_tokens=120, 
            temperature=0.6, 
            n=1,
            stop=None
        )
        summary = response.choices[0].message.content.strip()
        app.logger.info(f"LLM generated summary: {summary}")
        return summary

    except Exception as e:
        app.logger.error(f"Error calling OpenAI API: {e}")
        return f"Error generating summary from LLM for {student_data_dict.get('student_name', 'N/A')}. Please check API key and logs. (Details: {str(e)[:100]}...)"


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
    student_vespa_data_response = get_knack_record("object_10", record_id=student_obj10_id_from_request)

    if not student_vespa_data_response:
        app.logger.error(f"Could not retrieve data for student_object10_record_id: {student_obj10_id_from_request} from Knack Object_10.")
        return jsonify({"error": f"Could not retrieve data for student {student_obj10_id_from_request}"}), 404
    
    student_vespa_data = student_vespa_data_response 
    app.logger.info(f"Successfully fetched Object_10 data for ID {student_obj10_id_from_request}")

    # Determine School ID for the student
    school_id = None
    school_connection_raw = student_vespa_data.get("field_133_raw")
    if isinstance(school_connection_raw, list) and school_connection_raw:
        school_id = school_connection_raw[0].get('id')
        app.logger.info(f"Extracted school_id '{school_id}' from student's Object_10 field_133_raw (list).")
    elif isinstance(school_connection_raw, str):
        school_id = school_connection_raw
        app.logger.info(f"Extracted school_id '{school_id}' (string) from student's Object_10 field_133_raw.")
    else:
        app.logger.warning(f"Could not determine school_id from field_133_raw for student {student_obj10_id_from_request}. Data: {school_connection_raw}")

    school_wide_vespa_averages = None
    if school_id:
        school_wide_vespa_averages = get_school_vespa_averages(school_id)
        if school_wide_vespa_averages:
            app.logger.info(f"Successfully retrieved school-wide VESPA averages for school {school_id}: {school_wide_vespa_averages}")
        else:
            app.logger.warning(f"Failed to retrieve school-wide VESPA averages for school {school_id}.")
    else:
        app.logger.warning("Cannot fetch school-wide VESPA averages as school_id is unknown.")

    student_name_for_profile_lookup = student_vespa_data.get("field_187_raw", {}).get("full", "N/A")
    student_email_obj = student_vespa_data.get("field_197_raw") 
    student_email = None
    if isinstance(student_email_obj, dict) and 'email' in student_email_obj:
        student_email = student_email_obj['email']
    elif isinstance(student_email_obj, str):
        student_email = student_email_obj

    actual_student_object3_id = None
    if student_email:
        filters_object3_for_id = [{'field': 'field_70', 'operator': 'is', 'value': student_email}]
        object3_response = get_knack_record("object_3", filters=filters_object3_for_id)
        
        user_accounts_list = [] # Initialize as an empty list
        if object3_response and isinstance(object3_response, dict) and 'records' in object3_response and isinstance(object3_response['records'], list):
            user_accounts_list = object3_response['records']
            app.logger.info(f"Found {len(user_accounts_list)} records in Object_3 for email {student_email}.")
        else:
            app.logger.warning(f"Object_3 response for email {student_email} was not in the expected format or missing 'records' list. Response: {str(object3_response)[:200]}")

        if user_accounts_list: # Check if the list is not empty
            # Ensure the first item is a dictionary before calling .get()
            if isinstance(user_accounts_list[0], dict):
                actual_student_object3_id = user_accounts_list[0].get('id')
                if actual_student_object3_id:
                    app.logger.info(f"Determined actual Object_3 ID for student ({student_name_for_profile_lookup}, {student_email}): {actual_student_object3_id}")
                else:
                    app.logger.warning(f"Found Object_3 record for {student_email}, but it has no 'id' attribute: {str(user_accounts_list[0])[:100]}")
            else:
                app.logger.warning(f"First item in user_accounts_list for {student_email} is not a dictionary: {type(user_accounts_list[0])} - {str(user_accounts_list[0])[:100]}")
        else:
            app.logger.warning(f"Could not find any Object_3 records for email {student_email} to get actual_student_object3_id.")
    else:
        app.logger.warning(f"No student email from Object_10, cannot determine actual_student_object3_id for profile lookup (Student Obj10 ID: {student_obj10_id_from_request}).")

    student_level = student_vespa_data.get("field_568_raw", "N/A") # Ensure student_level is defined here
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
    object29_top_bottom_questions = {
        "top_3": [],
        "bottom_3": []
    }
    all_scored_questions_from_object29 = []

    # Ensure student_vespa_data['id'] and current_m_cycle are valid before proceeding
    obj10_id_for_o29 = student_vespa_data.get('id')
    if obj10_id_for_o29 and current_m_cycle > 0:
        app.logger.info(f"Fetching Object_29 for Object_10 ID: {obj10_id_for_o29} and Cycle: {current_m_cycle}")
        filters_object29 = [
            {'field': 'field_792', 'operator': 'is', 'value': obj10_id_for_o29},
            {'field': 'field_863_raw', 'operator': 'is', 'value': str(current_m_cycle)}
        ]
        object29_response = get_knack_record("object_29", filters=filters_object29)
        
        temp_o29_list = [] # Use a temporary list variable
        if object29_response and isinstance(object29_response, dict) and 'records' in object29_response and isinstance(object29_response['records'], list):
            temp_o29_list = object29_response['records']
            app.logger.info(f"Found {len(temp_o29_list)} records in Object_29 for student {obj10_id_for_o29} and cycle {current_m_cycle}.")
        else:
            app.logger.warning(f"Object_29 response for student {obj10_id_for_o29} cycle {current_m_cycle} not in expected format or 'records' missing. Response: {str(object29_response)[:200]}")

        if temp_o29_list: # Check if the list is not empty
            # Ensure the first item is a dictionary before calling methods on it or accessing by index for safety
            if isinstance(temp_o29_list[0], dict):
                object29_record = temp_o29_list[0] # Assuming one record per student per cycle
                app.logger.info(f"Successfully fetched Object_29 record: {object29_record.get('id')}")
                
                parsed_insights = []
                if psychometric_question_details:
                    for q_detail in psychometric_question_details:
                        field_id = q_detail.get('currentCycleFieldId')
                        question_text = q_detail.get('questionText', 'Unknown Question')
                        vespa_category = q_detail.get('vespaCategory', 'N/A')
                        
                        if not field_id:
                            continue

                        raw_score_value = object29_record.get(field_id)
                        if raw_score_value is None and field_id.startswith("field_"):
                             score_obj = object29_record.get(field_id + '_raw')
                             if isinstance(score_obj, dict):
                                 raw_score_value = score_obj.get('value', 'N/A')
                             elif score_obj is not None:
                                 raw_score_value = score_obj
                        
                        score_display = "N/A"
                        numeric_score = None
                        if raw_score_value is not None and raw_score_value != 'N/A':
                            try:
                                numeric_score = int(raw_score_value)
                                score_display = str(numeric_score)
                            except (ValueError, TypeError):
                                score_display = str(raw_score_value)
                                app.logger.warning(f"Could not parse score '{raw_score_value}' for {field_id} to int.")

                        insight_text = f"{vespa_category} - '{question_text}': Score {score_display}/5"
                        if numeric_score is not None and numeric_score <= 2:
                            insight_text = f"FLAG: {insight_text}"
                        parsed_insights.append(insight_text)
                        
                        if numeric_score is not None:
                            all_scored_questions_from_object29.append({
                                "question_text": question_text,
                                "score": numeric_score,
                                "vespa_category": vespa_category
                            })
                    
                    if parsed_insights:
                        key_individual_question_insights = parsed_insights
                    else:
                        key_individual_question_insights = ["Could not parse any question details from Object_29 data."]
                    
                    if all_scored_questions_from_object29:
                        all_scored_questions_from_object29.sort(key=lambda x: x["score"])
                        object29_top_bottom_questions["bottom_3"] = [
                            {"text": q["question_text"], "score": q["score"], "category": q["vespa_category"]} 
                            for q in all_scored_questions_from_object29[:3]
                        ]
                        
                        all_scored_questions_from_object29.sort(key=lambda x: x["score"], reverse=True)
                        object29_top_bottom_questions["top_3"] = [
                            {"text": q["question_text"], "score": q["score"], "category": q["vespa_category"]}
                            for q in all_scored_questions_from_object29[:3]
                        ]
                        app.logger.info(f"Object_29 Top 3 questions: {object29_top_bottom_questions['top_3']}")
                        app.logger.info(f"Object_29 Bottom 3 questions: {object29_top_bottom_questions['bottom_3']}")
                    else:
                        app.logger.info("No numerically scored questions found in Object_29 to determine top/bottom.")
                else:
                    key_individual_question_insights = ["Psychometric question details mapping not loaded. Cannot process Object_29 data."]
            else:
                app.logger.warning(f"First item in fetched_o29_data_list for student {obj10_id_for_o29} cycle {current_m_cycle} is not a dictionary: {type(temp_o29_list[0])} - {str(temp_o29_list[0])[:100]}")
                key_individual_question_insights = [f"Object_29 data for cycle {current_m_cycle} is not in the expected dictionary format."]
        else:
            app.logger.warning(f"No data found in Object_29 for student {obj10_id_for_o29} and cycle {current_m_cycle}.")
            key_individual_question_insights = [f"No questionnaire data found for cycle {current_m_cycle}."]
            # Ensure object29_top_bottom_questions remains initialized with empty lists
    else:
        app.logger.warning("Missing Object_10 ID or current_m_cycle is 0, skipping Object_29 fetch.")
        key_individual_question_insights = ["Skipped fetching questionnaire data (missing ID or cycle is 0)."]
        # Ensure object29_top_bottom_questions remains initialized with empty lists


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
    academic_profile_summary_data = get_academic_profile(actual_student_object3_id, student_name_for_profile_lookup, student_obj10_id_from_request)

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
        "object29_question_highlights": object29_top_bottom_questions, # NEWLY ADDED
        "overall_framing_statement_for_tutor": overall_framing_statement, # Use populated statement
        "general_introductory_questions_for_tutor": general_intro_questions, # Use populated questions
        "llm_generated_summary_and_suggestions": {
            "conversation_openers": ["Let's talk about your VESPA scores. (Placeholder)"],
            "key_discussion_points": ["Consider your VESPA profile. (Placeholder)"],
            "suggested_next_steps_for_tutor": ["Discuss strategies based on the profile. (Placeholder)"]
        },
        "previous_interaction_summary": previous_interaction_summary,
        "school_vespa_averages": school_wide_vespa_averages # Add school averages to response
    }

    # Add LLM-generated summary (placeholder for now)
    llm_student_overview = generate_student_summary_with_llm(response_data) 
    response_data["llm_generated_summary_and_suggestions"]["student_overview_summary"] = llm_student_overview

    app.logger.info(f"Successfully prepared response for student_object10_record_id: {student_obj10_id_from_request}")
    return jsonify(response_data)

# --- Function to get School VESPA Averages ---
def get_school_vespa_averages(school_id):
    """Calculates and caches average VESPA scores for a given school ID."""
    if not school_id:
        app.logger.warning("get_school_vespa_averages called with no school_id.")
        return None

    # Check cache first
    cached_data = SCHOOL_AVERAGES_CACHE.get(school_id)
    if cached_data:
        if time.time() - cached_data['timestamp'] < CACHE_TTL_SECONDS:
            app.logger.info(f"Returning cached school VESPA averages for school_id: {school_id}")
            return cached_data['averages']
        else:
            app.logger.info(f"Cache expired for school_id: {school_id}")
            del SCHOOL_AVERAGES_CACHE[school_id]

    app.logger.info(f"Calculating school VESPA averages for school_id: {school_id}")
    
    filters_school_students_alt = [{'field': 'field_133', 'operator': 'is', 'value': school_id}]

    school_student_records = get_knack_record("object_10", filters=filters_school_students_alt)

    if not school_student_records:
        app.logger.warning(f"No student records found for school_id {school_id} using field_133 direct filter. Trying field_133_raw contains filter.")
        # Fallback to a 'contains' filter on field_133_raw which might be a string representation or part of a text field.
        # This is less precise and depends on how school IDs might be stored in field_133_raw if it's not a direct connection id.
        school_student_records = get_knack_record("object_10", filters=[{'field': 'field_133_raw', 'operator': 'contains', 'value': school_id}])
        if not school_student_records:
            app.logger.error(f"Could not retrieve any student records for school_id: {school_id} using multiple filter attempts. Cannot calculate averages.")
            return None
        app.logger.info(f"Retrieved {len(school_student_records)} student records for school_id {school_id} using fallback filter on field_133_raw.")
    else:
        app.logger.info(f"Retrieved {len(school_student_records)} student records for school_id {school_id} using direct field_133 filter.")

    vespa_elements = {
        "Vision": "field_147", "Effort": "field_148",
        "Systems": "field_149", "Practice": "field_150",
        "Attitude": "field_151"
    }
    sums = {key: 0 for key in vespa_elements}
    counts = {key: 0 for key in vespa_elements}

    for record in school_student_records:
        # Ensure record is a dictionary before trying to .get() from it
        if not isinstance(record, dict):
            app.logger.warning(f"Skipping a record in school_student_records because it is not a dictionary: {type(record)} - Content: {str(record)[:100]}...")
            continue # Skip this iteration if record is not a dict

        for element_name, field_key in vespa_elements.items():
            score_value = record.get(field_key)
            if score_value is not None:
                try:
                    score = float(score_value)
                    sums[element_name] += score
                    counts[element_name] += 1
                except (ValueError, TypeError):
                    app.logger.debug(f"Could not convert score '{score_value}' for {element_name} in record {record.get('id', 'N/A')} to float.")
    
    averages = {}
    for element_name in vespa_elements:
        if counts[element_name] > 0:
            averages[element_name] = round(sums[element_name] / counts[element_name], 2)
        else:
            averages[element_name] = 0 # Or None, or "N/A"
    
    app.logger.info(f"Calculated school VESPA averages for school_id {school_id}: {averages}")
    SCHOOL_AVERAGES_CACHE[school_id] = {'averages': averages, 'timestamp': time.time()}
    return averages

if __name__ == '__main__':
    # Ensure the FLASK_ENV is set to development for debug mode if not using `flask run`
    # For Heroku, Gunicorn will be used as specified in Procfile
    port = int(os.environ.get('PORT', 5001))
    # When running locally with `python app.py`, debug should be True.
    # Heroku will set PORT, and debug should ideally be False in production.
    is_local_run = __name__ == '__main__' and not os.environ.get('DYNO')
    app.run(debug=is_local_run, port=port, host='0.0.0.0') 