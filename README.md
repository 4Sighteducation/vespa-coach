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
*   **Student Reflections & Goals (Current Cycle - if available):**
    *   `field_2302`: RRC1 (Report Response Comment 1)
    *   `field_2303`: RRC2 (Report Response Comment 2)
    *   `field_2304`: RRC3 (Report Response Comment 3)
    *   `field_2499`: GOAL1 (Student Goal 1)
    *   `field_2493`: GOAL2 (Student Goal 2)
    *   `field_2494`: GOAL3 (Student Goal 3)

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
      "student_reflections_and_goals": {
        "rrc1_comment": "Student's comment for RRC1...",
        "rrc2_comment": "Student's comment for RRC2...",
        "rrc3_comment": "Student's comment for RRC3...",
        "goal1": "Student's goal 1...",
        "goal2": "Student's goal 2...",
        "goal3": "Student's goal 3..."
      },
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
6.  Load static JSON knowledge bases (`coaching_questions_knowledge_base.json`, `psychometric_question_details.json` - although `psychometric_question_details.json` now largely covers the latter for analysis).
7.  From `coaching_questions_knowledge_base.json`: Retrieve general intro questions, evaluate/select conditional framing statement, get supplementary VESPA-specific questions.
8.  Construct rich prompt for LLM: 
    *   Include all gathered data (student context, current/historical summary scores, trends, `Object_29` insights, `Object_33` content, academic profile, framing statement, intro questions, supplementary questions, previous AI summary).
    *   **Important for Reflections/Goals:** When including student-written comments (RRC1-3 from `field_2302`-`field_2304`) and goals (GOAL1-3 from `field_2499`, `field_2493`, `field_2494`) from `Object_10`, the backend should use the `current_cycle` (from `Object_10.field_146_raw`) to *give primary emphasis or highlight* the comment and goal corresponding to that `current_cycle` in the LLM prompt. Historical comments/goals should be treated as secondary context.
    *   Include a clear directive for the LLM.

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
=======
# vespa-coach


