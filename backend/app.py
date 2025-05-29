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
import re

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

# --- Helper Functions (Defining load_json_file first) ---

def load_json_file(file_path):
    """Loads a JSON file from the specified path."""
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        full_path = os.path.join(current_dir, file_path)
        full_path = os.path.normpath(full_path)
        app.logger.info(f"Attempting to load JSON file from calculated path: {full_path}")
        with open(full_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and 'records' in data and isinstance(data['records'], list):
                app.logger.info(f"Extracted {len(data['records'])} records from JSON file: {full_path}")
                return data['records']
            app.logger.info(f"Loaded JSON file (not in Knack 'records' format): {full_path}")
            return data
    except FileNotFoundError:
        app.logger.error(f"Knowledge base file not found: {full_path}")
        return None
    except json.JSONDecodeError:
        app.logger.error(f"Error decoding JSON from file: {full_path}")
        return None
    except Exception as e:
        app.logger.error(f"An unexpected error occurred while loading JSON file {full_path}: {e}")
        return None

# --- Load Knowledge Bases (now after load_json_file is defined) ---
psychometric_question_details = load_json_file('knowledge_base/psychometric_question_details.json')
question_id_to_text_mapping = load_json_file('knowledge_base/question_id_to_text_mapping.json')
report_text_data = load_json_file('knowledge_base/reporttext.json')
coaching_kb = load_json_file('knowledge_base/coaching_questions_knowledge_base.json')
grade_points_mapping_data = load_json_file('knowledge_base/grade_to_points_mapping.json')
alps_bands_aLevel_60 = load_json_file('knowledge_base/alpsBands_aLevel_60.json')
alps_bands_aLevel_75 = load_json_file('knowledge_base/alpsBands_aLevel_75.json')
alps_bands_aLevel_90 = load_json_file('knowledge_base/alpsBands_aLevel_90.json')
alps_bands_aLevel_100 = load_json_file('knowledge_base/alpsBands_aLevel_100.json')
alps_bands_btec2010 = load_json_file('knowledge_base/alpsBands_btec2010_main.json')
alps_bands_btec2016 = load_json_file('knowledge_base/alpsBands_btec2016_main.json')
alps_bands_cache = load_json_file('knowledge_base/alpsBands_cache.json')
alps_bands_ib = load_json_file('knowledge_base/alpsBands_ib.json')
alps_bands_preU = load_json_file('knowledge_base/alpsBands_preU.json')
alps_bands_ual = load_json_file('knowledge_base/alpsBands_ual.json')
alps_bands_wjec = load_json_file('knowledge_base/alpsBands_wjec.json')

# --- Load New Knowledge Bases ---
COACHING_INSIGHTS_DATA = load_json_file('knowledge_base/coaching_insights.json')
VESPA_ACTIVITIES_DATA = load_json_file('knowledge_base/vespa_activities_kb.json')
REFLECTIVE_STATEMENTS_DATA = []
try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Adjusted path for 100_statements.txt to be relative to the 'backend' directory, then up one level to 'AIVESPACoach' and then into 'VESPA Contextual Information'
    # This matches the structure described in the handover: AIVESPACoach/VESPA Contextual Information/100 statements - 2023.txt
    # The app.py is in AIVESPACoach/backend/
    statements_file_path = os.path.join(current_dir, '..', 'VESPA Contextual Information', '100 statements - 2023.txt')
    statements_file_path = os.path.normpath(statements_file_path) # Normalize path
    app.logger.info(f"Attempting to load 100 statements from: {statements_file_path}")
    with open(statements_file_path, 'r', encoding='utf-8') as f:
        # Read lines, strip whitespace, and filter out empty lines
        REFLECTIVE_STATEMENTS_DATA = [line.strip() for line in f if line.strip()]
    app.logger.info(f"Successfully loaded {len(REFLECTIVE_STATEMENTS_DATA)} statements from '100 statements - 2023.txt'")
except FileNotFoundError:
    app.logger.error(f"'100 statements - 2023.txt' not found at {statements_file_path}.")
except Exception as e:
    app.logger.error(f"Error loading '100 statements - 2023.txt': {e}")


if not psychometric_question_details:
    app.logger.warning("Psychometric question details KB is empty or failed to load.")
if not question_id_to_text_mapping:
    app.logger.warning("Question ID to text mapping KB is empty or failed to load.")
if not report_text_data:
    app.logger.warning("Report text data (Object_33 from reporttext.json) is empty or failed to load.")
else:
    app.logger.info(f"Loaded {len(report_text_data)} records from reporttext.json")
if not coaching_kb:
    app.logger.warning("Coaching Questions Knowledge Base (coaching_questions_knowledge_base.json) is empty or failed to load.")
else:
    app.logger.info("Successfully loaded Coaching Questions Knowledge Base.")
if not grade_points_mapping_data:
    app.logger.error("CRITICAL: Grade to Points Mapping (grade_to_points_mapping.json) failed to load. Point calculations will be incorrect.")
else:
    app.logger.info("Successfully loaded Grade to Points Mapping.")

if not COACHING_INSIGHTS_DATA:
    app.logger.warning("Coaching Insights KB (coaching_insights.json) is empty or failed to load.")
else:
    app.logger.info(f"Successfully loaded {len(COACHING_INSIGHTS_DATA)} records from Coaching Insights KB.")

if not VESPA_ACTIVITIES_DATA:
    app.logger.warning("VESPA Activities KB (vespa_activities_kb.json) is empty or failed to load.")
else:
    app.logger.info(f"Successfully loaded {len(VESPA_ACTIVITIES_DATA)} records from VESPA Activities KB.")

if not REFLECTIVE_STATEMENTS_DATA:
    app.logger.warning("Reflective Statements (100_statements.txt) is empty or failed to load.")
else:
    # Already logged success or failure during loading
    pass


# --- Helper Functions ---

def normalize_qualification_type(exam_type_str):
    if not exam_type_str:
        return "A Level" 
    lower_exam_type = exam_type_str.lower()
    if "a level" in lower_exam_type or "alevel" in lower_exam_type:
        return "A Level"
    if "as level" in lower_exam_type or "aslevel" in lower_exam_type:
        return "AS Level"
    if "btec" in lower_exam_type:
        if "extended diploma" in lower_exam_type or "ext dip" in lower_exam_type:
            return "BTEC Level 3 Extended Diploma"
        if "diploma" in lower_exam_type and "subsidiary" not in lower_exam_type and "found" not in lower_exam_type and "extended" not in lower_exam_type: 
            return "BTEC Level 3 Diploma"
        if "subsidiary diploma" in lower_exam_type or "sub dip" in lower_exam_type:
            return "BTEC Level 3 Subsidiary Diploma"
        return "BTEC Level 3 Extended Certificate" 
    if "wjec" in lower_exam_type:
        if "diploma" in lower_exam_type or "dip" in lower_exam_type:
            return "WJEC Level 3 Diploma"
        return "WJEC Level 3 Certificate"
    if "cache" in lower_exam_type:
        if "extended diploma" in lower_exam_type or "ext dip" in lower_exam_type:
            return "CACHE Level 3 Extended Diploma"
        if "diploma" in lower_exam_type: 
            return "CACHE Level 3 Diploma"
        if "award" in lower_exam_type:
            return "CACHE Level 3 Award"
        return "CACHE Level 3 Certificate"
    if "ual" in lower_exam_type:
        if "extended diploma" in lower_exam_type or "ext dip" in lower_exam_type:
            return "UAL Level 3 Extended Diploma"
        return "UAL Level 3 Diploma"
    if "ib" in lower_exam_type:
        if "hl" in lower_exam_type or "higher" in lower_exam_type: return "IB HL"
        if "sl" in lower_exam_type or "standard" in lower_exam_type: return "IB SL"
        app.logger.warning(f"IB qualification type '{exam_type_str}' did not specify HL/SL. Defaulting to 'IB HL'.")
        return "IB HL" 
    if "pre-u" in lower_exam_type or "preu" in lower_exam_type:
        if "short course" in lower_exam_type or "sc" in lower_exam_type:
             return "Pre-U Short Course"
        return "Pre-U Principal Subject"
    try:
        app.logger.warning(f"Could not normalize qualification type: '{exam_type_str}', defaulting to 'A Level'.")
    except RuntimeError: 
        print(f"WARNING (normalize_qualification_type): Could not normalize qualification type: '{exam_type_str}', defaulting to 'A Level'. Logger unavailable.")
    return "A Level"

def extract_qual_details(exam_type_str, normalized_qual_type, app_logger):
    if not exam_type_str or not normalized_qual_type:
        return None
    lower_exam_type = exam_type_str.lower()
    details = {}
    if normalized_qual_type == "IB HL":
        details['ib_level'] = "HL"
        return details
    if normalized_qual_type == "IB SL":
        details['ib_level'] = "SL"
        return details
    if "BTEC" in normalized_qual_type:
        if "2010" in lower_exam_type: details['year'] = "2010"
        elif "2016" in lower_exam_type: details['year'] = "2016"
        else:
            details['year'] = "2016" 
            app_logger.info(f"BTEC year not specified in '{exam_type_str}', defaulting to {details['year']} for MEG lookup.")
        if normalized_qual_type == "BTEC Level 3 Extended Diploma": details['size'] = "EXTDIP"
        elif normalized_qual_type == "BTEC Level 3 Diploma": details['size'] = "DIP"
        elif normalized_qual_type == "BTEC Level 3 Subsidiary Diploma": details['size'] = "SUBDIP"
        elif normalized_qual_type == "BTEC Level 3 Extended Certificate":
            if details['year'] == "2010":
                details['size'] = "CERT"
            else: 
                details['size'] = "EXTCERT"
        elif "foundation diploma" in lower_exam_type : details['size'] = "FOUNDDIP"
        elif "90 credit diploma" in lower_exam_type or "90cr" in lower_exam_type : details['size'] = "NINETY_CR"
        if not details.get('size'):
             app_logger.warning(f"Could not determine BTEC size for MEG key from '{exam_type_str}' (Normalized: '{normalized_qual_type}'). MEG lookup might fail.")
        return details
    if normalized_qual_type == "Pre-U Principal Subject":
        details['pre_u_type'] = "FULL"
        return details
    if normalized_qual_type == "Pre-U Short Course":
        details['pre_u_type'] = "SC"
        return details
    if "WJEC" in normalized_qual_type:
        if normalized_qual_type == "WJEC Level 3 Diploma": details['wjec_size'] = "DIP"
        elif normalized_qual_type == "WJEC Level 3 Certificate": details['wjec_size'] = "CERT"
        else:
            details['wjec_size'] = "CERT" 
            app_logger.info(f"WJEC size not clearly diploma/certificate from '{normalized_qual_type}', defaulting to CERT for MEG lookup.")
        return details
    return None

def get_points(normalized_qual_type, grade_str, grade_points_map_data, app_logger):
    if not grade_points_map_data:
        app_logger.error("get_points: grade_points_mapping_data is not loaded.")
        return 0
    if not normalized_qual_type:
        app_logger.warning("get_points: normalized_qual_type is missing.")
        return 0
    if grade_str is None: 
        app_logger.warning(f"get_points: grade_str is None for qualification '{normalized_qual_type}'.")
        grade_str = "U" 
    qual_map = grade_points_map_data.get(normalized_qual_type)
    if not qual_map:
        app_logger.warning(f"get_points: No grade point mapping found for qualification type: '{normalized_qual_type}'.")
        return 0
    grade_str_cleaned = str(grade_str).strip()
    points = qual_map.get(grade_str_cleaned)
    if points is None:
        if grade_str_cleaned == "Dist*": points = qual_map.get("D*")
        elif grade_str_cleaned == "Dist": points = qual_map.get("D")
        elif grade_str_cleaned == "Merit": points = qual_map.get("M")
        elif grade_str_cleaned == "Pass": points = qual_map.get("P")
        if points is None: 
            app_logger.warning(f"get_points: No points found for grade '{grade_str_cleaned}' (original: '{grade_str}') in qualification '{normalized_qual_type}'. Available grades: {list(qual_map.keys())}. Returning 0 points.")
            return 0
    return int(points)


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
                    academic_profile_record = None # Keep it None to fall through
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3064) has valid subjects. Using this profile.")
                    return {"subjects": subjects_summary, "profile_record": academic_profile_record} # MODIFIED RETURN
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
                    academic_profile_record = None # Keep it None to fall through
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via field_3070) has valid subjects. Using this profile.")
                    return {"subjects": subjects_summary, "profile_record": academic_profile_record} # MODIFIED RETURN
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
                    # Fall through to the final default return
                else:
                    app.logger.info(f"Object_112 ID {academic_profile_record.get('id')} (via name fallback) has valid subjects. Using this profile.")
                    return {"subjects": subjects_summary, "profile_record": academic_profile_record} # MODIFIED RETURN
            else:
                app.logger.warning(f"Attempt 3: First item in homepage_profiles_name_search is not a dict: {type(temp_profiles_list_attempt3[0])}")
        else:
            app.logger.warning(f"Attempt 3 FAILED (empty list): Fallback search: No Object_112 found for student name: '{student_name_for_fallback}'.")
    
    app.logger.warning(f"All attempts to fetch Object_112 failed (Student's Obj3 ID: '{actual_student_obj3_id}', Fallback name: '{student_name_for_fallback}').")
    default_subjects = [{"subject": "Academic profile not found by any method.", "currentGrade": "N/A", "targetGrade": "N/A", "effortGrade": "N/A", "examType": "N/A"}]
    return {"subjects": default_subjects, "profile_record": None} # MODIFIED RETURN


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
                    "effortGrade": subject_data.get("effortGrade") or subject_data.get("effort_grade") or subject_data.get("eg") or subject_data.get("effortgrade", "N/A"),
                    "examType": subject_data.get("examType") or subject_data.get("exam_type") or subject_data.get("qualificationType", "N/A") # Added examType
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


