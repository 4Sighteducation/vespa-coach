import csv
import os
import openai
import pdfplumber
from urllib.parse import unquote
from dotenv import load_dotenv
import time
import logging
import json

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Load Environment Variables (for OPENAI_API_KEY) ---
# Assumes .env file is in the same directory as this script, or an ancestor directory.
# For running within AIVESPACoach/backend/, it will find the .env file there.

# Corrected .env loading:
# The script is IN Homepage/AIVESPACoach/backend/Activity_PDFs/
# The .env file is ALSO IN Homepage/AIVESPACoach/backend/Activity_PDFs/
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path)
if os.getenv("OPENAI_API_KEY"):
    logging.info(f"Loaded .env file from {dotenv_path}")
else:
    logging.warning(f".env file not found at {dotenv_path} or OPENAI_API_KEY not set within it.")

openai.api_key = os.getenv("OPENAI_API_KEY")

if not openai.api_key:
    logging.error("CRITICAL: OPENAI_API_KEY is not set. The script cannot proceed without it.")
    exit()
else:
    logging.info("OpenAI API key loaded successfully.")

# --- Configuration ---
# Adjust paths if your script is located elsewhere relative to VESPAPDFScaper
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) # This is Homepage/AIVESPACoach/backend/Activity_PDFs/

# Path to the VESPAPDFScaper directory from the script's location
# Script is in .../backend/Activity_PDFs/
# VESPAPDFScaper is in .../Apps/VESPAPDFScaper/
# So, we need to go up three levels from SCRIPT_DIR to get to 'Apps', then into 'VESPAPDFScaper'
GRANDPARENT_DIR_OF_BACKEND = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..")) # This should be .../Homepage/AIVESPACoach/
APPS_DIR = os.path.abspath(os.path.join(GRANDPARENT_DIR_OF_BACKEND, "..", "..")) # This should be .../Apps/

VESPAPDFSCAPER_ROOT_DIR = os.path.join(APPS_DIR, "VESPAPDFScaper")
ACTIVITY_PDFS_METADATA_AND_SUBFOLDERS_DIR = os.path.join(VESPAPDFSCAPER_ROOT_DIR, "Activity_PDFs")

CSV_INPUT_FILE = os.path.join(SCRIPT_DIR, "vespa_pdf_worksheets.csv")
CSV_OUTPUT_FILE = os.path.join(SCRIPT_DIR, "vespa_pdf_worksheets_processed.csv")
PDF_BASE_DIR = SCRIPT_DIR # The PDF subfolders are directly inside this
PDF_SUBFOLDERS = ["GENERALPDFS", "LEVEL2PDFS", "LEVEL3PDFS"]

# Column indices from your CSV (0-based)
# "Worksheets Name,Activity Order,LEVEL,Multiple Choice,Tutor Activity Level,Welsh,PDF Link,..."
COL_WORKSHEET_NAME = 0
COL_LEVEL = 2
COL_VESPA_ELEMENT = 3 # This was "Multiple Choice" in the header
COL_PDF_LINK = 6      # The URL of the PDF
COL_TEXT_FORMULA_ID = 9 # For unique ID in JSON output

# Output columns to be filled (these are new or will be overwritten)
# O: Research Basis (index 14)
# P: Short Summary (index 15)
# Q: Long Summary (index 16)
# R: Key Words (index 17)
# Ensure your input CSV has headers up to at least column R for this to work smoothly when writing.
COL_RESEARCH_BASIS_OUT = "Research Basis"
COL_SHORT_SUMMARY_OUT = "Short Summary"
COL_LONG_SUMMARY_OUT = "Long Summary"
COL_KEYWORDS_OUT = "Key Words"

# --- Helper Functions ---

