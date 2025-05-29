/// AI Coach Launcher Script (aiCoachLauncher.js)

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
    let currentLLMInsightsForChat = null; // ADDED: To store insights for chat context
    let loadingMessageIntervalId = null; // For the rotating loading messages

    // --- Configuration ---
    const HEROKU_API_BASE_URL = 'https://vespa-coach-c64c795edaa7.herokuapp.com/api/v1'; // MODIFIED for base path
    const COACHING_SUGGESTIONS_ENDPOINT = `${HEROKU_API_BASE_URL}/coaching_suggestions`;
    const CHAT_TURN_ENDPOINT = `${HEROKU_API_BASE_URL}/chat_turn`;
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
        loadExternalStyles();
        createAICoachPanel();
        addPanelResizeHandler(); // ADD THIS LINE
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

    function loadExternalStyles() {
        const styleId = 'ai-coach-external-styles';
        if (document.getElementById(styleId)) {
            logAICoach("AI Coach external styles already loaded.");
            return;
        }

        // Load external CSS from jsdelivr
        const link = document.createElement('link');
        link.id = styleId;
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/report/aiCoachLauncher1f.css';
        // .css';
        
        // Add dynamic CSS for config-specific IDs
        const dynamicCss = `
            body.ai-coach-active ${AI_COACH_LAUNCHER_CONFIG.mainContentSelector} {
                width: calc(100% - var(--ai-coach-panel-width));
                margin-right: var(--ai-coach-panel-width);
                transition: width var(--ai-coach-transition-duration) ease-in-out, 
                            margin-right var(--ai-coach-transition-duration) ease-in-out;
            }
            
            ${AI_COACH_LAUNCHER_CONFIG.mainContentSelector} {
                transition: width var(--ai-coach-transition-duration) ease-in-out, 
                            margin-right var(--ai-coach-transition-duration) ease-in-out;
            }
            
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} {
                width: 0;
                opacity: 0;
                visibility: hidden;
                position: fixed !important;
                top: 0;
                right: 0;
                height: 100vh;
                background-color: #f4f6f8;
                border-left: 1px solid #ddd;
                padding: 20px;
                box-sizing: border-box;
                overflow-y: auto;
                z-index: 1050;
                transition: width var(--ai-coach-transition-duration) ease-in-out, 
                            opacity var(--ai-coach-transition-duration) ease-in-out, 
                            visibility var(--ai-coach-transition-duration);
                font-family: Arial, sans-serif;
                display: flex;
                flex-direction: column;
            }
            
            body.ai-coach-active #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} {
                width: var(--ai-coach-panel-width);
                opacity: 1;
                visibility: visible;
            }
            
            /* REMOVED ::before pseudo-element to avoid conflict with JavaScript resize handle */
            
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                border-bottom: 1px solid #ccc;
                padding-bottom: 10px;
                flex-shrink: 0;
            }
            
            #${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow-y: auto;
                min-height: 0;
            }
            
            /* Loader animation */
            .loader {
                border: 3px solid #f3f3f3;
                border-top: 3px solid #3498db;
                border-radius: 50%;
                width: 30px;
                height: 30px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* Ensure ai-coach-resizing body state prevents text selection */
            body.ai-coach-resizing {
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
            }
        `;
        
        const styleElement = document.createElement('style');
        styleElement.textContent = dynamicCss;
        
        // Set CSS variables
        document.documentElement.style.setProperty('--ai-coach-panel-width', '450px');
        document.documentElement.style.setProperty('--ai-coach-panel-min-width', '300px'); // CHANGED: from 350px
        document.documentElement.style.setProperty('--ai-coach-panel-max-width', '800px'); // CHANGED: from 600px
        document.documentElement.style.setProperty('--ai-coach-transition-duration', '0.3s');
        
        document.head.appendChild(link);
        document.head.appendChild(styleElement);
        
        logAICoach("AI Coach external styles loading from CDN...");
        
        // Log when styles are loaded
        link.onload = () => {
            logAICoach("AI Coach external styles loaded successfully.");
        };
        
        link.onerror = () => {
            console.error("[AICoachLauncher] Failed to load external styles from CDN.");
        };
    }

    // Add resize functionality for the panel
    function addPanelResizeHandler() {
        const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
        if (!panel) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let currentWidth = 450; // Default width

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'ai-coach-resize-handle';
        resizeHandle.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 10px;
            cursor: ew-resize;
            background: transparent;
            z-index: 1051;
            transition: background-color 0.2s;
        `;
        
        // Add hover effect
        resizeHandle.addEventListener('mouseenter', () => {
            resizeHandle.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        });
        
        resizeHandle.addEventListener('mouseleave', () => {
            if (!isResizing) {
                resizeHandle.style.backgroundColor = 'transparent';
            }
        });
        
        panel.appendChild(resizeHandle);

        const startResize = (e) => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            document.body.classList.add('ai-coach-resizing');
            
            // Add visual feedback
            resizeHandle.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            
            // Store current width
            currentWidth = startWidth;
            
            logAICoach(`Starting resize from width: ${startWidth}px`);
        };

        const doResize = (e) => {
            if (!isResizing) return;
            
            const diff = startX - e.clientX;
            const newWidth = Math.max(300, Math.min(1200, startWidth + diff)); // CHANGED: 300px min, 1200px max (was 350-600)
            
            // Update CSS variable for smooth transitions
            document.documentElement.style.setProperty('--ai-coach-panel-width', newWidth + 'px');
            
            // Update panel width directly
            panel.style.width = newWidth + 'px';
            
            // Update main content width
            const mainContent = document.querySelector(AI_COACH_LAUNCHER_CONFIG.mainContentSelector);
            if (mainContent && document.body.classList.contains('ai-coach-active')) {
                mainContent.style.width = `calc(100% - ${newWidth}px)`;
                mainContent.style.marginRight = `${newWidth}px`;
            }
            
            currentWidth = newWidth;
        };

        const stopResize = () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.classList.remove('ai-coach-resizing');
            
            // Reset visual feedback
            resizeHandle.style.backgroundColor = 'transparent';
            
            // Save the width preference
            if (window.localStorage) {
                localStorage.setItem('aiCoachPanelWidth', currentWidth);
                logAICoach(`Saved panel width: ${currentWidth}px`);
            }
        };

        // Add event listeners
        resizeHandle.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        
        // Add touch support for mobile
        resizeHandle.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startResize({ preventDefault: () => e.preventDefault(), clientX: touch.clientX });
        });
        
        document.addEventListener('touchmove', (e) => {
            if (isResizing) {
                const touch = e.touches[0];
                doResize({ clientX: touch.clientX });
            }
        });
        
        document.addEventListener('touchend', stopResize);
        
        // Debug: Log when resize handle is clicked
        resizeHandle.addEventListener('click', () => {
            logAICoach('Resize handle clicked (debug)');
        });
        
        // Load saved width if available
        const savedWidth = localStorage.getItem('aiCoachPanelWidth');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (!isNaN(width) && width >= 300 && width <= 1200) { // CHANGED: Updated range check
                document.documentElement.style.setProperty('--ai-coach-panel-width', width + 'px');
                panel.style.width = width + 'px';
                currentWidth = width;
            }
        }
        
        logAICoach("Panel resize handler added.");
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
                <h3>VESPA AI Coaching Assistant</h3>
                <div class="ai-coach-text-controls">
                    <button class="ai-coach-text-control-btn" data-action="decrease" title="Decrease text size">A-</button>
                    <span class="ai-coach-text-size-indicator">100%</span>
                    <button class="ai-coach-text-control-btn" data-action="increase" title="Increase text size">A+</button>
                </div>
                <button class="ai-coach-close-btn" aria-label="Close AI Coach Panel">&times;</button>
            </div>
            <div class="ai-coach-panel-content">
                <p>Activate the AI Coach to get insights.</p>
            </div>
        `;
        document.body.appendChild(panel);
        logAICoach("AI Coach panel created.");
        
        // Add text size control functionality
        setupTextSizeControls();
    }

    // Add text size control functionality
    function setupTextSizeControls() {
        const panel = document.getElementById(AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId);
        if (!panel) return;
        
        let currentZoom = 100;
        const zoomStep = 10;
        const minZoom = 70;
        const maxZoom = 150;
        
        // Load saved zoom preference
        const savedZoom = localStorage.getItem('aiCoachTextZoom');
        if (savedZoom) {
            currentZoom = parseInt(savedZoom, 10);
            applyTextZoom(currentZoom);
        }
        
        // Add event listeners for zoom controls
        panel.addEventListener('click', (e) => {
            if (e.target.classList.contains('ai-coach-text-control-btn')) {
                const action = e.target.getAttribute('data-action');
                if (action === 'increase' && currentZoom < maxZoom) {
                    currentZoom += zoomStep;
                } else if (action === 'decrease' && currentZoom > minZoom) {
                    currentZoom -= zoomStep;
                }
                applyTextZoom(currentZoom);
            }
        });
        
        function applyTextZoom(zoom) {
            panel.style.fontSize = `${zoom * 14 / 100}px`;
            const indicator = panel.querySelector('.ai-coach-text-size-indicator');
            if (indicator) {
                indicator.textContent = `${zoom}%`;
            }
            // Apply zoom to modals as well
            const modals = document.querySelectorAll('.ai-coach-modal-content');
            modals.forEach(modal => {
                modal.style.fontSize = `${zoom * 14 / 100}px`;
            });
            localStorage.setItem('aiCoachTextZoom', zoom);
            logAICoach(`Text zoom set to ${zoom}%`);
        }
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
            const panelContent = document.querySelector(`#${AI_COACH_LAUNCHER_CONFIG.aiCoachPanelId} .ai-coach-panel-content`);
            if(panelContent) {
                if (!panelContent.querySelector('.ai-coach-section p[style*="color:red"], .ai-coach-section p[style*="color:orange"] ')) {
                    panelContent.innerHTML = '<div class="ai-coach-section"><p style="color:orange;">Could not automatically determine the specific VESPA report ID for this student. Ensure student profile data is fully loaded.</p></div>';
                    stopLoadingMessageRotator(); // Stop rotator if error is shown
                }
            }
            return null; 
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
        if (!panelContent.innerHTML.includes('<div class="loader"></div>') && !panelContent.innerHTML.includes('ai-coach-section')) {
            // panelContent.innerHTML = '<div class="loader"></div><p style="text-align:center;">Loading AI Coach insights...</p>';
            // Instead of static message, start rotator if not already started by refreshAICoachData or toggleAICoachPanel
            if (!loadingMessageIntervalId) { // Check if rotator is already active
                startLoadingMessageRotator(panelContent);
            }
        }

        try {
            logAICoach("Fetching AI Coaching Data for student_object10_record_id: " + studentId);
            const response = await fetch(COACHING_SUGGESTIONS_ENDPOINT, { // MODIFIED to use constant
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
            if (data && data.llm_generated_insights) { // Store insights for chat
                currentLLMInsightsForChat = data.llm_generated_insights;
            } else {
                currentLLMInsightsForChat = null;
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                logAICoach('Fetch aborted for student ID: ' + studentId);
            } else {
                logAICoach("Error fetching AI Coaching data:", error);
                if (currentlyFetchingStudentId === studentId) { 
                    panelContent.innerHTML = `<div class="ai-coach-section"><p style="color:red;">Error loading AI Coach insights: ${error.message}</p></div>`;
                    stopLoadingMessageRotator(); // Stop rotator on error
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

        stopLoadingMessageRotator(); // Stop rotator as data is about to be rendered

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
        // stopLoadingMessageRotator(); // Stop any existing rotator before starting a new one or showing static message
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
            
            // If panelContent is empty or only shows the default activation message, start loading rotator.
            if (panelContent && (panelContent.innerHTML.includes("Activate the AI Coach to get insights") || panelContent.innerHTML.trim() === '<p>Activate the AI Coach to get insights.</p>')) {
                startLoadingMessageRotator(panelContent);
            }
            await refreshAICoachData(); 

        } else {
            document.body.classList.remove('ai-coach-active');
            if (toggleButton) toggleButton.textContent = '🚀 Activate AI Coach';
            if (panelContent) panelContent.innerHTML = '<p>Activate the AI Coach to get insights.</p>';
            logAICoach("AI Coach panel deactivated.");
            stopLoadingMessageRotator(); // Stop rotator when panel is closed
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
            <div id="aiCoachChatStats" style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: #f0f8ff;
                border-radius: 5px;
                margin-bottom: 10px;
                font-size: 0.85em;
                color: #666;
            ">
                <div>
                    <span id="aiCoachChatCount">Loading chat history...</span>
                </div>
                <div style="display: flex; gap: 15px; align-items: center;">
                    <span id="aiCoachLikedCount" style="color: #e74c3c;">
                        <span style="font-size: 1.1em;">❤️</span> <span id="likedCountNumber">0</span> liked
                    </span>
                    <button id="aiCoachClearOldChatsBtn" class="p-button p-component" style="
                        padding: 4px 8px;
                        font-size: 0.8em;
                        background: #f8f9fa;
                        color: #666;
                        border: 1px solid #ddd;
                        display: none;
                    ">
                        Clear Old Chats
                    </button>
                </div>
            </div>
            <div id="aiCoachChatDisplay">
                <p class="ai-chat-message ai-chat-message-bot"><em>AI Coach:</em> Hello! How can I help you with ${studentNameForContext} today?</p>
            </div>
            <div style="margin: 10px 0;">
                <button id="aiCoachProblemButton" class="p-button p-component" style="
                    width: 100%;
                    padding: 8px;
                    font-size: 0.9em;
                    background: #f8f9fa;
                    color: #333;
                    border: 1px solid #ddd;
                ">
                    🎯 Tackle a Specific Problem?
                </button>
            </div>
            <div style="display: flex; gap: 10px;">
                <input type="text" id="aiCoachChatInput" placeholder="Type your message...">
                <button id="aiCoachChatSendButton" class="p-button p-component">Send</button>
            </div>
            <div id="aiCoachChatThinkingIndicator" class="thinking-pulse" style="display: none;"> 
                AI Coach is thinking<span class="thinking-dots"><span></span><span></span><span></span></span>
            </div>
        `;
        panelContentElement.appendChild(chatContainer);

        const chatInput = document.getElementById('aiCoachChatInput');
        const chatSendButton = document.getElementById('aiCoachChatSendButton');
        const chatDisplay = document.getElementById('aiCoachChatDisplay');
        const chatStats = document.getElementById('aiCoachChatStats');
        const chatCountElement = document.getElementById('aiCoachChatCount');
        const likedCountElement = document.getElementById('likedCountNumber');
        const clearOldChatsBtn = document.getElementById('aiCoachClearOldChatsBtn');
        const panelThinkingIndicator = document.getElementById('aiCoachChatThinkingIndicator'); // Get the panel-level indicator

        // Track chat metadata
        let totalChatCount = 0;
        let likedChatCount = 0;
        let chatMessages = []; // Store message metadata including IDs

        // Load chat history and stats
        async function loadChatHistory() {
            const currentStudentId = lastFetchedStudentId;
            if (!currentStudentId) {
                chatCountElement.textContent = 'No student selected';
                return;
            }

            try {
                // Assuming CHAT_HISTORY_ENDPOINT is defined, e.g., `${HEROKU_API_BASE_URL}/chat_history`
                // This endpoint needs to be created or confirmed on the backend.
                // For now, we'll assume it returns the expected structure.
                const chatHistoryEndpoint = `${HEROKU_API_BASE_URL}/chat_history`; 
                logAICoach("loadChatHistory: Fetching from endpoint: ", chatHistoryEndpoint);

                const response = await fetch(chatHistoryEndpoint, { // MODIFIED to use a variable
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        student_object10_record_id: currentStudentId,
                        max_messages: 50, // Example: fetch last 50 messages
                        days_back: 30,    // Example: from last 30 days
                        include_metadata: true // Request message ID and liked status
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    logAICoach("Loaded chat history with metadata:", data);
                    
                    // Clear existing messages except the initial greeting
                    const existingMessages = chatDisplay.querySelectorAll('.ai-chat-message');
                    existingMessages.forEach((msg, index) => {
                        if (index > 0) msg.remove(); // Keep first message (greeting)
                    });
                    
                    // Update stats
                    totalChatCount = data.total_count || data.chat_history?.length || 0; // Use chat_history.length as fallback
                    likedChatCount = data.liked_count || 0;
                    chatMessages = data.chat_history || []; // Ensure chatMessages is updated
                    
                    // Update UI counters
                    updateChatStats();
                    
                    // Add summary if available
                    if (data.summary) {
                        const summaryElement = document.createElement('div');
                        summaryElement.className = 'ai-chat-summary';
                        summaryElement.style.cssText = `
                            background-color: #f0f0f0;
                            padding: 10px;
                            margin: 10px 0;
                            border-radius: 5px;
                            font-size: 0.9em;
                            border-left: 3px solid #3498db;
                        `;
                        summaryElement.innerHTML = `<em>Previous conversations summary:</em> ${data.summary}`;
                        chatDisplay.appendChild(summaryElement);
                        
                        // Add separator
                        const separator = document.createElement('hr');
                        separator.style.cssText = 'margin: 15px 0; opacity: 0.3;';
                        chatDisplay.appendChild(separator);
                    }
                    
                    // Add previous messages
                    if (chatMessages && chatMessages.length > 0) {
                        chatMessages.forEach((msg, index) => { // Iterate over chatMessages
                            const msgElement = document.createElement('div');
                            msgElement.className = msg.role === 'assistant' ? 
                                'ai-chat-message ai-chat-message-bot' : 
                                'ai-chat-message ai-chat-message-user';
                            msgElement.setAttribute('data-role', msg.role);
                            msgElement.setAttribute('data-message-id', msg.id || ''); // Ensure msg.id is used
                            msgElement.style.position = 'relative';
                            
                            // Create message content
                            let messageContent = '';
                            if (msg.role === 'assistant') {
                                messageContent = `<em>AI Coach:</em> ${msg.content}`;
                            } else {
                                messageContent = `You: ${msg.content}`;
                            }
                            
                            // Add liked indicator if message is liked
                            if (msg.is_liked) { // Check msg.is_liked (boolean expected from backend)
                                msgElement.style.backgroundColor = '#fff5f5';
                                msgElement.style.borderLeft = '3px solid #e74c3c';
                                msgElement.style.paddingLeft = '15px';
                            }
                            
                            msgElement.innerHTML = messageContent;
                            
                            // Add like button for assistant messages
                            if (msg.role === 'assistant' && msg.id) { // Ensure msg.id exists
                                const likeButton = createLikeButton(msg.id, msg.is_liked || false); // Pass is_liked status
                                msgElement.appendChild(likeButton);
                            }
                            
                            chatDisplay.appendChild(msgElement);
                        });
                        
                        // Add continuation message if needed (or adjust greeting)
                        const lastMessage = chatDisplay.querySelector('.ai-chat-message:last-child');
                        if(!(lastMessage && lastMessage.textContent.includes("Let's continue"))){
                            const continuationMsg = document.createElement('p');
                            continuationMsg.className = 'ai-chat-message ai-chat-message-bot';
                            continuationMsg.innerHTML = `<em>AI Coach:</em> Let's continue our conversation about ${studentNameForContext}. What would you like to discuss?`;
                            chatDisplay.appendChild(continuationMsg);
                        }
                    }
                    
                    // Scroll to bottom
                    chatDisplay.scrollTop = chatDisplay.scrollHeight;
                } else {
                    const errorData = await response.json().catch(() => ({ error: "Failed to load chat history. Unknown error."}));
                    throw new Error(errorData.error || `Chat History API Error: ${response.status}`);
                }
            } catch (error) {
                logAICoach("Error loading chat history:", error);
                chatCountElement.textContent = 'Error loading history';
            }
        }

        // Update chat statistics display
        function updateChatStats() {
            const remaining = 200 - totalChatCount;
            let statusText = `${totalChatCount} chats`;
            let statusColor = '#666';
            
            if (remaining <= 20 && remaining > 0) {
                statusText += ` (${remaining} remaining)`;
                statusColor = '#ff9800'; // Orange warning
                clearOldChatsBtn.style.display = 'inline-block';
            } else if (remaining <= 0) {
                statusText = `Chat limit reached (200 max)`;
                statusColor = '#e74c3c'; // Red
                clearOldChatsBtn.style.display = 'inline-block';
            }
            
            chatCountElement.textContent = statusText;
            chatCountElement.style.color = statusColor;
            likedCountElement.textContent = likedChatCount;
        }

        // Create like button for messages
        function createLikeButton(messageId, isLiked = false) {
            const likeBtn = document.createElement('button');
            likeBtn.className = 'ai-chat-like-btn';
            likeBtn.setAttribute('data-message-id', messageId);
            likeBtn.setAttribute('data-liked', isLiked ? 'true' : 'false');
            likeBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 1.2em;
                opacity: ${isLiked ? '1' : '0.3'}; // Set initial opacity based on liked state
                transition: opacity 0.2s, transform 0.2s;
                padding: 5px;
            `;
            likeBtn.innerHTML = isLiked ? '❤️' : '🤍';
            likeBtn.title = isLiked ? 'Unlike this response' : 'Like this response';
            
            // Hover effect - no change needed here from original if it was working
            likeBtn.addEventListener('mouseenter', () => {
                likeBtn.style.opacity = '1';
                likeBtn.style.transform = 'scale(1.2)';
            });
            
            likeBtn.addEventListener('mouseleave', () => {
                if (likeBtn.getAttribute('data-liked') !== 'true') {
                    likeBtn.style.opacity = '0.3';
                }
                likeBtn.style.transform = 'scale(1)';
            });
            
            // Click handler
            likeBtn.addEventListener('click', async () => {
                const currentlyLiked = likeBtn.getAttribute('data-liked') === 'true';
                const newLikedState = !currentlyLiked;
                
                // Optimistically update UI
                likeBtn.setAttribute('data-liked', newLikedState ? 'true' : 'false');
                likeBtn.innerHTML = newLikedState ? '❤️' : '🤍';
                likeBtn.title = newLikedState ? 'Unlike this response' : 'Like this response';
                likeBtn.style.opacity = newLikedState ? '1' : '0.3';
                
                // Update parent message styling
                const parentMsg = likeBtn.parentElement;
                if (newLikedState) {
                    parentMsg.style.backgroundColor = '#fff5f5';
                    parentMsg.style.borderLeft = '3px solid #e74c3c';
                    parentMsg.style.paddingLeft = '15px';
                    likedChatCount++;
                } else {
                    parentMsg.style.backgroundColor = '';
                    parentMsg.style.borderLeft = '';
                    parentMsg.style.paddingLeft = '';
                    likedChatCount--;
                }
                updateChatStats();
                
                // Send update to backend
                try {
                    const updateLikeEndpoint = `${HEROKU_API_BASE_URL}/update_chat_like`; // Define endpoint
                    const response = await fetch(updateLikeEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            message_id: messageId, // Knack record ID of the chat message
                            is_liked: newLikedState
                        }),
                    });
                    
                    if (!response.ok) {
                        // Revert on error
                        likeBtn.setAttribute('data-liked', currentlyLiked ? 'true' : 'false');
                        likeBtn.innerHTML = currentlyLiked ? '❤️' : '🤍';
                        likeBtn.style.opacity = currentlyLiked ? '1' : '0.3'; // Revert opacity
                        likeBtn.title = currentlyLiked ? 'Unlike this response' : 'Like this response';
                        // Revert parent message styling
                        if (currentlyLiked) {
                            parentMsg.style.backgroundColor = '#fff5f5';
                            parentMsg.style.borderLeft = '3px solid #e74c3c';
                            parentMsg.style.paddingLeft = '15px';
                        } else {
                            parentMsg.style.backgroundColor = '';
                            parentMsg.style.borderLeft = '';
                            parentMsg.style.paddingLeft = '';
                        }

                        if (newLikedState) likedChatCount--; else likedChatCount++; // Revert count
                        updateChatStats();
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || 'Failed to update like status on backend.');
                    }
                    
                    logAICoach(`Message ${messageId} like status updated to: ${newLikedState}`);
                } catch (error) {
                    logAICoach("Error updating like status:", error);
                    // Display a more user-friendly error, e.g., a small toast notification
                    // For now, just log it.
                }
            });
            
            return likeBtn;
        }

        // Clear old chats handler
        if (clearOldChatsBtn) {
            clearOldChatsBtn.addEventListener('click', async () => {
                if (!confirm('This will delete your oldest unlisted chats to make room for new ones. Continue?')) {
                    return;
                }
                
                try {
                    const response = await fetch(`${HEROKU_API_BASE_URL}/clear_old_chats`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            student_object10_record_id: lastFetchedStudentId,
                            keep_liked: true,
                            target_count: 150 // Clear to 150 to give some breathing room
                        }),
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        alert(`Cleared ${result.deleted_count} old chats. You now have room for ${200 - result.remaining_count} new chats.`);
                        loadChatHistory(); // Reload to show updated counts
                    }
                } catch (error) {
                    logAICoach("Error clearing old chats:", error);
                    alert('Failed to clear old chats. Please try again.');
                }
            });
        }

        async function sendChatMessage() {
            if (!chatInput || !chatDisplay) return;
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

            // Check chat limit before sending
            if (totalChatCount >= 200) {
                const warningMsg = document.createElement('p');
                warningMsg.className = 'ai-chat-message ai-chat-message-bot';
                warningMsg.style.cssText = 'background-color: #fff3cd; border-left: 3px solid #ffc107;';
                warningMsg.innerHTML = `<em>AI Coach:</em> You've reached the 200 chat limit. Please clear some old chats to continue.`;
                chatDisplay.appendChild(warningMsg);
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
            
            chatSendButton.disabled = true;
            chatInput.disabled = true;

            // Hide the panel-level (bottom) thinking indicator if it exists, as we prefer inline
            if (panelThinkingIndicator) {
                panelThinkingIndicator.style.display = 'none'; 
            }

            // Add in-chat "Analyzing your question..." message
            const inlineThinkingMessage = document.createElement('div'); 
            inlineThinkingMessage.id = 'aiCoachTempInlineThinkingMessage'; // Unique ID for the inline message
            inlineThinkingMessage.className = 'ai-chat-message ai-chat-message-bot'; // Style like a bot message
            inlineThinkingMessage.style.cssText = `
                background: #f0f8ff !important; 
                border: 1px solid #d0e8ff !important;
                opacity: 0.8;
            `;
            inlineThinkingMessage.innerHTML = `
                <em>AI Coach:</em> 
                <span style="color: #3498db; font-weight: 500;">
                    🤔 Thinking...<span class="thinking-dots"><span></span><span></span><span></span></span>
                </span>
            `;
            chatDisplay.appendChild(inlineThinkingMessage);
            chatDisplay.scrollTop = chatDisplay.scrollHeight; // Scroll to show it

            // Construct chat history from displayed messages (excluding the new inline thinking message)
            const chatHistory = [];
            const messages = chatDisplay.querySelectorAll('.ai-chat-message');
            messages.forEach(msgElement => {
                // Skip the user message we just added to the DOM AND the thinking message
                if (msgElement === userMessageElement || msgElement.id === 'aiCoachTempInlineThinkingMessage') return; 

                let role = msgElement.getAttribute('data-role');
                let content = '';

                if (!role) { 
                    if (msgElement.classList.contains('ai-chat-message-bot')) {
                         role = 'assistant';
                         // Extract only text content, remove HTML tags for history
                         const tempDiv = document.createElement('div');
                         tempDiv.innerHTML = msgElement.innerHTML.replace(/<em>AI Coach:<\/em>\s*/, '');
                         content = tempDiv.textContent || tempDiv.innerText || '';
                    } else if (msgElement.classList.contains('ai-chat-message-user')) {
                         role = 'user';
                         content = msgElement.textContent.replace(/You:\s*/, '');
                    } else {
                        return; 
                    }
                } else {
                    if (role === 'user') {
                        content = msgElement.textContent.replace(/^(You:)/, '').trim();
                    } else { // assistant
                        const tempDiv = document.createElement('div');
                        // Remove "AI Coach:" prefix and then get text content
                        tempDiv.innerHTML = msgElement.innerHTML.replace(/<em>AI Coach:<\/em>\s*/, '');
                        content = (tempDiv.textContent || tempDiv.innerText || '').trim();
                    }
                }
                chatHistory.push({ role: role, content: content });
            });
            
            logAICoach("Sending chat turn with history:", chatHistory);
            logAICoach("Current tutor message for API:", originalInput);

            try {
                const payload = {
                    student_object10_record_id: currentStudentId,
                    chat_history: chatHistory, 
                    current_tutor_message: originalInput
                };

                // No need to interact with the old thinkingIndicator (bottom bar) here
                chatSendButton.disabled = false;
                chatInput.disabled = false;
                
                // The in-chat thinking message (aiCoachTempInlineThinkingMessage) was already removed before the fetch call.
                // If we want to remove it only *after* a successful response or error, we'd move its removal here.
                // For now, keeping removal before fetch call as per previous logic.

                if (currentLLMInsightsForChat) {
                    payload.initial_ai_context = {
                        student_overview_summary: currentLLMInsightsForChat.student_overview_summary,
                        academic_benchmark_analysis: currentLLMInsightsForChat.academic_benchmark_analysis,
                        questionnaire_interpretation_and_reflection_summary: currentLLMInsightsForChat.questionnaire_interpretation_and_reflection_summary
                    };
                    logAICoach("Sending chat with initial_ai_context:", payload.initial_ai_context);
                }

                const response = await fetch(CHAT_TURN_ENDPOINT, { 
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                // No need to interact with the old thinkingIndicator (bottom bar) here
                chatSendButton.disabled = false;
                chatInput.disabled = false;
                
                // The in-chat thinking message (aiCoachTempInlineThinkingMessage) was already removed before the fetch call.
                // If we want to remove it only *after* a successful response or error, we'd move its removal here.
                // For now, keeping removal before fetch call as per previous logic.

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: "An unknown error occurred communicating with the AI chat."}));
                    throw new Error(errorData.error || `Chat API Error: ${response.status}`);
                }

                const data = await response.json();
                const botMessageElement = document.createElement('p');
                botMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                botMessageElement.setAttribute('data-role', 'assistant'); // For history reconstruction
                
                // Process the AI response to make activity references clickable
                let processedResponse = data.ai_response;
                const suggestedActivities = data.suggested_activities_in_chat || [];
                
                // Create a map of activity names to their data for easy lookup
                const activityMap = {};
                suggestedActivities.forEach(activity => {
                    activityMap[activity.name] = activity;
                    // Also map with ID for ID-based references
                    activityMap[`${activity.name} (ID: ${activity.id})`] = activity;
                });
                
                // Replace activity mentions with clickable links
                suggestedActivities.forEach(activity => {
                    // Pattern 1: "Activity Name (ID: XX)"
                    const pattern1 = new RegExp(`${activity.name}\\s*\\(ID:\\s*${activity.id}\\)`, 'gi');
                    processedResponse = processedResponse.replace(pattern1, 
                        `<a href="#" class="ai-coach-activity-link" data-activity='${JSON.stringify(activity).replace(/'/g, '&apos;')}' style="color: #3498db; text-decoration: underline; font-weight: 500;">${activity.name} (ID: ${activity.id})</a>`
                    );
                    
                    // Pattern 2: Just "Activity Name" if it's clearly in a suggestion context
                    const pattern2 = new RegExp(`(?:activity:|try the|consider|suggest|recommend)\\s*["']?${activity.name}["']?`, 'gi');
                    processedResponse = processedResponse.replace(pattern2, (match) => {
                        // Only replace if not already replaced
                        if (!match.includes('ai-coach-activity-link')) {
                            const prefix = match.substring(0, match.indexOf(activity.name));
                            return `${prefix}<a href="#" class="ai-coach-activity-link" data-activity='${JSON.stringify(activity).replace(/'/g, '&apos;')}' style="color: #3498db; text-decoration: underline; font-weight: 500;">${activity.name}</a>`;
                        }
                        return match;
                    });
                });
                
                botMessageElement.innerHTML = `<em>AI Coach:</em> ${processedResponse}`;
                chatDisplay.appendChild(botMessageElement);
                
                // Add click handlers to activity links
                const activityLinks = botMessageElement.querySelectorAll('.ai-coach-activity-link');
                activityLinks.forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        try {
                            const activityData = JSON.parse(link.getAttribute('data-activity'));
                            showActivityModal(activityData);
                        } catch (error) {
                            logAICoach("Error parsing activity data:", error);
                        }
                    });
                });
                
                // If there are suggested activities, also add a quick links section
                if (suggestedActivities.length > 0) {
                    const quickLinksElement = document.createElement('div');
                    quickLinksElement.style.cssText = `
                        margin-top: 10px;
                        padding: 10px;
                        background: #f0f8ff;
                        border-radius: 5px;
                        border-left: 3px solid #3498db;
                    `;
                    quickLinksElement.innerHTML = '<strong style="color: #2c3e50; font-size: 0.9em;">📚 Quick Activity Links:</strong>';
                    
                    const linksList = document.createElement('ul');
                    linksList.style.cssText = 'margin: 5px 0 0 0; padding-left: 20px;';
                    
                    suggestedActivities.forEach(activity => {
                        const listItem = document.createElement('li');
                        listItem.style.cssText = 'margin: 3px 0;';
                        listItem.innerHTML = `
                            <a href="#" class="ai-coach-activity-quick-link" 
                               data-activity='${JSON.stringify(activity).replace(/'/g, '&apos;')}'
                               style="color: #3498db; text-decoration: none; font-size: 0.9em;">
                                ${activity.name} <span style="color: #666;">(${activity.vespa_element})</span>
                            </a>
                        `;
                        linksList.appendChild(listItem);
                    });
                    
                    quickLinksElement.appendChild(linksList);
                    chatDisplay.appendChild(quickLinksElement);
                    
                    // Add click handlers to quick links
                    const quickLinks = quickLinksElement.querySelectorAll('.ai-coach-activity-quick-link');
                    quickLinks.forEach(link => {
                        link.addEventListener('click', (e) => {
                            e.preventDefault();
                            try {
                                const activityData = JSON.parse(link.getAttribute('data-activity'));
                                showActivityModal(activityData);
                            } catch (error) {
                                logAICoach("Error parsing activity data from quick link:", error);
                            }
                        });
                    });
                }
            } catch (error) {
                logAICoach("Error sending chat message:", error);
                const errorMessageElement = document.createElement('p');
                errorMessageElement.className = 'ai-chat-message ai-chat-message-bot';
                errorMessageElement.innerHTML = `<em>AI Coach:</em> Sorry, I couldn't get a response. ${error.message}`;
                chatDisplay.appendChild(errorMessageElement);
                // No need to interact with the old thinkingIndicator (bottom bar)
                // chatSendButton.disabled = false;
                // chatInput.disabled = false;
            }
            finally {
                // Remove the inline thinking message
                const tempInlineThinkingMsgForRemoval = document.getElementById('aiCoachTempInlineThinkingMessage');
                if (tempInlineThinkingMsgForRemoval) {
                    tempInlineThinkingMsgForRemoval.remove();
                }

                // Ensure panel-level indicator is hidden (should already be if logic above worked)
                if (panelThinkingIndicator) {
                    panelThinkingIndicator.style.display = 'none';
                }
                
                chatSendButton.disabled = false;
                chatInput.disabled = false;
                chatInput.focus(); // Return focus to input
            }
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
        }

        // Common problems organized by VESPA element
        const commonProblems = {
            "Vision": [
                { id: "vision_1", text: "Student lacks clear goals or aspirations" },
                { id: "vision_2", text: "Student seems unmotivated about their future" },
                { id: "vision_3", text: "Student doesn't see the relevance of their studies" }
            ],
            "Effort": [
                { id: "effort_1", text: "Poor homework completion rates" },
                { id: "effort_2", text: "Student gives up easily when faced with challenges" },
                { id: "effort_3", text: "Inconsistent effort across different subjects" }
            ],
            "Systems": [
                { id: "systems_1", text: "Difficulty sticking to deadlines" },
                { id: "systems_2", text: "Poor organization of notes and materials" },
                { id: "systems_3", text: "No effective revision system in place" }
            ],
            "Practice": [
                { id: "practice_1", text: "Student doesn't review or practice regularly" },
                { id: "practice_2", text: "Relies on last-minute cramming" },
                { id: "practice_3", text: "Doesn't use feedback to improve" }
            ],
            "Attitude": [
                { id: "attitude_1", text: "Fixed mindset - believes ability is unchangeable" },
                { id: "attitude_2", text: "Negative self-talk affecting performance" },
                { id: "attitude_3", text: "Blames external factors for poor results" }
            ]
        };

        // Handle problem selector button - MODIFIED to show modal
        const problemButton = document.getElementById('aiCoachProblemButton');
        if (problemButton) {
            problemButton.addEventListener('click', () => {
                showProblemSelectorModal(commonProblems, chatInput);
            });
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

    // --- NEW: Function to show problem selector modal ---
    function showProblemSelectorModal(commonProblems, chatInput) {
        logAICoach("Showing problem selector modal");
        
        // Remove existing modal if present
        const existingModal = document.getElementById('aiCoachProblemModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal structure
        const modal = document.createElement('div');
        modal.id = 'aiCoachProblemModal';
        modal.className = 'ai-coach-modal-overlay';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'ai-coach-modal-content';
        
        // Apply saved zoom level to modal
        const savedZoom = localStorage.getItem('aiCoachTextZoom');
        if (savedZoom) {
            const zoom = parseInt(savedZoom, 10);
            modalContent.style.fontSize = `${zoom * 14 / 100}px`;
        }
        
        // Modal header
        const modalHeader = document.createElement('div');
        modalHeader.className = 'ai-coach-problem-modal-header';
        modalHeader.innerHTML = `
            <h3>Select a Common Challenge</h3>
            <p>Choose a specific problem to get targeted coaching advice</p>
            <button class="ai-coach-modal-close">&times;</button>
        `;
        
        // Modal body
        const modalBody = document.createElement('div');
        modalBody.className = 'ai-coach-problem-modal-body';
        
        // Create categories with VESPA colors
        Object.entries(commonProblems).forEach(([vespaElement, problems]) => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = `ai-coach-problem-category vespa-${vespaElement.toLowerCase()}`;
            
            const categoryTitle = document.createElement('h4');
            categoryTitle.textContent = vespaElement;
            categoryDiv.appendChild(categoryTitle);
            
            problems.forEach(problem => {
                const problemItem = document.createElement('div');
                problemItem.className = 'ai-coach-problem-item';
                problemItem.textContent = problem.text;
                problemItem.dataset.problemId = problem.id;
                problemItem.dataset.vespaElement = vespaElement;
                
                // Click handler
                problemItem.addEventListener('click', () => {
                    // Populate chat input with the problem
                    if (chatInput) {
                        chatInput.value = `I need help with: ${problem.text} (${vespaElement} related)`;
                        chatInput.focus();
                    }
                    // Close modal
                    closeModal();
                });
                
                categoryDiv.appendChild(problemItem);
            });
            
            modalBody.appendChild(categoryDiv);
        });
        
        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Trigger animations
        setTimeout(() => {
            modal.style.opacity = '1';
            modalContent.style.transform = 'scale(1)';
        }, 10);
        
        // Close handlers
        const closeModal = () => {
            modal.style.opacity = '0';
            modalContent.style.transform = 'scale(0.9)';
            setTimeout(() => {
                modal.remove();
            }, 300);
        };
        
        modalHeader.querySelector('.ai-coach-modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
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

    // --- Function to create and show activity modal with PDF ---
    function showActivityModal(activity) {
        logAICoach("Showing activity modal for:", activity);
        
        // Remove existing modal if present
        const existingModal = document.getElementById('aiCoachActivityModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal structure
        const modal = document.createElement('div');
        modal.id = 'aiCoachActivityModal';
        modal.className = 'ai-coach-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.className = 'ai-coach-modal-content';
        modalContent.style.cssText = `
            background: white;
            width: 90%;
            max-width: 900px;
            height: 80vh;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            position: relative;
            transform: scale(0.9);
            transition: transform 0.3s ease;
        `;
        
        // Apply saved zoom level to modal
        const savedZoom = localStorage.getItem('aiCoachTextZoom');
        if (savedZoom) {
            const zoom = parseInt(savedZoom, 10);
            modalContent.style.fontSize = `${zoom * 14 / 100}px`;
        }
        
        // Modal header
        const modalHeader = document.createElement('div');
        modalHeader.style.cssText = `
            padding: 20px;
            border-bottom: 1px solid #ddd;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        `;
        
        modalHeader.innerHTML = `
            <div>
                <h3 style="margin: 0; color: #333;">${activity.name}</h3>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">
                    VESPA Element: <strong>${activity.vespa_element}</strong> | Activity ID: <strong>${activity.id}</strong>
                </p>
            </div>
            <button class="ai-coach-modal-close" style="
                background: none;
                border: none;
                font-size: 1.5em;
                cursor: pointer;
                padding: 5px 10px;
                color: #666;
                transition: color 0.2s;
            ">&times;</button>
        `;
        
        // Modal body with summary and PDF
        const modalBody = document.createElement('div');
        modalBody.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
        `;
        
        // Activity summary section
        if (activity.short_summary && activity.short_summary !== 'N/A') {
            const summarySection = document.createElement('div');
            summarySection.style.cssText = `
                background: #f8f9fa;
                padding: 15px;
                border-radius: 5px;
                border-left: 4px solid #3498db;
            `;
            summarySection.innerHTML = `
                <h4 style="margin: 0 0 10px 0; color: #333;">Activity Summary:</h4>
                <p style="margin: 0; color: #555; line-height: 1.6;">${activity.short_summary}</p>
            `;
            modalBody.appendChild(summarySection);
        }
        
        // PDF viewer section
        const pdfSection = document.createElement('div');
        pdfSection.style.cssText = `
            flex: 1;
            border: 1px solid #ddd;
            border-radius: 5px;
            overflow: hidden;
            min-height: 400px;
            background: #f5f5f5;
            position: relative;
        `;
        
        if (activity.pdf_link && activity.pdf_link !== '#') {
            // Try to embed PDF
            const pdfEmbed = document.createElement('iframe');
            pdfEmbed.src = activity.pdf_link;
            pdfEmbed.style.cssText = `
                width: 100%;
                height: 100%;
                border: none;
            `;
            pdfEmbed.title = `PDF viewer for ${activity.name}`;
            
            // Add loading indicator
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                color: #666;
            `;
            loadingDiv.innerHTML = `
                <div class="loader" style="margin: 0 auto 10px;"></div>
                <p>Loading PDF...</p>
            `;
            
            pdfSection.appendChild(loadingDiv);
            pdfSection.appendChild(pdfEmbed);
            
            // Handle PDF load events
            pdfEmbed.onload = () => {
                logAICoach("PDF iframe loaded successfully");
                loadingDiv.style.display = 'none';
            };
            
            pdfEmbed.onerror = () => {
                logAICoach("PDF iframe failed to load");
                pdfSection.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <p style="margin-bottom: 20px;">Unable to display PDF in this view.</p>
                        <a href="${activity.pdf_link}" target="_blank" class="p-button p-component" style="
                            display: inline-block;
                            padding: 10px 20px;
                            text-decoration: none;
                            background: #3498db;
                            color: white;
                            border-radius: 4px;
                        ">Open PDF in New Tab</a>
                    </div>
                `;
            };
            
            // Add fallback link below iframe
            const fallbackLink = document.createElement('p');
            fallbackLink.style.cssText = 'text-align: center; margin-top: 10px; font-size: 0.9em;';
            fallbackLink.innerHTML = `
                <a href="${activity.pdf_link}" target="_blank" style="color: #3498db; text-decoration: underline;">
                    Open PDF in new tab if viewer doesn't load
                </a>
            `;
            modalBody.appendChild(fallbackLink);
        } else {
            pdfSection.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <p>No PDF available for this activity.</p>
                </div>
            `;
        }
        
        modalBody.appendChild(pdfSection);
        
        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Trigger animations
        setTimeout(() => {
            modal.style.opacity = '1';
            modalContent.style.transform = 'scale(1)';
        }, 10);
        
        // Close handlers
        const closeModal = () => {
            modal.style.opacity = '0';
            modalContent.style.transform = 'scale(0.9)';
            setTimeout(() => {
                modal.remove();
            }, 300);
        };
        
        modal.querySelector('.ai-coach-modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    // --- Enhanced sendChatMessage function to handle activity suggestions ---
    // (This replaces part of the existing sendChatMessage function in addChatInterface)
    
    window.initializeAICoachLauncher = initializeAICoachLauncher;

    // --- NEW FUNCTION to manage rotating loading messages ---
    function startLoadingMessageRotator(panelContentElement) {
        if (loadingMessageIntervalId) {
            clearInterval(loadingMessageIntervalId); // Clear existing interval if any
            loadingMessageIntervalId = null; // Reset ID
        }
        if (!panelContentElement) return;

        const messages = [
            "Please wait while I analyse the student data...",
            "While I complete this please read through the report on the left.....",
            "Once my chat field has opened please ask me any questions about the student or report...",
            "Or add a \"specific Problem\" and I can help you find a solution."
        ];
        let messageIndex = 0;

        // Initial message display
        panelContentElement.innerHTML = `<div class="loader"></div><p style="text-align:center; min-height: 40px;">${messages[messageIndex]}</p>`;
        messageIndex = (messageIndex + 1) % messages.length;

        loadingMessageIntervalId = setInterval(() => {
            if (panelContentElement) { // Check if panel still exists
                 const existingLoader = panelContentElement.querySelector('.loader');
                 let loaderHtml = '';
                 if(existingLoader) loaderHtml = '<div class="loader"></div>'; // Preserve loader if it's there

                // Check if the panel content has been replaced by actual data or an error message
                // This is a simple check; more robust checks might be needed if other content can exist here.
                const currentText = panelContentElement.textContent || "";
                const isDefaultActivationMessage = currentText.includes("Activate the AI Coach to get insights");
                const isDisplayingMessages = messages.some(msg => currentText.includes(msg.substring(0,20)));
                const hasErrorMessage = currentText.toLowerCase().includes("error loading ai coach insights") || currentText.toLowerCase().includes("student id missing") || currentText.toLowerCase().includes("could not identify student report");

                if ((isDisplayingMessages || (existingLoader && !currentText.includes("Snapshot"))) && !hasErrorMessage && !isDefaultActivationMessage) { // Only update if still showing loading messages and no error and not default message
                    panelContentElement.innerHTML = `${loaderHtml}<p style=\"text-align:center; min-height: 40px;\">${messages[messageIndex]}</p>`;
                    messageIndex = (messageIndex + 1) % messages.length;
                } else {
                     // If content is not a loading message (e.g., data rendered or error shown), stop rotator.
                    stopLoadingMessageRotator();
                }
            } else { // panelContentElement does not exist
                stopLoadingMessageRotator();
            }
        }, 3500); // Change message every 3.5 seconds
        logAICoach("Started loading message rotator.");
    }

    function stopLoadingMessageRotator() {
        if (loadingMessageIntervalId) {
            clearInterval(loadingMessageIntervalId);
            loadingMessageIntervalId = null;
            logAICoach("Stopped loading message rotator.");
        }
    }
} 