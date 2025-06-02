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
from datetime import datetime # Add datetime for timestamp

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
VESPA_STATEMENTS_DATA = load_json_file('knowledge_base/vespa-statements.json')  # Load VESPA statements KB
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

if not VESPA_STATEMENTS_DATA:
    app.logger.warning("VESPA Statements KB (vespa-statements.json) is empty or failed to load.")
else:
    app.logger.info(f"Successfully loaded VESPA Statements KB.")


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
    
    # --- Update Object_10 with the new AI summary for field_3271 ---
    if llm_structured_output and isinstance(llm_structured_output, dict) and llm_structured_output.get('student_overview_summary'):
        summary_to_save = llm_structured_output['student_overview_summary']
        # Ensure summary is not an error message before saving
        if "error" not in summary_to_save.lower() and "unavailable" not in summary_to_save.lower() and summary_to_save:
            update_payload_obj10 = {
                "field_3271": summary_to_save
            }
            headers_knack_update = {
                'X-Knack-Application-Id': KNACK_APP_ID,
                'X-Knack-REST-API-Key': KNACK_API_KEY,
                'Content-Type': 'application/json'
            }
            update_url_obj10 = f"{KNACK_BASE_URL}/object_10/records/{student_obj10_id_from_request}"
            try:
                app.logger.info(f"Attempting to update Object_10 record {student_obj10_id_from_request} with new summary for field_3271. Summary: '{summary_to_save[:100]}...'") # Log summary
                update_response = requests.put(update_url_obj10, headers=headers_knack_update, json=update_payload_obj10)
                update_response.raise_for_status()
                app.logger.info(f"Successfully updated field_3271 for Object_10 record {student_obj10_id_from_request}.")
            except requests.exceptions.HTTPError as e_http:
                app.logger.error(f"HTTP error updating field_3271 for Object_10 {student_obj10_id_from_request}: {e_http}. Response: {update_response.content}")
            except requests.exceptions.RequestException as e_req:
                app.logger.error(f"Request exception updating field_3271 for Object_10 {student_obj10_id_from_request}: {e_req}")
            except Exception as e_gen:
                app.logger.error(f"General error updating field_3271 for Object_10 {student_obj10_id_from_request}: {e_gen}")
        else:
            app.logger.info(f"Skipping update of field_3271 for Object_10 {student_obj10_id_from_request} as LLM summary was an error or unavailable: '{summary_to_save}'")
    else:
        app.logger.warning(f"Could not update field_3271 for Object_10 {student_obj10_id_from_request} as llm_structured_output or student_overview_summary was missing/invalid. LLM Output: {str(llm_structured_output)[:200]}...")

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
            # key_individual_question_insights_from_object29 is not directly placed here in API response, but used by LLM
            "historical_summary_scores": hist_scores_for_api
        }
        # For "Overall", we only need a subset of these fields, especially if it was handled by llm_structured_output already
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