# --- Function to Generate Student Summary with LLM (Now with active LLM call) ---
def generate_student_summary_with_llm(student_data_dict, coaching_kb_data, student_goals_statements_text, all_scored_questionnaire_statements=None): # Added all_scored_questionnaire_statements
    app.logger.info(f"Attempting to generate LLM summary for student: {student_data_dict.get('student_name', 'N/A')}")
    
    if not OPENAI_API_KEY:
        app.logger.error("OpenAI API key is not configured. Cannot generate LLM summary.")
        return {
            "student_overview_summary": f"LLM summary for {student_data_dict.get('student_name', 'N/A')} is unavailable (AI key not configured).",
            "chart_comparative_insights": "Insights unavailable (AI key not configured).",
            "most_important_coaching_questions": ["Coaching questions unavailable (AI key not configured)."],
            "student_comment_analysis": "Comment analysis unavailable (AI key not configured).",
            "suggested_student_goals": ["Goal suggestions unavailable (AI key not configured)."],
            # ADDED: Default for new key
            "questionnaire_interpretation_and_reflection_summary": "Questionnaire interpretation unavailable (AI key not configured)."
        }

    student_level = student_data_dict.get('student_level', 'N/A')
    student_name = student_data_dict.get('student_name', 'Unknown Student')
    current_cycle = student_data_dict.get('current_cycle', 'N/A')
    school_averages = student_data_dict.get('school_vespa_averages') # Expects dict like {"Vision": 7.5, ...}
    vespa_profile_for_rag = student_data_dict.get('vespa_profile', {}) # Used for RAG

    # Construct a detailed prompt for the LLM
    prompt_parts = []
    prompt_parts.append(f"The following data is for student '{student_name}' (Level: {student_level}, Current Cycle: {current_cycle}).")

    # VESPA Profile
    prompt_parts.append("\n--- Student's Current VESPA Profile (Vision, Effort, Systems, Practice, Attitude) ---")
    if student_data_dict.get('vespa_profile'):
        for element, details in student_data_dict['vespa_profile'].items():
            if element == "Overall": continue # Skip overall for this detailed student section
            prompt_parts.append(f"- {element}: Score {details.get('score_1_to_10', 'N/A')}/10 ({details.get('score_profile_text', 'N/A')})")
            # We will refer to tutor notes/report text later if needed for goal generation, but not for the main summary to LLM

    # School VESPA Averages (if available)
    if school_averages:
        prompt_parts.append("\n--- School's Average VESPA Scores (For Comparison) ---")
        for element, avg_score in school_averages.items():
            prompt_parts.append(f"- {element} (School Avg): {avg_score}/10")
    else:
        prompt_parts.append("\n--- School's Average VESPA Scores ---")
        prompt_parts.append("  School-wide average VESPA scores are not available for comparison at this time.")

    # Academic Profile (Briefly)
    prompt_parts.append("\n--- Academic Profile (First 3 Subjects with 75th Percentile MEG) ---")
    if student_data_dict.get('academic_profile_summary'):
        profile_data = student_data_dict['academic_profile_summary']
        if isinstance(profile_data, list) and profile_data and profile_data[0].get('subject') and not profile_data[0]["subject"].startswith("Academic profile not found") and not profile_data[0]["subject"].startswith("No academic subjects"):
            for subject_info in profile_data[:3]:
                meg_75th_text = f", MEG (75th Pct): {subject_info.get('meg_75th', 'N/A')}" if subject_info.get('meg_75th') else ""
                prompt_parts.append(f"- Subject: {subject_info.get('subject', 'N/A')}, Current: {subject_info.get('currentGrade', 'N/A')}, Target: {subject_info.get('targetGrade', 'N/A')}{meg_75th_text}, Effort: {subject_info.get('effortGrade', 'N/A')}")
        else:
            prompt_parts.append("  No detailed academic profile summary available or profile indicates issues.")
    
    # Student's Prior Attainment and MEGs
    if student_data_dict.get('academic_megs'):
        meg_data = student_data_dict['academic_megs']
        prompt_parts.append("\n--- Student's Academic Benchmarks (MEGs based on Prior Attainment) ---")
        prompt_parts.append(f"  GCSE Prior Attainment Score: {meg_data.get('prior_attainment_score', 'N/A')}")
        prompt_parts.append(f"  MEG @ 60th Percentile: {meg_data.get('meg_60th', 'N/A')}")
        prompt_parts.append(f"  MEG @ 75th Percentile (Standard Target): {meg_data.get('meg_75th', 'N/A')}")
        prompt_parts.append(f"  MEG @ 90th Percentile: {meg_data.get('meg_90th', 'N/A')}")
        prompt_parts.append(f"  MEG @ 100th Percentile: {meg_data.get('meg_100th', 'N/A')}")
    else:
        prompt_parts.append("\n--- Student's Academic Benchmarks (MEGs based on Prior Attainment) ---")
        prompt_parts.append("  Prior attainment score or MEG data not available.")

    # Reflections and Goals (Current Cycle Focus)
    prompt_parts.append("\n--- Student Reflections & Goals (Current Cycle Focus) ---")
    reflections_goals_found = False
    current_rrc_text = "Not specified"
    current_goal_text = "Not specified"
    if student_data_dict.get('student_reflections_and_goals'):
        reflections = student_data_dict['student_reflections_and_goals']
        current_rrc_key = f"rrc{current_cycle}_comment"
        current_goal_key = f"goal{current_cycle}"

        if reflections.get(current_rrc_key) and reflections[current_rrc_key] != "Not specified":
            current_rrc_text = str(reflections[current_rrc_key])
            # Clean text before using in f-string
            cleaned_rrc_text_for_prompt = current_rrc_text[:300].replace('\n', ' ')
            prompt_parts.append(f"- Current Reflection (RRC{current_cycle}): {cleaned_rrc_text_for_prompt}...")
            reflections_goals_found = True
        if reflections.get(current_goal_key) and reflections[current_goal_key] != "Not specified":
            current_goal_text = str(reflections[current_goal_key])
            # Clean text before using in f-string
            cleaned_goal_text_for_prompt = current_goal_text[:300].replace('\n', ' ')
            prompt_parts.append(f"- Current Goal ({current_goal_key.replace('_',' ').upper()}): {cleaned_goal_text_for_prompt}...")
            reflections_goals_found = True
        
        if not reflections_goals_found: # Fallback to RRC1/Goal1 if current cycle ones are not found
            if reflections.get('rrc1_comment') and reflections['rrc1_comment'] != "Not specified":
                current_rrc_text = str(reflections['rrc1_comment'])
                cleaned_rrc_text_for_prompt = current_rrc_text[:300].replace('\n', ' ')
                prompt_parts.append(f"- RRC1 Reflection (Fallback): {cleaned_rrc_text_for_prompt}...")
                reflections_goals_found = True
            if reflections.get('goal1') and reflections['goal1'] != "Not specified":
                current_goal_text = str(reflections['goal1'])
                cleaned_goal_text_for_prompt = current_goal_text[:300].replace('\n', ' ')
                prompt_parts.append(f"- Goal1 (Fallback): {cleaned_goal_text_for_prompt}...")
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
        
    # Top and Bottom 3 questions from Object_29
    prompt_parts.append("\n--- Top & Bottom Scoring Questionnaire Questions (Object_29) ---")
    obj29_highlights = student_data_dict.get("object29_question_highlights")
    if obj29_highlights:
        if obj29_highlights.get("top_3") and obj29_highlights["top_3"]:
            prompt_parts.append("  Top Scoring Questions (1-5 scale):")
            for q_data in obj29_highlights["top_3"]:
                prompt_parts.append(f"    - Score {q_data['score']}/5 ({q_data['category']}): \"{q_data['text']}\"")
        if obj29_highlights.get("bottom_3") and obj29_highlights["bottom_3"]:
            prompt_parts.append("  Bottom Scoring Questions (1-5 scale):")
            for q_data in obj29_highlights["bottom_3"]:
                prompt_parts.append(f"    - Score {q_data['score']}/5 ({q_data['category']}): \"{q_data['text']}\"")
    else:
        prompt_parts.append("  No top/bottom question highlight data processed for Object_29.")
        
    # ADDED: Overall Questionnaire Statement Response Distribution
    prompt_parts.append("\n--- Overall Questionnaire Statement Response Distribution (Object_29 from 'all_scored_questionnaire_statements') ---")
    if all_scored_questionnaire_statements and isinstance(all_scored_questionnaire_statements, list):
        response_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for q_data in all_scored_questionnaire_statements:
            score = q_data.get("score")
            if score in response_counts:
                response_counts[score] += 1
        prompt_parts.append(f"  - Response '1' (e.g., Strongly Disagree): {response_counts[1]} statements")
        prompt_parts.append(f"  - Response '2': {response_counts[2]} statements")
        prompt_parts.append(f"  - Response '3': {response_counts[3]} statements")
        prompt_parts.append(f"  - Response '4': {response_counts[4]} statements")
        prompt_parts.append(f"  - Response '5' (e.g., Strongly Agree): {response_counts[5]} statements")
    else:
        prompt_parts.append("  Detailed questionnaire response distribution data (all_scored_questionnaire_statements) is not available or not in the expected list format.")

    # Previous Interaction Summary
    prev_summary = student_data_dict.get('previous_interaction_summary')
    if prev_summary and prev_summary != "No previous AI coaching summary found.":
        prompt_parts.append("\n--- Previous AI Interaction Summary (For Context) ---")
        prev_summary_clean = str(prev_summary)[:300].replace('\n', ' ')
        prompt_parts.append(f"  {prev_summary_clean}...")

    prompt_parts.append("\n\n--- TASKS FOR THE AI ACADEMIC MENTOR ---")
    prompt_parts.append("Based ONLY on the data provided above for the student, and the knowledge base excerpts below, provide the following insights for the student's TUTOR. ")
    prompt_parts.append("The tone should be objective, analytical, and supportive, aimed at helping the tutor quickly grasp the student's profile to effectively prepare for a coaching conversation focused on student ownership.")
    prompt_parts.append("IMPORTANT: Do NOT directly ask questions TO THE STUDENT or give direct advice TO THE STUDENT in your outputs. Instead, provide insights and talking points that will help the TUTOR facilitate these conversations effectively. Do not use conversational filler like 'Okay, let's look at...'.")
    prompt_parts.append("Format your entire response as a single JSON object with the following EXACT keys: \"student_overview_summary\", \"chart_comparative_insights\", \"most_important_coaching_questions\", \"student_comment_analysis\", \"suggested_student_goals\", \"academic_benchmark_analysis\", \"questionnaire_interpretation_and_reflection_summary\".") # ADDED new key
    prompt_parts.append("Ensure all string values within the JSON are properly escaped.")

    # --- RAG for Coaching Suggestions and Goals (within generate_student_summary_with_llm) ---
    retrieved_rag_items_for_prompt_structured = {
        "insights": [],
        "activities": [],
        "statements": []
    }
    lowest_vespa_element = None
    lowest_score = 11 # Initialize with a score higher than max VESPA score
    if vespa_profile_for_rag:
        for element, details in vespa_profile_for_rag.items():
            if element == "Overall": continue
            try:
                score = float(details.get('score_1_to_10', 10))
                if score < lowest_score:
                    lowest_score = score
                    lowest_vespa_element = element
            except (ValueError, TypeError):
                pass # Ignore if score is not a number

    if lowest_vespa_element:
        app.logger.info(f"Lowest VESPA element for RAG: {lowest_vespa_element} (Score: {lowest_score})")
        # Retrieve from COACHING_INSIGHTS_DATA
        if COACHING_INSIGHTS_DATA:
            for insight in COACHING_INSIGHTS_DATA:
                if lowest_vespa_element.lower() in str(insight.get('keywords', [])).lower() or lowest_vespa_element.lower() in insight.get('name', '').lower():
                    retrieved_rag_items_for_prompt_structured["insights"].append(f"Insight: '{insight.get('name')}' - Description: {insight.get('description', '')[:120]}... (Implications: {insight.get('implications_for_tutor', '')[:100]}...)")
                    if len(retrieved_rag_items_for_prompt_structured["insights"]) >= 1: break
        
        # Retrieve from VESPA_ACTIVITIES_DATA
        if VESPA_ACTIVITIES_DATA:
            for activity in VESPA_ACTIVITIES_DATA:
                if lowest_vespa_element.lower() == activity.get('vespa_element', '').lower(): # Match on element
                    retrieved_rag_items_for_prompt_structured["activities"].append(f"Activity: '{activity.get('name')}' (VESPA: {activity.get('vespa_element')}, ID: {activity.get('id')}) - Summary: {activity.get('short_summary', '')[:120]}... Link: {activity.get('pdf_link')}")
                    if len(retrieved_rag_items_for_prompt_structured["activities"]) >= 1: break

        # Retrieve from REFLECTIVE_STATEMENTS_DATA (simple match for now)
        if REFLECTIVE_STATEMENTS_DATA:
            for statement in REFLECTIVE_STATEMENTS_DATA:
                # A more robust category check would be better if statements are structured with categories
                if lowest_vespa_element.lower() in statement.lower(): 
                    retrieved_rag_items_for_prompt_structured["statements"].append(f"Reflective Statement: '{statement[:150]}...'")
                    if len(retrieved_rag_items_for_prompt_structured["statements"]) >= 1: break
    
    if any(retrieved_rag_items_for_prompt_structured.values()):
        prompt_parts.append("\n\n--- Dynamically Retrieved Context (Strongly consider these for formulating Most Important Coaching Questions and Suggested Student Goals) ---")
        prompt_parts.append(f"The student\'s lowest VESPA score is in '{lowest_vespa_element}'. Based on this, please incorporate the following into your suggestions:")
        if retrieved_rag_items_for_prompt_structured["insights"]:
            prompt_parts.append("\nRelevant Coaching Insight(s):")
            prompt_parts.extend(retrieved_rag_items_for_prompt_structured["insights"])
        if retrieved_rag_items_for_prompt_structured["activities"]:
            prompt_parts.append("\nRelevant VESPA Activity/ies (Include name and ID if suggesting one):")
            prompt_parts.extend(retrieved_rag_items_for_prompt_structured["activities"])
        if retrieved_rag_items_for_prompt_structured["statements"]:
            prompt_parts.append("\nRelevant Reflective Statement(s) to adapt:")
            prompt_parts.extend(retrieved_rag_items_for_prompt_structured["statements"])
        prompt_parts.append("Tailor your coaching questions and goal suggestions to be practical and actionable, leveraging these specific resources.")

    # --- Include Divers vs. Thrivers insight for comment analysis --- 
    divers_thrivers_insight_text = ""
    if COACHING_INSIGHTS_DATA:
        for insight in COACHING_INSIGHTS_DATA:
            if insight.get('id') == 'divers_thrivers_loc':
                divers_thrivers_insight_text = f"When analyzing comments, pay special attention to the 'Divers vs. Thrivers: Locus of Control' insight: {insight.get('description', '')} Implication: {insight.get('implications_for_tutor', '')}"
                break
    if divers_thrivers_insight_text:
        # Add this specifically to the description of the student_comment_analysis task
        # This requires finding where student_comment_analysis is defined in the prompt_parts for the JSON structure
        # For now, I'll add it as a general instruction before the JSON output structure definition.
        prompt_parts.append(f"\n\n--- Special Instruction for Student Comment Analysis ---")
        prompt_parts.append(divers_thrivers_insight_text)


    prompt_parts.append("\n\n--- Knowledge Base: Coaching Questions (Excerpt) ---")
    prompt_parts.append("Use these to select questions. Consider student's level, VESPA scores, and academic performance relative to MEGs.") # Added academic context
    # Simplified coaching_kb injection for brevity in prompt - real version would be more selective or summarized
    if coaching_kb_data:
        general_q = coaching_kb_data.get('generalIntroductoryQuestions', [])
        if general_q:
            prompt_parts.append("General Introductory Questions:")
            for q_text in general_q[:2]: prompt_parts.append(f"- {q_text}") # Limit for prompt
        
        vespa_q = coaching_kb_data.get('vespaSpecificCoachingQuestions', {})
        if vespa_q.get("Vision") and vespa_q["Vision"].get(student_level):
            prompt_parts.append(f"Vision Questions ({student_level}):")
            for q_text in vespa_q["Vision"][student_level].get("Low", [])[:1]: prompt_parts.append(f"- {q_text}") # Example
    else:
        prompt_parts.append("Coaching questions knowledge base not available for this request.")


    prompt_parts.append("\n\n--- Knowledge Base: Reflective Statements (Excerpt - for inspiration) ---")
    prompt_parts.append("Use these statements as INSPIRATION when formulating suggested goals. Do not just copy them. Reframe them based on the student's specific context.")
    if REFLECTIVE_STATEMENTS_DATA: # Use the new global variable
        # Include a small, relevant snippet of the statements
        snippet = "\n".join(REFLECTIVE_STATEMENTS_DATA[:5]) # First 5 statements, escaped for JSON in prompt
        prompt_parts.append(snippet + "\n...")
    else:
        prompt_parts.append("Reflective statements knowledge base not available for this request.")

    prompt_parts.append("\n\n--- REQUIRED OUTPUT STRUCTURE (JSON Object) ---")
    prompt_parts.append("Please provide your response as a single, valid JSON object. Example:")
    prompt_parts.append("'''")
    prompt_parts.append("{")
    prompt_parts.append("  \"student_overview_summary\": \"Concise 2-3 sentence AI Student Snapshot for the tutor, highlighting 1-2 key strengths and 1-2 primary areas for development, rooted in VESPA principles. Max 100-120 words.\",")
    prompt_parts.append("  \"chart_comparative_insights\": \"Provide 2-3 bullet points or a short paragraph (max 80 words) analyzing the student\\'s VESPA scores in comparison to school averages (if available). What could these differences or similarities mean?\",")
    prompt_parts.append("  \"most_important_coaching_questions\": [\"Based on the student\\'s profile (scores, level, comments, academic performance vs MEGs), list 3-5 most impactful coaching questions selected from the provided Coaching Questions Knowledge Base.\", \"Question 2...\"],")
    prompt_parts.append("  \"student_comment_analysis\": \"Analyze the student\\'s RRC/Goal comments (text provided: RRC='{RRC_COMMENT_PLACEHOLDER}', Goal='{GOAL_COMMENT_PLACEHOLDER}'). What insights can be gained? Specifically look for language indicating locus of control (e.g., 'receive a grade' vs 'achieve a grade'). Max 100 words.\",")
    prompt_parts.append("  \"suggested_student_goals\": [\"Based on the analysis, and inspired by the 100 Statements KB, suggest 2-3 S.M.A.R.T. goals for the student, reframed to their context.\", \"Goal 2...\"]," )
    prompt_parts.append("  \"academic_benchmark_analysis\": \"Provide a supportive and encouraging analysis (approx. 150-180 words) of the student's academic performance. Start by looking at their current grades in relation to their Subject Target Grades (STGs) and their 75th percentile Minimum Expected Grades (MEGs). Explain to the tutor that MEGs are derived from national data for students with similar prior GCSE attainment, representing what the top 25% achieve and are thus aspirational. Note that MEGs are a baseline and don't account for subject-specific difficulty, individual student factors, or wider context. Then, explain that the STG is a more nuanced target, calculated by applying a subject-specific Value Added (VA) factor to the MEG. This VA factor (e.g., 1.05 for Further Maths, 0.90 for Biology) adjusts for the typical grade distribution and relative difficulty of a subject, aiming for fairer, more realistic targets. Emphasize that the comparison between current grades, MEGs, and STGs should foster a positive discussion about the student's progress, strengths, and potential next steps. Crucially, advise the tutor that while these benchmarks are informative, the most effective targets consider all factors: prior attainment, subject difficulty, individual student needs, and school context. The goal is to use this information to identify areas for support or challenge, always contextualized within a broader understanding of the student.\",") # Ensure comma if not last
    prompt_parts.append("  \"questionnaire_interpretation_and_reflection_summary\": \"Provide a concise summary (approx. 100-150 words) interpreting the overall distribution of the student's questionnaire responses (e.g., tendencies towards 'Strongly Disagree' or 'Strongly Agree', as indicated by the counts of 1s, 2s, etc., from 'Overall Questionnaire Statement Response Distribution' provided above). Highlight any notable patterns, such as a concentration of low or high responses in specific VESPA elements (refer to the Top/Bottom scoring statements for VESPA categories from 'Top & Bottom Scoring Questionnaire Questions'). Also, briefly compare and contrast these questionnaire insights with the student's own RRC/Goal comments (text provided: RRC='{RRC_COMMENT_PLACEHOLDER}', Goal='{GOAL_COMMENT_PLACEHOLDER}'), noting any consistencies or discrepancies that could be valuable for the tutor to explore.\",") # ADDED new key & description
    prompt_parts.append("}")
    prompt_parts.append("'''")
    # Prepare cleaned versions of current_rrc_text and current_goal_text for the prompt placeholder replacement
    cleaned_rrc_placeholder = current_rrc_text[:100].replace('\n', ' ').replace("'", "\\'").replace('"', '\\"')
    cleaned_goal_placeholder = current_goal_text[:100].replace('\n', ' ').replace("'", "\\'").replace('"', '\\"')
    prompt_parts.append(f"REMEMBER to replace RRC_COMMENT_PLACEHOLDER with: '{cleaned_rrc_placeholder}...' and GOAL_COMMENT_PLACEHOLDER with: '{cleaned_goal_placeholder}...' in your actual student_comment_analysis output.")


    prompt_to_send = "\n".join(prompt_parts)
    # Ensure the placeholders are correctly substituted in the final prompt string itself.
    # The placeholders in the prompt_to_send string are 'RRC_COMMENT_PLACEHOLDER' and 'GOAL_COMMENT_PLACEHOLDER'
    prompt_to_send = prompt_to_send.replace("'{RRC_COMMENT_PLACEHOLDER}'", f"'{cleaned_rrc_placeholder}...'")
    prompt_to_send = prompt_to_send.replace("'{GOAL_COMMENT_PLACEHOLDER}'", f"'{cleaned_goal_placeholder}...'")


    app.logger.info(f"Generated LLM Prompt (first 500 chars): {prompt_to_send[:500]}")
    app.logger.info(f"Generated LLM Prompt (last 500 chars): {prompt_to_send[-500:]}")
    app.logger.info(f"Total LLM Prompt length: {len(prompt_to_send)} characters")

    system_message_content = (
        f"You are a professional academic mentor with significant experience working with school-age students, "
        f"specifically at {student_level}. Your responses should reflect this understanding. You are assisting a tutor "
        f"who is preparing for a coaching session with {student_name}, guided by the VESPA framework. "
        f"The tutor aims to foster student ownership, encourage self-reflection, and co-create action plans. "
        f"Your role is to provide concise, data-driven, structured insights to the TUTOR in JSON format."
    )

    max_retries = 2
    for attempt in range(max_retries):
        try:
            response = openai.chat.completions.create(
                model="gpt-3.5-turbo", 
                messages=[
                    {"role": "system", "content": system_message_content},
                    {"role": "user", "content": prompt_to_send}
                ],
                # max_tokens set to a higher value to accommodate the detailed JSON structure
                max_tokens=700, # Increased from 120
                temperature=0.5, # Slightly lower for more factual JSON
                n=1,
                stop=None,
                # Ensure the model is encouraged to output JSON
                response_format={"type": "json_object"} 
            )
            
            raw_response_content = response.choices[0].message.content.strip()
            app.logger.info(f"LLM raw response: {raw_response_content}")

            # Attempt to parse the JSON
            parsed_llm_outputs = json.loads(raw_response_content)
            
            # Validate that all expected keys are in the parsed dictionary
            expected_keys = ["student_overview_summary", "chart_comparative_insights", "most_important_coaching_questions", "student_comment_analysis", "suggested_student_goals", "academic_benchmark_analysis", "questionnaire_interpretation_and_reflection_summary"] # ADDED new key
            if not all(key in parsed_llm_outputs for key in expected_keys):
                app.logger.error(f"LLM response missing one or more expected keys. Response: {raw_response_content}")
                # If keys are missing, construct a default error structure for those keys
                # but keep any keys that *were* successfully returned.
                default_error_response = {
                    "student_overview_summary": "Error: LLM did not provide a valid overview.",
                    "chart_comparative_insights": "Error: LLM did not provide valid chart insights.",
                    "most_important_coaching_questions": ["Error: LLM did not provide valid questions."],
                    "student_comment_analysis": "Error: LLM did not provide valid comment analysis.",
                    "suggested_student_goals": ["Error: LLM did not provide valid goal suggestions."],
                    "academic_benchmark_analysis": "Error: LLM did not provide valid academic benchmark analysis.",
                    "questionnaire_interpretation_and_reflection_summary": "Error: LLM did not provide questionnaire interpretation." # ADDED new key error
                }
                # Update with any valid parts from the LLM, then fill missing with errors
                for key in expected_keys:
                    if key not in parsed_llm_outputs:
                        parsed_llm_outputs[key] = default_error_response[key]
                # No need to raise an exception here, just return the partially error-filled dict
            
            app.logger.info(f"LLM generated structured data: {parsed_llm_outputs}")
            return parsed_llm_outputs

        except json.JSONDecodeError as e:
            app.logger.error(f"JSONDecodeError from LLM response (Attempt {attempt + 1}/{max_retries}): {e}")
            app.logger.error(f"Problematic LLM response content: {raw_response_content}")
            if attempt == max_retries - 1: # Last attempt
                return {
                    "student_overview_summary": f"Error: Could not parse LLM summary for {student_name} after multiple attempts. (JSONDecodeError)",
                    "chart_comparative_insights": "Error parsing LLM response.",
                    "most_important_coaching_questions": ["Error parsing LLM response."],
                    "student_comment_analysis": "Error parsing LLM response.",
                    "suggested_student_goals": ["Error parsing LLM response."],
                    "academic_benchmark_analysis": "Error parsing LLM response.",
                    "questionnaire_interpretation_and_reflection_summary": "Error parsing LLM response." # ADDED
                }
        except Exception as e:
            app.logger.error(f"Error calling OpenAI API or processing response (Attempt {attempt + 1}/{max_retries}): {e}")
            if attempt == max_retries - 1: # Last attempt
                 return {
                    "student_overview_summary": f"Error generating structured summary for {student_name} from LLM. (Details: {str(e)[:100]}...)",
                    "chart_comparative_insights": "Error generating insights from LLM.",
                    "most_important_coaching_questions": ["Error generating questions from LLM."],
                    "student_comment_analysis": "Error generating analysis from LLM.",
                    "suggested_student_goals": ["Error generating goals from LLM."],
                    "academic_benchmark_analysis": "Error generating academic benchmark analysis from LLM.",
                    "questionnaire_interpretation_and_reflection_summary": "Error generating questionnaire interpretation from LLM." # ADDED
                }
        time.sleep(1) # Wait a second before retrying if an error occurred

    # Fallback if all retries fail (though individual try/excepts should handle returning)
    return {
        "student_overview_summary": "Critical error: LLM processing failed after all retries.",
        "chart_comparative_insights": "Critical error.",
        "most_important_coaching_questions": ["Critical error."],
        "student_comment_analysis": "Critical error.",
        "suggested_student_goals": ["Critical error."],
        "academic_benchmark_analysis": "Critical error.",
        "questionnaire_interpretation_and_reflection_summary": "Critical error." # ADDED
    }