def find_pdf_file(pdf_filename_from_url, base_dir, subfolders):
    """
    Cleans the filename derived from URL and searches for it in specified subfolders.
    Now processes files even if '(editable)' is in their URL-derived name,
    but will prefer non-editable if both non-editable and editable versions exist locally with the same base name.
    """
    # Decode URL-encoded characters like %20 -> space
    cleaned_filename_from_url = unquote(pdf_filename_from_url)
    base_name, ext = os.path.splitext(cleaned_filename_from_url)
    is_editable_in_url = "(editable)" in base_name.lower()

    # Construct the non-editable version of the filename first to prioritize it
    non_editable_base_name = base_name.lower().replace("(editable)", "").strip()
    non_editable_filename_to_search = non_editable_base_name + ext

    # First, try to find the non-editable version
    for folder in subfolders:
        potential_path_non_editable = os.path.join(base_dir, folder, non_editable_filename_to_search)
        # Case-insensitive check for actual file system
        # We list dir and check case-insensitively because os.path.exists can be case-sensitive on some systems
        # For simplicity here, we will rely on the direct check, assuming consistent casing or case-insensitive FS.
        # A more robust way would be to list files in `os.path.join(base_dir, folder)` and compare lowercased names.
        if os.path.exists(potential_path_non_editable):
            logging.info(f"Found non-editable PDF: {potential_path_non_editable}")
            return potential_path_non_editable

    # If non-editable wasn't found, AND the original URL-derived name was editable, try finding that exact editable file
    if is_editable_in_url:
        for folder in subfolders:
            potential_path_editable = os.path.join(base_dir, folder, cleaned_filename_from_url) # Use original case from URL for lookup
            if os.path.exists(potential_path_editable):
                logging.info(f"Found editable PDF (as per URL): {potential_path_editable}")
                return potential_path_editable
    
    # If the URL was for a non-editable version but we didn't find it above, it's truly not found.
    # If the URL was for an editable version, and we didn't find that specific editable version, it's not found.
    logging.warning(f"PDF file derived from URL '{cleaned_filename_from_url}' (or its non-editable variant '{non_editable_filename_to_search}') not found in any subfolder: {subfolders} under {base_dir}")
    return None

def extract_text_from_pdf(pdf_path):
    """Extracts all text from a PDF file using pdfplumber."""
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
                # logging.info(f"Extracted text from page {page_num + 1} of {pdf_path}")
        logging.info(f"Successfully extracted {len(text)} characters from {pdf_path}")
        return text.strip()
    except Exception as e:
        logging.error(f"Error extracting text from {pdf_path}: {e}")
        return None

def get_llm_completion(prompt_messages, max_tokens=150, temperature=0.5):
    """Generic function to get completion from OpenAI."""
    try:
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo", # Or your preferred model
            messages=prompt_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            n=1,
            stop=None
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logging.error(f"OpenAI API call failed: {e}")
        # Fallback for rate limit errors specifically
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
                    stop=None
                )
                return response.choices[0].message.content.strip()
            except Exception as e2:
                 logging.error(f"OpenAI API call failed on retry: {e2}")
                 return None # Or a default error string
        return None # Or a default error string

