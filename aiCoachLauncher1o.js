// AI Coach Launcher Script (aiCoachLauncher.js)

// Guard to prevent re-initialization
if (window.aiCoachLauncherInitialized) {
    console.warn("[AICoachLauncher] Attempted to re-initialize. Skipping.");
} else {
    window.aiCoachLauncherInitialized = true;

    let AI_COACH_LAUNCHER_CONFIG = null;
    let coachObserver = null;
    let coachUIInitialized = false;
    let debouncedObserverCallback = null; // For debouncing mutation observer
    let eventListenersAttached = false; // ADDED: Module-scoped flag for event listeners
    let currentFetchAbortController = null; // ADD THIS
    let lastFetchedStudentId = null; // ADD THIS to track the ID for which data was last fetched
    let observerLastProcessedStudentId = null; // ADD THIS: Tracks ID processed by observer
    let currentlyFetchingStudentId = null; // ADD THIS
    let vespaChartInstance = null; // To keep track of the chart instance for updates/destruction

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

    // Function to ensure Chart.js is loaded
    function ensureChartJsLoaded(callback) {
        if (typeof Chart !== 'undefined') {
            logAICoach("Chart.js already loaded.");
            if (callback) callback();
            return;
        }
        logAICoach("Chart.js not found, attempting to load from CDN...");
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.7.1/dist/chart.min.js';
        script.onload = () => {
            logAICoach("Chart.js loaded successfully from CDN.");
            if (callback) callback();
        };
        script.onerror = () => {
            console.error("[AICoachLauncher] Failed to load Chart.js from CDN.");
            // Optionally, display an error in the chart container
            const chartContainer = document.getElementById('vespaComparisonChartContainer');
            if(chartContainer) chartContainer.innerHTML = '<p style="color:red; text-align:center;">Chart library failed to load.</p>';
        };
        document.head.appendChild(script);
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
        if (coachUIInitialized && document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId)) {
            logAICoach("Coach UI appears to be already initialized with a button. Skipping full re-initialization.");
            // If UI is marked initialized and button exists, critical parts are likely fine.
            // Data refresh is handled by observer logic or toggleAICoachPanel.
            return;
        }

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
        lastFetchedStudentId = null; 
        observerLastProcessedStudentId = null; // ADD THIS: Reset when UI is cleared
        currentlyFetchingStudentId = null; // ADD THIS: Clear if ID becomes null
        if (currentFetchAbortController) { 
            currentFetchAbortController.abort();
            currentFetchAbortController = null;
            logAICoach("Aborted ongoing fetch as UI was cleared (not individual report).");
        }
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

        // Debounce utility
        function debounce(func, wait) {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), wait);
            };
        }

        const observerCallback = function(mutationsList, observer) {
            logAICoach("MutationObserver detected DOM change (raw event).");
            const currentStudentIdFromWindow = window.currentReportObject10Id;

            if (isIndividualReportView()) {
                const panelIsActive = document.body.classList.contains('ai-coach-active');
                if (!coachUIInitialized) { 
                    initializeCoachUI();
                } else if (panelIsActive) { 
                    // Only refresh if the student ID has actually changed from the observer's last processed ID
                    if (currentStudentIdFromWindow && currentStudentIdFromWindow !== observerLastProcessedStudentId) {
                        logAICoach(`Observer: Student ID changed from ${observerLastProcessedStudentId} to ${currentStudentIdFromWindow}. Triggering refresh.`);
                        observerLastProcessedStudentId = currentStudentIdFromWindow; // Update before refresh
                        refreshAICoachData(); 
                    } else if (!currentStudentIdFromWindow && observerLastProcessedStudentId !== null) {
                        // Case: Student ID became null (e.g., navigating away from a specific student but still on a report page somehow)
                        logAICoach(`Observer: Student ID became null. Previously ${observerLastProcessedStudentId}. Clearing UI.`);
                        observerLastProcessedStudentId = null;
                        clearCoachUI(); // Or handle as appropriate, maybe refreshAICoachData will show error.
                    } else if (currentStudentIdFromWindow && currentStudentIdFromWindow === observerLastProcessedStudentId){
                        logAICoach(`Observer: Student ID ${currentStudentIdFromWindow} is the same as observerLastProcessedStudentId. No refresh from observer.`);
                    }
                }
            } else {
                if (observerLastProcessedStudentId !== null) { // Only clear if we were previously tracking a student
                    logAICoach("Observer: Not on individual report view. Clearing UI and resetting observer ID.");
                    observerLastProcessedStudentId = null;
                    clearCoachUI();
                }
            }
        };

        // Use a debounced version of the observer callback
        debouncedObserverCallback = debounce(function() {
            logAICoach("MutationObserver processing (debounced).");
            const currentStudentIdFromWindow = window.currentReportObject10Id;

            if (isIndividualReportView()) {
                const panelIsActive = document.body.classList.contains('ai-coach-active');
                if (!coachUIInitialized) { 
                    initializeCoachUI();
                } else if (panelIsActive) { 
                    // Only refresh if the student ID has actually changed from the observer's last processed ID
                    if (currentStudentIdFromWindow && currentStudentIdFromWindow !== observerLastProcessedStudentId) {
                        logAICoach(`Observer: Student ID changed from ${observerLastProcessedStudentId} to ${currentStudentIdFromWindow}. Triggering refresh.`);
                        observerLastProcessedStudentId = currentStudentIdFromWindow; // Update before refresh
                        refreshAICoachData(); 
                    } else if (!currentStudentIdFromWindow && observerLastProcessedStudentId !== null) {
                        // Case: Student ID became null (e.g., navigating away from a specific student but still on a report page somehow)
                        logAICoach(`Observer: Student ID became null. Previously ${observerLastProcessedStudentId}. Clearing UI.`);
                        observerLastProcessedStudentId = null;
                        clearCoachUI(); // Or handle as appropriate, maybe refreshAICoachData will show error.
                    } else if (currentStudentIdFromWindow && currentStudentIdFromWindow === observerLastProcessedStudentId){
                        logAICoach(`Observer: Student ID ${currentStudentIdFromWindow} is the same as observerLastProcessedStudentId. No refresh from observer.`);
                    }
                }
            } else {
                if (observerLastProcessedStudentId !== null) { // Only clear if we were previously tracking a student
                    logAICoach("Observer: Not on individual report view. Clearing UI and resetting observer ID.");
                    observerLastProcessedStudentId = null;
                    clearCoachUI();
                }
            }
        }, 750); // Debounce for 750ms

        coachObserver = new MutationObserver(observerCallback); // Use the raw, non-debounced one
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
                background-color: #f4f6f8; /* Main panel background */
                border-left: 1px solid #ddd;
                padding: 20px;
                box-sizing: border-box;
                overflow-y: auto;
                z-index: 1050;
                transition: width 0.3s ease-in-out, opacity 0.3s ease-in-out, visibility 0.3s;
                font-family: Arial, sans-serif; 
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
                color: #333; /* Darker text for header */
            }
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-close-btn {
                background: none;
                border: none;
                font-size: 1.6em;
                cursor: pointer;
                padding: 5px;
                color: #555; /* Darker color for close button */
            }
            #aiCoachLauncherButtonContainer { /* This is for the main Activate AI Coach button if used from config */
                 text-align: center; 
                 padding: 20px; 
                 border-top: 1px solid #eee;
            }
            .ai-coach-section-toggles {
                display: flex; /* Make buttons appear in a row */
                flex-direction: row; /* Explicitly row */
                justify-content: space-between; /* Distribute space */
                gap: 8px; /* Space between buttons */
                margin: 10px 0 15px 0 !important; /* Ensure margin is applied */
            }
            .ai-coach-section-toggles .p-button {
                flex-grow: 1; /* Allow buttons to grow and share space */
                padding: 10px 5px !important; /* Adjust padding */
                font-size: 0.85em !important; /* Slightly smaller font for row layout */
                border: none; /* Remove existing p-button border if any */
                color: white !important; /* Text color */
                border-radius: 4px;
                transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
            }
            .ai-coach-section-toggles .p-button:hover {
                opacity: 0.85;
                transform: translateY(-1px);
            }
            #aiCoachToggleVespaButton {
                background-color: #79A6DC !important; /* Vespa Blue */
            }
            #aiCoachToggleAcademicButton {
                background-color: #77DD77 !important; /* Academic Green */
            }
            #aiCoachToggleQuestionButton {
                background-color: #C3B1E1 !important; /* Question Purple */
            }

            .ai-coach-section {
                margin-bottom: 20px;
                padding: 15px;
                background-color: #fff; /* White background for content sections */
                border: 1px solid #e0e0e0;
                border-radius: 5px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            .ai-coach-section h4 {
                font-size: 1.1em;
                margin-top: 0;
                margin-bottom: 10px;
                color: #333;
                border-bottom: 1px solid #eee;
                padding-bottom: 5px;
            }
            .ai-coach-section h5 {
                font-size: 1em; /* For sub-headings within sections */
                color: #444;
                margin-top: 15px;
                margin-bottom: 8px;
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
            /* Style for chart containers if Chart.js fails or data is missing */
            #vespaComparisonChartContainer p,
            #questionScoresChartContainer p {
                color: #777;
                font-style: italic;
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

        let buttonContainer = document.getElementById('aiCoachLauncherButtonContainer');
        
        // If the main button container div doesn't exist within the targetElement, create it.
        if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.id = 'aiCoachLauncherButtonContainer';
            // Clear targetElement before appending to ensure it only contains our button container.
            // This assumes targetElement is designated EXCLUSIVELY for the AI Coach button.
            // If targetElement can have other dynamic content, this approach needs refinement.
            targetElement.innerHTML = ''; // Clear previous content from target
            targetElement.appendChild(buttonContainer);
            logAICoach("Launcher button container DIV created in target: " + AI_COACH_LAUNCHER_CONFIG.elementSelector);
        }

        // Now, populate/repopulate the buttonContainer if the button itself is missing.
        // clearCoachUI empties buttonContainer.innerHTML.
        if (!buttonContainer.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId}`)) {
            const buttonContentHTML = `
                <p>Get AI-powered insights and suggestions to enhance your coaching conversation.</p>
                <button id="${AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId}" class="p-button p-component">🚀 Activate AI Coach</button>
            `;
            buttonContainer.innerHTML = buttonContentHTML;
            logAICoach("Launcher button content added/re-added to container.");
        } else {
            logAICoach("Launcher button content already present in container.");
        }
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

        if (!studentId) { 
             logAICoach("fetchAICoachingData called with no studentId. Aborting.");
             if(panelContent && !panelContent.querySelector('.ai-coach-section p[style*="color:red"], .ai-coach-section p[style*="color:orange"] ')) {
                panelContent.innerHTML = '<div class="ai-coach-section"><p style="color:orange;">Student ID missing, cannot fetch AI coaching data.</p></div>';
             }
             return;
        }

        // If already fetching for this specific studentId, don't start another one.
        if (currentlyFetchingStudentId === studentId) {
            logAICoach(`fetchAICoachingData: Already fetching data for student ID ${studentId}. Aborting duplicate call.`);
            return;
        }

        // If there's an ongoing fetch for a *different* student, abort it.
        if (currentFetchAbortController) {
            currentFetchAbortController.abort();
            logAICoach("Aborted previous fetchAICoachingData call for a different student.");
        }
        currentFetchAbortController = new AbortController(); 
        const signal = currentFetchAbortController.signal;

        currentlyFetchingStudentId = studentId; // Mark that we are now fetching for this student

        // Set loader text more judiciously
        if (!panelContent.innerHTML.includes('<div class="loader"></div>')) {
            panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Loading AI Coach insights...</p>';
        }

        try {
            logAICoach("Fetching AI Coaching Data for student_object10_record_id: " + studentId);
            const response = await fetch(HEROKU_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ student_object10_record_id: studentId }),
                signal: signal 
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "An unknown error occurred."}));
                throw new Error(`API Error (${response.status}): ${errorData.error || errorData.message || response.statusText}`);
            }

            const data = await response.json();
            logAICoach("AI Coaching data received:", data);
            lastFetchedStudentId = studentId; 
            renderAICoachData(data);

        } catch (error) {
            if (error.name === 'AbortError') {
                logAICoach('Fetch aborted for student ID: ' + studentId);
            } else {
                logAICoach("Error fetching AI Coaching data:", error);
                // Only update panel if this error wasn't for an aborted old fetch
                if (currentlyFetchingStudentId === studentId) { 
                    panelContent.innerHTML = `<div class="ai-coach-section"><p style="color:red;">Error loading AI Coach insights: ${error.message}</p></div>`;
                }
            }
        } finally {
            // If this fetch (for this studentId) was the one being tracked, clear the tracking flag.
            if (currentlyFetchingStudentId === studentId) {
                currentlyFetchingStudentId = null;
            }
            // If this specific fetch was the one associated with the current controller, nullify it
            if (currentFetchAbortController && currentFetchAbortController.signal === signal) {
                currentFetchAbortController = null;
            }
        }
    }

    function renderAICoachData(data) {
        logAICoach("renderAICoachData CALLED. Data received:", JSON.parse(JSON.stringify(data)));
        const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);

        if (!panelContent) {
            logAICoach("renderAICoachData: panelContent element not found. Cannot render.");
            return;
        }

        panelContent.innerHTML = ''; // Clear previous content

        // --- 1. Construct the entire HTML shell (Snapshot, Buttons, Empty Content Divs) ---
        let htmlShell = '';

        // AI Student Snapshot part
        htmlShell += '<div class="ai-coach-section">';
        htmlShell += '<h4>AI Student Snapshot</h4>';
        if (data.llm_generated_insights && data.llm_generated_insights.student_overview_summary) {
            htmlShell += `<p>${data.llm_generated_insights.student_overview_summary}</p>`;
        } else if (data.student_name && data.student_name !== "N/A") { 
            htmlShell += '<p>AI summary is being generated or is not available for this student.</p>';
        } else {
             htmlShell += '<p>No detailed coaching data or student context available. Ensure the report is loaded.</p>';
        }
        htmlShell += '</div>';
        
        // Toggle Buttons part
        // We add buttons even if student_name is N/A, they just might show empty sections
        htmlShell += `
            <div class="ai-coach-section-toggles" style="margin: 10px 0 15px 0; display: flex; gap: 10px;">
                <button id="aiCoachToggleVespaButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachVespaProfileContainer">
                    View VESPA Profile Insights
                </button>
                <button id="aiCoachToggleAcademicButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachAcademicProfileContainer">
                    View Academic Profile Insights
                </button>
                <button id="aiCoachToggleQuestionButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachQuestionAnalysisContainer">
                    View Questionnaire Analysis
                </button>
            </div>
        `;
        
        // Empty Content Divs part
        htmlShell += '<div id="aiCoachVespaProfileContainer" class="ai-coach-details-section" style="display: none;"></div>';
        htmlShell += '<div id="aiCoachAcademicProfileContainer" class="ai-coach-details-section" style="display: none;"></div>';
        htmlShell += '<div id="aiCoachQuestionAnalysisContainer" class="ai-coach-details-section" style="display: none;"></div>';

        // --- Set the HTML shell to the panel content ---
        panelContent.innerHTML = htmlShell;

        // --- 2. Conditionally Populate Content Sections (only if data.student_name is valid) ---
        //    This check ensures we don't try to populate if the core student identifier is missing.
        if (data.student_name && data.student_name !== "N/A") {
            // --- Populate VESPA Profile Section (now VESPA Insights) ---
            const vespaContainer = document.getElementById('aiCoachVespaProfileContainer');
            
            if (vespaContainer && data.llm_generated_insights) { // Check for llm_generated_insights
                const insights = data.llm_generated_insights;

                // 1. Populate Chart & Comparative Data Section
                const chartComparativeSection = vespaContainer.querySelector('#vespaChartComparativeSection');
                if (chartComparativeSection) {
                    let chartHtml = '<h5>Chart & Comparative Data</h5>';
                    chartHtml += '<div id="vespaComparisonChartContainer" style="height: 250px; margin-bottom: 15px; background: #eee; display:flex; align-items:center; justify-content:center;"><p>Comparison Chart Area</p></div>';
                    if (insights.chart_comparative_insights) {
                        chartHtml += `<p>${insights.chart_comparative_insights}</p>`;
                    } else {
                        chartHtml += '<p><em>AI insights on chart data are currently unavailable.</em></p>';
                    }
                    chartComparativeSection.innerHTML = chartHtml;
                    // Ensure chart is rendered if data for it is available
                    ensureChartJsLoaded(() => {
                        renderVespaComparisonChart(data.vespa_profile, data.school_vespa_averages);
                    });
                } else {
                    console.warn("[AICoachLauncher] vespaChartComparativeSection not found.")
                }

                // 2. Populate Most Important Coaching Questions Section
                const coachingQuestionsSection = vespaContainer.querySelector('#vespaCoachingQuestionsSection');
                if (coachingQuestionsSection) {
                    let questionsHtml = '<h5>Most Important Coaching Questions</h5>';
                    if (insights.most_important_coaching_questions && insights.most_important_coaching_questions.length > 0) {
                        questionsHtml += '<ul>';
                        insights.most_important_coaching_questions.forEach(q => {
                            questionsHtml += `<li>${q}</li>`;
                        });
                        questionsHtml += '</ul>';
                    } else {
                        questionsHtml += '<p><em>AI-selected coaching questions are currently unavailable.</em></p>';
                    }
                    coachingQuestionsSection.innerHTML = questionsHtml;
                }

                // 3. Populate Student Comment & Goals Insights Section
                const studentCommentsGoalsSection = vespaContainer.querySelector('#vespaStudentCommentsGoalsSection');
                if (studentCommentsGoalsSection) {
                    let commentsGoalsHtml = '<h5>Student Comment & Goals Insights</h5>';
                    if (insights.student_comment_analysis) {
                        commentsGoalsHtml += `<p><strong>Comment Analysis:</strong> ${insights.student_comment_analysis}</p>`;
                    } else {
                        commentsGoalsHtml += '<p><em>AI analysis of student comments is currently unavailable.</em></p>';
                    }
                    if (insights.suggested_student_goals && insights.suggested_student_goals.length > 0) {
                        commentsGoalsHtml += '<div style="margin-top:10px;"><strong>Suggested Goals:</strong><ul>';
                        insights.suggested_student_goals.forEach(g => {
                            commentsGoalsHtml += `<li>${g}</li>`;
                        });
                        commentsGoalsHtml += '</ul></div>';
                    } else {
                        commentsGoalsHtml += '<p style="margin-top:10px;"><em>Suggested goals are currently unavailable.</em></p>';
                    }
                    studentCommentsGoalsSection.innerHTML = commentsGoalsHtml;
                }
            } else if (vespaContainer) { // If llm_generated_insights is missing but container exists
                // Keep the overall placeholder structure if insights object is missing
                let baseHtml = vespaContainer.innerHTML; // Preserve existing structure (title, 3 sections)
                if (!baseHtml.includes('id="vespaChartComparativeSection"')) { // Basic check if it was even setup
                    baseHtml = '<div class="ai-coach-section"><h4>VESPA Insights</h4>';
                    baseHtml += '<div id="vespaChartComparativeSection"><h5>Chart & Comparative Data</h5><p>VESPA insights data not available.</p></div>';
                    baseHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';
                    baseHtml += '<div id="vespaCoachingQuestionsSection"><h5>Most Important Coaching Questions</h5><p>VESPA insights data not available.</p></div>';
                    baseHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';
                    baseHtml += '<div id="vespaStudentCommentsGoalsSection"><h5>Student Comment & Goals Insights</h5><p>VESPA insights data not available.</p></div>';
                    baseHtml += '</div>';
                    vespaContainer.innerHTML = baseHtml;
                } else {
                    // If the structure is there but data is missing, update placeholders in each section
                    const chartSection = vespaContainer.querySelector('#vespaChartComparativeSection p:not([style*="color:red"])'); // target the placeholder
                    if(chartSection) chartSection.textContent = 'Chart and comparative insights data not available.';
                    const questionsSection = vespaContainer.querySelector('#vespaCoachingQuestionsSection p');
                    if(questionsSection) questionsSection.textContent = 'Coaching questions data not available.';
                    const goalsSection = vespaContainer.querySelector('#vespaStudentCommentsGoalsSection p');
                    if(goalsSection) goalsSection.textContent = 'Student comment/goals analysis data not available.';
                }
            }

            // --- Populate Academic Profile Section ---
            let academicHtml = '';
            const academicContainer = document.getElementById('aiCoachAcademicProfileContainer');
            if (academicContainer) {
                academicHtml += `
                    <div class="ai-coach-section">
                        <h4>Student Overview</h4>
                        <p><strong>Name:</strong> ${data.student_name || 'N/A'}</p>
                        <p><strong>Level:</strong> ${data.student_level || 'N/A'}</p>
                        <p><strong>Current VESPA Cycle:</strong> ${data.current_cycle || 'N/A'}</p>
                    </div>
                `;
                if (data.academic_profile_summary && data.academic_profile_summary.length > 0 && 
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("not found")) &&
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("No academic subjects parsed"))) {
                    academicHtml += '<div class="ai-coach-section"><h4>Academic Profile</h4><ul>';
                    data.academic_profile_summary.forEach(subject => {
                        academicHtml += `<li><strong>${subject.subject || 'N/A'}:</strong> Grade ${subject.currentGrade || 'N/A'} (Target: ${subject.targetGrade || 'N/A'}, Effort: ${subject.effortGrade || 'N/A'})</li>`;
                    });
                    academicHtml += '</ul></div>';
                } else {
                    academicHtml += '<div class="ai-coach-section"><h4>Academic Profile</h4><p>No detailed academic profile available or profile not found.</p></div>';
                }
                academicHtml += '<div class="ai-coach-section"><h4>AI Analysis: Linking VESPA to Academics</h4><p><em>(AI will analyze non-cognitive factors affecting academic performance here)</em></p></div>';
                academicContainer.innerHTML = academicHtml;
            }

            // --- Populate Question Level Analysis Section ---
            let questionHtml = '';
            const questionContainer = document.getElementById('aiCoachQuestionAnalysisContainer');
            if (questionContainer) {
                questionHtml += '<div class="ai-coach-section"><h4>Questionnaire Analysis (Object_29)</h4>';
                if (data.object29_question_highlights && (data.object29_question_highlights.top_3 || data.object29_question_highlights.bottom_3)) {
                    const highlights = data.object29_question_highlights;
                    if (highlights.top_3 && highlights.top_3.length > 0) {
                        questionHtml += '<h5>Top Scoring Questions:</h5><ul>';
                        highlights.top_3.forEach(q => {
                            questionHtml += `<li>Score ${q.score}/5 (${q.category}): "${q.text}"</li>`;
                        });
                        questionHtml += '</ul>';
                    }
                    if (highlights.bottom_3 && highlights.bottom_3.length > 0) {
                        questionHtml += '<h5>Bottom Scoring Questions:</h5><ul>';
                        highlights.bottom_3.forEach(q => {
                            questionHtml += `<li>Score ${q.score}/5 (${q.category}): "${q.text}"</li>`;
                        });
                        questionHtml += '</ul>';
                    }
                    questionHtml += '<div id="questionScoresChartContainer" style="height: 300px; margin-top:15px; background: #eee; display:flex; align-items:center; justify-content:center;"><p>Question Scores Chart Area</p></div>';
                } else {
                    questionHtml += "<p>No specific top/bottom question highlights processed from Object_29.</p>";
                }
                if (data.student_reflections_and_goals) {
                    const reflections = data.student_reflections_and_goals;
                    const currentCycle = data.current_cycle ? parseInt(data.current_cycle) : null;
                    let reflectionsContent = '';
                    const reflectionsMap = [
                        { key: 'rrc1_comment', label: 'RRC1', cycle: 1 },
                        { key: 'rrc2_comment', label: 'RRC2', cycle: 2 },
                        { key: 'rrc3_comment', label: 'RRC3', cycle: 3 },
                        { key: 'goal1', label: 'Goal 1', cycle: 1 },
                        { key: 'goal2', label: 'Goal 2', cycle: 2 },
                        { key: 'goal3', label: 'Goal 3', cycle: 3 },
                    ];
                    reflectionsMap.forEach(item => {
                        if (reflections[item.key] && reflections[item.key].trim() !== '' && reflections[item.key].trim() !== 'Not specified') {
                            const isCurrentCycleComment = currentCycle === item.cycle;
                            const style = isCurrentCycleComment ? 'font-weight: bold; color: #0056b3;' : '';
                            const cycleLabel = isCurrentCycleComment ? ' (Current Cycle)' : ` (Cycle ${item.cycle})`;
                            reflectionsContent += `<p style="${style}"><strong>${item.label}${cycleLabel}:</strong> ${reflections[item.key]}</p>`;
                        }
                    });
                    if (reflectionsContent.trim() !== '') {
                        questionHtml += `<div style="margin-top:15px;"><h5>Student Reflections & Goals (Object_10)</h5>${reflectionsContent}</div>`;
                    } else {
                        questionHtml += "<div style='margin-top:15px;'><h5>Student Reflections & Goals (Object_10)</h5><p>No specific comments or goals recorded.</p></div>";
                    }
                }
                questionHtml += "<div style='margin-top:15px;'><h5>General AI Interpretation of Questionnaire</h5><p><em>(AI will provide an overall summary of what the questionnaire responses suggest about the student here)</em></p></div>";
                questionHtml += '</div>';
                questionContainer.innerHTML = questionHtml;
            }
        } else {
            // If data.student_name was N/A or missing, the main content sections remain empty or show a message.
            // We can add placeholder messages to the empty containers if desired.
            const vespaContainer = document.getElementById('aiCoachVespaProfileContainer');
            if (vespaContainer) vespaContainer.innerHTML = '<div class="ai-coach-section"><p>Student data not fully available to populate VESPA details.</p></div>';
            const academicContainer = document.getElementById('aiCoachAcademicProfileContainer');
            if (academicContainer) academicContainer.innerHTML = '<div class="ai-coach-section"><p>Student data not fully available to populate Academic details.</p></div>';
            const questionContainer = document.getElementById('aiCoachQuestionAnalysisContainer');
            if (questionContainer) questionContainer.innerHTML = '<div class="ai-coach-section"><p>Student data not fully available to populate Questionnaire analysis.</p></div>';
        }

        // --- 3. Add Event Listeners for Toggle Buttons (always attach) ---
        const toggleButtons = [
            { id: 'aiCoachToggleVespaButton', containerId: 'aiCoachVespaProfileContainer' },
            { id: 'aiCoachToggleAcademicButton', containerId: 'aiCoachAcademicProfileContainer' },
            { id: 'aiCoachToggleQuestionButton', containerId: 'aiCoachQuestionAnalysisContainer' }
        ];

        toggleButtons.forEach(btnConfig => {
            const button = document.getElementById(btnConfig.id);
            const detailsContainer = document.getElementById(btnConfig.containerId); // Get container once

            if (button && detailsContainer) { // Ensure both button and container exist
                button.addEventListener('click', () => {
                    const allDetailSections = document.querySelectorAll('.ai-coach-details-section');
                    // const currentButtonText = button.textContent; // Not needed with new logic
                    const isCurrentlyVisible = detailsContainer.style.display === 'block';

                    // Hide all sections first
                    allDetailSections.forEach(section => {
                        if (section.id !== btnConfig.containerId) { // Don't hide the one we might show
                            section.style.display = 'none';
                        }
                    });
                    // Reset all other button texts and ARIA states
                    toggleButtons.forEach(b => {
                        if (b.id !== btnConfig.id) {
                            const otherBtn = document.getElementById(b.id);
                            if (otherBtn) {
                                otherBtn.textContent = `View ${b.id.replace('aiCoachToggle', '').replace('Button','')} Insights`;
                                otherBtn.setAttribute('aria-expanded', 'false');
                            }
                        }
                    });
                    
                    if (isCurrentlyVisible) {
                        detailsContainer.style.display = 'none';
                        button.textContent = `View ${btnConfig.id.replace('aiCoachToggle', '').replace('Button','')} Insights`;
                        button.setAttribute('aria-expanded', 'false');
                    } else {
                        detailsContainer.style.display = 'block';
                        button.textContent = `Hide ${btnConfig.id.replace('aiCoachToggle', '').replace('Button','')} Insights`;
                        button.setAttribute('aria-expanded', 'true');
                    }
                });
            } else {
                logAICoach(`Button or container not found for config: ${btnConfig.id}`);
            }
        });

        logAICoach("renderAICoachData: Successfully rendered shell and conditionally populated data. Event listeners attached.");

        // --- Add Chat Interface (conditionally, if student context is valid) ---
        if (data.student_name && data.student_name !== "N/A") {
            addChatInterface(panelContent, data.student_name);
        } else {
            // Optionally, add a placeholder if chat cannot be initialized due to missing student context
            const existingChat = document.getElementById('aiCoachChatContainer');
            if(existingChat && existingChat.parentNode === panelContent) {
                panelContent.removeChild(existingChat);
            }
            logAICoach("Chat interface not added due to missing student context.");
        }
    }

    function renderVespaComparisonChart(studentVespaProfile, schoolVespaAverages) {
        const chartContainer = document.getElementById('vespaComparisonChartContainer');
        if (!chartContainer) {
            logAICoach("VESPA comparison chart container not found.");
            return;
        }

        if (typeof Chart === 'undefined') {
            logAICoach("Chart.js is not loaded. Cannot render VESPA comparison chart.");
            chartContainer.innerHTML = '<p style="color:red; text-align:center;">Chart library not loaded.</p>';
            return;
        }

        // Destroy previous chart instance if it exists
        if (vespaChartInstance) {
            vespaChartInstance.destroy();
            vespaChartInstance = null;
            logAICoach("Previous VESPA chart instance destroyed.");
        }
        
        // Ensure chartContainer is empty before creating a new canvas
        chartContainer.innerHTML = '<canvas id="vespaStudentVsSchoolChart"></canvas>';
        const ctx = document.getElementById('vespaStudentVsSchoolChart').getContext('2d');

        if (!studentVespaProfile) {
            logAICoach("Student VESPA profile data is missing. Cannot render chart.");
            chartContainer.innerHTML = '<p style="text-align:center;">Student VESPA data not available for chart.</p>';
            return;
        }

        const labels = ['Vision', 'Effort', 'Systems', 'Practice', 'Attitude'];
        const studentScores = labels.map(label => {
            const elementData = studentVespaProfile[label];
            return elementData && elementData.score_1_to_10 !== undefined && elementData.score_1_to_10 !== "N/A" ? parseFloat(elementData.score_1_to_10) : 0;
        });

        const datasets = [
            {
                label: 'Student Scores',
                data: studentScores,
                backgroundColor: 'rgba(54, 162, 235, 0.6)', // Blue
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }
        ];

        let chartTitle = 'Student VESPA Scores';

        if (schoolVespaAverages) {
            const schoolScores = labels.map(label => {
                return schoolVespaAverages[label] !== undefined && schoolVespaAverages[label] !== "N/A" ? parseFloat(schoolVespaAverages[label]) : 0;
            });
            datasets.push({
                label: 'School Average',
                data: schoolScores,
                backgroundColor: 'rgba(255, 159, 64, 0.6)', // Orange
                borderColor: 'rgba(255, 159, 64, 1)',
                borderWidth: 1
            });
            chartTitle = 'Student VESPA Scores vs. School Average';
            logAICoach("School averages available, adding to chart.", {studentScores, schoolScores});
        } else {
            logAICoach("School averages not available for chart.");
        }

        try {
            vespaChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: chartTitle,
                            font: { size: 16, weight: 'bold' },
                            padding: { top: 10, bottom: 20 }
                        },
                        legend: {
                            position: 'top',
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 10,
                            title: {
                                display: true,
                                text: 'Score (1-10)'
                            }
                        }
                    }
                }
            });
            logAICoach("VESPA comparison chart rendered successfully.");
        } catch (error) {
            console.error("[AICoachLauncher] Error rendering Chart.js chart:", error);
            chartContainer.innerHTML = '<p style="color:red; text-align:center;">Error rendering chart.</p>';
        }
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

        logAICoach("refreshAICoachData: Attempting to get student ID...");
        
        const studentObject10Id = await getStudentObject10RecordId(); 
        
        if (studentObject10Id) {
            if (studentObject10Id !== lastFetchedStudentId || lastFetchedStudentId === null) {
                logAICoach(`refreshAICoachData: Student ID ${studentObject10Id}. Last fetched ID: ${lastFetchedStudentId}. Condition met for fetching data.`);
                // Only set loader here if not already fetching this specific ID, fetchAICoachingData will manage its own loader then.
                if (currentlyFetchingStudentId !== studentObject10Id && panelContent.innerHTML.indexOf('loader') === -1 ){
                    panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Identifying student report...</p>';
                }
                fetchAICoachingData(studentObject10Id); 
            } else {
                logAICoach(`refreshAICoachData: Student ID ${studentObject10Id} is same as last fetched (${lastFetchedStudentId}). Data likely current.`);
            }
        } else {
            logAICoach("refreshAICoachData: Student Object_10 ID not available. Panel will show error from getStudentObject10RecordId.");
            lastFetchedStudentId = null; 
            observerLastProcessedStudentId = null; 
            currentlyFetchingStudentId = null; // ADD THIS: Clear if ID becomes null
            if (panelContent.innerHTML.includes('loader') && !panelContent.innerHTML.includes('ai-coach-section')){
                 panelContent.innerHTML = '<div class="ai-coach-section"><p style="color:orange;">Could not identify student report. Please ensure the report is fully loaded.</p></div>';
            }
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
            lastFetchedStudentId = null; 
            observerLastProcessedStudentId = null; 
            currentlyFetchingStudentId = null; // ADD THIS: Reset when panel is closed
            if (currentFetchAbortController) { 
                currentFetchAbortController.abort();
                currentFetchAbortController = null;
                logAICoach("Aborted ongoing fetch as panel was closed.");
            }
        }
    }

    function setupEventListeners() {
        if (eventListenersAttached) {
            logAICoach("Global AI Coach event listeners already attached. Skipping setup.");
            return;
        }

        document.body.addEventListener('click', function(event) {
            if (!AI_COACH_LAUNCHER_CONFIG || 
                !AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId || 
                !AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId) {
                // Config might not be ready if an event fires too early, or if script reloaded weirdly.
                // console.warn("[AICoachLauncher] Event listener fired, but essential config is missing.");
                return; 
            }

            const toggleButtonId = AI_COACH_LAUNCHER_CONFIG.aiCoachToggleButtonId;
            const panelId = AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId;
            
            if (event.target && event.target.id === toggleButtonId) {
                const isActive = document.body.classList.contains('ai-coach-active');
                toggleAICoachPanel(!isActive);
            }
            
            const panel = document.getElementById(panelId);
            if (panel && event.target && event.target.classList.contains('ai-coach-close-btn') && panel.contains(event.target)) {
                toggleAICoachPanel(false);
            }
        });
        eventListenersAttached = true;
        logAICoach("Global AI Coach event listeners set up ONCE.");
    }

    // --- Function to add Chat Interface --- 
    function addChatInterface(panelContentElement, studentNameForContext) {
        if (!panelContentElement) return;

        logAICoach("Adding chat interface...");

        const chatContainer = document.createElement('div');
        chatContainer.id = 'aiCoachChatContainer';
        chatContainer.className = 'ai-coach-section'; // Use existing class for styling consistency
        chatContainer.style.marginTop = '20px';

        chatContainer.innerHTML = `
            <h4>AI Chat with ${studentNameForContext}</h4>
            <div id="aiCoachChatDisplay" style="height: 200px; border: 1px solid #ccc; overflow-y: auto; padding: 10px; margin-bottom: 10px; background-color: #fff;">
                <p class="ai-chat-message ai-chat-message-bot"><em>AI Coach:</em> Hello! How can I help you with ${studentNameForContext} today? (Chat functionality is under development)</p>
            </div>
            <div style="display: flex;">
                <input type="text" id="aiCoachChatInput" style="flex-grow: 1; padding: 8px; border: 1px solid #ccc;" placeholder="Type your message...">
                <button id="aiCoachChatSendButton" class="p-button p-component" style="margin-left: 10px; padding: 8px 15px;">Send</button>
            </div>
        `;
        panelContentElement.appendChild(chatContainer);

        const chatInput = document.getElementById('aiCoachChatInput');
        const chatSendButton = document.getElementById('aiCoachChatSendButton');
        const chatDisplay = document.getElementById('aiCoachChatDisplay');

        function sendChatMessage() {
            if (!chatInput || !chatDisplay) return;
            const messageText = chatInput.value.trim();
            if (messageText === '') return;

            // Display user message
            const userMessageElement = document.createElement('p');
            userMessageElement.className = 'ai-chat-message ai-chat-message-user';
            userMessageElement.textContent = `You: ${messageText}`;
            chatDisplay.appendChild(userMessageElement);

            chatInput.value = ''; // Clear input
            chatDisplay.scrollTop = chatDisplay.scrollHeight; // Scroll to bottom

            // Placeholder for LLM response
            // In the future, this will involve an API call
            setTimeout(() => {
                const botMessageElement = document.createElement('p');
                botMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                botMessageElement.innerHTML = `<em>AI Coach:</em> Thinking... (response for \"${messageText}\" will appear here)`;
                chatDisplay.appendChild(botMessageElement);
                chatDisplay.scrollTop = chatDisplay.scrollHeight; // Scroll to bottom
            }, 500);
        }

        if (chatSendButton) {
            chatSendButton.addEventListener('click', sendChatMessage);
        }
        if (chatInput) {
            chatInput.addEventListener('keypress', function(event) {
                if (event.key === 'Enter') {
                    sendChatMessage();
                }
            });
        }
        logAICoach("Chat interface added and event listeners set up.");
    }

    window.initializeAICoachLauncher = initializeAICoachLauncher;
} 
