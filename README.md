# VESPA AI Coaching Assistant

## 1. Project Aim

### Overall Goal
To develop an AI-powered coaching assistant that leverages the VESPA (Vision, Effort, Systems, Practice, Attitude) framework to support both tutors in their coaching conversations with students and, in a later phase, students directly.

### 1.1. AI Coach for Tutors (Priority 1)
This assistant will provide tutors with data-driven insights, suggested coaching questions, and relevant information from student VESPA profiles and academic data. The goal is to enhance the effectiveness and consistency of coaching conversations, helping tutors to better guide students in their personal and academic development according to the VESPA model.

### 1.2. AI Coach for Students (Priority 2 - Future Phase)
This assistant will interact directly with students after they complete their VESPA questionnaires. It will provide personalized feedback, insights based on their scores, suggest relevant VESPA tools, and guide them through reflective coaching questions to foster self-awareness and proactive development.

## 2. Core Technologies & Architecture

*   **Knack Database:** Primary data store for all student information, VESPA results, questionnaire responses, report content, and academic data.
*   **Heroku Application (Backend):** A Python (or other suitable language) application hosted on Heroku. This will:
    *   House the core AI/business logic.
    *   Serve an API for the client-side to call.
    "   Interact with the Knack API to read/write student data.
    *   Manage and query local JSON knowledge base files.
    *   Construct prompts and interact with an external LLM API.
    *   Orchestrate the overall data flow and response generation.
*   **External LLM API:** A service like OpenAI (GPT series) or Anthropic Claude will be used for advanced natural language processing, summarization, and generating conversational, nuanced responses.
*   **Client-Side Integration:** Initially, a button or trigger within the Knack UI (potentially integrated with `copyofReportProfiles.js`) will call the Heroku API. Results will be displayed within the Knack interface.

## 3. Data Map & Knowledge Base

### 3.1. Knack Objects & Key Fields

