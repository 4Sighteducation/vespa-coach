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
        const styleId = 'ai-coach-external-styles'; 
        if (document.getElementById(styleId)) {
            logAICoach("AI Coach external styles already linked.");
            return;
        }

        // Remove any old inline style tag if it exists (e.g., from a previous version)
        const oldStyleElement = document.getElementById('ai-coach-styles');
        if (oldStyleElement) {
            oldStyleElement.parentNode.removeChild(oldStyleElement);
            logAICoach("Removed old inline AI Coach styles.");
        }

        const linkElement = document.createElement('link');
        linkElement.id = styleId;
        linkElement.rel = 'stylesheet';
        linkElement.type = 'text/css';
        linkElement.href = 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/report/aiCoachLauncher.css'; // Your JSDelivr URL

        document.head.appendChild(linkElement);
        logAICoach("AICoachLauncher external styles linked from: " + linkElement.href);
        
        // Add static classes to elements targeted by the now external CSS that were previously dynamic
        // This should ideally be done when these elements are confirmed to exist or are created.
        // For mainContentSelector, it's typically when the panel becomes active.
        // For aiCoachPanelId, it's when the panel is created.
        // We can ensure these classes are added/removed in toggleAICoachPanel and createAICoachPanel.
    }

    function createAICoachPanel() {
        const panelId = AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId;
        if (document.getElementById(panelId)) {
            logAICoach("AI Coach panel already exists.");
            return;
        }
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.classList.add('ai-coach-panel-main'); // Add the static class for CSS targeting
        panel.innerHTML = `
            <div class="ai-coach-panel-header">
                <h3>AI Coaching Assistant</h3>
                <button class="ai-coach-close-btn" aria-label="Close AI Coach Panel">&times;</button>
            </div>
            <div id="aiCoachPanelContentContainer">
                <div class="ai-coach-panel-content">
                    <p>Activate the AI Coach to get insights.</p>
                </div>
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
        const snapshotSection = document.createElement('div');
        snapshotSection.className = 'ai-coach-section';
        snapshotSection.id = 'aiCoachSnapshotSection';
        let snapshotHtml = '<h4>AI Student Snapshot</h4>';
        if (data.llm_generated_insights && data.llm_generated_insights.student_overview_summary) {
            snapshotHtml += `<p>${data.llm_generated_insights.student_overview_summary}</p>`;
        } else if (data.student_name && data.student_name !== "N/A") { 
            snapshotHtml += '<p>AI summary is being generated or is not available for this student.</p>';
        } else {
             snapshotHtml += '<p>No detailed coaching data or student context available. Ensure the report is loaded.</p>';
        }
        snapshotSection.innerHTML = snapshotHtml;
        
        // Toggle Buttons part
        const toggleButtonsContainer = document.createElement('div');
        toggleButtonsContainer.className = 'ai-coach-section-toggles';
        toggleButtonsContainer.style.margin = '10px 0 15px 0';
        toggleButtonsContainer.style.display = 'flex';
        toggleButtonsContainer.style.gap = '10px';
        toggleButtonsContainer.innerHTML = `
            <button id="aiCoachToggleVespaButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachVespaProfileContainer">
                View VESPA Profile Insights
            </button>
            <button id="aiCoachToggleAcademicButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachAcademicProfileContainer">
                View Academic Profile Insights
            </button>
            <button id="aiCoachToggleQuestionButton" class="p-button p-component" style="padding: 10px; font-size: 0.9em;" aria-expanded="false" aria-controls="aiCoachQuestionAnalysisContainer">
                View Questionnaire Analysis
            </button>
        `;

        // Content Divs part (these will be direct children of panelContentContainer)
        const vespaContainer = document.createElement('div');
        vespaContainer.id = 'aiCoachVespaProfileContainer';
        vespaContainer.className = 'ai-coach-details-section ai-coach-section'; // Added ai-coach-section for consistent styling
        vespaContainer.style.display = 'none';

        const academicContainer = document.createElement('div');
        academicContainer.id = 'aiCoachAcademicProfileContainer';
        academicContainer.className = 'ai-coach-details-section ai-coach-section'; // Added ai-coach-section
        academicContainer.style.display = 'none';

        const questionContainer = document.createElement('div');
        questionContainer.id = 'aiCoachQuestionAnalysisContainer';
        questionContainer.className = 'ai-coach-details-section ai-coach-section'; // Added ai-coach-section
        questionContainer.style.display = 'none';

        // Chat container will also be a direct child of panelContentContainer
        const chatInterfaceContainer = document.createElement('div');
        chatInterfaceContainer.id = 'aiCoachChatInterfaceContainer'; // New ID for the chat specific section
        // chatInterfaceContainer.className = 'ai-coach-section'; // It will get this styling from addChatInterface

        // --- Append to the panel content container --- 
        const panelContentContainer = document.getElementById('aiCoachPanelContentContainer');
        if (panelContentContainer) {
            panelContentContainer.innerHTML = ''; // Clear it first
            panelContentContainer.appendChild(snapshotSection);
            panelContentContainer.appendChild(toggleButtonsContainer);
            panelContentContainer.appendChild(vespaContainer);
            panelContentContainer.appendChild(academicContainer);
            panelContentContainer.appendChild(questionContainer);
            panelContentContainer.appendChild(chatInterfaceContainer); // Add placeholder for chat
        } else {
            logAICoach("Error: aiCoachPanelContentContainer not found for rendering.");
            return;
        }

        // --- Conditionally Populate Content Sections --- 
        if (data.student_name && data.student_name !== "N/A") {
            // --- Populate VESPA Profile Section (now VESPA Insights) ---
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
            if (academicContainer) {
                // Area 1: Comparative Benchmark Table & Overall MEGs
                academicHtml += '<div class="ai-coach-section"><h4>Academic Benchmark Comparison</h4>';
                academicHtml += '<div id="academicBenchmarkTableContainer">';

                // Display overall MEGs first
                if (data.academic_megs) {
                    academicHtml += `<p><strong>Student GCSE Prior Attainment Score:</strong> ${data.academic_megs.prior_attainment_score || 'N/A'}</p>`;
                    academicHtml += '<ul>';
                    academicHtml += `<li>MEG @ 60th Percentile: <strong>${data.academic_megs.meg_60th || 'N/A'}</strong></li>`;
                    academicHtml += `<li>MEG @ 75th Percentile (Standard): <strong>${data.academic_megs.meg_75th || 'N/A'}</strong></li>`;
                    academicHtml += `<li>MEG @ 90th Percentile: <strong>${data.academic_megs.meg_90th || 'N/A'}</strong></li>`;
                    academicHtml += `<li>MEG @ 100th Percentile: <strong>${data.academic_megs.meg_100th || 'N/A'}</strong></li>`;
                    academicHtml += '</ul><hr style="margin: 10px 0;">';
                } else {
                    academicHtml += '<p><em>Overall MEG data not available.</em></p><hr style="margin: 10px 0;">';
                }

                // Display subject-specific table (Current Grade, Target Grade, 75th MEG)
                academicHtml += '<h5>Subject Performance vs. 75th Percentile MEG:</h5>';
                if (data.academic_profile_summary && data.academic_profile_summary.length > 0 && 
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("not found")) &&
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("No academic subjects parsed"))) {
                    academicHtml += '<table style="width:100%; border-collapse: collapse;">';
                    academicHtml += '<thead><tr><th style="text-align:left; border-bottom:1px solid #ddd; padding:5px;">Subject</th><th style="text-align:left; border-bottom:1px solid #ddd; padding:5px;">Current</th><th style="text-align:left; border-bottom:1px solid #ddd; padding:5px;">Target</th><th style="text-align:left; border-bottom:1px solid #ddd; padding:5px;">MEG (75th)</th></tr></thead><tbody>';
                    data.academic_profile_summary.forEach(subject => {
                        academicHtml += '<tr>';
                        academicHtml += `<td style="border-bottom:1px solid #eee; padding:5px;"><strong>${subject.subject || 'N/A'}</strong></td>`;
                        academicHtml += `<td style="border-bottom:1px solid #eee; padding:5px;">${subject.currentGrade || 'N/A'}</td>`;
                        academicHtml += `<td style="border-bottom:1px solid #eee; padding:5px;">${subject.targetGrade || 'N/A'}</td>`;
                        academicHtml += `<td style="border-bottom:1px solid #eee; padding:5px;">${subject.meg_75th || 'N/A'}</td>`; // Display MEG from profile summary
                        academicHtml += '</tr>';
                    });
                    academicHtml += '</tbody></table>';
                } else {
                    academicHtml += '<p><em>No detailed academic subject profile available to compare against MEGs.</em></p>';
                }
                academicHtml += '</div></div>'; // End benchmarkTableContainer and its ai-coach-section

                // Area 2: AI Analysis of Academic Data
                academicHtml += '<div class="ai-coach-section" style="margin-top: 15px;"><h4>AI Analysis: Academic Performance & Benchmarks</h4>';
                if (data.llm_generated_insights && data.llm_generated_insights.academic_benchmark_analysis) {
                    academicHtml += `<p>${data.llm_generated_insights.academic_benchmark_analysis}</p>`;
                } else {
                    academicHtml += '<p><em>AI analysis of academic benchmarks will appear here.</em></p>'; // Placeholder
                }
                academicHtml += '</div>';

                // Original student overview (Name, Level, Cycle) - can be kept or integrated differently
                academicHtml += '<div class="ai-coach-section" style="margin-top: 15px;">';
                academicHtml += '<h5>Student Overview (from Academic Profile)</h5>'; // Clarified title
                academicHtml += `<p><strong>Name:</strong> ${data.student_name || 'N/A'}</p>`;
                academicHtml += `<p><strong>Level:</strong> ${data.student_level || 'N/A'}</p>`;
                academicHtml += `<p><strong>Current VESPA Cycle:</strong> ${data.current_cycle || 'N/A'}</p>`;
                academicHtml += '</div>';

                // Original Academic Profile Summary (Subjects list) - can be kept or integrated differently
                if (data.academic_profile_summary && data.academic_profile_summary.length > 0 && 
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("not found")) &&
                    !(data.academic_profile_summary.length === 1 && data.academic_profile_summary[0].subject.includes("No academic subjects parsed"))) {
                    academicHtml += '<div class="ai-coach-section" style="margin-top: 15px;"><h5>Academic Profile Summary (Subjects)</h5><ul>'; // Clarified title
                    data.academic_profile_summary.forEach(subject => {
                        academicHtml += `<li><strong>${subject.subject || 'N/A'}:</strong> Grade ${subject.currentGrade || 'N/A'} (Target: ${subject.targetGrade || 'N/A'}, Effort: ${subject.effortGrade || 'N/A'})</li>`;
                    });
                    academicHtml += '</ul></div>';
                } else {
                    academicHtml += '<div class="ai-coach-section" style="margin-top: 15px;"><h5>Academic Profile Summary (Subjects)</h5><p>No detailed academic profile available or profile not found.</p></div>';
                }
                academicContainer.innerHTML = academicHtml;
            }

            // --- Populate Question Level Analysis Section ---
            let questionHtml = '';
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
                    const isCurrentlyVisible = detailsContainer.style.display === 'block';

                    allDetailSections.forEach(section => {
                        if (section.id !== btnConfig.containerId) {
                            section.style.display = 'none';
                            // Reset other buttons that are now definitively hiding their section
                            const otherButtonId = section.id.replace('Container', 'Button').replace('Profile', 'ToggleVespa').replace('AcademicProfile', 'ToggleAcademic').replace('QuestionAnalysis', 'ToggleQuestion');
                            // A bit complex mapping, might need refinement if IDs change
                            // Simplified: find button by what it controls
                            let otherButton = null;
                            if (section.id === 'aiCoachVespaProfileContainer') otherButton = document.getElementById('aiCoachToggleVespaButton');
                            else if (section.id === 'aiCoachAcademicProfileContainer') otherButton = document.getElementById('aiCoachToggleAcademicButton');
                            else if (section.id === 'aiCoachQuestionAnalysisContainer') otherButton = document.getElementById('aiCoachToggleQuestionButton');

                            if(otherButton && otherButton.id !== btnConfig.id) {
                                otherButton.textContent = `View ${otherButton.id.replace('aiCoachToggle', '').replace('Button','')} Insights`;
                                otherButton.setAttribute('aria-expanded', 'false');
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
                    checkAndResizeChat(); // Call the resize function
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
                    panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Analysing student data...</p>';
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
        const mainContent = document.querySelector(AI_COACH_LAUNCHER_CONFIG.mainContentSelector);

        if (show) {
            document.body.classList.add('ai-coach-active');
            if (mainContent) mainContent.classList.add('ai-coach-main-content-area');
            if (toggleButton) toggleButton.textContent = '🙈 Hide AI Coach';
            logAICoach("AI Coach panel activated.");
            
            // Instead of direct call here, refreshAICoachData will be primary way for new/refreshed data
            await refreshAICoachData(); 

        } else {
            document.body.classList.remove('ai-coach-active');
            if (mainContent) mainContent.classList.remove('ai-coach-main-content-area');
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

        const chatContainerParent = document.getElementById('aiCoachChatInterfaceContainer'); // Target new container
        if (!chatContainerParent) {
            logAICoach("Chat interface parent container (aiCoachChatInterfaceContainer) not found.");
            return;
        }
        chatContainerParent.innerHTML = ''; // Clear it before adding new chat

        const chatContainer = document.createElement('div');
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
        chatContainerParent.appendChild(chatContainer);

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
                botMessageElement.innerHTML = `<em>AI Coach:</em> Thinking... (response for "${messageText}" will appear here)`;
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
        checkAndResizeChat(); // Call after chat is added
    }

    // New function to check visibility of sections and resize chat
    function checkAndResizeChat() {
        const vespaContainer = document.getElementById('aiCoachVespaProfileContainer');
        const academicContainer = document.getElementById('aiCoachAcademicProfileContainer');
        const questionContainer = document.getElementById('aiCoachQuestionAnalysisContainer');
        const chatContainer = document.getElementById('aiCoachChatContainer');
        const chatDisplay = document.getElementById('aiCoachChatDisplay');

        if (!chatContainer || !chatDisplay) return; // Chat not yet rendered or issue

        const vespaVisible = vespaContainer && vespaContainer.style.display === 'block';
        const academicVisible = academicContainer && academicContainer.style.display === 'block';
        const questionVisible = questionContainer && questionContainer.style.display === 'block';

        if (!vespaVisible && !academicVisible && !questionVisible) {
            logAICoach("All insight sections are hidden. Expanding chat.");
            chatContainer.classList.add('expanded-chat');
            chatDisplay.classList.add('expanded-chat-display');
        } else {
            logAICoach("At least one insight section is visible. Reverting chat size.");
            chatContainer.classList.remove('expanded-chat');
            chatDisplay.classList.remove('expanded-chat-display');
        }
    }

    window.initializeAICoachLauncher = initializeAICoachLauncher;
} 