# --- Main Processing Logic ---
def main():
    logging.info(f"Starting PDF processing. Input CSV: {CSV_INPUT_FILE}")
    
    processed_rows_for_csv = [] # To store rows for the new CSV
    header = []

    try:
        with open(CSV_INPUT_FILE, 'r', newline='', encoding='utf-8-sig') as infile: # utf-8-sig to handle BOM
            reader = csv.reader(infile)
            header = next(reader) # Read the header row

            # Ensure new columns are in the header for writing, if not already
            new_cols = [COL_RESEARCH_BASIS_OUT, COL_SHORT_SUMMARY_OUT, COL_LONG_SUMMARY_OUT, COL_KEYWORDS_OUT]
            output_header = list(header) # Start with a copy of the original header

            # Add new column headers if they don't exist - this assumes we're APPENDING columns
            # If your CSV *already* has these headers, this step isn't strictly needed but ensures correctness.
            # Your CSV has 17 columns (0-16). New columns are 14,15,16,17 (O,P,Q,R)
            # This means your existing header should be long enough.
            # Let's assume the headers ARE present as per your description.

            processed_rows_for_csv.append(output_header) # Add header to the output list

            for i, row in enumerate(reader):
                logging.info(f"\nProcessing row {i+1}...")
                if len(row) < max(COL_WORKSHEET_NAME, COL_PDF_LINK) + 1:
                    logging.warning(f"Skipping row {i+1} due to insufficient columns: {row}")
                    # Add original row to output if it's too short to process, to not lose data
                    processed_rows_for_csv.append(list(row)) # Ensure it's a copy
                    continue

                activity_name = row[COL_WORKSHEET_NAME]
                pdf_link = row[COL_PDF_LINK]
                logging.info(f"Activity: '{activity_name}', PDF Link: '{pdf_link}'")

                # Ensure the row has enough columns for the output fields, extend if necessary
                # The input CSV has 17 columns. We want to write to indices 14, 15, 16, 17
                while len(row) < len(output_header):
                    row.append("") # Pad with empty strings if row is shorter than header

                # Skip if PDF link is empty
                if not pdf_link:
                    logging.warning(f"Skipping '{activity_name}' due to empty PDF link.")
                    processed_rows_for_csv.append(list(row))
                    continue
                
                pdf_filename = os.path.basename(pdf_link)
                pdf_filepath = find_pdf_file(pdf_filename, PDF_BASE_DIR, PDF_SUBFOLDERS)

                if pdf_filepath:
                    extracted_text = extract_text_from_pdf(pdf_filepath)
                    if extracted_text and len(extracted_text) > 50: # Process only if meaningful text extracted
                        
                        # 1. Research Basis
                        logging.info(f"Generating Research Basis for '{activity_name}'...")
                        research_prompt = [
                            {"role": "system", "content": "You are an expert in educational psychology and pedagogy."},
                            {"role": "user", "content": f"Review the following text from an educational activity worksheet titled '{activity_name}'. Based SOLELY on the provided text, identify and briefly state if any specific research basis, educational theory, or psychological principle is EXPLICITLY mentioned or strongly implied as underpinning the activity. If no such basis is clearly evident in the text, respond with 'Not specified in text'. Do not infer or add external knowledge. Focus only on what the text itself reveals.\n\nWorksheet Text:\n---\n{extracted_text[:4000]}\n---\nResearch Basis:"}
                        ]
                        research_basis = get_llm_completion(research_prompt, max_tokens=100, temperature=0.3)
                        row[header.index(COL_RESEARCH_BASIS_OUT)] = research_basis or "LLM Error"
                        time.sleep(1) # Small delay

                        # 2. Short Summary
                        logging.info(f"Generating Short Summary for '{activity_name}'...")
                        short_summary_prompt = [
                            {"role": "system", "content": "You are an expert at creating concise summaries."},
                            {"role": "user", "content": f"Create a very concise 1-2 sentence summary (maximum 40 words) of the main purpose of the following educational activity titled '{activity_name}'.\n\nWorksheet Text:\n---\n{extracted_text[:3000]}\n---\nShort Summary:"}
                        ]
                        short_summary = get_llm_completion(short_summary_prompt, max_tokens=60, temperature=0.5)
                        row[header.index(COL_SHORT_SUMMARY_OUT)] = short_summary or "LLM Error"
                        time.sleep(1)

                        # 3. Long Summary
                        logging.info(f"Generating Long Summary for '{activity_name}'...")
                        long_summary_prompt = [
                             {"role": "system", "content": "You are an expert at creating detailed and informative summaries of educational activities for tutors."},
                             {"role": "user", "content": f"For the educational activity titled '{activity_name}', based on the provided text, write a detailed summary of 80-150 words. The summary should clearly explain:\n1. The main purpose or learning objective of this activity.\n2. The key steps or tasks a student is expected to perform.\n3. The primary benefits or outcomes for a student engaging in this activity.\nFocus on providing information that would help a tutor quickly understand what the activity is about and when it might be useful to suggest to a student.\n\nWorksheet Text:\n---\n{extracted_text[:4000]}\n---\nDetailed Summary:"}
                        ]
                        long_summary = get_llm_completion(long_summary_prompt, max_tokens=200, temperature=0.6)
                        row[header.index(COL_LONG_SUMMARY_OUT)] = long_summary or "LLM Error"
                        time.sleep(1)

                        # 4. Key Words
                        logging.info(f"Generating Keywords for '{activity_name}'...")
                        keywords_prompt = [
                            {"role": "system", "content": "You are an expert at extracting relevant keywords."},
                            {"role": "user", "content": f"Based on the educational activity titled '{activity_name}' and its content below, list 5-7 relevant keywords, separated by commas.\n\nWorksheet Text:\n---\n{extracted_text[:3000]}\n---\nKeywords:"}
                        ]
                        keywords = get_llm_completion(keywords_prompt, max_tokens=50, temperature=0.4)
                        row[header.index(COL_KEYWORDS_OUT)] = keywords or "LLM Error"
                        time.sleep(1) # Respect API rate limits

                    else:
                        logging.warning(f"No meaningful text extracted from '{pdf_filepath}' for '{activity_name}'. Skipping LLM processing for this file.")
                        # Keep existing values for these columns if any, or they'll be blank
                else:
                    logging.warning(f"PDF not found for '{activity_name}'.")
                
                processed_rows_for_csv.append(list(row)) # Add the (potentially updated) row
    
    except FileNotFoundError:
        logging.error(f"Input CSV file not found: {CSV_INPUT_FILE}")
        return
    except Exception as e:
        logging.error(f"An unexpected error occurred during CSV processing: {e}", exc_info=True)
        return

    # Write the updated data to a new CSV file
    try:
        with open(CSV_OUTPUT_FILE, 'w', newline='', encoding='utf-8-sig') as outfile:
            writer = csv.writer(outfile)
            writer.writerows(processed_rows_for_csv)
        logging.info(f"Processing complete. Intermediate processed CSV written to: {CSV_OUTPUT_FILE}")
    except Exception as e:
        logging.error(f"Error writing output CSV file: {e}", exc_info=True)
        return # Don't proceed to JSON conversion if CSV writing failed

    # --- NEW: Convert the processed CSV to JSON KB ---
    logging.info(f"Starting conversion of {CSV_OUTPUT_FILE} to JSON knowledge base...")
    activities_kb_list = []
    try:
        # Read the CSV we just wrote (which includes the header and LLM-generated data)
        with open(CSV_OUTPUT_FILE, 'r', newline='', encoding='utf-8-sig') as csvfile_processed:
            reader_processed = csv.DictReader(csvfile_processed)
            for row_dict in reader_processed:
                # Ensure all expected keys are present from the CSV headers
                activity_id = row_dict.get(header[COL_TEXT_FORMULA_ID], f"unknown_id_{reader_processed.line_num}")
                activity_name = row_dict.get(header[COL_WORKSHEET_NAME], "Unknown Activity")
                vespa_element = row_dict.get(header[COL_VESPA_ELEMENT], "Unknown")
                level = row_dict.get(header[COL_LEVEL], "N/A")
                research_basis = row_dict.get(COL_RESEARCH_BASIS_OUT, "")
                short_summary = row_dict.get(COL_SHORT_SUMMARY_OUT, "")
                long_summary = row_dict.get(COL_LONG_SUMMARY_OUT, "")
                keywords_str = row_dict.get(COL_KEYWORDS_OUT, "")
                pdf_link_url = row_dict.get(header[COL_PDF_LINK], "")

                keywords_list = [k.strip() for k in keywords_str.split(',') if k.strip()] if keywords_str else []

                activities_kb_list.append({
                    "id": activity_id,
                    "name": activity_name,
                    "vespa_element": vespa_element,
                    "level": level,
                    "research_basis": research_basis,
                    "short_summary": short_summary,
                    "long_summary": long_summary,
                    "keywords": keywords_list,
                    "pdf_link": pdf_link_url
                })
        
        # Define the path for the final JSON knowledge base
        # It should go into Homepage/AIVESPACoach/backend/knowledge_base/
        kb_dir = os.path.join(SCRIPT_DIR, "..", "knowledge_base") # Up one from Activity_PDFs, then into knowledge_base
        if not os.path.exists(kb_dir):
            os.makedirs(kb_dir)
            logging.info(f"Created knowledge_base directory: {kb_dir}")
        
        json_kb_output_file = os.path.join(kb_dir, "vespa_activities_kb.json")

        with open(json_kb_output_file, 'w', encoding='utf-8') as jsonfile:
            json.dump(activities_kb_list, jsonfile, indent=2, ensure_ascii=False)
        logging.info(f"Successfully converted CSV to JSON. Output written to: {json_kb_output_file}")

    except FileNotFoundError:
        logging.error(f"Processed CSV file not found for JSON conversion: {CSV_OUTPUT_FILE}")
    except Exception as e:
        logging.error(f"An error occurred during JSON conversion: {e}", exc_info=True)

if __name__ == "__main__":
    main()