# --- Helper function to get MEG from prior attainment ---
def get_meg_for_prior_attainment(prior_attainment_score, benchmark_table_data, normalized_qualification_type, qual_details=None, app_logger=app.logger):
    """Looks up MEG aspiration from a given ALPS band table based on prior attainment score, normalized qualification type, and specific qualification details."""
    if benchmark_table_data is None or prior_attainment_score is None:
        app_logger.debug(f"MEG lookup: Benchmark data or prior score is None. Score: {prior_attainment_score}, NormQual: {normalized_qualification_type}")
        return "N/A"
    try:
        score = float(prior_attainment_score)
        # table_to_use is already the specific, correct table passed as benchmark_table_data

        for band_info in benchmark_table_data:
            # Accommodate different key names for min/max scores found in various ALPS tables
            min_score_val = None
            max_score_val = None
            possible_min_keys = ["gcseMinScore", "gcseMin", "Avg GCSE score Min", "Prior Attainment Min"]
            possible_max_keys = ["gcseMaxScore", "gcseMax", "Avg GCSE score Max", "Prior Attainment Max"]

            for key in possible_min_keys:
                if key in band_info:
                    min_score_val = band_info[key]
                    break
            for key in possible_max_keys:
                if key in band_info:
                    max_score_val = band_info[key]
                    break
            
            meg_aspiration = "N/A" # Default MEG

            # Determine MEG key based on normalized_qualification_type and qual_details
            if normalized_qualification_type in ["A Level", "AS Level"]:
                meg_aspiration = band_info.get("megAspiration", band_info.get("MEG Aspiration", "N/A"))
            elif normalized_qualification_type == "IB HL":
                meg_aspiration = band_info.get("hlMeg", band_info.get("HL MEG Aspiration", "N/A"))
            elif normalized_qualification_type == "IB SL":
                meg_aspiration = band_info.get("slMeg", band_info.get("SL MEG Aspiration", "N/A"))
            elif normalized_qualification_type == "Pre-U Principal Subject":
                meg_aspiration = band_info.get("fullMeg", band_info.get("Principal Subject MEG", "N/A"))
            elif normalized_qualification_type == "Pre-U Short Course":
                meg_aspiration = band_info.get("scMeg", band_info.get("Short Course MEG", "N/A"))
            elif "BTEC" in normalized_qualification_type and qual_details:
                btec_year = qual_details.get('year', "2016") # Default to 2016 if year not in details
                btec_size = qual_details.get('size')
                
                # MEG keys can vary significantly between 2010 and 2016 BTEC tables
                if btec_year == "2016":
                    if btec_size == "EXTCERT": meg_aspiration = band_info.get("extCertMeg", band_info.get("Ext Cert MEG", "N/A"))
                    elif btec_size == "DIP": meg_aspiration = band_info.get("dipMeg", band_info.get("Diploma MEG", "N/A"))
                    elif btec_size == "EXTDIP": meg_aspiration = band_info.get("extDipMeg", band_info.get("Ext Dip MEG", "N/A"))
                    elif btec_size == "CERT": meg_aspiration = band_info.get("certMeg", band_info.get("Certificate MEG", "N/A")) # e.g. BTEC L3 Nat Cert (1 yr)
                    elif btec_size == "FOUNDDIP": meg_aspiration = band_info.get("foundDipMeg", band_info.get("Found Dip MEG", "N/A"))
                    else: app_logger.warning(f"BTEC 2016: Unknown size '{btec_size}' for MEG lookup in {normalized_qualification_type}")
                elif btec_year == "2010":
                    if btec_size == "CERT": meg_aspiration = band_info.get("certMEG", "N/A")         # L3 Cert (30 cred)
                    elif btec_size == "SUBDIP": meg_aspiration = band_info.get("subDipMEG", "N/A")    # L3 Sub Dip (60 cred)
                    elif btec_size == "NINETY_CR": meg_aspiration = band_info.get("ninetyCrMEG", "N/A") # L3 90-Credit Dip
                    elif btec_size == "DIP": meg_aspiration = band_info.get("dipMEG", "N/A")          # L3 Dip (120 cred)
                    elif btec_size == "EXTDIP": meg_aspiration = band_info.get("extDipMEG", "N/A")   # L3 Ext Dip (180 cred)
                    else: app_logger.warning(f"BTEC 2010: Unknown size '{btec_size}' for MEG lookup in {normalized_qualification_type}")
                else:
                    app_logger.warning(f"Unknown BTEC year '{btec_year}' for MEG lookup.")
            elif "UAL" in normalized_qualification_type:
                 meg_aspiration = band_info.get("megGrade", band_info.get("MEG", "N/A"))
            elif "WJEC" in normalized_qualification_type and qual_details:
                 wjec_size = qual_details.get('wjec_size', "CERT") # Default to CERT if not specified
                 if wjec_size == "CERT": meg_aspiration = band_info.get("certMeg", band_info.get("Certificate MEG", "N/A"))
                 elif wjec_size == "DIP": meg_aspiration = band_info.get("dipMegAsp", band_info.get("Diploma MEG", "N/A"))
                 else: app_logger.warning(f"WJEC: Unknown size '{wjec_size}' for MEG lookup.")
            elif "CACHE" in normalized_qualification_type:
                 # CACHE tables might use "megGrade" or similar generic keys like UAL
                 meg_aspiration = band_info.get("megGrade", band_info.get("MEG Aspiration", "N/A"))
            else: 
                # Fallback for any other types or if details are missing for complex types
                meg_aspiration = band_info.get("megAspiration", band_info.get("megGrade", band_info.get("MEG", "N/A")))
                app_logger.info(f"MEG lookup for '{normalized_qualification_type}' using default MEG key ('megAspiration' or 'megGrade' or 'MEG').")

            if isinstance(min_score_val, (int, float)):
                # Ensure max_score_val is treated correctly if it represents an inclusive upper bound or exclusive
                # Standard ALPS tables are usually [min_score, max_score) - min inclusive, max exclusive
                if score >= min_score_val and (max_score_val is None or score < float(max_score_val)):
                    return meg_aspiration
        app_logger.debug(f"MEG lookup: Score {score} not in any band for NormQual: {normalized_qualification_type}. Table (first 200 chars): {str(benchmark_table_data)[:200]}...")
        return "N/A"
    except (ValueError, TypeError) as e:
        app.logger.warning(f"MEG lookup error: Could not process prior attainment score '{prior_attainment_score}' or table for {normalized_qualification_type}. Error: {e}")
        return "N/A"

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
        school_id = school_connection_raw # Assuming the string itself is the ID
        app.logger.info(f"Extracted school_id '{school_id}' (string) from student's Object_10 field_133_raw.")
    else:
        # Attempt to get from non-raw field if raw is not helpful
        school_connection_obj = student_vespa_data.get("field_133")
        if isinstance(school_connection_obj, list) and school_connection_obj: # Knack connection fields are lists of dicts
             school_id = school_connection_obj[0].get('id')
             app.logger.info(f"Extracted school_id '{school_id}' from student's Object_10 field_133 (non-raw object).")
        else:
            app.logger.warning(f"Could not determine school_id from field_133_raw or field_133 for student {student_obj10_id_from_request}. Data (raw): {school_connection_raw}, Data (obj): {school_connection_obj}")


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
    elif isinstance(student_email_obj, str): # If it's already a string
        student_email = student_email_obj

    actual_student_object3_id = None
    if student_email:
        filters_object3_for_id = [{'field': 'field_70', 'operator': 'is', 'value': student_email}]
        object3_response = get_knack_record("object_3", filters=filters_object3_for_id)
        
        user_accounts_list = [] 
        if object3_response and isinstance(object3_response, dict) and 'records' in object3_response and isinstance(object3_response['records'], list):
            user_accounts_list = object3_response['records']
            app.logger.info(f"Found {len(user_accounts_list)} records in Object_3 for email {student_email}.")
        else:
            app.logger.warning(f"Object_3 response for email {student_email} was not in the expected format or missing 'records' list. Response: {str(object3_response)[:200]}")

        if user_accounts_list: 
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

    student_level = student_vespa_data.get("field_568_raw", "N/A") 
    current_m_cycle_str = student_vespa_data.get("field_146_raw", "0")
    try:
        # Ensure current_m_cycle_str is treated as a string for isdigit(), then convert to int
        current_m_cycle_str_for_check = str(current_m_cycle_str) if current_m_cycle_str is not None else "0"
        current_m_cycle = int(current_m_cycle_str_for_check) if current_m_cycle_str_for_check.isdigit() else 0
    except ValueError:
        app.logger.warning(f"Could not parse current_m_cycle '{current_m_cycle_str}' to int. Defaulting to 0.")
        current_m_cycle = 0
    
    previous_interaction_summary = student_vespa_data.get("field_3271", "No previous AI coaching summary found.")

    vespa_scores = {
        "Vision": student_vespa_data.get("field_147"), "Effort": student_vespa_data.get("field_148"),
        "Systems": student_vespa_data.get("field_149"), "Practice": student_vespa_data.get("field_150"),
        "Attitude": student_vespa_data.get("field_151"), "Overall": student_vespa_data.get("field_152"),
    }

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

    student_reflections_and_goals = {
        "rrc1_comment": student_vespa_data.get("field_2302"),
        "rrc2_comment": student_vespa_data.get("field_2303"),
        "rrc3_comment": student_vespa_data.get("field_2304"),
        "goal1": student_vespa_data.get("field_2499"),
        "goal2": student_vespa_data.get("field_2493"),
        "goal3": student_vespa_data.get("field_2494"),
    }
    for key, value in student_reflections_and_goals.items():
        if value is None:
            student_reflections_and_goals[key] = "Not specified"
    
    app.logger.info(f"Object_10 Reflections and Goals: {student_reflections_and_goals}")


    key_individual_question_insights = ["No questionnaire data processed."] 
    object29_top_bottom_questions = { "top_3": [], "bottom_3": [] }
    all_scored_questions_from_object29 = []

    obj10_id_for_o29 = student_vespa_data.get('id')
    if obj10_id_for_o29 and current_m_cycle > 0:
        app.logger.info(f"Fetching Object_29 for Object_10 ID: {obj10_id_for_o29} and Cycle: {current_m_cycle}")
        filters_object29 = [
            {'field': 'field_792', 'operator': 'is', 'value': obj10_id_for_o29},
            {'field': 'field_863_raw', 'operator': 'is', 'value': str(current_m_cycle)}
        ]
        object29_response = get_knack_record("object_29", filters=filters_object29)
        
        temp_o29_list = [] 
        if object29_response and isinstance(object29_response, dict) and 'records' in object29_response and isinstance(object29_response['records'], list):
            temp_o29_list = object29_response['records']
            app.logger.info(f"Found {len(temp_o29_list)} records in Object_29 for student {obj10_id_for_o29} and cycle {current_m_cycle}.")
        else:
            app.logger.warning(f"Object_29 response for student {obj10_id_for_o29} cycle {current_m_cycle} not in expected format or 'records' missing. Response: {str(object29_response)[:200]}")

        if temp_o29_list: 
            if isinstance(temp_o29_list[0], dict):
                object29_record = temp_o29_list[0] 
                app.logger.info(f"Successfully fetched Object_29 record: {object29_record.get('id')}")
                
                parsed_insights = []
                if psychometric_question_details: # This KB is loaded globally
                    for q_detail in psychometric_question_details:
                        field_id = q_detail.get('currentCycleFieldId')
                        question_text = q_detail.get('questionText', 'Unknown Question')
                        vespa_category = q_detail.get('vespaCategory', 'N/A')
                        
                        if not field_id: continue

                        raw_score_value = object29_record.get(field_id)
                        if raw_score_value is None and field_id.startswith("field_"):
                             score_obj = object29_record.get(field_id + '_raw')
                             if isinstance(score_obj, dict):
                                 raw_score_value = score_obj.get('value', 'N/A')
                             elif score_obj is not None: # If score_obj is a direct value (e.g. string, number)
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
                        if numeric_score is not None and numeric_score <= 2: # Assuming 2 or less is a "FLAG"
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
    else:
        app.logger.warning("Missing Object_10 ID or current_m_cycle is 0, skipping Object_29 fetch.")
        key_individual_question_insights = ["Skipped fetching questionnaire data (missing ID or cycle is 0)."]

    # --- Phase 2: Knowledge Base Lookup & Data Structuring for LLM ---
    def get_score_profile_text(score_value):
        if score_value is None: return "N/A"
        try:
            score = float(score_value) # Knack scores are usually numeric but can be strings
            if score >= 8: return "High"
            if score >= 6: return "Medium"
            if score >= 4: return "Low"
            if score >= 0: return "Very Low" # VESPA scores 1-10
            return "N/A"
        except (ValueError, TypeError):
            app.logger.warning(f"Could not convert score '{score_value}' to float for profile text.")
            return "N/A"

    vespa_profile_details_for_llm = {} # This will be a part of student_data_for_llm
    for element, score_value in vespa_scores.items():
        if element == "Overall": continue # Overall score handled separately if needed by LLM
        score_profile_text = get_score_profile_text(score_value)
        
        # Find matching report text from report_text_data (Object_33)
        matching_report_text_record = None
        if report_text_data: # This KB is loaded globally
            for record in report_text_data:
                if (record.get('field_848') == student_level and 
                    record.get('field_844') == element and 
                    record.get('field_842') == score_profile_text):
                    matching_report_text_record = record
                    break
        
        element_specific_insights_from_o29 = []
        if key_individual_question_insights and isinstance(key_individual_question_insights, list) and not key_individual_question_insights[0].startswith("No questionnaire data") and not key_individual_question_insights[0].startswith("Psychometric question details mapping not loaded") and not key_individual_question_insights[0].startswith("No questionnaire data found for cycle") and not key_individual_question_insights[0].startswith("Skipped fetching questionnaire data"):
            for insight in key_individual_question_insights:
                if isinstance(insight, str) and insight.upper().startswith(element.upper()):
                    element_specific_insights_from_o29.append(insight)
        
        vespa_profile_details_for_llm[element] = {
            "score_1_to_10": score_value if score_value is not None else "N/A",
            "score_profile_text": score_profile_text,
            # Primary tutor coaching comments are more for direct display, not LLM summary input unless crucial
            "primary_tutor_coaching_comments": matching_report_text_record.get('field_853', "Coaching comments not found.") if matching_report_text_record else "Coaching comments not found.",
            "key_individual_question_insights_from_object29": element_specific_insights_from_o29 if element_specific_insights_from_o29 else ["No specific insights for this category from questionnaire."]
            # We don't pass all historical scores directly to LLM prompt to save tokens, unless specifically needed for a task
        }

    # Fetch Academic Profile Data (Object_112)
    # academic_profile_summary_data = get_academic_profile(actual_student_object3_id, student_name_for_profile_lookup, student_obj10_id_from_request)
    academic_profile_response = get_academic_profile(actual_student_object3_id, student_name_for_profile_lookup, student_obj10_id_from_request)
    academic_profile_summary_data = academic_profile_response.get("subjects")
    object112_profile_record = academic_profile_response.get("profile_record") # This is the Object_112 record
    
    # --- Extract Student's GCSE Prior Attainment Score from Object_112.field_3272 ---
    prior_attainment_score = None
    if object112_profile_record:
        # Try to get from _raw first, then the direct field if _raw is not present or not a direct value
        prior_attainment_raw = object112_profile_record.get('field_3272_raw')
        # Check if _raw is a direct value; if it's a dict (like connection), it's not the score itself
        if isinstance(prior_attainment_raw, (str, int, float)) and str(prior_attainment_raw).strip() != '':
            try:
                prior_attainment_score = float(prior_attainment_raw)
                app.logger.info(f"Successfully extracted prior attainment score: {prior_attainment_score} from Object_112.field_3272_raw.")
            except (ValueError, TypeError):
                app.logger.warning(f"Could not convert prior attainment score '{prior_attainment_raw}' from Object_112.field_3272_raw to float. Trying non-raw field.")
                prior_attainment_raw = None # Fallback to non-raw
        
        if prior_attainment_score is None: # If _raw wasn't useful or conversion failed
            prior_attainment_direct = object112_profile_record.get('field_3272')
            if isinstance(prior_attainment_direct, (str, int, float)) and str(prior_attainment_direct).strip() != '':
                try:
                    prior_attainment_score = float(prior_attainment_direct)
                    app.logger.info(f"Successfully extracted prior attainment score: {prior_attainment_score} from Object_112.field_3272.")
                except (ValueError, TypeError):
                    app.logger.warning(f"Could not convert prior attainment score '{prior_attainment_direct}' from Object_112.field_3272 to float.")
            elif prior_attainment_direct is not None: # Log if it exists but isn't a direct value
                 app.logger.warning(f"Prior attainment score from Object_112.field_3272 ('{prior_attainment_direct}') is not a direct string/numeric value.")

        if prior_attainment_score is None:
             app.logger.warning(f"Prior attainment score (field_3272 or field_3272_raw) is missing or invalid in Object_112 record: {object112_profile_record.get('id')}.")
    else:
        app.logger.warning("Cannot extract prior attainment score as Object_112 profile record is missing.")

    # --- Calculate MEGs for different percentiles ---
    academic_megs_data = {
        "prior_attainment_score": prior_attainment_score if prior_attainment_score is not None else "N/A",
        "aLevel_meg_grade_60th": "N/A", "aLevel_meg_points_60th": 0,
        "aLevel_meg_grade_75th": "N/A", "aLevel_meg_points_75th": 0,
        "aLevel_meg_grade_90th": "N/A", "aLevel_meg_points_90th": 0,
        "aLevel_meg_grade_100th": "N/A", "aLevel_meg_points_100th": 0
    }
    app.logger.info(f"Initial Academic MEGs data: {academic_megs_data}")

    # Calculate overall A-Level MEGs if prior attainment is available
    if prior_attainment_score is not None:
        if alps_bands_aLevel_60:
            meg_60_grade = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_60, "A Level", None, app.logger)
            academic_megs_data["aLevel_meg_grade_60th"] = meg_60_grade
            academic_megs_data["aLevel_meg_points_60th"] = get_points("A Level", meg_60_grade, grade_points_mapping_data, app.logger)
        if alps_bands_aLevel_75:
            meg_75_grade = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_75, "A Level", None, app.logger)
            academic_megs_data["aLevel_meg_grade_75th"] = meg_75_grade
            academic_megs_data["aLevel_meg_points_75th"] = get_points("A Level", meg_75_grade, grade_points_mapping_data, app.logger)
        if alps_bands_aLevel_90:
            meg_90_grade = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_90, "A Level", None, app.logger)
            academic_megs_data["aLevel_meg_grade_90th"] = meg_90_grade
            academic_megs_data["aLevel_meg_points_90th"] = get_points("A Level", meg_90_grade, grade_points_mapping_data, app.logger)
        if alps_bands_aLevel_100:
            meg_100_grade = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_100, "A Level", None, app.logger)
            academic_megs_data["aLevel_meg_grade_100th"] = meg_100_grade
            academic_megs_data["aLevel_meg_points_100th"] = get_points("A Level", meg_100_grade, grade_points_mapping_data, app.logger)
        app.logger.info(f"Populated overall A-Level MEGs: {academic_megs_data}")


    # Process each subject in academic_profile_summary_data for MEG and points
    if isinstance(academic_profile_summary_data, list) and prior_attainment_score is not None:
        for subject_summary in academic_profile_summary_data:
            if isinstance(subject_summary, dict) and subject_summary.get("subject") and not subject_summary["subject"].startswith("Academic profile not found") and not subject_summary["subject"].startswith("No academic subjects parsed"):
                raw_exam_type = subject_summary.get("examType", "A Level") # Default to A Level if examType missing
                current_grade = subject_summary.get("currentGrade")

                normalized_qual = normalize_qualification_type(raw_exam_type)
                qual_details = extract_qual_details(raw_exam_type, normalized_qual, app.logger)
                
                subject_summary['normalized_qualification_type'] = normalized_qual # Add for context
                subject_summary['currentGradePoints'] = get_points(normalized_qual, current_grade, grade_points_mapping_data, app.logger)
                subject_summary['standard_meg'] = "N/A"
                subject_summary['standardMegPoints'] = 0
                
                # Select the correct benchmark table
                benchmark_table_for_subject = None
                if normalized_qual == "A Level": # For A-Levels, standard MEG is 75th percentile
                    benchmark_table_for_subject = alps_bands_aLevel_75
                elif normalized_qual == "AS Level": # AS Level also uses A Level 75th as a common proxy if no specific AS table
                    benchmark_table_for_subject = alps_bands_aLevel_75 
                    app.logger.info(f"Using A-Level 75th percentile benchmark for AS Level subject: {subject_summary.get('subject')}")
                elif normalized_qual == "IB HL" or normalized_qual == "IB SL":
                    benchmark_table_for_subject = alps_bands_ib
                elif "BTEC" in normalized_qual:
                    # Determine BTEC year from qual_details, default to 2016 if not found
                    btec_year = qual_details.get('year', "2016") if qual_details else "2016"
                    if btec_year == "2010": benchmark_table_for_subject = alps_bands_btec2010
                    else: benchmark_table_for_subject = alps_bands_btec2016 # Default to 2016 BTEC table
                elif "Pre-U" in normalized_qual:
                    benchmark_table_for_subject = alps_bands_preU
                elif "UAL" in normalized_qual:
                    benchmark_table_for_subject = alps_bands_ual
                elif "WJEC" in normalized_qual:
                    benchmark_table_for_subject = alps_bands_wjec
                elif "CACHE" in normalized_qual:
                    benchmark_table_for_subject = alps_bands_cache
                else:
                    app.logger.warning(f"No specific ALPS benchmark table configured for normalized qualification: \'{normalized_qual}\' for subject \'{subject_summary.get('subject')}\'. MEG will be N/A.")

                if benchmark_table_for_subject:
                    standard_meg_grade = get_meg_for_prior_attainment(prior_attainment_score, benchmark_table_for_subject, normalized_qual, qual_details, app.logger)
                    subject_summary['standard_meg'] = standard_meg_grade
                    subject_summary['standardMegPoints'] = get_points(normalized_qual, standard_meg_grade, grade_points_mapping_data, app.logger)
                    app.logger.info(f"Subject: {subject_summary.get('subject')} ({normalized_qual}), Prior Att: {prior_attainment_score}, Raw ExamType: '{raw_exam_type}', Details: {qual_details}, MEG Grade: {standard_meg_grade}, MEG Points: {subject_summary['standardMegPoints']}")

                    # For A-Levels, also add specific percentile points
                    if normalized_qual == "A Level":
                        # Standard MEG (75th) points already calculated
                        subject_summary['megPoints75'] = subject_summary['standardMegPoints']
                        
                        meg60_grade_alvl = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_60, "A Level", None, app.logger)
                        subject_summary['megPoints60'] = get_points("A Level", meg60_grade_alvl, grade_points_mapping_data, app.logger)
                        
                        meg90_grade_alvl = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_90, "A Level", None, app.logger)
                        subject_summary['megPoints90'] = get_points("A Level", meg90_grade_alvl, grade_points_mapping_data, app.logger)

                        meg100_grade_alvl = get_meg_for_prior_attainment(prior_attainment_score, alps_bands_aLevel_100, "A Level", None, app.logger)
                        subject_summary['megPoints100'] = get_points("A Level", meg100_grade_alvl, grade_points_mapping_data, app.logger)
                else:
                     app.logger.warning(f"Could not determine benchmark table for subject: {subject_summary.get('subject')} with normalized type: {normalized_qual}. Standard MEG will remain N/A.")
            else:
                if isinstance(subject_summary, dict): # Log if it's a dict but doesn't meet criteria
                    app.logger.info(f"Skipping MEG/point calculation for subject entry: {str(subject_summary)[:100]}... (Invalid subject or profile not found message)")

    elif prior_attainment_score is None:
        app.logger.warning("Prior attainment score is missing. Cannot calculate subject-specific MEGs or points accurately.")
        if isinstance(academic_profile_summary_data, list): # Still add default keys if profile exists
             for subject_summary in academic_profile_summary_data:
                if isinstance(subject_summary, dict):
                    subject_summary['currentGradePoints'] = 0
                    subject_summary['standard_meg'] = "N/A (No PA)"
                    subject_summary['standardMegPoints'] = 0
                    # Check if examType indicates A-Level more carefully by normalizing first
                    raw_exam_type_for_default = subject_summary.get("examType", "")
                    normalized_qual_for_default = normalize_qualification_type(raw_exam_type_for_default) if raw_exam_type_for_default else ""
                    if normalized_qual_for_default == "A Level":
                         subject_summary['megPoints60'] = 0
                         subject_summary['megPoints75'] = 0
                         subject_summary['megPoints90'] = 0
                         subject_summary['megPoints100'] = 0


    # Data structure to pass to the LLM
    student_data_for_llm = {
        "student_name": student_name_for_profile_lookup,
        "student_level": student_level,
        "current_cycle": current_m_cycle,
        "vespa_profile": vespa_profile_details_for_llm, # Uses the processed details
        "school_vespa_averages": school_wide_vespa_averages, # Pass school averages to LLM
        "academic_profile_summary": academic_profile_summary_data,
        "student_reflections_and_goals": student_reflections_and_goals,
        "object29_question_highlights": object29_top_bottom_questions,
        "previous_interaction_summary": previous_interaction_summary,
        "academic_megs": academic_megs_data # Add MEGs to data for LLM
        # key_individual_question_insights is indirectly included via vespa_profile_details_for_llm
    }
    
    # Load full KBs here to pass to LLM function (or relevant parts)
    # coaching_kb is already loaded globally
    # Load 100 statements text
    statements_file_path = os.path.join(os.path.dirname(__file__), 'knowledge_base', '100 statements - 2023.txt')
    # Corrected path relative to app.py
    alt_statements_file_path = os.path.join(os.path.dirname(__file__), '..', 'VESPA Contextual Information', '100 statements - 2023.txt')
    # Normalise path for OS compatibility
    alt_statements_file_path = os.path.normpath(alt_statements_file_path)

    student_goals_statements_content = None
    try:
        app.logger.info(f"Attempting to load 100 statements from: {alt_statements_file_path}")
        with open(alt_statements_file_path, 'r', encoding='utf-8') as f:
            student_goals_statements_content = f.read()
        app.logger.info("Successfully loaded '100 statements - 2023.txt' using UTF-8")
    except FileNotFoundError:
        app.logger.error(f"'100 statements - 2023.txt' not found at {alt_statements_file_path}. Also tried {statements_file_path}")
    except UnicodeDecodeError:
        app.logger.warning(f"UTF-8 decoding failed for '100 statements - 2023.txt' at {alt_statements_file_path}. Attempting with latin-1.")
        try:
            with open(alt_statements_file_path, 'r', encoding='latin-1') as f:
                student_goals_statements_content = f.read()
            app.logger.info("Successfully loaded '100 statements - 2023.txt' using latin-1 fallback.")
        except Exception as e_latin1:
            app.logger.error(f"Error loading '100 statements - 2023.txt' with latin-1 fallback: {e_latin1}")
    except Exception as e:
        app.logger.error(f"Error loading '100 statements - 2023.txt': {e}")


    # Call LLM to get structured insights
    # The coaching_kb (dict) and student_goals_statements_content (string) are passed here
    llm_structured_output = generate_student_summary_with_llm(student_data_for_llm, coaching_kb, REFLECTIVE_STATEMENTS_DATA, all_scored_questions_from_object29) # Pass all_scored_questions
    
    # --- Prepare Final API Response ---
    # The vespa_profile_details for the API response needs more than what LLM got (report_text etc.)
    # So, we rebuild it here for the API response.
    final_vespa_profile_details_for_api = {}
    for element, score_value in vespa_scores.items(): # Iterate over original vespa_scores
        score_profile_text = get_score_profile_text(score_value)
        matching_report_text_rec = None
        if report_text_data:
            for record in report_text_data:
                if (record.get('field_848') == student_level and 
                    record.get('field_844') == element and 
                    record.get('field_842') == score_profile_text):
                    matching_report_text_rec = record
                    break
        
        # Get supplementary questions (already prepared for LLM, reuse logic slightly)
        supplementary_questions_for_api = []
        if coaching_kb and coaching_kb.get('vespaSpecificCoachingQuestions'):
            element_data = coaching_kb['vespaSpecificCoachingQuestions'].get(element, {})
            if element_data:
                level_specific_questions = element_data.get(student_level, {})
                if not level_specific_questions and student_level == "Level 3":
                    level_specific_questions = element_data.get("Level 2", {}) # Fallback
                elif not level_specific_questions and student_level == "Level 2":
                    level_specific_questions = element_data.get("Level 3", {}) # Fallback
                profile_questions = level_specific_questions.get(score_profile_text, [])
                supplementary_questions_for_api.extend(profile_questions)

        hist_scores_for_api = {}
        for cycle_num_str, cycle_data_hist in historical_scores.items():
            cycle_key = f"cycle{cycle_num_str[-1]}"
            hist_score = cycle_data_hist.get(element)
            hist_scores_for_api[cycle_key] = hist_score if hist_score is not None else "N/A"

        final_vespa_profile_details_for_api[element] = {
            "score_1_to_10": score_value if score_value is not None else "N/A",
            "score_profile_text": score_profile_text,
            "report_text_for_student": matching_report_text_rec.get('field_845', "Content not found.") if matching_report_text_rec else "Content not found.",
            "report_questions_for_student": matching_report_text_rec.get('field_846', "Questions not found.") if matching_report_text_rec else "Questions not found.",
            "report_suggested_tools_for_student": matching_report_text_rec.get('field_847', "Tools not found.") if matching_report_text_rec else "Tools not found.",
            "primary_tutor_coaching_comments": matching_report_text_rec.get('field_853', "Coaching comments not found.") if matching_report_text_rec else "Coaching comments not found.",
            "supplementary_tutor_questions": supplementary_questions_for_api if supplementary_questions_for_api else ["No supplementary questions found for this profile."],
            "historical_summary_scores": hist_scores_for_api
        }
        # For "Overall", we only need a subset of these fields
        if element == "Overall":
            final_vespa_profile_details_for_api[element].pop("supplementary_tutor_questions", None)
            final_vespa_profile_details_for_api[element].pop("report_questions_for_student", None)
            final_vespa_profile_details_for_api[element].pop("report_suggested_tools_for_student", None)

    # Populate general introductory questions and overall framing statement from coaching_kb
    general_intro_questions = ["No general introductory questions found."]
    if coaching_kb and coaching_kb.get('generalIntroductoryQuestions'):
        general_intro_questions = coaching_kb['generalIntroductoryQuestions']
        if not general_intro_questions: general_intro_questions = ["No general introductory questions found in KB."]
    
    overall_framing_statement = {"id": "default_framing", "statement": "No specific framing statement matched or available."}
    if coaching_kb and coaching_kb.get('conditionalFramingStatements'):
        default_statement_found = False
        for stmt in coaching_kb['conditionalFramingStatements']:
            if stmt.get('id') == 'default_response':
                overall_framing_statement = {"id": stmt['id'], "statement": stmt.get('statement', "Default statement text missing.")}
                default_statement_found = True; break
        if not default_statement_found and coaching_kb['conditionalFramingStatements']:
            first_stmt = coaching_kb['conditionalFramingStatements'][0]
            overall_framing_statement = {"id": first_stmt.get('id', 'unknown_conditional'), "statement": first_stmt.get('statement', "Conditional statement text missing.")}

    response_data = {
        "student_name": student_name_for_profile_lookup,
        "student_level": student_level,
        "current_cycle": current_m_cycle,
        "vespa_profile": final_vespa_profile_details_for_api, # Use the fully detailed one for API
        "academic_profile_summary": academic_profile_summary_data,
        "student_reflections_and_goals": student_reflections_and_goals,
        "object29_question_highlights": object29_top_bottom_questions,
        "overall_framing_statement_for_tutor": overall_framing_statement,
        "general_introductory_questions_for_tutor": general_intro_questions,
        "llm_generated_insights": llm_structured_output, # This now holds the structured data
        "previous_interaction_summary": previous_interaction_summary,
        "school_vespa_averages": school_wide_vespa_averages,
        "academic_megs": academic_megs_data, # Add MEGs to API response
        "all_scored_questionnaire_statements": all_scored_questions_from_object29 # ADDED for frontend chart
    }
    
    # For backward compatibility with old frontend's "llm_generated_summary_and_suggestions.student_overview_summary"
    # We can also add the student_overview_summary at the top level of llm_generated_insights if it's not already there.
    # The new llm_structured_output should already contain "student_overview_summary" as a key.
    # If frontend expects "llm_generated_summary_and_suggestions", we might need to adapt.
    # For now, sending "llm_generated_insights" as the main holder of new structured data.

    app.logger.info(f"Successfully prepared API response for student_object10_record_id: {student_obj10_id_from_request}")
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

    app.logger.info(f"Calculating school VESPA averages for school_id: {school_id} by fetching all student records.")
    
    filters_primary = [{'field': 'field_133', 'operator': 'is', 'value': school_id}]
    app.logger.info(f"Attempting to fetch all records for object_10 with primary filter: {filters_primary}")
    all_student_records_for_school = get_all_knack_records("object_10", filters=filters_primary)

    if not all_student_records_for_school:
        app.logger.warning(f"No student records found for school_id {school_id} using primary filter (field_133). Trying fallback filter (field_133_raw).")
        filters_fallback = [{'field': 'field_133_raw', 'operator': 'contains', 'value': school_id}]
        app.logger.info(f"Attempting to fetch all records for object_10 with fallback filter: {filters_fallback}")
        all_student_records_for_school = get_all_knack_records("object_10", filters=filters_fallback)
        
        if not all_student_records_for_school:
            app.logger.error(f"Could not retrieve any student records for school_id: {school_id} using primary or fallback filters. Cannot calculate averages.")
            return None
        app.logger.info(f"Retrieved {len(all_student_records_for_school)} student records for school_id {school_id} using fallback filter (field_133_raw).")
    else:
        app.logger.info(f"Retrieved {len(all_student_records_for_school)} student records for school_id {school_id} using primary filter (field_133).")

    vespa_elements = {
        "Vision": "field_147", "Effort": "field_148",
        "Systems": "field_149", "Practice": "field_150",
        "Attitude": "field_151", "Overall": "field_152",
    }
    sums = {key: 0 for key in vespa_elements}
    counts = {key: 0 for key in vespa_elements}

    # Now all_student_records_for_school is a flat list of student record dictionaries
    for record in all_student_records_for_school:
        # Ensure record is a dictionary before trying to .get() from it
        if not isinstance(record, dict):
            app.logger.warning(f"Skipping an item in all_student_records_for_school because it is not a dictionary: {type(record)} - Content: {str(record)[:100]}...")
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

