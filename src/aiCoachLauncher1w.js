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
            /* Styles for Benchmark Scales */
            .subject-benchmark-item {
                padding: 10px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            .subject-benchmark-item:last-child {
                border-bottom: none;
            }
            .subject-benchmark-header {
                /* display: flex; */ /* Already part of a section, might not need flex here directly */
                /* justify-content: space-between; */
                /* align-items: center; */
                margin-bottom: 8px;
            }
            .subject-benchmark-header h5 { /* For subject name, within its own section */
                margin: 0 0 5px 0;
                font-size: 1em;
                font-weight: bold;
                color: #224466; /* Dark blue for subject names */
            }
            .subject-grades-info {
                font-size: 0.85em;
                color: #555;
                margin-bottom: 12px; /* Space before the scale */
            }
            .subject-benchmark-scale-container {
                margin-top: 5px;
                margin-bottom: 25px; /* Increased space below each scale */
                padding: 0 5px; 
            }
            .scale-labels {
                display: flex;
                justify-content: space-between;
                font-size: 0.75em;
                color: #777;
                margin-bottom: 4px;
            }
            .scale-bar-wrapper {
                width: 100%;
                height: 10px; 
                background-color: #e9ecef; 
                border-radius: 5px;
                position: relative;
            }
            .scale-bar { 
                height: 100%;
                position: relative; 
            }
            .scale-marker {
                width: 8px; 
                height: 16px; 
                border-radius: 2px; 
                position: absolute;
                top: 50%;
                transform: translateY(-50%) translateX(-50%); 
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10; 
            }
            .scale-marker .marker-label {
                position: absolute;
                bottom: -20px; 
                left: 50%;
                transform: translateX(-50%);
                font-size: 0.7em;
                color: #333;
                white-space: nowrap;
                background-color: rgba(255, 255, 255, 0.9);
                padding: 1px 3px;
                border-radius: 3px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.15);
                z-index: 11;
            }

            .current-grade-marker { background-color: #28a745; /* Green */ }
            .standard-meg-marker { background-color: #ffc107; /* Yellow */ }
            /* A-Level MEG markers will use this base color */
            .a-level-meg-marker { background-color: #007bff; /* Blue */ }
            
            /* Specific label colors for P60, P90, P100 markers for better visual distinction */
            .a-level-meg-marker.p60 .marker-label { color: #17a2b8; } /* Teal for P60 label */
            .a-level-meg-marker.p90 .marker-label { color: #fd7e14; } /* Orange for P90 label */
            .a-level-meg-marker.p100 .marker-label { color: #dc3545; } /* Red for P100 label */

            /* New styles for distinct markers */
            .current-grade-dot-marker {
                background-color: #28a745; /* Green - student's actual grade */
                width: 10px; /* Make it slightly wider for a dot feel */
                height: 10px; /* Make it a circle/square dot */
                border-radius: 50%; /* Circle dot */
                border: 2px solid white; /* White border to stand out */
                box-shadow: 0 0 3px rgba(0,0,0,0.4);
                z-index: 15; /* Higher z-index to be on top */
            }
            .current-grade-dot-marker .marker-label {
                bottom: -22px; /* Adjust label position for dot */
                font-weight: bold; /* Make student name bold */
            }

            .percentile-line-marker {
                background-color: #6c757d; /* Grey for percentile lines - can be overridden by specific Px colors */
                width: 2px; /* Thin line */
                height: 20px; /* Taller line, extending above and below center */
                border-radius: 1px; 
                z-index: 12; /* Below student marker but above bar */
            }
            /* Override for A-Level MEG percentiles to use their specific colors */
            .percentile-line-marker.a-level-meg-marker {
                 background-color: #007bff; /* Blue for general A-Level percentiles */
            }
            .percentile-line-marker.p60 {
                 background-color: #17a2b8; /* Teal */
            }
            .percentile-line-marker.p90 {
                 background-color: #fd7e14; /* Orange */
            }
            .percentile-line-marker.p100 {
                 background-color: #dc3545; /* Red */
            }
            .percentile-line-marker.standard-meg-marker { /* For the Top25% or general MEG */
                background-color: #ffc107; /* Yellow, if it's the main MEG marker */
                z-index: 13; /* Slightly higher z-index to ensure it's visible over other percentiles like P60 if they overlap */
            }

            .percentile-line-marker .marker-label {
                bottom: -20px; /* Keep labels consistent for lines */
                 font-size: 0.65em; /* Slightly smaller for percentile labels if needed */
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
        if (data.student_name && data.student_name !== "N/A") {
            // --- Populate VESPA Profile Section (now VESPA Insights) ---
            const vespaContainer = document.getElementById('aiCoachVespaProfileContainer');
            
            if (vespaContainer && data.llm_generated_insights) { 
                const insights = data.llm_generated_insights;
                let vespaInsightsHtml = ''; // Build the entire inner HTML for vespaContainer here

                // 1. Chart & Comparative Data Section
                vespaInsightsHtml += '<div id="vespaChartComparativeSection">';
                vespaInsightsHtml += '<h5>Chart & Comparative Data</h5>';
                vespaInsightsHtml += '<div id="vespaComparisonChartContainer" style="height: 250px; margin-bottom: 15px; background: #eee; display:flex; align-items:center; justify-content:center;"><p>Comparison Chart Area</p></div>';
                if (insights.chart_comparative_insights) {
                    vespaInsightsHtml += `<p>${insights.chart_comparative_insights}</p>`;
                } else {
                    vespaInsightsHtml += '<p><em>AI insights on chart data are currently unavailable.</em></p>';
                }
                vespaInsightsHtml += '</div>'; // end vespaChartComparativeSection

                vespaInsightsHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';

                // 2. Most Important Coaching Questions Section
                vespaInsightsHtml += '<div id="vespaCoachingQuestionsSection">';
                vespaInsightsHtml += '<h5>Most Important Coaching Questions</h5>';
                if (insights.most_important_coaching_questions && insights.most_important_coaching_questions.length > 0) {
                    vespaInsightsHtml += '<ul>';
                    insights.most_important_coaching_questions.forEach(q => {
                        vespaInsightsHtml += `<li>${q}</li>`;
                    });
                    vespaInsightsHtml += '</ul>';
                } else {
                    vespaInsightsHtml += '<p><em>AI-selected coaching questions are currently unavailable.</em></p>';
                }
                vespaInsightsHtml += '</div>'; // end vespaCoachingQuestionsSection

                vespaInsightsHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';

                // 3. Student Comment & Goals Insights Section
                vespaInsightsHtml += '<div id="vespaStudentCommentsGoalsSection">';
                vespaInsightsHtml += '<h5>Student Comment & Goals Insights</h5>';
                if (insights.student_comment_analysis) {
                    vespaInsightsHtml += `<p><strong>Comment Analysis:</strong> ${insights.student_comment_analysis}</p>`;
                } else {
                    vespaInsightsHtml += '<p><em>AI analysis of student comments is currently unavailable.</em></p>';
                }
                if (insights.suggested_student_goals && insights.suggested_student_goals.length > 0) {
                    vespaInsightsHtml += '<div style="margin-top:10px;"><strong>Suggested Goals:</strong><ul>';
                    insights.suggested_student_goals.forEach(g => {
                        vespaInsightsHtml += `<li>${g}</li>`;
                    });
                    vespaInsightsHtml += '</ul></div>';
                } else {
                    vespaInsightsHtml += '<p style="margin-top:10px;"><em>Suggested goals are currently unavailable.</em></p>';
                }
                vespaInsightsHtml += '</div>'; // end vespaStudentCommentsGoalsSection

                // Set the complete inner HTML for the VESPA insights area
                vespaContainer.innerHTML = vespaInsightsHtml;

                // Ensure chart is rendered now that its container div exists with content
                ensureChartJsLoaded(() => {
                    renderVespaComparisonChart(data.vespa_profile, data.school_vespa_averages);
                });
            
            } else if (vespaContainer) { 
                // If llm_generated_insights is missing but container exists, fill with placeholders
                let placeholderHtml = '<div id="vespaChartComparativeSection"><h5>Chart & Comparative Data</h5><p>VESPA insights data not available for this student.</p></div>';
                placeholderHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';
                placeholderHtml += '<div id="vespaCoachingQuestionsSection"><h5>Most Important Coaching Questions</h5><p>VESPA insights data not available for this student.</p></div>';
                placeholderHtml += '<hr style="border-top: 1px dashed #eee; margin: 15px 0;">';
                placeholderHtml += '<div id="vespaStudentCommentsGoalsSection"><h5>Student Comment & Goals Insights</h5><p>VESPA insights data not available for this student.</p></div>';
                vespaContainer.innerHTML = placeholderHtml;
            }

            // --- Populate Academic Profile Section ---
            let academicHtml = '';
            const academicContainer = document.getElementById('aiCoachAcademicProfileContainer');
            if (academicContainer) {
                // 1. Student Info (already part of the main snapshot, but can be repeated or summarized here if desired)
                // For now, let's skip re-adding basic student name/level here as it's in the main snapshot.

                // 2. Overall Academic Benchmarks
                academicHtml += '<div class="ai-coach-section"><h5>Overall Academic Benchmarks</h5>';
                if (data.academic_megs) {
                    academicHtml += `<p><strong>GCSE Prior Attainment Score:</strong> ${data.academic_megs.prior_attainment_score !== undefined && data.academic_megs.prior_attainment_score !== null ? data.academic_megs.prior_attainment_score : 'N/A'}</p>`;
                    const hasRelevantALevelMegs = ['aLevel_meg_grade_60th', 'aLevel_meg_grade_75th', 'aLevel_meg_grade_90th', 'aLevel_meg_grade_100th']
                                                .some(key => data.academic_megs[key] && data.academic_megs[key] !== 'N/A');
                    if (hasRelevantALevelMegs) {
                        academicHtml += `<h6>A-Level Percentile MEGs (Minimum Expected Grades):</h6>
                                     <ul>
                                         <li><strong>Top 40% (60th):</strong> <strong>${data.academic_megs.aLevel_meg_grade_60th || 'N/A'}</strong> (${data.academic_megs.aLevel_meg_points_60th !== undefined ? data.academic_megs.aLevel_meg_points_60th : 0} pts)</li>
                                         <li><strong>Top 25% (75th - Standard MEG):</strong> <strong>${data.academic_megs.aLevel_meg_grade_75th || 'N/A'}</strong> (${data.academic_megs.aLevel_meg_points_75th !== undefined ? data.academic_megs.aLevel_meg_points_75th : 0} pts)</li>
                                         <li><strong>Top 10% (90th):</strong> <strong>${data.academic_megs.aLevel_meg_grade_90th || 'N/A'}</strong> (${data.academic_megs.aLevel_meg_points_90th !== undefined ? data.academic_megs.aLevel_meg_points_90th : 0} pts)</li>
                                         <li><strong>Top 1% (100th):</strong> <strong>${data.academic_megs.aLevel_meg_grade_100th || 'N/A'}</strong> (${data.academic_megs.aLevel_meg_points_100th !== undefined ? data.academic_megs.aLevel_meg_points_100th : 0} pts)</li>
                                     </ul>`;
                    } else {
                        academicHtml += '<p><em>A-Level percentile MEG data not available or not applicable.</em></p>';
                    }
                } else {
                    academicHtml += '<p><em>Overall academic benchmark data not available.</em></p>';
                }
                academicHtml += '</div>'; // Close overall benchmarks section

                // 3. Subject-by-Subject Breakdown with Scales
                academicHtml += '<div class="ai-coach-section"><h5>Subject-Specific Benchmarks</h5>';
                if (data.academic_profile_summary && data.academic_profile_summary.length > 0 && 
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("not found")) &&
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("No academic subjects parsed"))) {
                    
                    let validSubjectsFoundForScales = 0;
                    data.academic_profile_summary.forEach((subject, index) => {
                        if (subject && subject.subject && 
                            !subject.subject.includes("not found by any method") && 
                            !subject.subject.includes("No academic subjects parsed")) {
                            validSubjectsFoundForScales++;
                            const studentFirstName = data.student_name ? data.student_name.split(' ')[0] : "Current";
                            academicHtml += `<div class="subject-benchmark-item">
                                        <div class="subject-benchmark-header">
                                            <h5>${subject.subject || 'N/A'} (${subject.normalized_qualification_type || 'Qual Type N/A'})</h5>
                                        </div>
                                        <p class="subject-grades-info">
                                            Current: <strong>${subject.currentGrade || 'N/A'}</strong> (${subject.currentGradePoints !== undefined ? subject.currentGradePoints : 'N/A'} pts) | 
                                            ${subject.normalized_qualification_type === 'A Level' ? 'Top 25% (MEG)' : 'Standard MEG'}: <strong>${subject.standard_meg || 'N/A'}</strong> (${subject.standardMegPoints !== undefined ? subject.standardMegPoints : 'N/A'} pts)
                                        </p>`;
                            academicHtml += createSubjectBenchmarkScale(subject, index, studentFirstName);
                            academicHtml += `</div>`; 
                        }
                    });
                    if (validSubjectsFoundForScales === 0) {
                        academicHtml += '<p>No detailed academic subjects with point data found to display benchmarks.</p>';
                   }
                } else {
                    academicHtml += '<p>No detailed academic profile subjects available to display benchmarks.</p>';
                }
                academicHtml += '</div>'; // Close subject-specific benchmarks section

                // 4. AI Analysis: Linking VESPA to Academics (Placeholder as per original structure)
                // This part now comes from the LLM output.
                if (data.llm_generated_insights && data.llm_generated_insights.academic_benchmark_analysis) {
                    academicHtml += `<div class="ai-coach-section"><h5>AI Academic Benchmark Analysis</h5>
                                     <p>${data.llm_generated_insights.academic_benchmark_analysis}</p>
                                   </div>`;
                } else {
                    academicHtml += '<div class="ai-coach-section"><h5>AI Academic Benchmark Analysis</h5><p><em>AI analysis of academic benchmarks is currently unavailable.</em></p></div>';
                }
                academicContainer.innerHTML = academicHtml;
            }

            // --- Populate Question Level Analysis Section ---
            let questionHtml = '';
            const questionContainer = document.getElementById('aiCoachQuestionAnalysisContainer');
            if (questionContainer) {
                // Incorporate user's latest text changes for title and scale description
                questionHtml += '<div class="ai-coach-section"><h4>VESPA Questionnaire Analysis</h4>';
                questionHtml += '<p style="font-size:0.8em; margin-bottom:10px;">(Response Scale: 1=Strongly Disagree, 2=Disagree, 3=Neutral, 4=Agree, 5=Strongly Agree)</p>';

                if (data.object29_question_highlights && (data.object29_question_highlights.top_3 || data.object29_question_highlights.bottom_3)) {
                    const highlights = data.object29_question_highlights;
                    if (highlights.top_3 && highlights.top_3.length > 0) {
                        questionHtml += '<h5>Highest Scoring Responses:</h5><ul>';
                        highlights.top_3.forEach(q => {
                            questionHtml += `<li>"${q.text}" (${q.category}): Response ${q.score}/5</li>`;
                        });
                        questionHtml += '</ul>';
                    }
                    if (highlights.bottom_3 && highlights.bottom_3.length > 0) {
                        questionHtml += '<h5 style="margin-top:15px;">Lowest Scoring Responses:</h5><ul>';
                        highlights.bottom_3.forEach(q => {
                            questionHtml += `<li>"${q.text}" (${q.category}): Response ${q.score}/5</li>`;
                        });
                        questionHtml += '</ul>';
                    }
                } else {
                    questionHtml += "<p>No specific top/bottom statement response highlights processed from Object_29.</p>";
                }

                questionHtml += '<div id="questionnaireResponseDistributionChartContainer" style="height: 300px; margin-top:20px; margin-bottom: 20px; background: #f9f9f9; display:flex; align-items:center; justify-content:center;"><p>Chart loading...</p></div>';

                if (data.llm_generated_insights && data.llm_generated_insights.questionnaire_interpretation_and_reflection_summary) {
                    questionHtml += `<div style='margin-top:15px;'><h5>Reflections on the VESPA Questionnaire</h5><p>${data.llm_generated_insights.questionnaire_interpretation_and_reflection_summary}</p></div>`;
                } else {
                    questionHtml += "<div style='margin-top:15px;'><h5>Reflections on the VESPA Questionnaire</h5><p><em>AI analysis of questionnaire responses and reflections is currently unavailable.</em></p></div>";
                }
                questionHtml += '</div>'; // Close ai-coach-section for Questionnaire Analysis
                questionContainer.innerHTML = questionHtml;

                // Corrected logic for rendering the pie chart:
                const chartDiv = document.getElementById('questionnaireResponseDistributionChartContainer');
                if (data.all_scored_questionnaire_statements && data.all_scored_questionnaire_statements.length > 0) {
                    ensureChartJsLoaded(() => { // Always use ensureChartJsLoaded
                        renderQuestionnaireDistributionChart(data.all_scored_questionnaire_statements);
                    });
                } else {
                    if (chartDiv) {
                        chartDiv.innerHTML = '<p style="text-align:center;">Questionnaire statement data not available for chart.</p>';
                        logAICoach("Questionnaire chart not rendered: all_scored_questionnaire_statements is missing or empty.", data.all_scored_questionnaire_statements);
                    }
                }
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
                    panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Please wait while I analyse the student data...</p>';
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

        // Remove existing chat container if it exists to prevent duplicates on re-render
        const oldChatContainer = document.getElementById('aiCoachChatContainer');
        if (oldChatContainer) {
            oldChatContainer.remove();
        }

        const chatContainer = document.createElement('div');
        chatContainer.id = 'aiCoachChatContainer';
        chatContainer.className = 'ai-coach-section'; // Use existing class for styling consistency
        chatContainer.style.marginTop = '20px';

        chatContainer.innerHTML = `
            <h4>AI Chat with ${studentNameForContext}</h4>
            <div id="aiCoachChatDisplay" style="height: 200px; border: 1px solid #ccc; overflow-y: auto; padding: 10px; margin-bottom: 10px; background-color: #fff;">
                <p class="ai-chat-message ai-chat-message-bot"><em>AI Coach:</em> Hello! How can I help you with ${studentNameForContext} today?</p>
            </div>
            <div style="display: flex;">
                <input type="text" id="aiCoachChatInput" style="flex-grow: 1; padding: 8px; border: 1px solid #ccc;" placeholder="Type your message...">
                <button id="aiCoachChatSendButton" class="p-button p-component" style="margin-left: 10px; padding: 8px 15px;">Send</button>
            </div>
            <div id="aiCoachChatThinkingIndicator" style="font-size:0.8em; color: #777; text-align:center; margin-top:5px; display:none;">AI Coach is thinking...</div>
        `;
        panelContentElement.appendChild(chatContainer);

        const chatInput = document.getElementById('aiCoachChatInput');
        const chatSendButton = document.getElementById('aiCoachChatSendButton');
        const chatDisplay = document.getElementById('aiCoachChatDisplay');
        const thinkingIndicator = document.getElementById('aiCoachChatThinkingIndicator');

        async function sendChatMessage() {
            if (!chatInput || !chatDisplay || !thinkingIndicator) return;
            const messageText = chatInput.value.trim();
            if (messageText === '') return;

            const currentStudentId = lastFetchedStudentId; // Use the ID from the last successful main data fetch
            if (!currentStudentId) {
                logAICoach("Cannot send chat message: student ID not available.");
                // Optionally display an error to the user in the chat window
                const errorMessageElement = document.createElement('p');
                errorMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                errorMessageElement.innerHTML = `<em>AI Coach:</em> Sorry, I can't process this message as the student context is missing. Please ensure student data is loaded.`;
                chatDisplay.appendChild(errorMessageElement);
                chatDisplay.scrollTop = chatDisplay.scrollHeight;
                return;
            }

            // Display user message
            const userMessageElement = document.createElement('p');
            userMessageElement.className = 'ai-chat-message ai-chat-message-user';
            userMessageElement.setAttribute('data-role', 'user'); // For history reconstruction
            userMessageElement.textContent = `You: ${messageText}`;
            chatDisplay.appendChild(userMessageElement);
            const originalInput = chatInput.value; // Keep original input for history
            chatInput.value = ''; // Clear input
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
            thinkingIndicator.style.display = 'block';
            chatSendButton.disabled = true;
            chatInput.disabled = true;

            // Construct chat history from displayed messages
            const chatHistory = [];
            const messages = chatDisplay.querySelectorAll('.ai-chat-message');
            messages.forEach(msgElement => {
                // Don't include the user message we just added to the DOM in the history sent to API
                // as it's sent separately as current_tutor_message.
                // Only include messages *before* the one just sent by the user.
                if (msgElement === userMessageElement) return; 

                let role = msgElement.getAttribute('data-role');
                let content = '';

                if (!role) { // Infer role if data-role is not set (e.g. initial bot message)
                    if (msgElement.classList.contains('ai-chat-message-bot')) {
                         role = 'assistant';
                         content = msgElement.innerHTML.replace(/<em>AI Coach:<\/em>\\s*/, '');
                    } else if (msgElement.classList.contains('ai-chat-message-user')) {
                         role = 'user';
                         content = msgElement.textContent.replace(/You:\\s*/, '');
                    } else {
                        return; // Skip if role cannot be determined
                    }
                } else {
                     content = msgElement.textContent.replace(/^(You:|<em>AI Coach:\\s*)/, '');
                }
                chatHistory.push({ role: role, content: content });
            });
            // The user's current message isn't part of displayed history yet for the API call
            // It will be added to the LLM prompt as the latest user message on the backend.

            logAICoach("Sending chat turn with history:", chatHistory);
            logAICoach("Current tutor message for API:", originalInput);

            try {
                const response = await fetch(`${HEROKU_API_URL}/chat_turn`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        student_object10_record_id: currentStudentId,
                        chat_history: chatHistory, // Send previously displayed messages
                        current_tutor_message: originalInput // Send the new message
                    }),
                });

                thinkingIndicator.style.display = 'none';
                chatSendButton.disabled = false;
                chatInput.disabled = false;

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: "An unknown error occurred communicating with the AI chat."}));
                    throw new Error(errorData.error || `Chat API Error: ${response.status}`);
                }

                const data = await response.json();
                const botMessageElement = document.createElement('p');
                botMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                botMessageElement.setAttribute('data-role', 'assistant'); // For history reconstruction
                botMessageElement.innerHTML = `<em>AI Coach:</em> ${data.ai_response}`;
                chatDisplay.appendChild(botMessageElement);

            } catch (error) {
                logAICoach("Error sending chat message:", error);
                const errorMessageElement = document.createElement('p');
                errorMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                // Don't set data-role for error messages not from AI assistant proper
                errorMessageElement.innerHTML = `<em>AI Coach:</em> Sorry, I couldn't get a response. ${error.message}`;
                chatDisplay.appendChild(errorMessageElement);
                thinkingIndicator.style.display = 'none';
                chatSendButton.disabled = false;
                chatInput.disabled = false;
            }
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
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

    // --- Helper function to determine max points for visual scale ---
    function getMaxPointsForScale(subject) {
        const normalizedType = subject.normalized_qualification_type;
        let maxPoints = 140; // Default for A-Level like scales

        const allPoints = [
            typeof subject.currentGradePoints === 'number' ? subject.currentGradePoints : 0,
            typeof subject.standardMegPoints === 'number' ? subject.standardMegPoints : 0
        ];

        if (normalizedType === "A Level") {
            if (typeof subject.megPoints60 === 'number') allPoints.push(subject.megPoints60);
            if (typeof subject.megPoints90 === 'number') allPoints.push(subject.megPoints90);
            if (typeof subject.megPoints100 === 'number') allPoints.push(subject.megPoints100);
            maxPoints = 140;
        } else if (normalizedType === "AS Level") maxPoints = 70;
        else if (normalizedType === "IB HL") maxPoints = 140;
        else if (normalizedType === "IB SL") maxPoints = 70;
        else if (normalizedType === "Pre-U Principal Subject") maxPoints = 150;
        else if (normalizedType === "Pre-U Short Course") maxPoints = 75;
        else if (normalizedType && normalizedType.includes("BTEC")) {
            if (normalizedType === "BTEC Level 3 Extended Diploma") maxPoints = 420;
            else if (normalizedType === "BTEC Level 3 Diploma") maxPoints = 280;
            else if (normalizedType === "BTEC Level 3 Subsidiary Diploma") maxPoints = 140;
            else if (normalizedType === "BTEC Level 3 Extended Certificate") maxPoints = 140;
            else maxPoints = 140; 
        } else if (normalizedType && normalizedType.includes("UAL")) {
            if (normalizedType === "UAL Level 3 Extended Diploma") maxPoints = 170;
            else if (normalizedType === "UAL Level 3 Diploma") maxPoints = 90;
            else maxPoints = 90;
        } else if (normalizedType && normalizedType.includes("CACHE")) {
            if (normalizedType === "CACHE Level 3 Extended Diploma") maxPoints = 210;
            else if (normalizedType === "CACHE Level 3 Diploma") maxPoints = 140;
            else if (normalizedType === "CACHE Level 3 Certificate") maxPoints = 70;
            else if (normalizedType === "CACHE Level 3 Award") maxPoints = 35;
            else maxPoints = 70;
        }

        const highestSubjectPoint = Math.max(0, ...allPoints.filter(p => typeof p === 'number'));
        if (highestSubjectPoint > maxPoints) {
            return highestSubjectPoint + Math.max(20, Math.floor(highestSubjectPoint * 0.1));
        }
        return maxPoints;
    }

    // --- Helper function to create a single subject's benchmark scale ---
    function createSubjectBenchmarkScale(subject, subjectIndex, studentFirstName) {
        if (!subject || typeof subject.currentGradePoints !== 'number' || typeof subject.standardMegPoints !== 'number') {
            return '<p style="font-size:0.8em; color: #777;">Benchmark scale cannot be displayed due to missing point data.</p>';
        }

        const maxScalePoints = getMaxPointsForScale(subject);
        if (maxScalePoints === 0) return '<p style="font-size:0.8em; color: #777;">Max scale points is zero, cannot render scale.</p>';

        let scaleHtml = `<div class="subject-benchmark-scale-container" id="scale-container-${subjectIndex}">
            <div class="scale-labels"><span>0 pts</span><span>${maxScalePoints} pts</span></div>
            <div class="scale-bar-wrapper"><div class="scale-bar">`;

        const createMarker = (points, grade, type, label, percentile = null, specificClass = '') => {
            if (typeof points !== 'number') return '';
            const percentage = (points / maxScalePoints) * 100;
            let titleText = `${type}: ${grade || 'N/A'} (${points} pts)`;
            if (percentile) titleText += ` - ${percentile}`;
            const leftPosition = Math.max(0, Math.min(percentage, 100));
            const markerClass = type.toLowerCase().replace(/ /g, '-') + '-marker' + (specificClass ? ' ' + specificClass : '');

            // Updated Label Logic
            let displayLabel = label;
            let titleType = type;
            if (specificClass === 'p60') { displayLabel = 'Top40%'; titleType = 'Top 40% MEG (60th)'; }
            else if (label === 'MEG' && subject.normalized_qualification_type === 'A Level') { displayLabel = 'Top25%'; titleType = 'Top 25% MEG (75th)'; }
            else if (specificClass === 'p90') { displayLabel = 'Top10%'; titleType = 'Top 10% MEG (90th)'; }
            else if (specificClass === 'p100') { displayLabel = 'Top1%'; titleType = 'Top 1% MEG (100th)'; }
            else if (label === 'CG') { 
                displayLabel = studentFirstName || "Current"; 
                titleType = `${studentFirstName || "Current"}'s Grade`;
            }

            // Add a specific class for percentile markers to style them differently
            const isPercentileMarker = ['p60', 'p90', 'p100'].includes(specificClass) || (label === 'MEG' && subject.normalized_qualification_type === 'A Level');
            const finalMarkerClass = `${markerClass} ${isPercentileMarker ? 'percentile-line-marker' : 'current-grade-dot-marker'}`;

            // Update titleText to use titleType for more descriptive tooltips
            titleText = `${titleType}: ${grade || 'N/A'} (${points} pts)`;
            if (percentile && !titleType.includes("Percentile")) titleText += ` - ${percentile}`;

            return `<div class="scale-marker ${finalMarkerClass}" style="left: ${leftPosition}%;" title="${titleText}">
                        <span class="marker-label">${displayLabel}</span>
                    </div>`;
        };
        
        // For A-Levels, standard MEG is 75th (Top25%). For others, it's just MEG.
        let standardMegLabel = "MEG";
        if (subject.normalized_qualification_type === "A Level") {
            standardMegLabel = "Top25%"; // This will be used by the updated displayLabel logic inside createMarker
        }

        // Use studentFirstName for the Current Grade marker label
        scaleHtml += createMarker(subject.currentGradePoints, subject.currentGrade, "Current Grade", "CG", null, 'cg-student'); 
        scaleHtml += createMarker(subject.standardMegPoints, subject.standard_meg, "Standard MEG", "MEG"); // Label will be adjusted by logic in createMarker

        if (subject.normalized_qualification_type === "A Level") {
            if (typeof subject.megPoints60 === 'number') {
                scaleHtml += createMarker(subject.megPoints60, null, "A-Level MEG", "P60", "60th Percentile", "p60");
            }
            // 75th is standardMegPoints, already marked with updated label
            if (typeof subject.megPoints90 === 'number') {
                scaleHtml += createMarker(subject.megPoints90, null, "A-Level MEG", "P90", "90th Percentile", "p90");
            }
            if (typeof subject.megPoints100 === 'number') {
                scaleHtml += createMarker(subject.megPoints100, null, "A-Level MEG", "P100", "100th Percentile", "p100");
            }
        }

        scaleHtml += `</div></div></div>`;
        return scaleHtml;
    }

    window.initializeAICoachLauncher = initializeAICoachLauncher;

    // --- NEW FUNCTION to render Questionnaire Response Distribution Pie Chart ---
    let questionnairePieChartInstance = null; // Module scope for this chart instance

    function renderQuestionnaireDistributionChart(allStatements) {
        logAICoach("renderQuestionnaireDistributionChart called with statements:", allStatements);
        const chartContainer = document.getElementById('questionnaireResponseDistributionChartContainer');
        if (!chartContainer) {
            logAICoach("Questionnaire response distribution chart container not found.");
            return;
        }

        if (typeof Chart === 'undefined') {
            logAICoach("Chart.js is not loaded. Cannot render questionnaire distribution chart.");
            chartContainer.innerHTML = '<p style="color:red; text-align:center;">Chart library not loaded.</p>';
            return;
        }

        if (questionnairePieChartInstance) {
            questionnairePieChartInstance.destroy();
            questionnairePieChartInstance = null;
            logAICoach("Previous questionnaire pie chart instance destroyed.");
        }

        chartContainer.innerHTML = '<canvas id="questionnaireDistributionPieChartCanvas"></canvas>';
        const ctx = document.getElementById('questionnaireDistributionPieChartCanvas').getContext('2d');

        if (!allStatements || allStatements.length === 0) {
            logAICoach("No statements data for questionnaire pie chart.");
            chartContainer.innerHTML = '<p style="text-align:center;">No questionnaire statement data available for chart.</p>';
            return;
        }

        const responseCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const responseDetailsByScore = { 
            1: {}, 2: {}, 3: {}, 4: {}, 5: {}
        };
        const vespaCategories = ['VISION', 'EFFORT', 'SYSTEMS', 'PRACTICE', 'ATTITUDE'];
        vespaCategories.forEach(cat => {
            for (let score = 1; score <= 5; score++) {
                responseDetailsByScore[score][cat.toUpperCase()] = { count: 0, statements: [] };
            }
        });

        allStatements.forEach(stmt => {
            const score = stmt.score;
            const category = stmt.vespa_category ? stmt.vespa_category.toUpperCase() : 'UNKNOWN';
            if (score >= 1 && score <= 5) {
                responseCounts[score]++;
                if (responseDetailsByScore[score][category]) {
                    responseDetailsByScore[score][category].count++;
                    responseDetailsByScore[score][category].statements.push(stmt.question_text);
                } else if (category === 'UNKNOWN') {
                     if (!responseDetailsByScore[score]['UNKNOWN']) responseDetailsByScore[score]['UNKNOWN'] = { count: 0, statements: [] };
                     responseDetailsByScore[score]['UNKNOWN'].count++;
                     responseDetailsByScore[score]['UNKNOWN'].statements.push(stmt.question_text);
                }
            }
        });

        const chartData = {
            labels: [
                'Strongly Disagree',
                'Disagree',
                'Neutral',
                'Agree',
                'Strongly Agree'
            ],
            datasets: [{
                label: 'Questionnaire Response Distribution',
                data: Object.values(responseCounts),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)', // Score 1
                    'rgba(255, 159, 64, 0.7)', // Score 2
                    'rgba(255, 205, 86, 0.7)', // Score 3
                    'rgba(75, 192, 192, 0.7)', // Score 4
                    'rgba(54, 162, 235, 0.7)'  // Score 5
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(255, 159, 64, 1)',
                    'rgba(255, 205, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(54, 162, 235, 1)'
                ],
                borderWidth: 1
            }]
        };

        const vespaColors = {
            VISION: '#ff8f00',
            EFFORT: '#86b4f0',
            SYSTEMS: '#72cb44',
            PRACTICE: '#7f31a4',
            ATTITUDE: '#f032e6',
            UNKNOWN: '#808080' // Grey for unknown
        };

        questionnairePieChartInstance = new Chart(ctx, {
            type: 'pie',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Distribution of Questionnaire Statement Responses',
                        font: { size: 14, weight: 'bold' },
                        padding: { top: 10, bottom: 15 }
                    },
                    legend: {
                        position: 'bottom',
                    },
                    tooltip: {
                        yAlign: 'bottom', // Position tooltip above the mouse point
                        caretPadding: 15, // Add more space between cursor and tooltip
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                const scoreValue = context.parsed;
                                if (scoreValue !== null) {
                                    label += scoreValue + ' statement(s)';
                                }
                                return label;
                            },
                            afterLabel: function(context) {
                                const scoreIndex = context.dataIndex; // 0 for score 1, 1 for score 2, etc.
                                const score = scoreIndex + 1;
                                const detailsForThisScore = responseDetailsByScore[score];
                                let tooltipLines = [];

                                let totalInScore = 0;
                                vespaCategories.forEach(cat => {
                                   if(detailsForThisScore[cat]) totalInScore += detailsForThisScore[cat].count;
                                });
                                if (detailsForThisScore['UNKNOWN'] && detailsForThisScore['UNKNOWN'].count > 0) totalInScore += detailsForThisScore['UNKNOWN'].count;


                                if (totalInScore > 0) {
                                    tooltipLines.push('\nBreakdown by VESPA Element:');
                                    vespaCategories.forEach(cat => {
                                        if (detailsForThisScore[cat] && detailsForThisScore[cat].count > 0) {
                                            const percentage = ((detailsForThisScore[cat].count / totalInScore) * 100).toFixed(1);
                                            tooltipLines.push(`  ${cat}: ${percentage}% (${detailsForThisScore[cat].count} statement(s))`);
                                        }
                                    });
                                    if (detailsForThisScore['UNKNOWN'] && detailsForThisScore['UNKNOWN'].count > 0){
                                        const percentage = ((detailsForThisScore['UNKNOWN'].count / totalInScore) * 100).toFixed(1);
                                        tooltipLines.push(`  UNKNOWN: ${percentage}% (${detailsForThisScore['UNKNOWN'].count} statement(s))`);
                                    }
                                }
                                return tooltipLines;
                            }
                        },
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleFont: { size: 14 },
                        bodyFont: { size: 12 },
                        footerFont: { size: 10 },
                        padding: 10
                    }
                }
            }
        });
        logAICoach("Questionnaire response distribution pie chart rendered.");
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
} 