# --- API Endpoint for AI Chat Turn ---
@app.route('/api/v1/chat_turn', methods=['POST'])
def chat_turn():
    data = request.get_json() # Ensure this line is present
    app.logger.info(f"Received request for /api/v1/chat_turn with data: {str(data)[:500]}...")

    student_object10_id = data.get('student_object10_record_id')
    chat_history = data.get('chat_history', []) 
    current_tutor_message = data.get('current_tutor_message')
    initial_ai_context = data.get('initial_ai_context') 
    student_level_from_context = initial_ai_context.get('student_level') if initial_ai_context else None
    app.logger.info(f"Chat turn: student_object10_id: {student_object10_id}, Student level from initial_ai_context: {student_level_from_context}") # ADDED LOG

    # --- NEW: Detect if a new topic is being initiated ---
    new_topic_being_initiated = data.get('new_topic_initiated', False)
    if new_topic_being_initiated:
        app.logger.info(f"New topic initiated for student {student_object10_id}.")

    # --- Student Name for Personalization (Fetch if not in initial_ai_context) ---
    student_name_for_chat = "the student"
    if initial_ai_context and initial_ai_context.get('student_name'):
        student_name_for_chat = initial_ai_context['student_name']
    elif student_object10_id: # Fallback to fetch from Object_10 if needed
        obj10_record = get_knack_record("object_10", record_id=student_object10_id)
        if obj10_record and obj10_record.get("field_187_raw"):
            student_name_for_chat = obj10_record.get("field_187_raw", {}).get("full", "the student")

    if not student_object10_id or not current_tutor_message:
        app.logger.error("chat_turn: Missing student_object10_record_id or current_tutor_message.")
        return jsonify({"error": "Missing student_object10_record_id or current_tutor_message"}), 400
    
    if not OPENAI_API_KEY:
        app.logger.error("chat_turn: OpenAI API key not configured.")
        save_chat_message_to_knack(student_object10_id, "Tutor", current_tutor_message)
        return jsonify({"ai_response": "I am currently unable to respond (AI not configured). Your message has been logged."}), 200

    tutor_message_saved_id = save_chat_message_to_knack(student_object10_id, "Tutor", current_tutor_message)
    if not tutor_message_saved_id:
        app.logger.error(f"chat_turn: Failed to save tutor's message to Knack for student {student_object10_id}.")

    # Calculate conversation depth (number of back-and-forth exchanges)
    conversation_depth = len([msg for msg in chat_history if msg.get('role') == 'user'])
    app.logger.info(f"Conversation depth: {conversation_depth} tutor messages")
    
    # Check if tutor is explicitly asking for activities
    tutor_asking_for_activity = any(phrase in current_tutor_message.lower() for phrase in [
        "suggest an activity", "recommend an activity", "what activity", "any activities",
        "activity suggestion", "activity recommendation", "activities to suggest", "could you suggest",
        "what can i suggest", "activities for", "exercises for", "what should we do", "how can i help",
        "what interventions", "practical steps", "action plan"
    ])

    # Determine effective conversation depth for activity suggestions
    effective_conversation_depth_for_activities = 0 if new_topic_being_initiated else conversation_depth
    app.logger.info(f"Original conversation depth: {conversation_depth}, Effective depth for activities: {effective_conversation_depth_for_activities}, New topic flag: {new_topic_being_initiated}")

    # Prepare student_level_for_prompt for use in the system message string
    student_level_for_prompt = student_level_from_context if student_level_from_context else 'unknown'
    
    messages_for_llm = [
        {"role": "system", "content": f"""You are an AI coaching colleague, a thought partner, here to help a tutor explore and understand their student, {student_name_for_chat}. Your primary goal is to facilitate the tutor's own thinking and insight generation.

CRITICAL: You are NOT here to provide immediate solutions or act as a "font of all knowledge." You are here to help the tutor understand their student deeply through collaborative exploration and Socratic dialogue. Avoid giving direct advice or lists of recommendations unless the tutor explicitly asks and the conversation has matured.

YOUR ROLE AS A COACH FOR THE TUTOR:
- Your primary function is to be a "coach for the coach."
- Any suggestions (like activities or coaching questions from the KBs) are for the TUTOR'S TOOLKIT. They are ideas for the TUTOR to consider using with the student.
- You are NOT to directly suggest activities or questions TO THE STUDENT through the tutor.
- Empower the tutor to make their own decisions about how and when to use any resources or suggestions that arise.
- Focus on asking the tutor questions that help them reflect, analyze, and strategize.

Your role is to help the tutor make connections between:
- The student's VESPA scores and their observed behaviors/comments.
- The student's questionnaire responses and their self-perceptions or stated goals.
- The student's academic data (profile, MEGs) and their attitudes or effort levels.
- Discrepancies or alignments between what the tutor observes and what various data points suggest.

CONVERSATION PRINCIPLES:
1. EXPLORE FIRST, SOLVE LATER (IF AT ALL): Always seek to deeply understand the tutor's perspective and the student's situation before even considering solutions. Often, your best role is to help the tutor arrive at their OWN solutions.
2. ASK, DON'T TELL: Use open-ended, probing, and reflective questions to guide the tutor's discovery process.
3. VALIDATE & PROBE: Acknowledge the tutor's observations, then dig deeper with questions like, "Tell me more about that..." or "What does that look like in practice?"
4. CONNECT DOTS (THROUGH QUESTIONS): Help the tutor see patterns and relationships by asking questions like, "I notice their Vision score is quite low. How do you see that connecting to what you've described as 'laziness'?"
5. FOSTER TUTOR OWNERSHIP: Empower the tutor to synthesize information and formulate their own hypotheses and strategies.

CONVERSATION TECHNIQUES TO EMPLOY:
- Open with curiosity: "That's an interesting observation about the 'laziness'. Can you share a specific example of what that looked like recently?"
- Probe for specifics: "When you say they're 'bright but unfocused,' what's the contrast you're seeing in their work or behavior?"
- Connect to data via questions: "Their questionnaire indicated X, but you're seeing Y. What do you make of that difference?"
- Explore contradictions: "It sounds like they are capable of [X - e.g., complex problem solving in one subject] but struggle with [Y - e.g., starting tasks in another]. What are your thoughts on why that might be?"
- Use tentative, reflective language: "I wonder if..." "Could it be that..." "What if the 'laziness' is perhaps a symptom of something else, like feeling overwhelmed or a lack of clear goals?" "How might their low Systems score (X/10) be playing a role in what you're observing with their 5 A-Levels?"

THINGS TO STRICTLY AVOID (especially in early to mid-conversation):
- DON'T jump to suggesting activities or solutions. Wait until the tutor asks or the conversation naturally arrives at a point where strategies are being explicitly discussed.
- DON'T lecture about VESPA theory. Instead, weave in data points (like a specific VESPA score) to inform a relevant question.
- DON'T provide lists of recommendations.
- DON'T act like you have all the answers. Your role is to help the *tutor* find theirs.
- DON'T overwhelm with too many points or questions at once. Aim for a natural, turn-by-turn conversational flow.

RESPONSE STRUCTURE (General Guideline):
- Briefly acknowledge/validate what the tutor has shared (1 sentence).
- Ask 1-2 thoughtful, exploratory questions that encourage deeper reflection or connect to data.
- If appropriate, make ONE tentative observation or connection to data, framed as a question or a point for the tutor to consider (e.g., "Given their low score in Systems, I'm wondering how they are managing the workload of 5 A-Levels?").
- End with an open question that invites the tutor to elaborate or consider a new angle.

Remember: The tutor knows their student best. Your job is to be a skilled questioner and a data-informed thought partner to help them unlock deeper understanding and effective strategies."""}
    ]
    
    # Add conversation depth guidance
    conversation_guidance = ""

    # Use effective_conversation_depth_for_activities for phase determination
    if effective_conversation_depth_for_activities < 3 and not tutor_asking_for_activity:
        conversation_guidance = f"""

CONVERSATION PHASE: Initial Exploration (turn {effective_conversation_depth_for_activities + 1} for {student_name_for_chat})
Your SOLE FOCUS is to help the tutor fully articulate their observations and concerns. You MUST NOT suggest any activities or solutions at this stage.

- Start by acknowledging the tutor's input and asking open-ended questions to understand their perspective more deeply.
- If the tutor mentions a general problem (e.g., "lazy," "unmotivated"), ask for specific examples: "Can you describe a recent situation where you observed this 'laziness'?" or "What does 'unfocused' look like in their work on a typical day?"
- Probe the context: "Does this happen in all subjects, or more in some than others?" "When did you first start noticing this?"
- Use data from the initial_ai_context (student snapshot, academic benchmarks, questionnaire summary - if provided in the RAG section) to formulate insightful, open-ended questions, but DO NOT state the data directly to the tutor. Instead, let the data inform your curiosity. For example, if Vision is low, you might ask, "I'm curious, how clear do you think {student_name_for_chat} is about why these A-Levels are important for their future?"
- ABSOLUTELY NO MENTION of activities, solutions, or direct advice from KBs. Stick to questions that encourage the tutor to elaborate and reflect. If any activity suggestions or details appear in the RAG context provided to you, you MUST IGNORE them for this turn and focus SOLELY on asking the tutor exploratory questions about the student.

Example AI Responses (Focus on questions):
"That sounds like a tricky situation with {student_name_for_chat}. When you say they seem 'lazy,' could you tell me more about what specific behaviors make you say that?"
"It's interesting you mention {student_name_for_chat} is 'bright but unfocused.' In what specific tasks or subjects does their brightness shine through, and where does the lack of focus become most apparent?"
"You've mentioned {student_name_for_chat} is doing 5 A-Levels, which is a significant workload. How do you see them managing the demands of that workload day-to-day?" """
    elif effective_conversation_depth_for_activities >= 3 and effective_conversation_depth_for_activities < 5 and not tutor_asking_for_activity:
        conversation_guidance = f"""

CONVERSATION PHASE: Deepening Understanding & Connecting Dots (turn {effective_conversation_depth_for_activities + 1} for {student_name_for_chat})
Continue to prioritize the tutor's insights. You are guiding them to connect information. NO DIRECT SOLUTIONS or activity suggestions unless explicitly asked by the tutor.

- Synthesize what the tutor has shared so far and ask questions that help them link their observations to potential underlying factors or data points (from initial_ai_context or RAG).
- Frame data-informed questions tentatively: "You've described {student_name_for_chat} as [tutor's observation, e.g., 'struggling with deadlines']. I also recall their Systems score was [e.g., 'quite low']. I wonder, do you see any connection there? How might their approach to organization be impacting this?"
- If RAG provides relevant VESPA statements or coaching insights, use them to inspire questions that probe deeper. E.g., if a RAG insight mentions procrastination related to low Vision, ask: "Sometimes, when students aren't crystal clear on their 'why,' tasks can feel less urgent. To what extent do you think {student_name_for_chat} has a strong sense of purpose for these subjects?"
- Explore contradictions or patterns: "So, on one hand, {student_name_for_chat} [shows strength X], but on the other hand, [shows challenge Y]. What are your thoughts on what might be happening there?"
- If the tutor is stuck, you can offer a very gentle, open-ended framing question based on a general coaching principle, e.g., "Often, behaviors like [observed behavior] can stem from various places like [general factor 1, e.g., skill gaps] or [general factor 2, e.g., mindset blocks]. Does either of those resonate more in {student_name_for_chat}'s case, or perhaps something else?"
- STILL NO unsolicited activity suggestions. If activity details are present in your RAG context, do NOT suggest them directly. Instead, if the conversation naturally leads to strategies, you might ask the TUTOR something like: "We've discussed [student's issue]. I'm seeing some potentially relevant activities in our resources, like [Activity Name from RAG, if highly relevant]. Would exploring that type of intervention be helpful for your planning with {student_name_for_chat} at this stage, or are there other areas you'd like to explore first?" The goal is to help the tutor build their own hypothesis and decide if/when to introduce an activity.

Example AI Responses (Focus on synthesis and deeper questioning):
"So, it sounds like this 'laziness' you mentioned earlier with {student_name_for_chat} is particularly noticeable when it comes to [specific task/subject], even though they're clearly capable in other areas like [strength]. What do you think is different about [specific task/subject] for them?"
"Given {student_name_for_chat}'s low Systems score (X/10) and the challenge of 5 A-Levels, I'm curious how they approach planning and organizing their work. What have you observed about their methods?"
"We've talked about [observation A] and [observation B]. Do you see any underlying themes or connections emerging in {student_name_for_chat}'s approach that might explain both?" """
    elif effective_conversation_depth_for_activities >= 5 and not tutor_asking_for_activity:
        conversation_guidance = f"""

CONVERSATION PHASE: Moving Towards Potential Strategies (turn {effective_conversation_depth_for_activities + 1} for {student_name_for_chat})
NOW, you can begin to gently transition towards exploring solutions, but the tutor MUST lead. Your role is to help them brainstorm or refine their own ideas first.

- Summarize the key insights and patterns that you and the tutor have discussed so far regarding {student_name_for_chat}.
- Explicitly ask the tutor for their thoughts on next steps or potential strategies: "Based on our conversation, what are your initial thoughts on how you might approach this with {student_name_for_chat}?" or "What kind of support or intervention do you feel would be most beneficial for them right now?"
- If the tutor offers ideas, help them elaborate or consider different angles. Ask clarifying questions about their proposed strategies.
- ONLY if the tutor seems unsure, or explicitly asks for your input ("What do you think?" or "Do you have any suggestions?"), THEN you can cautiously introduce a relevant idea. Frame it as a possibility, not a directive. Connect it clearly to the preceding discussion.
- If you do introduce an idea (e.g., a type of activity, a coaching question style), draw from relevant KBs (activities, questions provided in RAG). Present it conversationally: "One approach that sometimes helps in situations where a student [matches student's issue, e.g., 'lacks clear goals'] is to work on [relevant activity type, e.g., 'defining their vision']. For example, an activity like 'Ikigai' (if in RAG context) can help with that. Alternatively, a powerful coaching question could be [example question from RAG]. What are your thoughts on something along those lines?"
- Offer a MAXIMUM of 1-2 distinct ideas, and always loop back to the tutor: "Does that resonate with what you know about {student_name_for_chat}?" or "How might that fit into your upcoming conversations with them?"

Example AI Responses (Focus on tutor-led strategy, then cautious suggestion if asked):
"We've discussed quite a bit about {student_name_for_chat} – the challenges with [X], their strengths in [Y], and how their VESPA profile (e.g., low Vision at Z/10) might be playing a role. What are your initial thoughts on a good starting point for your next conversation with them?"
(If tutor asks for ideas): "That's a good question. Given our discussion about [student's specific issue, e.g., 'difficulty managing workload'], one area we could explore is strengthening their 'Systems'. There are activities like 'Pending, Doing, Done' (if in RAG) that focus on task management. Or, you might start by asking them, 'What's one change you could make to how you organize your week that would feel most helpful right now?' How do those options sound as a starting point?" """
    elif tutor_asking_for_activity:
        conversation_guidance = f"""

ACTIVITY/SOLUTION SUGGESTION PHASE (Tutor Initiated for {student_name_for_chat})
The tutor is explicitly asking for suggestions. Now you can more directly offer relevant ideas based on your conversation and the RAG context.

- Acknowledge the tutor's request clearly.
- Briefly link your suggestions back to the core issues you've discussed about {student_name_for_chat}. For example: "Okay, since we identified that {student_name_for_chat}'s main challenge seems to be [e.g., 'a lack of clear vision and subsequent motivation'], here are a couple of approaches from our resources that might be helpful..."
- Prioritize suggestions from the RAG context if relevant items (activities, coaching questions, statements) were provided for the current turn. Refer to activities by Name and mention if resources are available (as per RAG instructions). Suggest a coaching question or an adapted reflective statement as an alternative or complement.
- Offer 1-2 well-chosen suggestions. Explain the 'why' – how each suggestion addresses the student's specific needs that you've uncovered together.
- Keep it collaborative: "Which of these feels like it might be a good fit for {student_name_for_chat} and your coaching style?" or "What are your thoughts on trying one of these?"
- Be prepared to offer an alternative if the first suggestions don't resonate.

Example AI Response (Tutor has asked for activity suggestions):
"Okay, you're looking for some specific activities for {student_name_for_chat}. Based on our conversation, particularly around their [low Vision score of X and comments about lacking direction], a couple of things come to mind from the resources:

1.  The 'Ikigai' activity (if in RAG & relevant) could be really powerful. It's designed to help students connect their passions, skills, and what the world needs, which can build that sense of Vision. Resources are available for this one.
2.  Alternatively, or perhaps as a follow-up, you could explore some coaching questions like, 'If you could wave a magic wand, what would your ideal outcome be for this year, and what's one small step you could take towards that this week?' (adapt from RAG coaching_questions if available).

How do these options sound for {student_name_for_chat}?" """
    
    if conversation_guidance:
        messages_for_llm[0]["content"] += conversation_guidance

    if initial_ai_context:
        context_preamble = "Key previously generated insights for this student (use this as context for the current chat):\n"
        if initial_ai_context.get('student_overview_summary'):
            context_preamble += f"- Overall Student Snapshot: {initial_ai_context['student_overview_summary']}\n"
        if initial_ai_context.get('academic_benchmark_analysis'):
            context_preamble += f"- Academic Benchmark Analysis: {initial_ai_context['academic_benchmark_analysis']}\n"
        if initial_ai_context.get('questionnaire_interpretation_and_reflection_summary'):
            context_preamble += f"- Questionnaire Interpretation: {initial_ai_context['questionnaire_interpretation_and_reflection_summary']}\n"
        if student_level_from_context: # Add student level to initial context if available
             context_preamble += f"- Student Level: {student_level_from_context}\n"

        retrieved_context_parts = []
        suggested_activities_for_response = [] 

        if current_tutor_message:
            common_words = {
                "is", "a", "the", "and", "to", "of", "it", "in", "for", "on", "with", "as", "an", "at", "by", 
                "what", "how", "tell", "me", "about", "can", "you", "help", "student", "student's", "students",
                "i", "am", "my", "need", "her", "his", "him", "she", "he", "they", "them", "their", "concern", 
                "concerned", "issue", "problem", "regard", "regarding", "with", "this", "that", "these", "those",
                "think", "thinking", "feel", "feels", "feeling", "suggest", "suggestion", "suggestions", "advice", "idea", "ideas",
                "get", "give", "have", "has", "had", "do", "does", "did", "some", "any", "lot", "little", "bit",
                "very", "really", "quite", "much", "more", "less", "also", "too", "well", "good", "bad", "okay",
                "would", "should", "could", "may", "might", "must", "will", "shall", "from", "make", "making",
                "example", "examples", "way", "ways", "try", "trying", "want", "wants", "talk", "talking"
            }
            # Clean keywords more thoroughly
            cleaned_message = current_tutor_message.lower()
            for char_to_replace in ['?', '.', ',', '\'s', '\"', '\'']:
                cleaned_message = cleaned_message.replace(char_to_replace, '')
            
            keywords = [word for word in cleaned_message.split() if word not in common_words and len(word) > 2]
            app.logger.info(f"chat_turn RAG: Extracted keywords: {keywords} from message: '{current_tutor_message}'")

            vespa_element_from_problem = None
            message_lower = current_tutor_message.lower() # Use original lowercased message for element detection
            if "(vision related)" in message_lower or "vision related" in message_lower:
                vespa_element_from_problem = "VISION"
            elif "(effort related)" in message_lower or "effort related" in message_lower:
                vespa_element_from_problem = "EFFORT"
            elif "(systems related)" in message_lower or "systems related" in message_lower:
                vespa_element_from_problem = "SYSTEMS"
            elif "(practice related)" in message_lower or "practice related" in message_lower:
                vespa_element_from_problem = "PRACTICE"
            elif "(attitude related)" in message_lower or "attitude related" in message_lower:
                vespa_element_from_problem = "ATTITUDE"
            
            if vespa_element_from_problem:
                app.logger.info(f"chat_turn RAG: Detected VESPA element from problem: {vespa_element_from_problem}")

            # Search COACHING_INSIGHTS_DATA with enhanced relevance scoring
            relevant_coaching_insights_for_chat = []
            if COACHING_INSIGHTS_DATA and isinstance(COACHING_INSIGHTS_DATA, list):
                app.logger.info(f"chat_turn RAG: Searching COACHING_INSIGHTS_DATA ({len(COACHING_INSIGHTS_DATA)} items) for keywords: {keywords}")
                # Get more insights and be more generous with relevance scoring
                for insight in COACHING_INSIGHTS_DATA[:50]:  # Check more insights
                    if isinstance(insight, dict):
                        insight_name = insight.get('name', '').lower()
                        insight_summary = insight.get('summary', '').lower()
                        insight_description = insight.get('description', '').lower()
                        insight_tags = [tag.lower() for tag in insight.get('tags', [])]
                        insight_keywords = [kw.lower() for kw in insight.get('keywords', [])]
                        
                        # Calculate relevance score more generously
                        relevance_score = 0
                        
                        # Check for keyword matches
                        all_insight_text = insight_name + ' ' + insight_summary + ' ' + insight_description + ' ' + ' '.join(insight_tags) + ' ' + ' '.join(insight_keywords)
                        for keyword in keywords:
                            if len(keyword) > 3 and keyword in all_insight_text:
                                relevance_score += 2
                        
                        # Check for VESPA element match
                        if vespa_element_from_problem:
                            element_lower = vespa_element_from_problem.lower()
                            if element_lower in insight_tags or element_lower in insight_name or element_lower in insight_summary:
                                relevance_score += 3
                        
                        # Include insights with any relevance
                        if relevance_score > 0 and len(relevant_coaching_insights_for_chat) < 4:  # Increased to 4
                            relevant_coaching_insights_for_chat.append({
                                'name': insight.get('name'),
                                'summary': insight.get('summary') or insight.get('description', '')[:200],
                                'key_points': insight.get('key_points', [])[:3],  # Get key points if available
                                'relevance': relevance_score
                            })
                
                # Sort by relevance and take top insights
                relevant_coaching_insights_for_chat.sort(key=lambda x: x['relevance'], reverse=True)
                relevant_coaching_insights_for_chat = relevant_coaching_insights_for_chat[:3]
            
            if relevant_coaching_insights_for_chat:
                retrieved_context_parts.append("\n--- Relevant Research & Coaching Insights ---")
                retrieved_context_parts.append("Use these insights to inform your exploratory questions and observations:")
                for ci in relevant_coaching_insights_for_chat:
                    retrieved_context_parts.append(f"\n{ci['name']}:")
                    retrieved_context_parts.append(f"Research insight: {ci['summary']}")
                    if ci.get('key_points'):
                        retrieved_context_parts.append("This suggests exploring:")
                        for point in ci['key_points']:
                            retrieved_context_parts.append(f"  • {point}")
                retrieved_context_parts.append(f"\nUse these insights to ask deeper questions about {student_name_for_chat}'s situation.")
                app.logger.info(f"chat_turn RAG: Found {len(relevant_coaching_insights_for_chat)} relevant coaching insights.")
            else:
                app.logger.info("chat_turn RAG: No relevant coaching insights found.")
            
            # Search VESPA_ACTIVITIES_DATA
            if VESPA_ACTIVITIES_DATA:
                app.logger.info(f"chat_turn RAG: Searching VESPA_ACTIVITIES_DATA ({len(VESPA_ACTIVITIES_DATA)} items). Keywords: {keywords}. Student Level from context: {student_level_from_context}") # MODIFIED LOG to show level
                all_matched_activities_with_level_info = []

                for activity in VESPA_ACTIVITIES_DATA:
                    activity_text_to_search = (str(activity.get('keywords', [])).lower() +
                                               str(activity.get('name', '')).lower() +
                                               str(activity.get('short_summary', '')).lower() +
                                               str(activity.get('vespa_element', '')).lower())
                    
                    activity_level = activity.get('level', '') 
                    is_keyword_match = any(kw in activity_text_to_search for kw in keywords) if keywords else False # check if keywords is not empty
                    is_element_match_from_problem = vespa_element_from_problem and activity.get('vespa_element', '').upper() == vespa_element_from_problem

                    if is_keyword_match or is_element_match_from_problem:
                        activity_data = {
                            "id": activity.get('id', 'N/A'),
                            "name": activity.get('name', 'N/A'),
                            "short_summary": activity.get('short_summary', 'N/A'),
                            "pdf_link": activity.get('pdf_link', '#'),
                            "vespa_element": activity.get('vespa_element','N/A'),
                            "level": activity_level,
                            "is_element_match": is_element_match_from_problem
                        }
                        all_matched_activities_with_level_info.append(activity_data)
                
                app.logger.info(f"chat_turn RAG: Initial matched activities BEFORE sorting ({len(all_matched_activities_with_level_info)} found): {[(a['name'], a['level']) for a in all_matched_activities_with_level_info]}") # ADDED LOG

                def sort_key_activities(act):
                    score = 0
                    if act['is_element_match']: 
                        score += 100 # Strongest preference for direct element match
                    
                    # Level preference scoring
                    if student_level_from_context:
                        if act['level'] == student_level_from_context: # Exact level match
                            score += 60 # Increased preference for exact match
                        elif act['level'] == '' or not act['level']: # Level agnostic (Handbook)
                            score += 20 # Reduced preference when student level is known
                        elif student_level_from_context == "Level 2" and act['level'] == "Level 3":
                            score += 10 
                        elif student_level_from_context == "Level 3" and act['level'] == "Level 2":
                            score += 10
                    else: # No student level context, prioritize agnostic slightly more
                        if act['level'] == '' or not act['level']:
                             score += 30 # Still a good choice if level unknown
                    return score

                all_matched_activities_with_level_info.sort(key=sort_key_activities, reverse=True)
                app.logger.info(f"Sorted RAG activities (Top 5 with sort scores): {[(a['name'], a['level'], a['is_element_match'], sort_key_activities(a)) for a in all_matched_activities_with_level_info[:5]]}") # MODIFIED LOG to show sort score

                found_activities_count = 0
                current_found_activities_text_for_prompt = []
                processed_activity_ids = set()
                for activity_data in all_matched_activities_with_level_info:
                    if found_activities_count >= 3: break
                    if activity_data['id'] not in processed_activity_ids:
                        pdf_available_text = " (Resource PDF available)" if activity_data['pdf_link'] and activity_data['pdf_link'] != '#' else ""
                        level_display = f"Level: {activity_data.get('level')}" if activity_data.get('level') else 'Level: Agnostic (Handbook)'
                        current_found_activities_text_for_prompt.append(f"- Name: {activity_data['name']}, VESPA Element: {activity_data['vespa_element']}{pdf_available_text}. {level_display}. Summary: {activity_data['short_summary'][:100]}...")
                        
                        # Only add to the list for frontend if conditions are met
                        # Use effective_conversation_depth_for_activities for this check
                        # Corrected and simplified conditional logic:
                        condition_to_add_activity = (effective_conversation_depth_for_activities >= 3 or tutor_asking_for_activity)
                        if new_topic_being_initiated and not tutor_asking_for_activity:
                            condition_to_add_activity = False # If new topic and tutor isn't asking, don't add yet
                        
                        if condition_to_add_activity:
                            suggested_activities_for_response.append(activity_data)
                        
                        processed_activity_ids.add(activity_data['id'])
                        found_activities_count += 1
                
                app.logger.info(f"chat_turn RAG: Top {found_activities_count} activities selected for LLM prompt: {[(a['name'], a['level']) for a in suggested_activities_for_response]}") # ADDED LOG

                # Only include activities in RAG context if conversation is mature enough OR tutor is asking
                # Use effective_conversation_depth_for_activities here too
                include_activities_in_rag = (effective_conversation_depth_for_activities >= 3 or tutor_asking_for_activity)
                
                if current_found_activities_text_for_prompt and include_activities_in_rag: 
                    retrieved_context_parts.append("\n--- Provided VESPA Activities ---")
                    retrieved_context_parts.append("ONLY use the following activities if you choose to suggest one. For each, I've provided its Name, VESPA element, a Summary, Level and whether a PDF is available. When suggesting an activity, use its Name. Do NOT mention the ID. If a PDF is indicated as available, you can state that resources are available for it:")
                    if vespa_element_from_problem and any(a['is_element_match'] for a in all_matched_activities_with_level_info): # Check if any actual element matches were found
                        retrieved_context_parts.append(f"NOTE: Activities from {vespa_element_from_problem} element are prioritized if relevant, as the problem was identified as {vespa_element_from_problem}-related.")
                    retrieved_context_parts.extend(current_found_activities_text_for_prompt)
                    app.logger.info(f"chat_turn RAG: Found {found_activities_count} relevant VESPA activities for LLM. LLM prompt text: {current_found_activities_text_for_prompt}")
                elif current_found_activities_text_for_prompt and conversation_depth >= 2:
                    # Add a note that activities are available but not shown yet
                    retrieved_context_parts.append(f"\n[Note: There are relevant activities available that could be suggested once you better understand the tutor's needs.]")
                    app.logger.info(f"chat_turn RAG: {found_activities_count} activities found but not included in context yet (conversation depth: {conversation_depth})")
                else:
                    app.logger.info("chat_turn RAG: No relevant VESPA activities found to provide to LLM.")
            else:
                app.logger.info("chat_turn RAG: Skipped searching VESPA_ACTIVITIES_DATA (KB empty).")

            # Add relevant VESPA statements from vespa-statements.json
            relevant_vespa_statements = []
            if VESPA_STATEMENTS_DATA and isinstance(VESPA_STATEMENTS_DATA, dict):
                vespa_statements_list = VESPA_STATEMENTS_DATA.get('vespa_statements', {}).get('statements', [])
                if vespa_statements_list and isinstance(vespa_statements_list, list) and (keywords or vespa_element_from_problem):
                    # Filter statements by category matching our inferred element or keywords
                    for statement_obj in vespa_statements_list:
                        if isinstance(statement_obj, dict):
                            statement_category = statement_obj.get('category', '').lower()
                            statement_keywords = [kw.lower() for kw in statement_obj.get('keywords', [])]
                            
                            # Check if this statement's category matches our inferred element
                            if (vespa_element_from_problem and statement_category == vespa_element_from_problem.lower()) or \
                               (not vespa_element_from_problem and any(kw in statement_keywords for kw in keywords)):
                                
                                if len(relevant_vespa_statements) < 4:
                                    # Get both positive and negative indicators for balance
                                    indicators = statement_obj.get('student_indicators', {})
                                    if 'positive' in indicators and len(relevant_vespa_statements) < 2:
                                        for indicator in indicators['positive'][:1]:  # Take 1 positive
                                            relevant_vespa_statements.append({
                                                'element': statement_category.capitalize(),
                                                'type': 'positive',
                                                'text': indicator
                                            })
                                    if 'negative' in indicators:
                                        for indicator in indicators['negative'][:1]:  # Take 1 negative
                                            if len(relevant_vespa_statements) < 4:
                                                relevant_vespa_statements.append({
                                                    'element': statement_category.capitalize(),
                                                    'type': 'negative',
                                                    'text': indicator
                                                })
                            
                            if len(relevant_vespa_statements) >= 4:
                                break

            if relevant_vespa_statements:
                retrieved_context_parts.append("\n--- VESPA Framework Student Indicators ---")
                retrieved_context_parts.append("These indicators might help you explore what's happening:")
                current_element = None
                for vs in relevant_vespa_statements:
                    if vs['element'] != current_element:
                        current_element = vs['element']
                        retrieved_context_parts.append(f"\n{current_element} - Students might show:")
                    indicator_prefix = "✓" if vs['type'] == 'positive' else "✗"
                    retrieved_context_parts.append(f"  {indicator_prefix} {vs['text']}")
                retrieved_context_parts.append(f"\nExplore with the tutor: Which of these behaviors does {student_name_for_chat} show? What else have they noticed?")
                app.logger.info(f"chat_turn RAG: Found {len(relevant_vespa_statements)} relevant VESPA statement indicators.")
            
            # Search REFLECTIVE_STATEMENTS_DATA
            if REFLECTIVE_STATEMENTS_DATA and keywords:
                app.logger.info(f"chat_turn RAG: Searching REFLECTIVE_STATEMENTS_DATA ({len(REFLECTIVE_STATEMENTS_DATA)} items) for keywords: {keywords}")
                found_statements_count = 0
                current_found_statements = []
                if keywords:
                    for statement_text in REFLECTIVE_STATEMENTS_DATA:
                        if any(kw in statement_text.lower() for kw in keywords):
                            current_found_statements.append(f"- Statement: \"{statement_text[:150]}...\"")
                            found_statements_count += 1
                            if found_statements_count >= 2: break
                if current_found_statements:
                    retrieved_context_parts.append("\nRelevant Reflective Statements (from 100 statements - 2023.txt) the tutor could adapt:")
                    retrieved_context_parts.extend(current_found_statements)
                    app.logger.info(f"chat_turn RAG: Found {found_statements_count} relevant reflective statements.")
                else:
                    app.logger.info("chat_turn RAG: No relevant reflective statements found.")
            else:
                app.logger.info("chat_turn RAG: Skipped searching REFLECTIVE_STATEMENTS_DATA (KB empty or no keywords).")
            
            # Search COACHING_QUESTIONS_KNOWLEDGE_BASE (coaching_kb)
            coaching_question_trigger_keywords = {"question", "questions", "ask", "guide", "coach", "coaching", "empower", "help student think", "student to decide", "how should i ask", "what should i ask"}
            search_coaching_questions = any(kw in keywords for kw in coaching_question_trigger_keywords) or any(trigger_kw in current_tutor_message.lower() for trigger_kw in coaching_question_trigger_keywords)

            if coaching_kb and (keywords or search_coaching_questions):
                app.logger.info(f"chat_turn RAG: Searching coaching_kb for relevant questions. Keywords: {keywords}. Trigger: {search_coaching_questions}.")
                found_coaching_questions_count = 0
                current_found_coaching_questions = []
                # Search general introductory questions
                if coaching_kb.get('generalIntroductoryQuestions'):
                    for q_text in coaching_kb['generalIntroductoryQuestions']:
                        if any(kw in q_text.lower() for kw in keywords) or search_coaching_questions:
                            current_found_coaching_questions.append(f"- General Question: {q_text}")
                            found_coaching_questions_count += 1
                            if found_coaching_questions_count >= 3: break
                
                # Search VESPA specific questions if count is still low
                if found_coaching_questions_count < 3 and coaching_kb.get('vespaSpecificCoachingQuestions'):
                    for vespa_element, levels_data in coaching_kb['vespaSpecificCoachingQuestions'].items(): # renamed levels to levels_data
                        if found_coaching_questions_count >= 3: break
                        # Determine student level for KB lookup (e.g. "Level 3", "Level 2")
                        kb_student_level_key = student_level_from_context if student_level_from_context in levels_data else None
                        if not kb_student_level_key and student_level_from_context == "Level 3" and "Level 2" in levels_data: # Fallback
                            kb_student_level_key = "Level 2"
                        elif not kb_student_level_key and student_level_from_context == "Level 2" and "Level 3" in levels_data: # Fallback
                             kb_student_level_key = "Level 3"
                        
                        if kb_student_level_key and levels_data.get(kb_student_level_key):
                            for score_type, questions_list in levels_data[kb_student_level_key].items():
                                if found_coaching_questions_count >= 3: break
                                for q_text in questions_list:
                                    if any(kw in q_text.lower() for kw in keywords) or \
                                       (search_coaching_questions and (any(kw in vespa_element.lower() for kw in keywords) or any(kw in score_type.lower() for kw in keywords))):
                                        current_found_coaching_questions.append(f"- {vespa_element} ({kb_student_level_key} - {score_type}): {q_text}")
                                        found_coaching_questions_count += 1
                                        if found_coaching_questions_count >= 3: break
                                    elif search_coaching_questions and found_coaching_questions_count < 2 and not keywords: # Broader match if no keywords
                                        current_found_coaching_questions.append(f"- {vespa_element} ({kb_student_level_key} - {score_type}): {q_text}")
                                        found_coaching_questions_count += 1
                                        if found_coaching_questions_count >= 2: break 
                if current_found_coaching_questions:
                    retrieved_context_parts.append("\n--- Coaching Questions to Explore ---")
                    retrieved_context_parts.append("These questions from our knowledge base might help you and the tutor explore deeper:")
                    retrieved_context_parts.extend(current_found_coaching_questions)
                    retrieved_context_parts.append("\nAdapt these naturally into your conversation - perhaps: 'This makes me wonder...' or 'Have you considered asking {student_name_for_chat}...'")
                    app.logger.info(f"chat_turn RAG: Found {found_coaching_questions_count} relevant coaching questions.")
                else:
                    app.logger.info("chat_turn RAG: No specific coaching questions found from KB.")
            else:
                app.logger.info("chat_turn RAG: Skipped searching coaching_kb.")
        else: # if not current_tutor_message (though this path might be unlikely if function requires it)
            app.logger.info("chat_turn RAG: No current_tutor_message, skipping keyword-based RAG.")


        if retrieved_context_parts: 
            app.logger.info(f"chat_turn RAG: Final retrieved_context_parts count: {len(retrieved_context_parts)}")
            context_preamble += "\n\n--- Additional Context Retrieved from Knowledge Bases (Based on Tutor's Query) ---\n"
            context_preamble += "Use the following information to formulate your response. Remember the guidelines on synthesizing, explaining relevance, and practical application.\n"
            if vespa_element_from_problem:
                context_preamble += f"IMPORTANT: The tutor has indicated a {vespa_element_from_problem}-related problem. If relevant activities from this element are listed under '--- Provided VESPA Activities ---', prioritize suggesting one.\n"
            context_preamble += "\n"
            context_preamble += "\n".join(retrieved_context_parts)

        context_preamble += "\n\nGiven the student's overall profile (from initial context) and any specific items just retrieved from the knowledge bases (detailed above), please respond to the tutor's latest message. Adhere to all persona and response guidelines."
        messages_for_llm.insert(1, {"role": "system", "content": context_preamble}) 
        app.logger.info(f"chat_turn: Added initial_ai_context and RAG context to LLM prompt. Pre-amble length: {len(context_preamble)}")
    else: # if not initial_ai_context
        app.logger.info("chat_turn: No initial_ai_context provided. Proceeding without RAG for this turn.")


    # Add existing chat history
    for message in chat_history:
        # Prepend a marker if the tutor liked this message
        content = message.get("content", "")
        if message.get("is_liked") and message.get("role") == "assistant": # Mark liked AI responses
            content = f"[Tutor Liked This Assistant Response]: {content}"
        elif message.get("is_liked") and message.get("role") == "user": # Or if user message was somehow marked as liked contextually
            content = f"[Tutor Indicated This Was Important User Context]: {content}"
        messages_for_llm.append({"role": message.get("role"), "content": content}) 
    # Add current tutor message
    messages_for_llm.append({"role": "user", "content": current_tutor_message})

    ai_response_text = "An error occurred while generating my response."
    try:
        app.logger.info(f"chat_turn: Sending to LLM. Number of messages: {len(messages_for_llm)}. First system message length: {len(messages_for_llm[0]['content'])}. Second system message (context) length (if present): {len(messages_for_llm[1]['content']) if len(messages_for_llm) > 1 and messages_for_llm[1]['role'] == 'system' else 'N/A'}")
        
        # Prepend new topic instruction if applicable
        final_user_message_for_llm = current_tutor_message
        if new_topic_being_initiated:
            final_user_message_for_llm = f"[TUTOR IS STARTING A COMPLETELY NEW DISCUSSION TOPIC. Focus your response solely on the following message as if it's the beginning of a new conversation. Do not refer to previous topics unless the tutor explicitly does so in this new message.] {current_tutor_message}"
            # Remove the last user message (which is the original current_tutor_message) and add the modified one
            if messages_for_llm[-1]["role"] == "user":
                messages_for_llm.pop()
            messages_for_llm.append({"role": "user", "content": final_user_message_for_llm})
            app.logger.info("Prepended NEW TOPIC instruction to user message for LLM.")

        response = openai.chat.completions.create(
            model="gpt-4o-mini", # Using more capable model for better conversational quality
            messages=messages_for_llm,
            max_tokens=400, # Slightly increased to allow for thoughtful exploration
            temperature=0.7, # Balanced temperature for natural yet focused conversation
            n=1,
            stop=None
        )
        ai_response_text = response.choices[0].message.content.strip()
        app.logger.info(f"chat_turn: LLM raw response: {ai_response_text}")

    except Exception as e:
        app.logger.error(f"chat_turn: Error calling OpenAI API: {e}")
        # ai_response_text will remain the default error message

    ai_message_saved_id = save_chat_message_to_knack(student_object10_id, "AI Coach", ai_response_text)
    if not ai_message_saved_id:
        app.logger.error(f"chat_turn: Failed to save AI's response to Knack for student {student_object10_id}.")

    return jsonify({
        "ai_response": ai_response_text, 
        "suggested_activities_in_chat": suggested_activities_for_response,
        "ai_message_knack_id": ai_message_saved_id # Ensure this is returned
    })