# --- Function to fetch All Records with Pagination ---
def get_all_knack_records(object_key, filters=None, max_pages=20):
    """Fetches all records from a Knack object using pagination."""
    all_records = []
    current_page = 1
    # Initialize total_pages to a value that allows the loop to start.
    # It will be updated from the first actual response.
    total_pages = 1 

    app.logger.info(f"Starting paginated fetch for {object_key} with filters: {filters}")

    while current_page <= total_pages and current_page <= max_pages:
        app.logger.info(f"Fetching page {current_page} for {object_key}...")
        # get_knack_record now returns the full response dictionary from Knack API
        response_data = get_knack_record(object_key, filters=filters, page=current_page, rows_per_page=1000)
        
        if response_data and isinstance(response_data, dict):
            # Extract the list of records from the response_data dictionary
            records_on_page = response_data.get('records', []) 
            
            if isinstance(records_on_page, list):
                all_records.extend(records_on_page) # Add records from current page to the main list
                app.logger.info(f"Fetched {len(records_on_page)} records from page {current_page} for {object_key}. Total so far: {len(all_records)}.")
            else:
                app.logger.warning(f"'records' key in response_data for {object_key} page {current_page} is not a list as expected. Type: {type(records_on_page)}. Response (first 200 chars): {str(response_data)[:200]}. Stopping pagination.")
                break 
            
            # Update total_pages from the API response (usually present on each page)
            # More robustly get total_pages, ensuring it's an int
            new_total_pages = response_data.get('total_pages')
            if new_total_pages is not None:
                try:
                    total_pages = int(new_total_pages)
                    if current_page == 1: # Log only on first discovery
                       app.logger.info(f"Total pages for {object_key} identified from API: {total_pages}")
                except (ValueError, TypeError):
                    app.logger.warning(f"Could not parse 'total_pages' ('{new_total_pages}') from response for {object_key} on page {current_page}. Will rely on record count or max_pages.")
                    # If parsing fails, and total_pages was just the initial 1, it might indicate only one page.
                    # If records_on_page < rows_per_page, that's a stronger indicator of the last page.
            
            # Check if this was the last page
            if not records_on_page or len(records_on_page) < 1000 or current_page >= total_pages:
                app.logger.info(f"Last page likely reached for {object_key} on page {current_page} (fetched {len(records_on_page)} records, total pages from API: {total_pages}).")
                break
            current_page += 1
        else:
            app.logger.warning(f"No response_data or unexpected format on page {current_page} for {object_key}. Response: {str(response_data)[:200]}. Stopping pagination.")
            break
            
    app.logger.info(f"Completed paginated fetch for {object_key}. Total records retrieved: {len(all_records)}.")
    return all_records # This should NOW be a flat list of record dictionaries