AI Next Steps Suggestions - 1) -Now for the exciting part: building the actual functionality. Your plan sounds solid and aligns well with the README.md.
Thoughts on Your Plan & Next Steps:
Your idea of using a Heroku app for the AI API, integrating SendGrid for email summaries, and using the Knack API for data exchange is a robust and common approach for this kind of application.
Here's a breakdown of my thoughts and suggested next steps:
1. Heroku AI Coach API (POST /api/v1/coaching_suggestions):
Core Task: This is the heart of the "Coach for the Coach." It will receive the student_object10_record_id, gather all necessary data, interact with the LLM, and return a structured JSON response.
Data Gathering (Phase 1 in your README):
Knack API Interaction:
Student Record ID: You already have a plan to get the student_object10_record_id from the client-side (aiCoachLauncher.js will need to fetch this, likely from the REPORTPROFILE_CONFIG or by inspecting the "VIEW STUDENT ACTIVITIES" button URL as ReportProfiles2k.js does).
Knack API Keys: Yes, your Heroku app will need the Knack Application ID and REST API Key. Store these securely as environment variables on Heroku (e.g., KNACK_APP_ID, KNACK_API_KEY). Do not hardcode them in your Python/backend code.
Fetching Data: Your Python backend will use these keys to make authenticated requests to the Knack API to fetch:
Object_10 (VESPA Results) for the given student.
Relevant Object_29 (Questionnaire Qs) records (current and possibly historical for trends).
Object_33 (ReportText Content) based on student level, VESPA scores, etc.
Object_112 (SubjectInformation / Homepage Profile) for academic data, linking via Object_3 (User Accounts).
The "previous interaction summary" from Object_10.field_3271.
Knowledge Base Lookup (Phase 2):
Your Python app will load and parse the local JSON files:
AIVESPACoach/coaching_questions_knowledge_base.json
AIVESPACoach/question_id_to_text_mapping.json (though psychometric_question_details.json might cover much of this for analysis, as noted in your README).
AIVESPACoach/psychometric_question_details.json
This data will be used to enrich the information sent to the LLM and to select predefined coaching questions/statements.
LLM Prompt Construction (Phase 2):
This is a critical step. You'll need to craft a well-structured prompt for your chosen LLM (OpenAI, Anthropic, etc.).
The prompt should include all the gathered student data (current/historical VESPA scores, individual responses, Object_33 content, academic profile, previous AI summary) and the relevant information from your local knowledge bases.
Clearly instruct the LLM on what kind of output you expect (e.g., conversation openers, key discussion points, suggested next steps for the tutor, as outlined in your API response structure).
LLM Interaction & Response Formatting (Phase 3):
Your Python app will make an API call to the external LLM. Store the LLM API key securely as an environment variable on Heroku.
Receive the LLM's response.
Parse and format this response, combining it with the data you've directly fetched/selected from Knack and your local JSON files, to construct the final JSON response for your /api/v1/coaching_suggestions endpoint, matching the detailed structure in your README.md.
Update "Memory" (Phase 4 - Write-back to Knack):
After generating the coaching suggestions (or perhaps as part of the LLM's task), create a concise summary of the interaction.
Use the Knack API to write this summary back to Object_10.field_3271 for the student.
2. SendGrid Integration (for Email Summary):
Trigger: This could be an option within the AI Coach panel (e.g., a "Send Summary to Tutor" button) or an automatic action after a coaching session is "logged" (if you add such a feature).
Heroku Endpoint: You might create a separate, simple Heroku endpoint (e.g., /api/v1/send_summary) that your client-side can call.
Data for Email: This endpoint would take the coaching suggestions (or a summary of them) and the tutor's email (which might need to be fetched from Object_3 or passed from the client if the logged-in user is the tutor).
SendGrid API Key & Template: Store your SendGrid API key as an environment variable on Heroku. Using a SendGrid dynamic template is an excellent idea for formatting the email nicely. You'll pass the coaching summary data to the template.
Implementation: Your Python backend will use the SendGrid Python library to send the email.
3. Client-Side (aiCoachLauncher.js):
Fetching student_object10_record_id:
This is crucial. When the "Activate AI Coach" button is clicked, aiCoachLauncher.js needs to get the ID of the student currently being viewed.
Since ReportProfiles2k.js already determines this (it uses currentStudentId which seems to be the student's object_6 record ID, and it also fetches profile data which might contain the object_10 record ID or a way to link to it), you have a few options:
Expose currentStudentId or object10_record_id globally from ReportProfiles2k.js: Make it accessible as window.currentReportStudentObject10Id or similar when an individual profile is loaded. aiCoachLauncher.js can then read this.
Inspect DOM elements: If ReportProfiles2k.js or your Vue report adds an element with the object_10 record ID (e.g., a data attribute on a button or a hidden field), aiCoachLauncher.js could try to find and read that. The "VIEW STUDENT ACTIVITIES" button often has the object_6 record ID. You'd then need a way to get from object_6 ID to object_10 ID.
The REPORTPROFILE_CONFIG is available to ReportProfiles2k.js. When it successfully loads a student's profile, it could potentially update a shared global variable or a custom event that aiCoachLauncher.js listens for.
API Call:
In toggleAICoachPanel(show), when show is true, make an AJAX POST request to your Heroku endpoint /api/v1/coaching_suggestions, sending {"student_object10_record_id": /* the_id */}.
Use jQuery's $.ajax or the native fetch API. Remember to include necessary headers if your Heroku app requires them (e.g., for authentication if you add that later, or Content-Type: application/json).
Rendering Response:
On successful API response, parse the detailed JSON.
Dynamically build HTML to display this information within the #aiCoachSlidePanel .ai-coach-panel-content. This will involve creating sections for each part of your defined response structure (student name, VESPA profile breakdown, academic summary, LLM suggestions, etc.). Consider using templates or helper functions to keep this clean.
Handle API errors gracefully (e.g., show an error message in the panel).
Suggested Next Steps (Iterative Development):
Heroku API - Basic Data Fetch (Knack Read-Only):
Start by setting up your Python Heroku app.
Implement the /api/v1/coaching_suggestions endpoint.
For now, just make it fetch the Object_10 record for the provided student_object10_record_id using the Knack API.
Return a simplified JSON response containing just this Object_10 data.
Client-Side: Update aiCoachLauncher.js to fetch this student_object10_record_id (decide on the method: global variable, DOM inspection) and call this basic Heroku API. Display the raw Object_10 JSON in the panel.
Goal: Confirm Heroku setup, Knack API keys, client-to-server communication, and basic data retrieval.
Heroku API - Expand Data Fetching:
Extend the Heroku endpoint to fetch all the other required Knack objects (Object_29, Object_33, Object_112).
Parse and structure this data (still without LLM or local JSON files yet).
Update the JSON response from Heroku to include this structured data.
Client-Side: Update aiCoachLauncher.js to render this more detailed (but still raw/pre-LLM) data in the panel.
Goal: Confirm all Knack data can be fetched and passed to the client correctly.
Heroku API - Integrate Local Knowledge Bases:
Add the logic to your Heroku app to load and parse coaching_questions_knowledge_base.json, psychometric_question_details.json.
Use this data to select/filter relevant coaching questions or framing statements based on the fetched Knack data (e.g., pick VESPA-specific questions based on score profiles).
Incorporate these into the JSON response.
Client-Side: Update panel rendering to display these.
Goal: Confirm local JSON knowledge bases are used effectively.
Heroku API - LLM Integration (The Core AI):
Choose your LLM provider.
Set up the LLM API key as an environment variable on Heroku.
Construct the detailed prompt for the LLM using all gathered data.
Make the API call to the LLM.
Incorporate the LLM's response into your final JSON structure.
Client-Side: Render the LLM-generated suggestions.
Goal: Get the AI coaching advice generated and displayed. Iterate on prompt engineering for best results.
Heroku API - Implement "Memory" (Write-back to Knack):
Add logic to generate a concise summary of the AI's suggestions.
Use the Knack API to write this summary to Object_10.field_3271.
Goal: Implement the contextual follow-up feature.
SendGrid Integration:
Set up a SendGrid account and dynamic template.
Add a new Heroku endpoint (or extend the existing one with a parameter) to trigger email sending.
Add a button/trigger in the AI Coach panel client-side to call this endpoint.
Goal: Allow tutors to email themselves a summary.
UI/UX Refinements:
Make the AI Coach panel look good, use accordions/tabs if needed, ensure it's responsive.
Add loading states, error messages.
This iterative approach allows you to build and test each component before moving to the next, making debugging easier.
Regarding Knack API Keys for Heroku:
You're correct. Your Heroku application will need its own set of Knack API credentials (Application ID and a REST API Key). You should create a dedicated API key in your Knack builder if possible, perhaps with specific permissions if Knack allows that, though a general key will also work. Store these as environment variables on Heroku (e.g., KNACK_APP_ID, KNACK_API_KEY). Your Python code will then read these from the environment.

2) - 1. Separate Apps for Tutor Coach vs. Student Coach, or Adapt One?
This is a common architectural decision. Here are the pros and cons of each approach:
Option A: Totally Separate Apps (e.g., two Heroku apps, two client-side JS bundles)
Pros:
Clear Separation of Concerns: Each app has its own distinct logic, UI, and potentially different LLM prompting strategies. This can be easier to manage and develop independently.
Tailored User Experience: The UI for a tutor will likely be different from what a student sees (e.g., tutors might see more raw data or analytical tools, while students get more guided reflection).
Scalability/Resource Allocation: If one app becomes much more resource-intensive, you can scale its Heroku dynos independently.
Deployment Flexibility: You can update one app without affecting the other.
Cons:
Code Duplication: A lot of the core data fetching logic from Knack, interaction with your local JSON knowledge bases, and even some parts of the LLM interaction (like basic prompt formatting) might be very similar or identical. This means duplicating code and maintaining it in two places.
Higher Maintenance Overhead: Two codebases, two Heroku apps to monitor, etc.
Option B: Adapt One App (One Heroku app, potentially one core client-side library with different "modes" or UIs)
Pros:
Code Reusability: Maximize reuse of common logic (Knack API interaction, knowledge base access, core LLM prompt components).
Lower Maintenance: One codebase, one Heroku app.
Consistent Data Handling: Ensures both coach versions use data in the same way.
Cons:
Increased Complexity in One App: The Heroku app will need logic to differentiate between requests coming for the "tutor coach" vs. the "student coach." This could be via different API endpoints (e.g., /api/v1/tutor_coach and /api/v1/student_coach) or a parameter in the request.
Conditional Logic: The client-side script (and potentially the backend) will need more conditional logic to present the correct UI and tailor the LLM interaction.
Deployment Interdependence: An update to shared code affects both versions.
Recommendation for Your Scenario:
Given that "AI Coach for Students" is Priority 2 (Future Phase), I would lean towards starting with a single, adaptable Heroku app (Option B) but plan for clear separation within its structure.
Backend (Heroku - Python):
Create distinct API endpoints:
POST /api/v1/tutor_coach_suggestions (for the current "Coach for the Coach")
Later, POST /api/v1/student_coach_feedback (or similar for the student version).
Have shared utility modules for:
Knack API interaction (fetching Object_10, Object_29, etc.).
Loading/querying your JSON knowledge bases.
Basic LLM interaction (sending prompt, receiving response).
The logic specific to each coach type (e.g., how the LLM prompt is tailored, what data is emphasized) would reside in the handlers for their respective endpoints.
Client-Side (JavaScript):
You'll likely have different JavaScript initializers or different configurations for the tutor page vs. the student page.
The aiCoachLauncher.js we're building now is specifically for the tutor view.
When you build the student coach, it will be a new script (or a new part of your loader) that calls the /api/v1/student_coach_feedback endpoint and renders a UI appropriate for students.
This approach allows you to build the tutor coach now, reusing core components when you develop the student coach later. If the student coach becomes vastly different and complex, you could always split it into a separate Heroku app at that point.
2. Leveraging copyofReportProfiles.js for Data Fetching:
You're absolutely right. AIVESPACoach/copyofReportProfiles.js (or ReportProfiles2n.js as per your logs) already does a lot of the heavy lifting to:
Identify the current student (it has currentStudentId, which seems to be the object_6 record ID).
Fetch the student's academic profile from object_112.
It also knows the Knack API key and app ID.
How aiCoachLauncher.js can get the student_object10_record_id:
This is the immediate next challenge for the client-side. When the "Activate AI Coach" button is clicked, aiCoachLauncher.js needs the object_10 record ID for the student whose report is currently being viewed.
Here are a few ways to achieve this, building on what ReportProfiles2k.js already does:
Option 2.1: Global Variable or Custom Event (Recommended for cleaner separation):
In ReportProfiles2k.js: When processStudentProfileById (or similar) successfully fetches and processes a student's data, and it has access to (or can derive) the student_object10_record_id (this might involve an extra API call if object_10 isn't directly part of its current data fetch, or if it needs to link from object_6 to object_10), it can:
Set a global JavaScript variable: window.currentVespaReportObject10Id = /* the_id */;
Or, even better, dispatch a custom JavaScript event:
Apply to README.md
In aiCoachLauncher.js:
If using a global variable, it can just read window.currentVespaReportObject10Id when the button is clicked.
If using a custom event, aiCoachLauncher.js would add an event listener:
Apply to README.md
When navigating away from an individual student (e.g., clearProfileView in ReportProfiles2k.js), window.currentVespaReportObject10Id should be set to null, or another event dispatched.
Option 2.2: DOM Inspection (More coupled, but feasible):
ReportProfiles2k.js renders the academic profile. If it (or the Vue report component) includes the object_10_record_id as a data attribute on a specific, stable DOM element (e.g., data-object10-id="..." on the main report container), then aiCoachLauncher.js could query the DOM for this attribute when the button is clicked.
The "VIEW STUDENT ACTIVITIES" button often contains the object_6 record ID. If you have a reliable way on the client-side to quickly get the object_10 ID from the object_6 ID without an API call (e.g., if ReportProfiles2k.js caches this mapping or makes it available), that's an option. Otherwise, making an extra API call just for this from aiCoachLauncher.js is less ideal.
Option 2.3: Exposing a function from ReportProfiles2k.js:
ReportProfiles2k.js could expose a global function like window.getCurrentStudentObject10Id() that aiCoachLauncher.js can call. This is similar to a global variable but might feel slightly cleaner to some.
Recommendation for getting object_10_record_id:
The Custom Event (Option 2.1) is generally the cleanest and most decoupled approach. It allows ReportProfiles2k.js to announce "hey, an individual student report is loaded, and here's their object_10 ID" without aiCoachLauncher.js needing to know the internal workings of ReportProfiles2k.js.
Next Immediate Client-Side Step:
Decide how aiCoachLauncher.js will get the student_object10_record_id.
If using global var/custom event, modify ReportProfiles2k.js to provide this ID when an individual student report is fully loaded.
This might mean ReportProfiles2k.js needs to ensure it has the object_10_record_id. It currently fetches student profile data (object_112) based on an object_6 ID or name. It might need to perform an additional lookup to find the corresponding object_10 record if that ID isn't already available from its current data sources or passed in its initial configuration from the loader for the individual report view. Your Knack data map shows Object_10.field_197_raw.email -> Object_3.field_70 (match email) -> Get Object_3.record_id (which is user account ID) -> match with Object_112.field_3070. This path is for getting academic data.
To get to Object_10 (VESPA Results), ReportProfiles2k.js already gets the student's object_6 ID from the "VIEW STUDENT ACTIVITIES" button. It then needs to find the Object_10 record linked to this student. There should be a connection from Object_6 (Students) to Object_10 (VESPA Results) or via Object_3 (User Account) to Object_10. Your README.md mentions Object_10.field_197_raw.email links to user accounts. The report context usually starts from an Object_10 record when viewing a specific VESPA report.
The "VIEW STUDENT ACTIVITIES" button likely has the object_6 (student) record ID. When the tutor clicks "C.REPORT" or "S.REPORT" from the student list (view_2716), they navigate to a page whose URL likely contains the object_10 record ID. This URL is probably the most direct source. The ReportProfiles2k.js might already be parsing this from the URL hash or a similar mechanism when it loads an individual report. If so, that's the object_10_record_id to use.