def save_chat_message_to_knack(student_obj10_id, sender, message_text):
    """Saves a chat message to the new Object_118 in Knack."""
    if not student_obj10_id or not sender or not message_text:
        app.logger.error("save_chat_message_to_knack: Missing required parameters.")
        return None

    # --- Knack Field Mappings for Object_118 (AIChatLog) ---
    # Object Key: object_118
    # field_3275: Tutor Report Conversation (Connection to Object_10)
    # field_3276: Message Timestamp (Date/Time)
    # field_3273: Author (Short Text) -> Sender
    # field_3277: Conversation Log (Paragraph Text) -> MessageText
    # field_3278: Log Sequence (Auto Increment) -> Knack handles this.
    # field_3274: Student (Connection to Student Object_6)
    # field_3279: Liked (Yes/No Boolean)

    knack_object_key_chatlog = "object_118"
    
    # 1. Fetch the Object_10 record to get the connection to Object_6 (Student)
    student_object_6_id = None
    if student_obj10_id:
        object_10_record = get_knack_record("object_10", record_id=student_obj10_id)
        if object_10_record and isinstance(object_10_record, dict): # specific record fetch returns dict directly
            # field_132 in Object_10 is 'Student' connecting to Object_6 'Students'
            student_connection_raw = object_10_record.get("field_132_raw")
            if isinstance(student_connection_raw, list) and student_connection_raw:
                student_object_6_id = student_connection_raw[0].get('id')
                app.logger.info(f"Found student Object_6 ID: {student_object_6_id} from Object_10.field_132_raw")
            else:
                app.logger.warning(f"Could not extract student Object_6 ID from Object_10 record's field_132_raw. Data: {student_connection_raw}")
        else:
            app.logger.warning(f"Could not fetch Object_10 record for ID: {student_obj10_id} to get student connection.")

    # 2. Prepare current timestamp for Knack
    # Knack often prefers 'MM/DD/YYYY HH:MM:SS AM/PM' or ISO 8601. Let's try ISO.
    # Or, if Knack field is Date/Time, often 'MM/DD/YYYY HH:mm' is fine.
    # Let's use a common format Knack usually accepts for Date/Time fields.
    current_timestamp_knack_format = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

    payload = {
        "field_3275": student_obj10_id, 
        "field_3273": sender,
        "field_3277": message_text,
        "field_3276": current_timestamp_knack_format 
        # field_3279 (Liked) will default to "No" or Knack's default for boolean.
        # It will be updated by a separate 'like' function.
    }

    if student_object_6_id:
        payload["field_3274"] = student_object_6_id
    else:
        app.logger.warning(f"student_object_6_id is None for Object_10 ID {student_obj10_id}. Chat log will not be linked to Object_6.")

    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    url = f"{KNACK_BASE_URL}/{knack_object_key_chatlog}/records"

    try:
        app.logger.info(f"Saving chat message to Knack ({knack_object_key_chatlog}). Payload: {payload}")
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        saved_record = response.json()
        app.logger.info(f"Successfully saved chat message to Knack. Record ID: {saved_record.get('id')}")
        return saved_record.get('id')
    except requests.exceptions.HTTPError as e:
        app.logger.error(f"HTTP error saving chat message to Knack: {e}")
        app.logger.error(f"Response content: {response.content}")
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request exception saving chat message to Knack: {e}")
    except json.JSONDecodeError:
        app.logger.error(f"JSON decode error for Knack response when saving chat. Response: {response.text}")
    return None