# --- Function to extract suggested activities from AI response ---
def extract_suggested_activities(ai_response_text):
    """Extracts activity suggestions from the AI response text."""
    suggested_activities = []
    
    # This is a simple implementation - you might want to make it more sophisticated
    # For now, we'll look for patterns like "Activity Name (ID: XX)" in the response
    import re
    
    # Pattern to find activity references like "Activity Name (ID: 123)"
    pattern = r'([^(]+)\s*\(ID:\s*(\d+)\)'
    matches = re.findall(pattern, ai_response_text)
    
    for match in matches:
        activity_name = match[0].strip()
        activity_id = match[1]
        
        # You might want to look up the full activity details from your activities database
        # For now, we'll return a basic structure
        suggested_activities.append({
            'id': activity_id,
            'name': activity_name,
            'vespa_element': 'Unknown',  # You'd need to look this up
            'short_summary': 'Activity details would be retrieved from database',
            'pdf_link': '#'  # You'd need to look this up
        })
    
    return suggested_activities

# --- API Endpoint for AI Chat Turn ---
@app.route('/api/v1/chat_turn', methods=['POST'])
def chat_turn():
    """Simple chat endpoint for AI coaching conversations."""
    data = request.get_json()
    app.logger.info(f"Received request for /api/v1/chat_turn with data: {str(data)[:500]}...")

    student_object10_id = data.get('student_object10_record_id')
    chat_history = data.get('chat_history', [])
    current_tutor_message = data.get('current_tutor_message')
    initial_ai_context = data.get('initial_ai_context')
    include_previous_chats = data.get('include_previous_chats', True)

    if not student_object10_id or not current_tutor_message:
        app.logger.error("chat_turn: Missing student_object10_record_id or current_tutor_message.")
        return jsonify({"error": "Missing student_object10_record_id or current_tutor_message"}), 400

    # Save the tutor's message to Knack first
    tutor_message_id = save_chat_message_to_knack(student_object10_id, "Tutor", current_tutor_message)
    if not tutor_message_id:
        app.logger.warning("Failed to save tutor message to Knack, but continuing with chat...")

    # Optionally include previous chat sessions in the context
    if include_previous_chats and len(chat_history) < 10:
        previous_messages = get_chat_history_from_knack(student_object10_id, max_messages=10, days_back=30)
        if previous_messages and len(previous_messages) > 0:
            summary = summarize_chat_history(previous_messages, max_summary_length=200)
            if summary and summary != "No previous chat history found.":
                chat_history.insert(0, {
                    "role": "system",
                    "content": f"Context from previous coaching sessions: {summary}"
                })

    app.logger.info(f"Chat history length for LLM: {len(chat_history)}")

    # Prepend system message for role definition
    messages = [
        {"role": "system", "content": """You are an AI-powered tutoring assistant specializing in VESPA (Vision, Effort, Systems, Practice, Attitude) coaching. You're supporting a tutor in their conversation with a student. Your role is to:

1. Be conversational and supportive, like a helpful colleague
2. Provide specific, actionable suggestions based on the VESPA framework
3. Draw from the student's VESPA profile, academic data, and questionnaire responses
4. Suggest specific activities from the toolkit when relevant (format them as "Activity Name (ID: XX)")
5. Ask genuine questions that show you're thinking alongside them

Remember: You're a supportive colleague sharing experience, not an expert delivering a lecture."""}
    ]

    # Prepend initial AI context if available
    if initial_ai_context:
        context_preamble = "Key previously generated insights for this student (use this as context for the current chat):\n"
        if initial_ai_context.get('student_overview_summary'):
            context_preamble += f"- Overall Student Snapshot: {initial_ai_context['student_overview_summary']}\n"
        if initial_ai_context.get('academic_benchmark_analysis'):
            context_preamble += f"- Academic Benchmark Analysis: {initial_ai_context['academic_benchmark_analysis']}\n"
        if initial_ai_context.get('questionnaire_interpretation_and_reflection_summary'):
            context_preamble += f"- Questionnaire Reflections: {initial_ai_context['questionnaire_interpretation_and_reflection_summary']}\n"
        
        messages.append({"role": "system", "content": context_preamble})

    # Add the chat history
    for msg in chat_history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Add the current tutor message
    messages.append({"role": "user", "content": current_tutor_message})

    # Call OpenAI
    try:
        app.logger.info("Calling OpenAI for chat response...")
        response = openai.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7,
            max_tokens=500
        )

        ai_response_text = response.choices[0].message.content
        app.logger.info(f"OpenAI response received: {ai_response_text[:100]}...")

        # Save the AI's response to Knack
        ai_message_id = save_chat_message_to_knack(student_object10_id, "AI Coach", ai_response_text)
        if not ai_message_id:
            app.logger.warning("Failed to save AI response to Knack")

        # Extract suggested activities from the response
        suggested_activities = extract_suggested_activities(ai_response_text)
        
        return jsonify({
            "ai_response": ai_response_text,
            "suggested_activities_in_chat": suggested_activities,
            "message_id": ai_message_id
        })

    except Exception as e:
        app.logger.error(f"Error in chat_turn: {e}")
        return jsonify({"error": f"Failed to generate AI response: {str(e)}"}), 500

