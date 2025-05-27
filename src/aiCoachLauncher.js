// AI Coach Launcher Script (aiCoachLauncher.js)

// Guard to prevent re-initialization
if (window.aiCoachLauncherInitialized) {
    console.warn("[AICoachLauncher] Attempted to re-initialize. Skipping.");
} else {
    window.aiCoachLauncherInitialized = true;

    let AI_COACH_LAUNCHER_CONFIG = null; 
    let coachObserver = null;
    let coachUIInitialized = false;

    // --- Configuration ---
    const HEROKU_API_URL = 'https://vespa-coach-c64c795edaa7.herokuapp.com/api/v1/coaching_suggestions';
    // Knack App ID and API Key are expected in AI_COACH_LAUNCHER_CONFIG if any client-side Knack calls were needed,
    // but with the new approach, getStudentObject10RecordId will primarily rely on a global variable.

    function logAICoach(message, data) {
        // Temporarily log unconditionally for debugging
        console.log(`[AICoachLauncher] ${message}`, data === undefined ? '' : data);
        // if (AI_COACH_LAUNCHER_CONFIG && AI_COACH_LAUNCHER_CONFIG.debugMode) {
        //     console.log(`[AICoachLauncher] ${message}`, data === undefined ? '' : data);
        // }
    }

    // Function to check if we are on the individual student report view
    function isIndividualReportView() {
        const studentNameDiv = document.querySelector('#student-name p'); // More specific selector for the student name paragraph
        const backButton = document.querySelector('a.kn-back-link'); // General Knack back link
        
        if (studentNameDiv && studentNameDiv.textContent && studentNameDiv.textContent.includes('STUDENT:')) {
            logAICoach("Individual report view confirmed by STUDENT: text in #student-name.");
            return true;
        }
        // Fallback to back button if the #student-name structure changes or isn't specific enough
        if (backButton && document.body.contains(backButton)) { 
             logAICoach("Individual report view confirmed by BACK button presence.");
            return true;
        }
        logAICoach("Not on individual report view.");
        return false;
    }

    // Function to initialize the UI elements (button and panel)
    function initializeCoachUI() {
        if (coachUIInitialized) return;

        logAICoach("Conditions met. Initializing AI Coach UI (button and panel).");
        addAICoachStyles();
        createAICoachPanel();
        addLauncherButton();
        setupEventListeners();
        coachUIInitialized = true; // Mark as initialized
        logAICoach("AICoachLauncher UI initialization complete.");
    }
    
    // Function to clear/hide the UI elements when not on individual report
    function clearCoachUI() {
        if (!coachUIInitialized) return;
        logAICoach("Clearing AI Coach UI.");
        const launcherButtonContainer = document.getElementById('aiCoachLauncherButtonContainer');
        if (launcherButtonContainer) {
            launcherButtonContainer.innerHTML = ''; // Clear the button
        }
        toggleAICoachPanel(false); // Ensure panel is closed
        // Optionally, remove the panel from DOM if preferred when navigating away
        // const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
        // if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        coachUIInitialized = false; // Reset for next individual report view
    }

    function initializeAICoachLauncher() {
        logAICoach("AICoachLauncher initializing and setting up observer...");

        if (typeof window.AI_COACH_LAUNCHER_CONFIG === 'undefined') {
            console.error("[AICoachLauncher] AI_COACH_LAUNCHER_CONFIG is not defined. Cannot initialize.");
            return;
        }
        AI_COACH_LAUNCHER_CONFIG = window.AI_COACH_LAUNCHER_CONFIG;
        logAICoach("Config loaded:", AI_COACH_LAUNCHER_CONFIG);

        if (!AI_COACH_LAUNCHER_CONFIG.elementSelector || 
            !AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId ||
            !AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId ||
            !AI_COACH_LAUNCHER_CONFIG.mainContentSelector) {
            console.error("[AICoachLauncher] Essential configuration properties missing.");
            return;
        }

        const targetNode = document.querySelector('#kn-scene_1095'); // Observe the scene for changes

        if (!targetNode) {
            console.error("[AICoachLauncher] Target node for MutationObserver not found (#kn-scene_1095).");
            return;
        }

        const observerCallback = function(mutationsList, observer) {
            logAICoach("MutationObserver detected DOM change.");
            if (isIndividualReportView()) {
                const panelIsActive = document.body.classList.contains('ai-coach-active');
                if (!coachUIInitialized) { // First time UI init for a student view
                    initializeCoachUI();
                } else if (panelIsActive) { // UI already initialized AND panel is active, potentially new student
                    logAICoach("Individual report view, panel active. Re-fetching data for potentially new student.");
                    // Directly trigger the data fetching part of toggleAICoachPanel(true)
                    // without toggling visibility, as it's already visible.
                    refreshAICoachData(); 
                }
            } else {
                clearCoachUI();
            }
        };

        coachObserver = new MutationObserver(observerCallback);
        coachObserver.observe(targetNode, { childList: true, subtree: true });

        // Initial check in case the page loads directly on an individual report
        if (isIndividualReportView()) {
            initializeCoachUI();
        }
    }

    function addAICoachStyles() {
        const styleId = 'ai-coach-styles';
        if (document.getElementById(styleId)) return;

        const css = `
            body.ai-coach-active ${AI_COACH_LAUNCHER_CONFIG.mainContentSelector} {
                width: calc(100% - 450px); /* Increased panel width */
                margin-right: 450px; /* Increased panel width */
                transition: width 0.3s ease-in-out, margin-right 0.3s ease-in-out;
            }
            #${AI_COACH_LAUNCHER_CONFIG.mainContentSelector} {
                 transition: width 0.3s ease-in-out, margin-right 0.3s ease-in-out;
            }
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} {
                width: 0;
                opacity: 0;
                visibility: hidden;
                position: fixed;
                top: 0;
                right: 0;
                height: 100vh;
                background-color: #f4f6f8;
                border-left: 1px solid #ddd;
                padding: 20px;
                box-sizing: border-box;
                overflow-y: auto;
                z-index: 1050;
                transition: width 0.3s ease-in-out, opacity 0.3s ease-in-out, visibility 0.3s;
                font-family: Arial, sans-serif; /* Added a default font */
            }
            body.ai-coach-active #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} {
                width: 450px; /* Increased panel width */
                opacity: 1;
                visibility: visible;
            }
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                border-bottom: 1px solid #ccc;
                padding-bottom: 10px;
            }
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-header h3 {
                margin: 0;
                font-size: 1.3em;
            }
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-close-btn {
                background: none;
                border: none;
                font-size: 1.6em;
                cursor: pointer;
                padding: 5px;
            }
            #aiCoachLauncherButtonContainer {
                 text-align: center; 
                 padding: 20px; 
                 border-top: 1px solid #eee;
            }
            .ai-coach-section {
                margin-bottom: 20px;
                padding: 15px;
                background-color: #fff;
                border: 1px solid #e0e0e0;
                border-radius: 5px;
            }
            .ai-coach-section h4 {
                font-size: 1.1em;
                margin-top: 0;
                margin-bottom: 10px;
                color: #333;
                border-bottom: 1px solid #eee;
                padding-bottom: 5px;
            }
            .ai-coach-section p, .ai-coach-section ul, .ai-coach-section li {
                font-size: 0.9em;
                line-height: 1.6;
                color: #555;
            }
            .ai-coach-section ul {
                padding-left: 20px;
                margin-bottom: 0;
            }
            .loader {
                border: 5px solid #f3f3f3; 
                border-top: 5px solid #3498db; 
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        const styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.type = 'text/css';
        styleElement.appendChild(document.createTextNode(css));
        document.head.appendChild(styleElement);
        logAICoach("AICoachLauncher styles added.");
    }

    function createAICoachPanel() {
        const panelId = AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId;
        if (document.getElementById(panelId)) {
            logAICoach("AI Coach panel already exists.");
            return;
        }
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.className = 'ai-coach-panel';
        panel.innerHTML = `
            <div class="ai-coach-panel-header">
                <h3>AI Coaching Assistant</h3>
                <button class="ai-coach-close-btn" aria-label="Close AI Coach Panel">&times;</button>
            </div>
            <div class="ai-coach-panel-content">
                <p>Activate the AI Coach to get insights.</p>
            </div>
        `;
        document.body.appendChild(panel);
        logAICoach("AI Coach panel created.");
    }

    function addLauncherButton() {
        const targetElement = document.querySelector(AI_COACH_LAUNCHER_CONFIG.elementSelector);
        if (!targetElement) {
            console.error(`[AICoachLauncher] Launcher button target element '${AI_COACH_LAUNCHER_CONFIG.elementSelector}' not found.`);
            return;
        }
        if (document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId)) {
            logAICoach("AI Coach launcher button already exists.");
            return;
        }
        const buttonContainerHTML = `
            <div id="aiCoachLauncherButtonContainer">
              <p>Get AI-powered insights and suggestions to enhance your coaching conversation.</p>
              <button id="${AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId}" class="p-button p-component">🚀 Activate AI Coach</button>
            </div>
        `;
        targetElement.innerHTML = buttonContainerHTML;
        logAICoach("Launcher button added to view: " + AI_COACH_LAUNCHER_CONFIG.viewKey);
    }

    async function getStudentObject10RecordId(retryCount = 0) {
        logAICoach("Attempting to get student_object10_record_id from global variable set by ReportProfiles script...");

        if (window.currentReportObject10Id) {
            logAICoach("Found student_object10_record_id in window.currentReportObject10Id: " + window.currentReportObject10Id);
            return window.currentReportObject10Id;
        } else if (retryCount < 5) { // Retry up to 5 times (e.g., 5 * 500ms = 2.5 seconds)
            logAICoach(`student_object10_record_id not found. Retrying in 500ms (Attempt ${retryCount + 1}/5)`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return getStudentObject10RecordId(retryCount + 1);
        } else {
            logAICoach("Warning: student_object10_record_id not found in window.currentReportObject10Id after multiple retries. AI Coach may not function correctly if ReportProfiles hasn't set this.");
            // Display a message in the panel if the ID isn't found.
            const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
            if(panelContent) {
                // Avoid overwriting a more specific error already shown by a failed Knack API call if we were to reinstate it.
                if (!panelContent.querySelector('.ai-coach-section p[style*="color:red"], .ai-coach-section p[style*="color:orange"] ')) {
                    panelContent.innerHTML = '<div class="ai-coach-section"><p style="color:orange;">Could not automatically determine the specific VESPA report ID for this student. Ensure student profile data is fully loaded.</p></div>';
                }
            }
            return null; // Important to return null so fetchAICoachingData isn't called with undefined.
        }
    }

    async function fetchAICoachingData(studentId) {
        const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
        if (!panelContent) return;
        if (!studentId) { // Double check studentId is not null/undefined before fetching
             logAICoach("fetchAICoachingData called with no studentId. Aborting.");
             if(panelContent && !panelContent.querySelector('.ai-coach-section p[style*="color:red"], .ai-coach-section p[style*="color:orange"] ')) {
                panelContent.innerHTML = '<div class="ai-coach-section"><p style="color:orange;">Student ID missing, cannot fetch AI coaching data.</p></div>';
             }
             return;
        }

        panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Loading AI Coach insights...</p>';

        try {
            logAICoach("Fetching AI Coaching Data for student_object10_record_id: " + studentId);
            const response = await fetch(HEROKU_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ student_object10_record_id: studentId })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "An unknown error occurred."}));
                throw new Error(`API Error (${response.status}): ${errorData.error || errorData.message || response.statusText}`);
            }

            const data = await response.json();
            logAICoach("AI Coaching data received:", data);
            renderAICoachData(data);

        } catch (error) {
            logAICoach("Error fetching AI Coaching data:", error);
            panelContent.innerHTML = `<div class="ai-coach-section"><p style="color:red;">Error loading AI Coach insights: ${error.message}</p></div>`;
        }
    }

    function renderAICoachData(data) {
        const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
        if (!panelContent) return;

        let html = '';

        // Student Info
        html += `
            <div class="ai-coach-section">
                <h4>Student Overview</h4>
                <p><strong>Name:</strong> ${data.student_name || 'N/A'}</p>
                <p><strong>Level:</strong> ${data.student_level || 'N/A'}</p>
                <p><strong>Current Cycle:</strong> ${data.current_cycle || 'N/A'}</p>
            </div>
        `;

        // VESPA Profile
        if (data.vespa_profile) {
            html += '<div class="ai-coach-section"><h4>VESPA Profile</h4>';
            for (const [element, details] of Object.entries(data.vespa_profile)) {
                html += `
                    <div>
                        <h5>${element} (Score: ${details.score_1_to_10 !== undefined ? details.score_1_to_10 : 'N/A'}) - <em>${details.score_profile_text || 'N/A'}</em></h5>
                        ${details.primary_tutor_coaching_comments ? `<p><strong>Coaching Comments:</strong> ${details.primary_tutor_coaching_comments}</p>` : ''}
                        ${details.report_text_for_student ? `<p><em>Report Text:</em> ${details.report_text_for_student}</p>` : ''}
                        ${details.report_questions_for_student ? `<p><em>Student Questions:</em> ${details.report_questions_for_student}</p>` : ''}
                        ${details.report_suggested_tools_for_student ? `<p><em>Suggested Tools:</em> ${details.report_suggested_tools_for_student}</p>` : ''}
                        <!-- TODO: Display historical scores, supplementary questions, individual insights -->
                    </div>
                `;
                 if (element !== "Overall" && Object.keys(data.vespa_profile).indexOf(element) < Object.keys(data.vespa_profile).length - (Object.keys(data.vespa_profile).includes("Overall") ? 2:1) ){
                    html += '<hr style="border-top: 1px dashed #eee; margin: 10px 0;">';
                }
            }
            html += '</div>';
        }

        // Academic Profile Summary
        if (data.academic_profile_summary && data.academic_profile_summary.length > 0) {
            html += '<div class="ai-coach-section"><h4>Academic Profile</h4><ul>';
            data.academic_profile_summary.forEach(subject => {
                html += `<li><strong>${subject.subject || 'N/A'}:</strong> Grade ${subject.currentGrade || 'N/A'} (Target: ${subject.targetGrade || 'N/A'}, Effort: ${subject.effortGrade || 'N/A'})</li>`;
            });
            html += '</ul></div>';
        }
        
        // Overall Framing Statement
        if(data.overall_framing_statement_for_tutor && data.overall_framing_statement_for_tutor.statement){
            html += `
            <div class="ai-coach-section">
                <h4>Overall Framing Statement</h4>
                <p>${data.overall_framing_statement_for_tutor.statement}</p>
            </div>
        `;
        }

        // General Introductory Questions
        if(data.general_introductory_questions_for_tutor && data.general_introductory_questions_for_tutor.length > 0){
            html += '<div class="ai-coach-section"><h4>General Introductory Questions</h4><ul>';
            data.general_introductory_questions_for_tutor.forEach(q => {
                html += `<li>${q}</li>`;
            });
            html += '</ul></div>';
        }

        // LLM Generated Summary & Suggestions
        if (data.llm_generated_summary_and_suggestions) {
            html += '<div class="ai-coach-section"><h4>AI Generated Suggestions</h4>';
            if (data.llm_generated_summary_and_suggestions.conversation_openers && data.llm_generated_summary_and_suggestions.conversation_openers.length > 0) {
                html += '<h5>Conversation Openers:</h5><ul>';
                data.llm_generated_summary_and_suggestions.conversation_openers.forEach(o => { html += `<li>${o}</li>`; });
                html += '</ul>';
            }
            if (data.llm_generated_summary_and_suggestions.key_discussion_points && data.llm_generated_summary_and_suggestions.key_discussion_points.length > 0) {
                html += '<h5>Key Discussion Points:</h5><ul>';
                data.llm_generated_summary_and_suggestions.key_discussion_points.forEach(p => { html += `<li>${p}</li>`; });
                html += '</ul>';
            }
            if (data.llm_generated_summary_and_suggestions.suggested_next_steps_for_tutor && data.llm_generated_summary_and_suggestions.suggested_next_steps_for_tutor.length > 0) {
                html += '<h5>Suggested Next Steps:</h5><ul>';
                data.llm_generated_summary_and_suggestions.suggested_next_steps_for_tutor.forEach(s => { html += `<li>${s}</li>`; });
                html += '</ul>';
            }
            html += '</div>';
        }
        
        // Previous Interaction Summary
        if(data.previous_interaction_summary){
             html += `
            <div class="ai-coach-section">
                <h4>Previous Interaction Summary</h4>
                <p>${data.previous_interaction_summary}</p>
            </div>
        `;
        }

        panelContent.innerHTML = html || '<p>No data to display.</p>';
    }

    // New function to specifically refresh data if panel is already open
    async function refreshAICoachData() {
        const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
        const panelContent = panel ? panel.querySelector('.ai-coach-panel-content') : null;

        if (!panel || !panelContent) {
            logAICoach("Cannot refresh AI Coach data: panel or panelContent not found.");
            return;
        }
        if (!document.body.classList.contains('ai-coach-active')) {
            logAICoach("AI Coach panel is not active, refresh not needed.");
            return;
        }

        logAICoach("Refreshing AI Coach data...");
        panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Identifying student report...</p>';
        
        const studentObject10Id = await getStudentObject10RecordId(); 
        
        if (studentObject10Id) {
            fetchAICoachingData(studentObject10Id); 
        } else {
            logAICoach("Student Object_10 ID not available after getStudentObject10RecordId. AI data fetch will not proceed during refresh.");
            // getStudentObject10RecordId should handle updating the panel with an error message
        }
    }

    async function toggleAICoachPanel(show) { 
        const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
        const toggleButton = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId);
        const panelContent = panel ? panel.querySelector('.ai-coach-panel-content') : null;

        if (show) {
            document.body.classList.add('ai-coach-active');
            if (toggleButton) toggleButton.textContent = '🙈 Hide AI Coach';
            logAICoach("AI Coach panel activated.");
            
            // Instead of direct call here, refreshAICoachData will be primary way for new/refreshed data
            await refreshAICoachData(); 

        } else {
            document.body.classList.remove('ai-coach-active');
            if (toggleButton) toggleButton.textContent = '🚀 Activate AI Coach';
            if (panelContent) panelContent.innerHTML = '<p>Activate the AI Coach to get insights.</p>';
            logAICoach("AI Coach panel deactivated.");
        }
    }

    function setupEventListeners() {
        document.body.addEventListener('click', function(event) {
            const toggleButton = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId);
            const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
            
            if (event.target && event.target.id === AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId) {
                const isActive = document.body.classList.contains('ai-coach-active');
                toggleAICoachPanel(!isActive);
            }
            
            if (panel && event.target && event.target.classList.contains('ai-coach-close-btn') && panel.contains(event.target)) {
                toggleAICoachPanel(false);
            }
        });
        logAICoach("Event listeners set up.");
    }

    window.initializeAICoachLauncher = initializeAICoachLauncher;
} 