**Object_10: VESPA Results** (Primary record for a student's VESPA engagement)
*   `record_id`: Unique ID for this object's record.
*   `field_197_raw.email`: Student's email address (key for linking).
*   `field_187_raw.full`: Student Name.
*   `field_568_raw`: Student Level (e.g., "Level 2", "Level 3").
*   `field_146_raw`: `currentMCycle` (Indicates the latest completed VESPA cycle: 1, 2, or 3).
*   **Current VESPA Scores (1-10 scale, dynamically show latest cycle based on `field_146`):**
    *   `field_147`: Vision (V)
    *   `field_148`: Effort (E)
    *   `field_149`: Systems (S)
    *   `field_150`: Practice (P)
    *   `field_151`: Attitude (A)
    *   `field_152`: Overall (O)
*   **Historical Cycle 1 Scores (1-10 scale):**
    *   `field_155` - `field_160` (V1, E1, S1, P1, A1, O1)
*   **Historical Cycle 2 Scores (1-10 scale):**
    *   `field_161` - `field_166` (V2, E2, S2, P2, A2, O2)
*   **Historical Cycle 3 Scores (1-10 scale):**
    *   `field_167` - `field_172` (V3, E3, S3, P3, A3, O3)
*   `field_3271`: AI Coaching Summary (Write-back field for AI "memory").

**Object_29: Questionnaire Qs** (Individual psychometric question responses)
*   `field_792`: Connection to `Object_10` (VESPA_RESULT).
*   `field_863_raw`: `Cycle` number (1, 2, or 3) for the responses in this record (assuming one `Object_29` record per cycle per student).
*   **Current Cycle Generic Response Fields (1-5 scale):**
    *   `field_794` - `field_821`, `field_2317`, `field_1816`, `field_1817`, `field_1818` (as mapped in `AIVESPACoach/question_id_to_text_mapping.json` and `AIVESPACoach/psychometric_question_details.json`).
*   **Historical Cycle-Specific Response Fields (1-5 scale):**
    *   e.g., `field_1953` (`c1_Q1v`), `field_1955` (`c2_Q1v`), `field_1956` (`c3_Q1v`), etc. (as mapped in `AIVESPACoach/psychometric_question_details.json`).

**Object_33: ReportText Content** (Content shown on student reports)
*   `field_848`: `Level` (e.g., "Level 2", "Level 3")
*   `field_844`: `Category` (e.g., "Vision", "Overall")
*   `field_842`: `ShowForScore` (e.g., "High", "Medium", "Low", "Very Low")
*   `field_845`: `Text` (Student report text)
*   `field_846`: `Questions` (Student report questions)
*   `field_847`: `Suggested Tools` (Student report tools)
*   `field_853`: `Coaching Comments` (Primary coaching prompts for tutor)
*   `field_849`, `field_850`, `field_851`, `field_854`: Welsh equivalents.

**Object_112: SubjectInformation / Homepage Profile** (Academic profile summary)
*   `field_3070`: `Account` (Connection to `Object_3` - User Account).
*   `field_3080` (`Sub1`) - `field_3094` (`Sub15`): Store JSON strings for each academic subject (details like subject name, exam type, board, MEG, CG, TG, effort, behavior, attendance).

**Object_3: User Accounts** (Central user table)
*   `record_id`: Unique ID for the user account.
*   `field_70`: User's email address (key for linking).

**Linkage Paths:**
*   **`Object_10` to `Object_112` (for Academic Data):** `Object_10.field_197_raw.email` -> `Object_3.field_70` (match email) -> Get `Object_3.record_id` -> Match with `Object_112.field_3070` (Account connection).
*   **`Object_10` to `Object_29` (for Individual Responses):** `Object_10.record_id` -> `Object_29.field_792` (VESPA_RESULT connection).

### 3.2. Static Knowledge Base Files (within Heroku App / `AIVESPACoach/` folder)

*   **`AIVESPACoach/coaching_questions_knowledge_base.json`**
    *   **Purpose:** Stores supplementary coaching guidance derived from `Coaching Questions.txt`.
    *   **Structure:** Contains `generalIntroductoryQuestions` (array of strings), `conditionalFramingStatements` (array of objects with `id`, `description`, `conditionLogic`, `statement`), and `vespaSpecificCoachingQuestions` (object keyed by VESPA element, with arrays of questions per 4-tier score profile: "Very Low", "Low", "Medium", "High").

*   **`AIVESPACoach/question_id_to_text_mapping.json`**
    *   **Purpose:** Maps generic field IDs from `Object_29` (that store current cycle psychometric answers) to their actual question text.
    *   **Structure:** A JSON object where keys are `Object_29` field IDs (e.g., "field_794") and values are the question strings.

*   **`AIVESPACoach/psychometric_question_details.json`**
    *   **Purpose:** Provides a detailed mapping for each unique psychometric question, linking it to its text, VESPA category, current cycle field ID, and the specific historical field IDs in `Object_29` for Cycle 1, Cycle 2, and Cycle 3. Essential for trend analysis.
    *   **Structure:** An array of objects, each with `questionId`, `questionText`, `vespaCategory`, `currentCycleFieldId`, `historicalCycleFieldBase`, `fieldIdCycle1`, `fieldIdCycle2`, `fieldIdCycle3`.

## 4. Heroku AI Coach API Definition

*   **Endpoint:** `POST /api/v1/coaching_suggestions`
*   **Request Body (JSON):**
    ```json
    {
      "student_object10_record_id": "KNACK_RECORD_ID_OF_STUDENT_IN_OBJECT_10"
    }
    ```
*   **Response Body (JSON - Detailed structure, example):**
    ```json
    {
      "student_name": "Jane Doe",
      "student_level": "Level 3",
      "current_cycle": 2,
      "vespa_profile": {
        "Vision": {
          "score_1_to_10": 7,
          "score_profile_text": "Medium",
          "report_text_for_student": "Text student sees...",
          "report_questions_for_student": "Questions student sees...",
          "report_suggested_tools_for_student": "Tools student sees...",
          "primary_tutor_coaching_comments": "Primary comments for tutor from Object_33...",
          "supplementary_tutor_questions": ["Supplementary Q1..."],
          "key_individual_question_insights_from_object29": [
            "Noted: Score for 'I plan and organise my time...' improved from C1:2 to C2:4.",
            "Flag: Low score (1/5) on 'I complete all my homework on time' in C2."
          ],
          "historical_summary_scores": {"cycle1": 8}
        },
        "Effort": { 
            "score_1_to_10": 4,
            "score_profile_text": "Low", 
            "report_text_for_student": "...",
            "report_questions_for_student": "...",
            "report_suggested_tools_for_student": "...",
            "primary_tutor_coaching_comments": "...",
            "supplementary_tutor_questions": ["..."],
            "key_individual_question_insights_from_object29": ["..."],
            "historical_summary_scores": {"cycle1": 5}
         }
        // ... Other VESPA elements (Systems, Practice, Attitude)
        "Overall": {
            "score_1_to_10": 6,
            "score_profile_text": "Medium",
            "report_text_for_student": "...",
            "primary_tutor_coaching_comments": "...",
            "historical_summary_scores": {"cycle1": 7}
        }
      },
      "academic_profile_summary": [
        {"subject": "Physics", "currentGrade": "B", "targetGrade": "A", "effortGrade": "C"}
        // ... other subjects if data exists
      ],
      "overall_framing_statement_for_tutor": {
        "id": "default_response",
        "statement": "Framing statement text..."
      },
      "general_introductory_questions_for_tutor": [
        "General intro Q1..."
      ],
      "llm_generated_summary_and_suggestions": {
        "conversation_openers": ["Opener 1..."],
        "key_discussion_points": ["Point 1..."],
        "suggested_next_steps_for_tutor": ["Step 1..."]
      },
      "previous_interaction_summary": "Summary from last AI session via Object_10.field_3271..."
    }
    ```

## 5. Core Logic Flow for "Coach for the Coach" (Heroku App)

**(Phase 1: Data Gathering & Preparation)**
1.  Receive `student_object10_record_id`.
2.  Fetch `Object_10` record: Get student name, email, level, `currentMCycle`, current & historical summary VESPA scores (1-10), previous AI summary (`field_3271`).
3.  Fetch relevant `Object_29` record(s): Based on `Object_10` ID and `currentMCycle` (and previous cycles for trends). Extract individual 1-5 scores using `psychometric_question_details.json` for mapping current and historical fields. Note significant responses/trends.
4.  Fetch `Object_33` content: For each VESPA category, query `Object_33` based on student Level, Category, and calculated 4-tier score profile. Extract student-facing text/questions/tools and primary `tutorCoachingComments`.
5.  Fetch `Object_112` (Academic Profile): Link via `Object_10` email -> `Object_3.field_70` -> `Object_112.field_3070`. Parse subject JSONs if available.

**(Phase 2: Knowledge Base Lookup & LLM Prompt Construction)**
6.  Load static JSON knowledge bases (`coaching_questions_knowledge_base.json`, `question_id_to_text_mapping.json` - although `psychometric_question_details.json` now largely covers the latter for analysis).
7.  From `coaching_questions_knowledge_base.json`: Retrieve general intro questions, evaluate/select conditional framing statement, get supplementary VESPA-specific questions.
8.  Construct rich prompt for LLM: Include all gathered data (student context, current/historical summary scores, trends, `Object_29` insights, `Object_33` content, academic profile, framing statement, intro questions, supplementary questions, previous AI summary) and a clear directive for the LLM.

**(Phase 3: LLM Interaction & Response Formatting)**
9.  Call external LLM API.
10. Receive LLM response.
11. Format final JSON response for the client as per the defined API structure.

**(Phase 4: Update "Memory")**
12. Generate a concise text summary of the AI's key suggestions for this session.
13. Write this summary to `Object_10.field_3271` via Knack API.

## 6. Key Features

*   Personalized coaching advice for tutors.
*   Deep integration of VESPA methodology.
*   Analysis of current and historical student data (summary scores & individual psychometric responses).
*   Utilization of student-facing report content directly from Knack `Object_33`.
*   Contextual framing statements based on score patterns.
*   "Memory" feature for continuity via `Object_10.field_3271`.
*   Leverages an external LLM for natural language summarization, question generation, and nuanced advice.
*   Handles different student "Levels" (Level 2 vs. Level 3).
*   Incorporates academic profile data for holistic coaching (where available).

## 7. Next Steps / Development Roadmap (High-Level)

1.  **Environment Setup:** Configure Heroku application, install necessary libraries (e.g., for Knack API interaction, LLM client).
2.  **Knack API Integration:** Develop robust modules/functions in the Heroku app to:
    *   Authenticate with the Knack API.
    *   Read data from `Object_10`, `Object_29`, `Object_33`, `Object_112`, `Object_3` using appropriate filters.
    *   Write data (AI summary) back to `Object_10.field_3271`.
3.  **Knowledge Base Implementation:**
    *   Include the JSON knowledge base files (`coaching_questions_knowledge_base.json`, `psychometric_question_details.json`) in the Heroku application.
    *   Develop logic to load and query these JSON files efficiently.
4.  **Core Logic Implementation:**
    *   Implement the data gathering and preparation steps.
    *   Develop the logic for calculating 4-tier score profiles.
    *   Implement evaluation of `conditionalFramingStatements`.
    *   Build the dynamic LLM prompt construction module.
5.  **LLM API Integration:** Integrate with the chosen LLM provider's API.
6.  **API Endpoint Development:** Create the `POST /api/v1/coaching_suggestions` endpoint with request handling and response formatting.
7.  **Client-Side Integration:** Plan and develop the mechanism (e.g., JavaScript in Knack) to call the Heroku API and display the structured JSON response to the tutor.
8.  **Testing & Refinement:** Thoroughly test with various student data scenarios. Refine prompts and logic based on LLM output quality and tutor feedback.
9.  **Deployment:** Deploy the Heroku application.
10. **Future Phase - AI Coach for Students:** Plan and develop the second AI coach variant.

## 8. Outstanding Information Required

*   Confirmation of any remaining ambiguities in Knack field IDs or data linkage paths if they arise during development.
*   Decision on specific LLM provider and API key setup.

---

This README should serve as a comprehensive guide for the project. 