# --- Helper Functions for Chat ---
def save_chat_message_to_knack(student_obj10_id, sender, message_text, suggested_activities=None):
    """Saves a chat message to object_118 in Knack."""
    if not student_obj10_id or not sender or not message_text:
        app.logger.error("save_chat_message_to_knack: Missing required parameters.")
        return None

    # Field mappings for Object_118 (AIChatLog)
    # field_3275: Tutor Report Conversation (Connection to Object_10)
    # field_3276: Message Timestamp (Date/Time)
    # field_3273: Author (Short Text)
    # field_3277: Conversation Log (Paragraph Text)
    # field_3279: Is Liked (Boolean)
    
    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    
    # Create the chat record
    chat_data = {
        'field_3275': [student_obj10_id],  # Connection to Object_10
        'field_3273': sender,  # Author
        'field_3277': message_text,  # Message content
        'field_3279': False  # Is Liked - default to false
    }
    
    # Add suggested activities if any
    if suggested_activities:
        # You might want to store this in another field or append to message
        # For now, appending to message text as JSON
        import json
        activities_json = json.dumps(suggested_activities)
        chat_data['field_3277'] = f"{message_text}\n\n[ACTIVITIES:{activities_json}]"
    
    try:
        response = requests.post(
            f"{KNACK_BASE_URL}/object_118/records",
            headers=headers,
            json=chat_data
        )
        response.raise_for_status()
        
        result = response.json()
        app.logger.info(f"Successfully saved chat message to Knack. Record ID: {result.get('id')}")
        return result.get('id')
        
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Error saving chat message to Knack: {e}")
        return None