# --- API Endpoint for Updating Chat Like Status ---
@app.route('/api/v1/update_chat_like', methods=['POST'])
def update_chat_like():
    data = request.get_json()
    app.logger.info(f"Received request for /api/v1/update_chat_like with data: {data}")

    message_knack_id = data.get('message_id')
    is_liked_status = data.get('is_liked') # This should be a boolean true/false

    if not message_knack_id or is_liked_status is None:
        app.logger.error("update_chat_like: Missing message_id or is_liked status.")
        return jsonify({"error": "Missing message_id or is_liked status"}), 400

    # Convert boolean to Knack's expected Yes/No string for field_3279
    knack_liked_value = "Yes" if is_liked_status else "No"

    knack_object_key_chatlog = "object_118"
    payload = {
        "field_3279": knack_liked_value
    }

    headers = {
        'X-Knack-Application-Id': KNACK_APP_ID,
        'X-Knack-REST-API-Key': KNACK_API_KEY,
        'Content-Type': 'application/json'
    }
    url = f"{KNACK_BASE_URL}/{knack_object_key_chatlog}/records/{message_knack_id}"

    try:
        app.logger.info(f"Updating chat message like status in Knack ({knack_object_key_chatlog}, record: {message_knack_id}). Payload: {payload}")
        response = requests.put(url, headers=headers, json=payload) # Use PUT for updates
        response.raise_for_status()
        updated_record = response.json()
        app.logger.info(f"Successfully updated like status for chat message. Record: {updated_record}")
        return jsonify({"success": True, "message": "Like status updated", "record": updated_record}), 200
    except requests.exceptions.HTTPError as e:
        app.logger.error(f"HTTP error updating like status in Knack: {e}")
        app.logger.error(f"Response content: {response.content}")
        return jsonify({"error": "Failed to update like status in Knack", "details": str(e)}), 500
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request exception updating like status in Knack: {e}")
        return jsonify({"error": "Failed to communicate with Knack API", "details": str(e)}), 500
    except json.JSONDecodeError:
        app.logger.error(f"JSON decode error for Knack response when updating like status. Response: {response.text}")
        return jsonify({"error": "Invalid response from Knack API"}), 500

