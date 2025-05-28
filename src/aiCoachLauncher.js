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
            if (isIndividualReportView()) {
                const panelIsActive = document.body.classList.contains('ai-coach-active');
                if (!coachUIInitialized) { 
                    initializeCoachUI();
                } else if (panelIsActive) { 
                    logAICoach("Individual report view, panel active. Re-fetching data for potentially new student (debounced).");
                    refreshAICoachData(); 
                }
            } else {
                clearCoachUI();
            }
        };

        // Use a debounced version of the observer callback
        debouncedObserverCallback = debounce(function() {
            logAICoach("MutationObserver processing (debounced).");
            if (isIndividualReportView()) {
                const panelIsActive = document.body.classList.contains('ai-coach-active');
                if (!coachUIInitialized) { 
                    initializeCoachUI();
                } else if (panelIsActive) { 
                    logAICoach("Individual report view, panel active. Re-fetching data for potentially new student (debounced).");
                    refreshAICoachData(); 
                }
            } else {
                clearCoachUI();
            }
        }, 750); // Debounce for 750ms

        coachObserver = new MutationObserver(debouncedObserverCallback); // Use the debounced version
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
            /* Styles for Benchmark Scales */
            .subject-benchmark-item {
                padding: 10px 0; /* Adjusted padding */
                border-bottom: 1px solid #f0f0f0;
            }
            .subject-benchmark-item:last-child {
                border-bottom: none;
            }
            .subject-benchmark-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .subject-benchmark-header h5 { /* For subject name */
                margin: 0;
                font-size: 1em;
                font-weight: bold;
                color: #224466; /* Dark blue for subject names */
            }
            .subject-grades-info {
                font-size: 0.85em;
                color: #555;
                margin-bottom: 10px; /* Space before the scale */
            }
            .subject-benchmark-scale-container {
                margin-top: 5px;
                margin-bottom: 20px; /* Space below each scale */
                padding: 0 5px; /* Padding to ensure labels aren't cut off */
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
                height: 10px; /* Height of the main bar */
                background-color: #e9ecef; /* Light grey background for the bar */
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
                transform: translateY(-50%) translateX(-50%); /* Center the marker on its left percentage */
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10; /* Ensure markers are above the bar */
            }
            .scale-marker .marker-label {
                position: absolute;
                bottom: -20px; /* Position label below marker */
                left: 50%;
                transform: translateX(-50%);
                font-size: 0.7em;
                color: #333;
                white-space: nowrap;
                background-color: rgba(255, 255, 255, 0.85);
                padding: 1px 3px;
                border-radius: 3px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                z-index: 11;
            }

            .current-grade-marker { background-color: #28a745; /* Green */ }
            .standard-meg-marker { background-color: #ffc107; /* Yellow */ }
            .a-level-meg-marker { background-color: #17a2b8; /* Teal - default for P60, P90, P100 if not distinct */ }
            
            /* More specific A-Level Percentile Markers for visual distinction if desired */
            .p60-marker .marker-label { color: #17a2b8; } /* Teal */
            .p90-marker .marker-label { color: #fd7e14; } /* Orange */
            .p100-marker .marker-label { color: #dc3545; } /* Red */
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

    // --- Helper function to determine max points for visual scale ---
    function getMaxPointsForScale(subject) {
        const normalizedType = subject.normalized_qualification_type;
        // Default max points for typical A-Level/AS-Level sized qualifications
        let maxPoints = 140; 

        const allPoints = [
            typeof subject.currentGradePoints === 'number' ? subject.currentGradePoints : 0,
            typeof subject.standardMegPoints === 'number' ? subject.standardMegPoints : 0
        ];

        if (normalizedType === "A Level") {
            if (typeof subject.megPoints60 === 'number') allPoints.push(subject.megPoints60);
            // subject.megPoints75 is standardMegPoints for A-Level
            if (typeof subject.megPoints90 === 'number') allPoints.push(subject.megPoints90);
            if (typeof subject.megPoints100 === 'number') allPoints.push(subject.megPoints100);
            maxPoints = 140; // Standard A-Level scale goes up to A*
        } else if (normalizedType === "AS Level") {
            maxPoints = 70; // Max for AS is A grade (60 points), so 70 gives headroom
        } else if (normalizedType === "IB HL") {
            maxPoints = 140; // IB HL Grade 7 is 140 points
        } else if (normalizedType === "IB SL") {
            maxPoints = 70;  // IB SL Grade 7 is 60 points
        } else if (normalizedType === "Pre-U Principal Subject") {
            maxPoints = 150; // Pre-U D1 is 145 points
        } else if (normalizedType === "Pre-U Short Course") {
            maxPoints = 75;  // Pre-U D1 Short Course is 72 points
        } else if (normalizedType && normalizedType.includes("BTEC")) {
            if (normalizedType === "BTEC Level 3 Extended Diploma") maxPoints = 420;
            else if (normalizedType === "BTEC Level 3 Diploma") maxPoints = 280;
            else if (normalizedType === "BTEC Level 3 Subsidiary Diploma") maxPoints = 140;
            else if (normalizedType === "BTEC Level 3 Extended Certificate") maxPoints = 140;
            else maxPoints = 140; // Default for other BTECs to A-level equivalent size
        } else if (normalizedType && normalizedType.includes("UAL")) {
            if (normalizedType === "UAL Level 3 Extended Diploma") maxPoints = 170; // Max D is 168
            else if (normalizedType === "UAL Level 3 Diploma") maxPoints = 90; // Max D is 84
            else maxPoints = 90;
        } else if (normalizedType && normalizedType.includes("CACHE")) {
            if (normalizedType === "CACHE Level 3 Extended Diploma") maxPoints = 210;
            else if (normalizedType === "CACHE Level 3 Diploma") maxPoints = 140;
            else if (normalizedType === "CACHE Level 3 Certificate") maxPoints = 70;
            else if (normalizedType === "CACHE Level 3 Award") maxPoints = 35;
            else maxPoints = 70;
        }
        // Ensure the scale can at least show all actual points provided for the subject, plus some headroom.
        const highestSubjectPoint = Math.max(0, ...allPoints.filter(p => typeof p === 'number'));
        // If highestSubjectPoint is significant, use it to define scale, otherwise stick to type-based maxPoints.
        // Add 20 points headroom or 10% whichever is larger, if highestSubjectPoint dictates the scale.
        if (highestSubjectPoint > maxPoints) {
            return highestSubjectPoint + Math.max(20, Math.floor(highestSubjectPoint * 0.1));
        }
        return maxPoints;
    }

    // --- Helper function to create a single subject's benchmark scale ---
    function createSubjectBenchmarkScale(subject, subjectIndex) {
        if (!subject || typeof subject.currentGradePoints !== 'number' || typeof subject.standardMegPoints !== 'number') {
            // logAICoach(`Skipping scale for ${subject ? subject.subject : 'unknown subject'} due to missing point data.`);
            return '<p style="font-size:0.8em; color: #777;">Benchmark scale cannot be displayed due to missing point data for this subject.</p>';
        }

        const maxScalePoints = getMaxPointsForScale(subject);
        if (maxScalePoints === 0) return '<pstyle="font-size:0.8em; color: #777;">Max scale points is zero, cannot render scale.</p>'; // Avoid division by zero

        let scaleHtml = `<div class="subject-benchmark-scale-container" id="scale-container-${subjectIndex}">
            <div class="scale-labels">
                <span>0 pts</span>
                <span>${maxScalePoints} pts</span>
            </div>
            <div class="scale-bar-wrapper">
                <div class="scale-bar">`; // Removed style from scale-bar, wrapper controls width perception

        // Helper to generate a marker
        const createMarker = (points, grade, type, label, percentile = null) => {
            if (typeof points !== 'number') return ''; // Don't render if points are not a number
            const percentage = (points / maxScalePoints) * 100;
            let titleText = `${type}: ${grade || 'N/A'} (${points} pts)`;
            if (percentile) titleText += ` - ${percentile}`;

            // Prevent markers going beyond 100% or below 0% visually
            const leftPosition = Math.max(0, Math.min(percentage, 100));

            return `<div class="scale-marker ${type.toLowerCase().replace(/ /g, '-')}-marker" style="left: ${leftPosition}%;" title="${titleText}">
                        <span class="marker-label">${label}</span>
                    </div>`;
        };
        
        scaleHtml += createMarker(subject.currentGradePoints, subject.currentGrade, "Current Grade", "CG");
        scaleHtml += createMarker(subject.standardMegPoints, subject.standard_meg, "Standard MEG", "MEG");

        if (subject.normalized_qualification_type === "A Level") {
            if (typeof subject.megPoints60 === 'number') { // Check if points exist
                scaleHtml += createMarker(subject.megPoints60, null, "A-Level MEG", "P60", "60th Pct");
            }
            // 75th is standardMegPoints, already marked as "MEG"
            if (typeof subject.megPoints90 === 'number') {
                scaleHtml += createMarker(subject.megPoints90, null, "A-Level MEG", "P90", "90th Pct");
            }
            if (typeof subject.megPoints100 === 'number') {
                scaleHtml += createMarker(subject.megPoints100, null, "A-Level MEG", "P100", "100th Pct");
            }
        }

        scaleHtml += `</div></div></div>`; // Close scale-bar, scale-bar-wrapper, subject-benchmark-scale-container
        return scaleHtml;
    }

    function renderAICoachData(data) {
        logAICoach("renderAICoachData CALLED. Data received:", JSON.parse(JSON.stringify(data))); // Log a deep copy
        if (data && data.student_name) {
            logAICoach(`renderAICoachData: Preparing to render for student: ${data.student_name} (Cycle: ${data.current_cycle})`);
        } else {
            logAICoach("renderAICoachData: data received is missing student_name or is undefined. Rendering basic message.");
            // Render a basic message if critical data is missing
            const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
            if (panelContent) {
                panelContent.innerHTML = '<div class="ai-coach-section"><p>No detailed coaching data available. Ensure the student report is fully loaded and the AI Coach is active.</p></div>';
            }
            return;
        }

        const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
        if (!panelContent) {
            logAICoach("renderAICoachData: panelContent element not found. Cannot render.");
            return;
        }

        // Explicitly clear previous content before rendering new data
        panelContent.innerHTML = ''; 

        let html = '';

        // Student Info
        html += `
            <div class="ai-coach-section">
                <h4>Student Overview</h4>
                <p><strong>Name:</strong> ${data.student_name || 'N/A'}</p>
                <p><strong>Level:</strong> ${data.student_level || 'N/A'}</p>
                <p><strong>Current VESPA Cycle:</strong> ${data.current_cycle || 'N/A'}</p>
            </div>
        `;

        // VESPA Profile - Enhanced to include historical scores and individual insights
        if (data.vespa_profile) {
            html += '<div class="ai-coach-section"><h4>VESPA Profile</h4>';
            for (const [element, details] of Object.entries(data.vespa_profile)) {
                html += `
                    <div>
                        <h5>${element} (Score: ${details.score_1_to_10 !== undefined ? details.score_1_to_10 : 'N/A'}) - <em>${details.score_profile_text || 'N/A'}</em></h5>
                        ${details.primary_tutor_coaching_comments ? `<p><strong>Tutor Coaching Comments (Report Gen):</strong> ${details.primary_tutor_coaching_comments}</p>` : ''}
                        ${details.report_text_for_student ? `<p><em>Student Report Text:</em> ${details.report_text_for_student}</p>` : ''}
                        ${details.report_questions_for_student ? `<p><em>Student Report Questions:</em> ${details.report_questions_for_student}</p>` : ''}
                        ${details.report_suggested_tools_for_student ? `<p><em>Student Report Tools:</em> ${details.report_suggested_tools_for_student}</p>` : ''}
                        ${details.supplementary_tutor_questions && details.supplementary_tutor_questions.length > 0 ? 
                            `<div><strong>Supplementary Tutor Questions (KB):</strong><ul>${details.supplementary_tutor_questions.map(q => `<li>${q}</li>`).join('')}</ul></div>` : ''}
                        ${details.key_individual_question_insights_from_object29 && details.key_individual_question_insights_from_object29.length > 0 ? 
                            `<div><strong>Key Psychometric Insights (Object_29):</strong><ul>${details.key_individual_question_insights_from_object29.map(insight => `<li>${insight}</li>`).join('')}</ul></div>` : ''}
                        ${details.historical_summary_scores ? 
                            `<div><strong>Historical Scores:</strong> ${Object.entries(details.historical_summary_scores).map(([cycle, score]) => `Cycle ${cycle.replace('cycle','')}: ${score}`).join(', ') || 'N/A'}</div>` : ''}
                    </div>
                `;
                 if (element !== "Overall" && Object.keys(data.vespa_profile).indexOf(element) < Object.keys(data.vespa_profile).length - (Object.keys(data.vespa_profile).includes("Overall") ? 2:1) ){
                    html += '<hr style="border-top: 1px dashed #eee; margin: 10px 0;">';
                }
            }
            html += '</div>';
        }

        // Overall Academic Benchmarks
        if (data.academic_megs) {
            html += `<div class="ai-coach-section" id="aiCoachOverallBenchmarksContainer">
                        <h4>Overall Academic Benchmarks</h4>
                        <p><strong>GCSE Prior Attainment Score:</strong> ${data.academic_megs.prior_attainment_score !== undefined && data.academic_megs.prior_attainment_score !== null ? data.academic_megs.prior_attainment_score : 'N/A'}</p>`;
            
            // Check if any A-Level MEG grade is present and not 'N/A' before showing the A-Level MEGs list
            const hasRelevantALevelMegs = ['aLevel_meg_grade_60th', 'aLevel_meg_grade_75th', 'aLevel_meg_grade_90th', 'aLevel_meg_grade_100th']
                                        .some(key => data.academic_megs[key] && data.academic_megs[key] !== 'N/A');

            if (hasRelevantALevelMegs) {
                html += `<h5>A-Level Percentile MEGs (where applicable):</h5>
                         <ul>
                             <li><strong>60th Percentile:</strong> ${data.academic_megs.aLevel_meg_grade_60th || 'N/A'} (${data.academic_megs.aLevel_meg_points_60th !== undefined ? data.academic_megs.aLevel_meg_points_60th : 0} pts)</li>
                             <li><strong>75th Percentile (Standard):</strong> ${data.academic_megs.aLevel_meg_grade_75th || 'N/A'} (${data.academic_megs.aLevel_meg_points_75th !== undefined ? data.academic_megs.aLevel_meg_points_75th : 0} pts)</li>
                             <li><strong>90th Percentile:</strong> ${data.academic_megs.aLevel_meg_grade_90th || 'N/A'} (${data.academic_megs.aLevel_meg_points_90th !== undefined ? data.academic_megs.aLevel_meg_points_90th : 0} pts)</li>
                             <li><strong>100th Percentile:</strong> ${data.academic_megs.aLevel_meg_grade_100th || 'N/A'} (${data.academic_megs.aLevel_meg_points_100th !== undefined ? data.academic_megs.aLevel_meg_points_100th : 0} pts)</li>
                         </ul>`;
            }
            html += `</div>`;
        }

        // Academic Profile with Benchmark Scales (replaces old Academic Profile section)
        if (data.academic_profile_summary && data.academic_profile_summary.length > 0 && 
            (!data.academic_profile_summary[0] || (data.academic_profile_summary[0].subject !== "Academic profile not found by any method." && data.academic_profile_summary[0].subject !== "No academic subjects parsed from profile."))) {
            
            html += '<div class="ai-coach-section" id="aiCoachAcademicProfileContainer"><h4>Academic Profile & Benchmarks</h4>';
            let validSubjectsFound = 0;
            data.academic_profile_summary.forEach((subject, index) => {
                // Ensure subject is valid and not a placeholder message
                if (subject && subject.subject && subject.subject !== "Academic profile not found by any method." && subject.subject !== "No academic subjects parsed from profile." && subject.subject !== "No academic subjects parsed from profile. ect...") {
                    validSubjectsFound++;
                    html += `<div class="subject-benchmark-item">
                                <div class="subject-benchmark-header">
                                    <h5>${subject.subject || 'N/A'} (${subject.normalized_qualification_type || 'Qual Type N/A'})</h5>
                                </div>
                                <p class="subject-grades-info">
                                    Current: <strong>${subject.currentGrade || 'N/A'}</strong> (${subject.currentGradePoints !== undefined ? subject.currentGradePoints : 'N/A'} pts) | 
                                    Standard MEG: <strong>${subject.standard_meg || 'N/A'}</strong> (${subject.standardMegPoints !== undefined ? subject.standardMegPoints : 'N/A'} pts)
                                </p>`;
                    html += createSubjectBenchmarkScale(subject, index); // Call the new function
                    html += `</div>`; // Close subject-benchmark-item
                }
            });
             if (validSubjectsFound === 0) {
                 html += '<p>No detailed academic subjects found in the profile to display benchmarks.</p>';
            }
            html += '</div>'; // Close aiCoachAcademicProfileContainer
        } else {
             html += '<div class="ai-coach-section" id="aiCoachAcademicProfileContainer"><p>No detailed academic subjects found in the profile to display benchmarks.</p></div>';
        }
        
        // Overall Framing Statement for Tutor
        if(data.overall_framing_statement_for_tutor && data.overall_framing_statement_for_tutor.statement){
            html += `
            <div class="ai-coach-section">
                <h4>Overall Framing Statement (KB)</h4>
                <p>${data.overall_framing_statement_for_tutor.statement}</p>
            </div>
        `;
        }

        // General Introductory Questions for Tutor
        if(data.general_introductory_questions_for_tutor && data.general_introductory_questions_for_tutor.length > 0){
            html += '<div class="ai-coach-section"><h4>General Introductory Questions (KB)</h4><ul>';
            data.general_introductory_questions_for_tutor.forEach(q => {
                html += `<li>${q}</li>`;
            });
            html += '</ul></div>';
        }

        // Student Reflections & Goals (from Object_10)
        if (data.student_reflections_and_goals) {
            const reflections = data.student_reflections_and_goals;
            const currentCycle = data.current_cycle ? parseInt(data.current_cycle) : null;
            let reflectionsHTML = '';

            const reflectionsMap = [
                { key: 'rrc1_comment', label: 'RRC1', cycle: 1 },
                { key: 'rrc2_comment', label: 'RRC2', cycle: 2 },
                { key: 'rrc3_comment', label: 'RRC3', cycle: 3 },
                { key: 'goal1', label: 'Goal 1', cycle: 1 },
                { key: 'goal2', label: 'Goal 2', cycle: 2 },
                { key: 'goal3', label: 'Goal 3', cycle: 3 },
            ];

            reflectionsMap.forEach(item => {
                if (reflections[item.key] && reflections[item.key].trim() !== '') {
                    const isCurrentCycleComment = currentCycle === item.cycle;
                    const style = isCurrentCycleComment ? 'font-weight: bold; color: #0056b3;' : ''; // Example style for current cycle
                    const cycleLabel = isCurrentCycleComment ? ' (Current Cycle)' : ` (Cycle ${item.cycle})`;
                    reflectionsHTML += `<p style="${style}"><strong>${item.label}${cycleLabel}:</strong> ${reflections[item.key]}</p>`;
                }
            });

            if (reflectionsHTML.trim() !== '') {
                html += `
                    <div class="ai-coach-section">
                        <h4>Student Reflections & Goals (Object_10)</h4>
                        ${reflectionsHTML}
                    </div>
                `;
            } else {
                 html += `
                    <div class="ai-coach-section">
                        <h4>Student Reflections & Goals (Object_10)</h4>
                        <p>No specific comments or goals recorded by the student in Object_10 for the current cycle.</p>
                    </div>
                `;
            }
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
        
        // Previous Interaction Summary (from Object_10.field_3271)
        if(data.previous_interaction_summary && data.previous_interaction_summary.trim() !== ''){
             html += `
            <div class="ai-coach-section">
                <h4>Previous AI Coach Interaction Summary</h4>
                <p>${data.previous_interaction_summary}</p>
            </div>
        `;
        } else {
            html += `
            <div class="ai-coach-section">
                <h4>Previous AI Coach Interaction Summary</h4>
                <p>No previous interaction summary recorded.</p>
            </div>
        `;
        }

        panelContent.innerHTML = html || '<p>No coaching data components to display. Check API response.</p>';
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

    window.initializeAICoachLauncher = initializeAICoachLauncher;
} 