def get_chat_history_from_knack(student_obj10_id, max_messages=20, days_back=7, include_metadata=False):
    """Retrieves chat history from object_118 for a given student."""
    if not student_obj10_id:
        app.logger.error("get_chat_history_from_knack: Missing student_obj10_id.")
        return []
    
    # Calculate date filter if days_back is specified
    from datetime import datetime, timedelta
    if days_back:
        cutoff_date = (datetime.now() - timedelta(days=days_back)).strftime('%m/%d/%Y')
        filters = [
            {'field': 'field_3275', 'operator': 'is', 'value': student_obj10_id},
            {'field': 'field_3276', 'operator': 'is after', 'value': cutoff_date}
        ]
    else:
        filters = [{'field': 'field_3275', 'operator': 'is', 'value': student_obj10_id}]
    
    # Get all messages with pagination
    all_messages = get_all_knack_records("object_118", filters=filters, max_pages=5)
    
    if not all_messages:
        app.logger.info(f"No chat messages found for student {student_obj10_id}")
        return [] if not include_metadata else {"messages": [], "total_count": 0, "liked_count": 0}
    
    # Sort by timestamp (newest first)
    all_messages.sort(key=lambda x: x.get('field_3276_raw', {}).get('timestamp', ''), reverse=True)
    
    # Format messages
    formatted_messages = []
    liked_count = 0
    
    for msg in all_messages[:max_messages]:
        formatted_msg = {
            'id': msg.get('id'),
            'author': msg.get('field_3273', 'Unknown'),
            'message': msg.get('field_3277', ''),
            'timestamp': msg.get('field_3276', ''),
            'timestamp_raw': msg.get('field_3276_raw', {}),
            'is_liked': msg.get('field_3279', False) or msg.get('field_3279_raw', False)
        }
        
        if formatted_msg['is_liked']:
            liked_count += 1
            
        # Remove activity JSON from message text if present
        if '[ACTIVITIES:' in formatted_msg['message']:
            formatted_msg['message'] = formatted_msg['message'].split('[ACTIVITIES:')[0].strip()
        
        formatted_messages.append(formatted_msg)
    
    # Return metadata if requested
    if include_metadata:
        return {
            "messages": formatted_messages,
            "total_count": len(all_messages),
            "liked_count": liked_count,
            "chat_history": formatted_messages  # For compatibility
        }
    
    return formatted_messages