# --- API Endpoint for Fetching Chat History ---
@app.route('/api/v1/chat_history', methods=['POST'])
def get_chat_history():
    data = request.get_json()
    app.logger.info(f"Received request for /api/v1/chat_history with data: {data}")

    student_obj10_id = data.get('student_object10_record_id')
    max_messages = data.get('max_messages', 50)
    # days_back = data.get('days_back', 30) # We'll sort by date and take latest, days_back is complex with Knack filters
    include_metadata = data.get('include_metadata', True) # Assumed true by frontend

    if not student_obj10_id:
        app.logger.error("get_chat_history: Missing student_object10_record_id.")
        return jsonify({"error": "Missing student_object10_record_id"}), 400

    knack_object_key_chatlog = "object_118"
    filters = [
        {'field': 'field_3275', 'operator': 'is', 'value': student_obj10_id}
    ]
    # Knack sort order: field_key | direction (asc/desc)
    sort_order = 'field_3276|desc' # Sort by Message Timestamp descending (latest first)

    # Fetch records using a potentially modified get_all_knack_records or a specific fetch for this
    # For now, let's assume get_knack_record can handle sort and limit if we adapt it slightly
    # or we fetch a larger set and process. get_all_knack_records fetches all, then we sort/slice.

    app.logger.info(f"Fetching chat history for {student_obj10_id} from {knack_object_key_chatlog} with filters: {filters} and sort: {sort_order}")    
    
    # Knack API v1 doesn't directly support `sort` in GET /records, only `sort_field` and `sort_order`
    # and `rows_per_page` for limiting. We might need to fetch more and sort in Python if complex sorting is needed.
    # However, for simple sort by one field, we can try to use the Knack parameters.
    
    # Let's use get_knack_record and fetch up to a reasonable number (e.g. 2*max_messages) and then sort and slice in Python
    # as Knack's direct sorting in query params can be tricky with all record fetching.
    # For simplicity, we will fetch all records for the student and then sort/slice.
    # This might be inefficient for students with vast histories, but aligns with the 50 record idea.
    
    all_student_chats_response = get_knack_record(
        knack_object_key_chatlog, 
        filters=filters, 
        page=1, # Start with page 1
        rows_per_page=max_messages * 2 # Fetch a bit more to ensure we have enough after potential filtering, max 1000 for Knack
    )

    all_student_chat_records = []
    if all_student_chats_response and isinstance(all_student_chats_response, dict) and 'records' in all_student_chats_response:
        all_student_chat_records = all_student_chats_response['records']
        app.logger.info(f"Fetched initial {len(all_student_chat_records)} chat records for student {student_obj10_id}.")
    else:
        app.logger.warning(f"No chat records found or unexpected response format for student {student_obj10_id}. Response: {all_student_chats_response}")
        return jsonify({"chat_history": [], "total_count": 0, "liked_count": 0, "summary": "No chat history found."}), 200

    # Sort the records by timestamp (field_3276) in descending order (latest first)
    # Knack date format is dd/mm/yyyy HH:MM:SS. Need to parse this for correct sorting.
    def get_datetime_from_knack_timestamp(ts_str):
        if not ts_str: return datetime.min
        try:
            return datetime.strptime(ts_str, '%d/%m/%Y %H:%M:%S')
        except ValueError:
            app.logger.warning(f"Could not parse Knack timestamp: {ts_str}. Using fallback date for sorting.")
            return datetime.min # Fallback for unparseable dates

    all_student_chat_records.sort(key=lambda r: get_datetime_from_knack_timestamp(r.get('field_3276')), reverse=True)

    # Slice to get the actual max_messages
    recent_chat_records = all_student_chat_records[:max_messages]

    chat_history_for_frontend = []
    liked_count = 0
    for record in recent_chat_records:
        is_liked = record.get('field_3279') == "Yes"
        if is_liked:
            liked_count += 1
        
        chat_history_for_frontend.append({
            "id": record.get('id'),
            "role": "assistant" if record.get('field_3273') == "AI Coach" else "user",
            "content": record.get('field_3277', ""),
            "is_liked": is_liked,
            "timestamp": record.get('field_3276') # Keep original timestamp for display if needed
        })
    
    # Reverse again to have chronological order for display (oldest of the recent batch first)
    chat_history_for_frontend.reverse()

    # Summary: Use the one from Object_10, field_3271 if available
    # This requires fetching the Object_10 record again, or passing it if available elsewhere
    summary_text = "Could not load conversation summary."
    object_10_record_for_summary = get_knack_record("object_10", record_id=student_obj10_id)
    if object_10_record_for_summary and isinstance(object_10_record_for_summary, dict):
        summary_text = object_10_record_for_summary.get("field_3271", "No summary available in Object_10.")
    
    total_chat_count_for_student = len(all_student_chat_records) # This is the count before slicing for max_messages

    app.logger.info(f"Returning {len(chat_history_for_frontend)} messages for chat history. Total for student: {total_chat_count_for_student}. Liked: {liked_count}")
    return jsonify({
        "chat_history": chat_history_for_frontend,
        "total_count": total_chat_count_for_student, # Total messages for this student
        "liked_count": liked_count,
        "summary": summary_text
    }), 200