def summarize_chat_history(messages, max_summary_length=500):
    """Creates a summary of chat history for context."""
    if not messages:
        return "No previous chat history found."
    
    if not OPENAI_API_KEY:
        # Fallback to simple extraction if no AI available
        summary_parts = []
        for msg in messages[-10:]:  # Last 10 messages
            author = "Tutor" if msg['author'] == "Tutor" else "AI"
            summary_parts.append(f"{author}: {msg['message'][:50]}...")
        return "Recent messages: " + "; ".join(summary_parts[:5])
    
    # Use AI to create a better summary
    try:
        messages_text = "\n".join([f"{msg['author']}: {msg['message']}" for msg in messages[-20:]])
        
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "Summarize the key topics and insights from this tutoring conversation in 2-3 sentences."},
                {"role": "user", "content": messages_text}
            ],
            max_tokens=150,
            temperature=0.5
        )
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        app.logger.error(f"Error creating AI summary: {e}")
        return "Previous conversations covered various VESPA-related topics."

# --- API Endpoint to Get Chat History ---
@app.route('/api/v1/chat_history', methods=['POST'])
def get_chat_history():
    """Endpoint to retrieve chat history for a student."""
    data = request.get_json()
    student_object10_id = data.get('student_object10_record_id')
    max_messages = data.get('max_messages', 20)  # Default to last 20 messages
    days_back = data.get('days_back', 7)  # Default to last 7 days
    include_metadata = data.get('include_metadata', False)
    
    if not student_object10_id:
        app.logger.error("get_chat_history endpoint: Missing student_object10_record_id.")
        return jsonify({"error": "Missing student_object10_record_id"}), 400
    
    app.logger.info(f"Fetching chat history for student {student_object10_id}")
    
    # Get the raw chat history with metadata
    result = get_chat_history_from_knack(
        student_object10_id, 
        max_messages=max_messages, 
        days_back=days_back,
        include_metadata=True
    )
    
    if isinstance(result, dict):
        messages = result.get('messages', [])
        total_count = result.get('total_count', 0)
        liked_count = result.get('liked_count', 0)
    else:
        messages = result
        total_count = len(messages)
        liked_count = sum(1 for msg in messages if msg.get('is_liked', False))
    
    # Convert to format expected by frontend
    formatted_messages = []
    for msg in messages:
        role = "assistant" if msg['author'] == "AI Coach" else "user"
        formatted_messages.append({
            "id": msg.get('id'),
            "role": role,
            "content": msg['message'],
            "timestamp": msg['timestamp'],
            "author": msg['author'],
            "is_liked": msg.get('is_liked', False)
        })
    
    # Also provide a summary if there are many messages
    summary = None
    if len(messages) > 10:
        summary = summarize_chat_history(messages[:-10], max_summary_length=300)
    
    response_data = {
        "chat_history": formatted_messages,
        "summary": summary,
        "total_messages": len(formatted_messages),
        "total_count": total_count,
        "liked_count": liked_count
    }
    
    return jsonify(response_data)

# --- API Endpoint to Update Chat Like Status ---
@app.route('/api/v1/update_chat_like', methods=['POST'])
def update_chat_like():
    """Updates the liked status of a chat message."""
    data = request.get_json()
    message_id = data.get('message_id')
    is_liked = data.get('is_liked', False)
    
    if not message_id:
        return jsonify({"error": "Missing message_id"}), 400
    
    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    
    update_data = {
        'field_3279': is_liked  # Is Liked field
    }
    
    try:
        response = requests.put(
            f"{KNACK_BASE_URL}/object_118/records/{message_id}",
            headers=headers,
            json=update_data
        )
        response.raise_for_status()
        
        app.logger.info(f"Successfully updated like status for message {message_id} to {is_liked}")
        return jsonify({"success": True, "is_liked": is_liked})
        
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Error updating like status: {e}")
        return jsonify({"error": "Failed to update like status"}), 500

# --- API Endpoint to Clear Old Chats ---
@app.route('/api/v1/clear_old_chats', methods=['POST'])
def clear_old_chats():
    """Deletes old chat messages to stay under the limit, keeping liked messages."""
    data = request.get_json()
    student_object10_id = data.get('student_object10_record_id')
    keep_liked = data.get('keep_liked', True)
    target_count = data.get('target_count', 150)  # Target number to keep
    
    if not student_object10_id:
        return jsonify({"error": "Missing student_object10_record_id"}), 400
    
    # Get all messages for this student
    filters = [{'field': 'field_3275', 'operator': 'is', 'value': student_object10_id}]
    all_messages = get_all_knack_records("object_118", filters=filters)
    
    if not all_messages:
        return jsonify({"deleted_count": 0, "remaining_count": 0})
    
    # Sort by timestamp (oldest first)
    all_messages.sort(key=lambda x: x.get('field_3276_raw', {}).get('timestamp', ''))
    
    # Separate liked and unliked messages
    liked_messages = []
    unliked_messages = []
    
    for msg in all_messages:
        if msg.get('field_3279', False) or msg.get('field_3279_raw', False):
            liked_messages.append(msg)
        else:
            unliked_messages.append(msg)
    
    # Calculate how many to delete
    total_count = len(all_messages)
    messages_to_delete = []
    
    if keep_liked:
        # Only delete from unliked messages
        if total_count > target_count:
            delete_count = total_count - target_count
            messages_to_delete = unliked_messages[:delete_count]
    else:
        # Delete from all messages (oldest first)
        if total_count > target_count:
            delete_count = total_count - target_count
            messages_to_delete = all_messages[:delete_count]
    
    # Delete the messages
    deleted_count = 0
    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY
    }
    
    for msg in messages_to_delete:
        try:
            response = requests.delete(
                f"{KNACK_BASE_URL}/object_118/records/{msg['id']}",
                headers=headers
            )
            response.raise_for_status()
            deleted_count += 1
        except requests.exceptions.RequestException as e:
            app.logger.error(f"Error deleting message {msg['id']}: {e}")
    
    remaining_count = total_count - deleted_count
    
    app.logger.info(f"Cleared {deleted_count} old chats for student {student_object10_id}. {remaining_count} messages remain.")
    
    return jsonify({
        "deleted_count": deleted_count,
        "remaining_count": remaining_count,
        "liked_preserved": len(liked_messages) if keep_liked else 0
    })

if __name__ == '__main__':
    # Ensure the FLASK_ENV is set to development for debug mode if not using `flask run`
    # For Heroku, Gunicorn will be used as specified in Procfile
    port = int(os.environ.get('PORT', 5001))
    # When running locally with `python app.py`, debug should be True.
    # Heroku will set PORT, and debug should ideally be False in production.
    is_local_run = __name__ == '__main__' and not os.environ.get('DYNO')
    app.run(debug=is_local_run, port=port, host='0.0.0.0') 