# --- API Endpoint for Clearing Old Chats ---
@app.route('/api/v1/clear_old_chats', methods=['POST'])
def clear_old_chats():
    data = request.get_json()
    app.logger.info(f"Received request for /api/v1/clear_old_chats with data: {data}")

    student_obj10_id = data.get('student_object10_record_id')
    keep_liked = data.get('keep_liked', True)
    target_count_after_clear = data.get('target_count', 150) # Target number of messages to remain

    if not student_obj10_id:
        app.logger.error("clear_old_chats: Missing student_object10_record_id.")
        return jsonify({"error": "Missing student_object10_record_id"}), 400

    knack_object_key_chatlog = "object_118"
    filters = [
        {'field': 'field_3275', 'operator': 'is', 'value': student_obj10_id}
    ]

    # Fetch ALL chat records for the student
    all_chats_for_student = get_all_knack_records(knack_object_key_chatlog, filters=filters, max_pages=50) # Limit pages to prevent runaway

    if not all_chats_for_student:
        app.logger.info(f"No chat records found for student {student_obj10_id} to clear.")
        return jsonify({"message": "No chats to clear.", "deleted_count": 0, "remaining_count": 0}), 200

    # Sort by timestamp ascending (oldest first)
    def get_datetime_from_knack_timestamp_for_clear(ts_str):
        if not ts_str: return datetime.max # Sort None/empty to the end if sorting ascending
        try:
            return datetime.strptime(ts_str, '%d/%m/%Y %H:%M:%S')
        except ValueError:
            return datetime.max
            
    all_chats_for_student.sort(key=lambda r: get_datetime_from_knack_timestamp_for_clear(r.get('field_3276')))

    num_to_delete = len(all_chats_for_student) - target_count_after_clear
    deleted_count = 0
    actual_records_deleted_ids = []

    if num_to_delete > 0:
        app.logger.info(f"Need to delete {num_to_delete} chats for student {student_obj10_id} to reach target of {target_count_after_clear}.")
        delete_candidates = []
        for record in all_chats_for_student:
            if keep_liked and record.get('field_3279') == "Yes":
                continue # Skip liked messages
            delete_candidates.append(record.get('id'))
        
        # Delete from the oldest of the candidates
        records_to_actually_delete_ids = delete_candidates[:num_to_delete]

        headers = {
            'X-Knack-Application-Id': KNACK_APP_ID,
            'X-Knack-REST-API-Key': KNACK_API_KEY
        }

        for record_id_to_delete in records_to_actually_delete_ids:
            if not record_id_to_delete: continue
            delete_url = f"{KNACK_BASE_URL}/{knack_object_key_chatlog}/records/{record_id_to_delete}"
            try:
                response = requests.delete(delete_url, headers=headers)
                response.raise_for_status()
                app.logger.info(f"Successfully deleted chat record ID: {record_id_to_delete}")
                deleted_count += 1
                actual_records_deleted_ids.append(record_id_to_delete)
            except requests.exceptions.HTTPError as e:
                app.logger.error(f"HTTP error deleting chat record {record_id_to_delete}: {e}. Response: {response.content}")
            except requests.exceptions.RequestException as e:
                app.logger.error(f"Request exception deleting chat record {record_id_to_delete}: {e}")
    else:
        app.logger.info(f"No chats need to be deleted for student {student_obj10_id}. Current count: {len(all_chats_for_student)}, Target: {target_count_after_clear}.")

    remaining_count = len(all_chats_for_student) - deleted_count
    return jsonify({
        "message": f"Clear old chats process completed. Deleted {deleted_count} unliked chats.",
        "deleted_count": deleted_count,
        "remaining_count": remaining_count,
        "deleted_ids": actual_records_deleted_ids
    }), 200

if __name__ == '__main__':
    # Ensure the FLASK_ENV is set to development for debug mode if not using `flask run`
    # For Heroku, Gunicorn will be used as specified in Procfile
    port = int(os.environ.get('PORT', 5001))
    # When running locally with `python app.py`, debug should be True.
    # Heroku will set PORT, and debug should ideally be False in production.
    is_local_run = __name__ == '__main__' and not os.environ.get('DYNO')
    app.run(debug=is_local_run, port=port, host='0.0.0.0') 