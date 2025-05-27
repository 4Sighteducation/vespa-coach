// ReportProfiles.js - Student Profile Integration for VESPA Reports
// This script displays student profile data above individual VESPA reports
// Adapted for Multi-App Loader system

// Global config variable - will be set by loader
// let REPORTPROFILE_CONFIG = null; // Moved to prevent re-declaration errors

// Guard to prevent re-initialization
if (window.reportProfilesInitialized) {
  // console.warn("[ReportProfiles] Attempted to re-initialize, but already initialized. Skipping.");
  if (DEBUG_MODE) console.warn("[ReportProfiles] Attempted to re-initialize, but already initialized. Skipping.");
  // Potentially throw an error or just return to stop further execution if this script is loaded multiple times.
  // For now, we'll rely on the loader to fix multiple loads, this just prevents re-running initialize.
} else {
  window.reportProfilesInitialized = true;

  // Moved REPORTPROFILE_CONFIG declaration here
  let REPORTPROFILE_CONFIG = null;

  // NEW: Global state for profile edit mode
  let isProfileInEditMode = false; // Default to false (display mode)

  // NEW: Global reference for the profile loading overlay
  let profileLoadingOverlayElement = null;

  // Constants
  const KNACK_API_URL = 'https://api.knack.com/v1';
  const HOMEPAGE_OBJECT = 'object_112'; // User Profile object for homepage
  const DEBUG_MODE = true; // Enable console logging
  const CHECK_INTERVAL = 500; // Check every 500ms
  const MAX_CHECKS = 20; // Give up after 10 seconds (20 checks)

  // Field mappings for the user profile object (copied from Homepage.js)
  const FIELD_MAPPING = {
    userId: 'field_3064',         // User ID
    userConnection: 'field_3070',  // User Account connection
    vespaCustomer: 'field_3069',   // VESPA Customer (User School)
    studentName: 'field_3066',     // Student Name
    tutorConnection: 'field_3071', // Student Tutors
    staffAdminConnection: 'field_3072', // Staff Admins
    attendance: 'field_3076',      // Attendance
    tutorGroup: 'field_3077',      // Tutor Group
    yearGroup: 'field_3078',       // Year Group
    numLogins: 'field_3079',       // NumLogins
    upn: 'field_3136',            // Unique Pupil Number (UPN)
    // Subject fields
    sub1: 'field_3080',
    sub2: 'field_3081',
    sub3: 'field_3082',
    sub4: 'field_3083',
    sub5: 'field_3084',
    sub6: 'field_3085',
    sub7: 'field_3086',
    sub8: 'field_3087',
    sub9: 'field_3088',
    sub10: 'field_3089',
    sub11: 'field_3090',
    sub12: 'field_3091',
    sub13: 'field_3092',
    sub14: 'field_3093',
    sub15: 'field_3094'
  };

  // Store state
  let currentStudentId = null;
  let previousStudentId = null; // Track previous student ID for comparison
  let reportObserver = null;
  let activityButtonPollInterval = null; // For continuous polling
  const BUTTON_POLL_INTERVAL = 1000; // Check every 1 second
  const BUTTON_POLL_MAX_ATTEMPTS = 60; // Try for up to 60 seconds (1 minute)

  // Request management
  let activeRequests = {}; // Track active AJAX requests
  let profileCache = {}; // Cache for student profile data
  const CACHE_TTL = 10000; // Cache TTL: 10 seconds (was 5 * 60 * 1000 or 0 for debugging)
  const API_COOLDOWN = 1250; // MODIFIED: Increased from 1000ms to 1250ms
  let lastRequestTimes = {}; // Track timestamps of last requests by resource type
  let isProcessingStudent = false; // Flag to prevent concurrent student processing

  // DOM update management
  let isUpdatingDOM = false; // Flag to prevent observer reactions to our own DOM changes
  let lastRenderedProfileHash = null; // Hash of the last rendered profile data
  let lastRenderTime = 0; // Timestamp of the last profile render
  const RENDER_COOLDOWN = 1000; // Minimum time between renders in milliseconds

  // Debounce helper function - prevents rapid repeated API calls
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  // Main initializer function that will be called by the loader
  function initializeReportProfiles() {
    debugLog("ReportProfiles initializing...");
    
    // Add CSS styles
    addStyles();
    
    // Add a visual indicator that the script is loaded
    addDebugIndicator();
    
    // Start polling for the necessary DOM elements
    startPolling();
  }

  // Add a small debug indicator to the page to confirm the script is loaded
  function addDebugIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'profile-debug-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background-color: #079baa;
      color: white;
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 12px;
      font-family: monospace;
      z-index: 9999;
      opacity: 0.8;
      cursor: pointer;
    `;
    indicator.textContent = 'Profile Script Loaded';
    indicator.addEventListener('click', function() {
      // Log debug info when clicked
      debugLog("Debug indicator clicked", {
        'reportContainer': document.querySelector('#view_2776 .kn-rich_text__content') ? 'Found' : 'Not found',
        'profileContainer': document.querySelector('#view_3015 .kn-rich_text__content') ? 'Found' : 'Not found',
        'activityButton': document.querySelector('#view-activities-button a') ? 'Found' : 'Not found',
        'studentNameInReport': document.querySelector('#view_2776 .kn-rich_text__content')?.textContent.includes('STUDENT:') ? 'Found' : 'Not found',
        'currentStudent': currentStudentId,
        'cachedProfiles': Object.keys(profileCache)
      });
      
      // Dump the report content to console
      const reportContent = document.querySelector('#view_2776 .kn-rich_text__content')?.innerHTML || '';
      debugLog("Report content sample", reportContent.substring(0, 500));
    });
    document.body.appendChild(indicator);
  }

  // Poll for the necessary DOM elements
  function startPolling() {
    debugLog("Starting to poll for report containers...");
    let checkCount = 0;
    
    const checkInterval = setInterval(function() {
      // Check if the report elements exist
      const reportContainer = document.querySelector('#view_2776 .kn-rich_text__content');
      const profileContainer = document.querySelector('#view_3015 .kn-rich_text__content');
      
      if (reportContainer && profileContainer) {
        // Elements found, clear the interval
        clearInterval(checkInterval);
        debugLog("Report containers found", { 
          reportContainer: '#view_2776 .kn-rich_text__content', 
          profileContainer: '#view_3015 .kn-rich_text__content' 
        });
        
    // Set up MutationObserver to watch for changes
    setupObservers(reportContainer, profileContainer);
    
    // Check immediately in case the report is already showing
    checkForIndividualReport(reportContainer, profileContainer);
    
    // Reset lastRenderedProfileHash to ensure a fresh render on page reload
    lastRenderedProfileHash = null;
      } else {
        checkCount++;
        if (checkCount >= MAX_CHECKS) {
          clearInterval(checkInterval);
          // console.error("[ReportProfiles] Could not find report containers after maximum attempts");
          if (DEBUG_MODE) console.error("[ReportProfiles] Could not find report containers after maximum attempts");
        }
      }
    }, CHECK_INTERVAL);
  }

  // Debug logging helper
  function debugLog(title, data) {
    if (!DEBUG_MODE) return;
    
    console.log(`%c[ReportProfiles] ${title}`, 'color: #00e5db; font-weight: bold; font-size: 12px;');
    try {
      if (data !== undefined) {
        console.log(JSON.parse(JSON.stringify(data, null, 2)));
      }
    } catch (e) {
      console.log("Data could not be fully serialized for logging:", data);
    }
    return data;
  }

  function setupObservers(reportContainer, profileContainer) {
    // Clean up any existing observer
    if (reportObserver) {
      reportObserver.disconnect();
    }
    
    // Create a new observer with debounced handler
    const debouncedHandler = debounce((mutations) => {
      // Skip handling if we're in the middle of updating the DOM ourselves
      if (isUpdatingDOM) {
        debugLog("Observer triggered while updating DOM - skipping");
        return;
      }
      handleReportChanges(reportContainer, profileContainer);
    }, 500); // Increased debounce time to prevent excessive triggering
    
    reportObserver = new MutationObserver(debouncedHandler);
    
    // Start observing the report container with more thorough options
    reportObserver.observe(reportContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    
    // Also observe the entire document body for navigation events and buttons
    const debouncedDocHandler = debounce((mutations) => {
      // Skip handling if we're in the middle of updating the DOM ourselves
      if (isUpdatingDOM) {
        debugLog("Document observer triggered while updating DOM - skipping");
        return;
      }
      
      // Check if our target button has appeared
      const activityButton = document.querySelector('#view-activities-button');
      
      // Check for navigation events (back button clicks)
      const backButton = document.querySelector('a.p-button[aria-label="BACK"]') || 
                         document.querySelector('button[aria-label="BACK"]');
      
      // Check if we're showing the group view table
      const groupViewTable = document.querySelector('#studentReports .p-datatable');
      
      if (groupViewTable && !backButton) {
        // We're likely back to the group view - clear the profile
        debugLog("Detected return to group view through DOM mutation");
        clearProfileView(profileContainer);
      } else if (activityButton) {
        debugLog("Found view-activities-button in document observation", activityButton);
        handleReportChanges(reportContainer, profileContainer);
      }
    }, 500); // Use same debounce time as main handler
    
    const docObserver = new MutationObserver(debouncedDocHandler);
    
    // Observe the document body for any changes
    docObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    debugLog("Report observers set up");
    
    // Start the activity button poller as a backup
    startActivityButtonPoller(reportContainer, profileContainer);
  }

  // Start polling for the activity button
  function startActivityButtonPoller(reportContainer, profileContainer) {
    // Clear any existing interval
    if (activityButtonPollInterval) {
      clearInterval(activityButtonPollInterval);
      activityButtonPollInterval = null; // Ensure it's reset
    }
    debugLog("Activity button poller is now disabled as primary load trigger. Observers should handle it.");
    return; // Temporarily disable this poller to see if observers are sufficient
  }

  function checkForIndividualReport(reportContainer, profileContainer) {
    // This checks if an individual report is already displayed when the script loads
    debugLog("Checking for existing student report...");
    
    // Look for student name element which would indicate we're on an individual report
    const reportContent = reportContainer.innerHTML || '';
    const hasStudentName = reportContent.includes('STUDENT:');
    
    // Check for the presence of the back button - another indicator of being on a student report
    const backButton = document.querySelector('a.p-button[aria-label="BACK"]') || 
                       document.querySelector('button[aria-label="BACK"]');
    
    // Check if we're showing the group view table
    const groupViewTable = document.querySelector('#studentReports .p-datatable');
    
    debugLog(`Report content check: contains "STUDENT:": ${hasStudentName}, Back button: ${backButton ? 'Found' : 'Not found'}, Group table: ${groupViewTable ? 'Found' : 'Not found'}`);
    
    // Clear any existing profile data if we're not on a student report or we're on the group view
    if ((!hasStudentName && !backButton) || groupViewTable) {
      debugLog("Not on an individual student report, clearing profile view");
      clearProfileView(profileContainer);
      return;
    }
    
    // If we find evidence of being on a student report, try to process it
    if (hasStudentName || backButton) {
      debugLog("Found evidence of student report, processing...");
      handleReportChanges(reportContainer, profileContainer);
    }
  }

  // Cancel any active requests for a specific student
  function cancelActiveRequests(studentId = null) {
    // If studentId is provided, only cancel requests for that student
    // Otherwise, cancel all active requests
    Object.keys(activeRequests).forEach(key => {
      if (!studentId || key.includes(studentId)) {
        if (activeRequests[key] && activeRequests[key].abort) {
          debugLog(`Cancelling active request: ${key}`);
          activeRequests[key].abort();
        }
        delete activeRequests[key];
      }
    });
  }

  // Helper to create a simple hash of profile data for change detection
  function hashProfileData(profileData) {
    if (!profileData) return "empty";
    const name = profileData[FIELD_MAPPING.studentName] || '';
    const id = profileData.id || ''; // ID of the object_112 record

    let subjectStrings = "";
    // Removed: debugLog("[hashProfileData] Starting. Profile Name:", name, "Profile ID:", id);
    // Removed: debugLog("[hashProfileData] Full profileData:", JSON.stringify(profileData).substring(0, 500)); 

    for (let i = 1; i <= 15; i++) {
      const fieldKey = `sub${i}`;
      const fieldId = FIELD_MAPPING[fieldKey];
      const subjectValue = profileData[fieldId];
      // Removed: debugLog(`[hashProfileData] Checking subject field: ${fieldId}, Value:`, subjectValue ? String(subjectValue).substring(0,100) + (String(subjectValue).length > 100 ? '...':'') : subjectValue);
      if (subjectValue) { // Check if subjectValue is truthy
        subjectStrings += String(subjectValue); // Concatenate all subject JSON strings
        // Removed: debugLog(`[hashProfileData] Added to subjectStrings from ${fieldId}`);
      }
    }
    const finalHash = `${name}-${id}-${subjectStrings}`;
    // Removed: debugLog("[hashProfileData] Final hash:", finalHash, "SubjectStrings length:", subjectStrings.length);
    return finalHash;
  }

  function handleReportChanges(reportContainer, profileContainer) {
    // Determine potential student ID from the current DOM state first
    const reportTextForId = reportContainer.textContent || '';
    const studentNameMatchForId = reportTextForId.match(/STUDENT:\s*([^\n]+)/);
    let studentNameFromReportForId = null;
    if (studentNameMatchForId && studentNameMatchForId[1]) {
      studentNameFromReportForId = studentNameMatchForId[1].trim();
    }
    const viewActivitiesButtonForId = document.querySelector('#view-activities-button a') || 
                                    document.querySelector('a.p-button[aria-label="VIEW STUDENT ACTIVITIES"]') ||
                                    document.querySelector('button[aria-label="VIEW STUDENT ACTIVITIES"]') ||
                                    document.querySelector('a[href*="view-student-details"]') ||
                                    document.querySelector('a[href*="student-details"]');
    let potentialStudentId = null;
    if (viewActivitiesButtonForId) {
      const buttonHref = viewActivitiesButtonForId.getAttribute('href') || '';
      const idMatch = buttonHref.match(/\/([^\/]+)\/?$/);
      if (idMatch && idMatch[1]) {
        potentialStudentId = idMatch[1];
      }
    }
    if (!potentialStudentId && studentNameFromReportForId) {
      potentialStudentId = "USE_NAME:" + studentNameFromReportForId;
    }

    debugLog("handleReportChanges triggered. Potential Student ID:", potentialStudentId, "Current lastRenderedProfileHash:", lastRenderedProfileHash); // Added granular logging

    // If a processing cycle for the *same student* is already happening, bail out early.
    if (isProcessingStudent && potentialStudentId === currentStudentId) {
      debugLog("Skipping due to active processing for the same student.");
      return;
    }

    if (isUpdatingDOM) {
      debugLog("Skipping due to DOM update in progress.");
      return;
    }

    // --- The rest of the logic proceeds if not caught by the above guards ---

    const backButton = document.querySelector('a.p-button[aria-label="BACK"]') || 
                       document.querySelector('button[aria-label="BACK"]');
    const groupViewTable = document.querySelector('#studentReports .p-datatable');
    const isOnStudentView = studentNameFromReportForId || viewActivitiesButtonForId || backButton || (reportTextForId.includes('STUDENT:') && !groupViewTable);
    
    if (!isOnStudentView || groupViewTable) {
      if (currentStudentId !== null || (profileContainer && profileContainer.innerHTML !== '')) {
          debugLog("Detected group view or non-student view, clearing profile");
          clearProfileView(profileContainer);
          currentStudentId = null;
          lastRenderedProfileHash = null;
          isProcessingStudent = false; // Ensure flag is clear if we bail here
      }
      return;
    }

    if (!potentialStudentId) {
      debugLog("Could not determine student ID, clearing profile if necessary.");
      if (currentStudentId !== null || (profileContainer && profileContainer.innerHTML !== '')) {
          clearProfileView(profileContainer);
          currentStudentId = null;
          lastRenderedProfileHash = null;
          isProcessingStudent = false; // Ensure flag is clear
      }
      return;
    }

    // If student context hasn't changed AND profile is already rendered, skip.
    if (potentialStudentId === currentStudentId && lastRenderedProfileHash !== null) {
      // debugLog("Student ID same, profile rendered. Skipping.");
      // Ensure loading class is removed if we bail here, though it shouldn't have been added.
      document.body.classList.remove('report-profile-loading');
      return;
    }

    // --- New student context or first render for this student ---
    // Show loading indicator immediately if we are proceeding
    showLoadingIndicator();
    debugLog(`New student context or first render. Processing: ${potentialStudentId}. Previously: ${currentStudentId}`);
    // showLoadingIndicator(profileContainer); // MOVED UP - Explicitly show loading indicator here

    // Cancel requests for previous student if ID is actually changing.
    if (currentStudentId !== null && currentStudentId !== potentialStudentId) {
      debugLog(`Student ID changed from ${currentStudentId} to ${potentialStudentId}. Cancelling old requests.`);
      cancelActiveRequests(currentStudentId); // Use the actual old ID
    }
    
    currentStudentId = potentialStudentId;
    isProcessingStudent = true; // Set flag: we are now officially processing this student
    lastRenderedProfileHash = null; // Reset hash, forcing a new render if data is fetched

    // Debounced processing logic remains the same
    const debouncedProcess = debounce(async (studentIdentifier) => {
      try {
        // Reset isProcessingStudent if the debounced call is for an outdated studentId
        // This can happen if user navigates quickly
        if (studentIdentifier !== currentStudentId) {
            debugLog(`Debounced call for ${studentIdentifier} is outdated (current is ${currentStudentId}). Halting this debounced path.`);
            // Do not clear isProcessingStudent here, let the active currentStudentId process complete or clear it.
            return;
        }
        debugLog(`Debounced processing for current student: ${studentIdentifier}`);
        
        // ... (rest of the try block from previous version: finding from cache or calling processStudentProfile/ById)
        if (studentIdentifier.startsWith("USE_NAME:")) {
          const studentName = studentIdentifier.substr(9);
          // debugLog(`Processing student by name (debounced): ${studentName}`);
          const cacheKey = `profile_name_${studentName}`; // Standardized cache key
          if (profileCache[cacheKey] && (Date.now() - profileCache[cacheKey].timestamp < CACHE_TTL)) {
            debugLog(`Using cached profile for student name: ${studentName}`);
            renderStudentProfile(profileCache[cacheKey].data, profileContainer);
          } else {
            await processStudentProfile(studentName, profileContainer); 
          }
        } else {
          // debugLog(`Processing student by ID (debounced): ${studentIdentifier}`);
          const cacheKey = `profile_id_${studentIdentifier}`; // Standardized cache key
          if (profileCache[cacheKey] && (Date.now() - profileCache[cacheKey].timestamp < CACHE_TTL)) {
            debugLog(`Using cached profile for student ID: ${studentIdentifier}`);
            renderStudentProfile(profileCache[cacheKey].data, profileContainer);
          } else {
            await processStudentProfileById(studentIdentifier, profileContainer); 
          }
        }
      } catch (error) {
        console.error("[ReportProfiles] Error during debounced student processing:", error);
      } finally {
        // Only clear isProcessingStudent if this debounced call was for the *still current* student
        if (studentIdentifier === currentStudentId) {
          isProcessingStudent = false; 
          debugLog(`Processing finished for student: ${studentIdentifier}`);
        } else {
          debugLog(`Debounced call for ${studentIdentifier} finished, but current student is ${currentStudentId}. isProcessingStudent not cleared by this path.`);
        }
      }
    }, 750);

    debouncedProcess(currentStudentId);
  }

  function clearProfileView(profileContainer) {
    if (profileContainer) {
      profileContainer.innerHTML = '';
      debugLog("Profile view cleared");
    }
    // Also remove the info tooltip if it exists in the body
    const tooltipElement = document.getElementById('reportProfileGradeInfoTooltip');
    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
      debugLog("Report profile info tooltip removed");
    }
    // Remove MEG tooltip if it exists
    const megTooltipElement = document.getElementById('megInfoTooltip');
    if (megTooltipElement && megTooltipElement.parentNode) {
      megTooltipElement.parentNode.removeChild(megTooltipElement);
      debugLog("MEG info tooltip removed");
    }
    hideLoadingIndicator(); // Ensure loading overlay is hidden
  }

  // Show a loading indicator in the profile container
  function showLoadingIndicator(/* profileContainer no longer needed for overlay logic */) {
    document.body.classList.add('report-profile-loading'); // General state indicator

    if (!profileLoadingOverlayElement) {
        profileLoadingOverlayElement = document.createElement('div');
        profileLoadingOverlayElement.id = 'report-profile-main-loader-overlay'; // New ID for the body-appended overlay
        profileLoadingOverlayElement.className = 'vespa-profile-loader-overlay'; // Use existing overlay styles
        profileLoadingOverlayElement.innerHTML = `
            <div class="profile-loading-spinner"></div>
            <div class="profile-loading-text">loading academic profile...</div>
        `;
        document.body.appendChild(profileLoadingOverlayElement);
    }
    profileLoadingOverlayElement.classList.add('visible');
    debugLog("Full page profile loading overlay displayed via showLoadingIndicator");
  }

  // NEW: Hide the profile loading overlay
  function hideLoadingIndicator() {
    document.body.classList.remove('report-profile-loading'); // General state indicator

    if (profileLoadingOverlayElement) {
        profileLoadingOverlayElement.classList.remove('visible');
        // Optional: To clean up the DOM if the overlay is not frequently re-shown immediately.
        // If it's toggled rapidly, keeping the element might be slightly more performant.
        // if (profileLoadingOverlayElement.parentNode) {
        //     document.body.removeChild(profileLoadingOverlayElement);
        // }
        // profileLoadingOverlayElement = null;
    }
    debugLog("Full page profile loading overlay hidden via hideLoadingIndicator");
  }

  // NEW: Show a saving overlay
  function showSavingOverlay() {
    let savingOverlay = document.getElementById('report-profile-saving-overlay');
    if (!savingOverlay) {
      savingOverlay = document.createElement('div');
      savingOverlay.id = 'report-profile-saving-overlay';
      savingOverlay.className = 'vespa-profile-loader-overlay visible'; // Initially visible
      savingOverlay.innerHTML = `
        <div class="profile-loading-spinner"></div>
        <div class="profile-loading-text">Saving changes...</div>
      `;
      document.body.appendChild(savingOverlay); // Append to body for full page overlay
    } else {
      savingOverlay.classList.add('visible');
    }
    document.body.classList.add('report-profile-saving');
    debugLog("Saving overlay displayed");
  }

  // NEW: Hide the saving overlay
  function hideSavingOverlay() {
    const savingOverlay = document.getElementById('report-profile-saving-overlay');
    if (savingOverlay) {
      savingOverlay.classList.remove('visible');
    }
    document.body.classList.remove('report-profile-saving');
    debugLog("Saving overlay hidden");
  }

  // Helper function to manage API requests with throttling
  async function makeRequest(url, options, cacheKey) {
    // Check if we should throttle this request
    const resourceType = url.split('/')[5] || url; // Extract resource type from URL for throttling
    const now = Date.now();
    const lastRequestTime = lastRequestTimes[resourceType] || 0;
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < API_COOLDOWN) {
      // We need to wait before making this request
      const waitTime = API_COOLDOWN - timeSinceLastRequest;
      debugLog(`Throttling request to ${resourceType} - waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update the last request time for this resource
    lastRequestTimes[resourceType] = Date.now();
    
    // Create a request key to track this specific request
    const requestKey = cacheKey || `${url}_${Date.now()}`;
    
    try {
      // Make the actual request
      const jqXHR = $.ajax({
        url: url,
        ...options,
        // Add an abort handler
        beforeSend: function(jqXHR) {
          activeRequests[requestKey] = jqXHR;
        }
      });
      
      // Wait for the request to complete
      const response = await jqXHR;
      
      // Remove from active requests
      delete activeRequests[requestKey];
      
      return response;
    } catch (error) {
      // Remove from active requests
      delete activeRequests[requestKey];
      
      // Handle rate limiting with exponential backoff
      if (error.status === 429) {
        debugLog(`Rate limited on ${resourceType}, implementing backoff`);
        // Increase the cooldown for this resource type
        const currentCooldown = lastRequestTimes[`${resourceType}_cooldown`] || API_COOLDOWN;
        const newCooldown = Math.min(currentCooldown * 2, 10000); // Max 10 second cooldown
        lastRequestTimes[`${resourceType}_cooldown`] = newCooldown;
        
        // Wait for the new cooldown period
        await new Promise(resolve => setTimeout(resolve, newCooldown));
        
        // Retry the request once (note: in a production environment, you might want a more robust retry mechanism)
        debugLog(`Retrying request to ${resourceType} after backoff`);
        return makeRequest(url, options, cacheKey);
      }
      
      // Re-throw the error for other error types
      throw error;
    }
  }

  async function processStudentProfileById(studentId, profileContainer) {
    try {
      // Show loading indicator immediately - now handled by handleReportChanges
      // showLoadingIndicator(profileContainer); // REMOVED - handleReportChanges calls global showLoadingIndicator()
      
      // Step 1: Get student record directly by ID
      debugLog(`Looking up student record with ID: ${studentId}`);
      
      const studentCacheKey = `student_${studentId}`;
      let studentRecord = null;
      
      // Check cache for student record
      if (profileCache[studentCacheKey] && (Date.now() - profileCache[studentCacheKey].timestamp < CACHE_TTL)) {
        studentRecord = profileCache[studentCacheKey].data;
        debugLog(`Using cached student record for ID: ${studentId}`);
      } else {
        studentRecord = await makeRequest(
          `${KNACK_API_URL}/objects/object_6/records/${studentId}`,
          {
            type: 'GET',
            headers: getKnackHeaders(),
            data: { format: 'raw' }
          },
          `student_get_${studentId}`
        );
        
        if (studentRecord && studentRecord.id) {
          // Cache the student record
          profileCache[studentCacheKey] = {
            data: studentRecord,
            timestamp: Date.now()
          };
        } else {
          console.error(`[ReportProfiles] Could not find student record with ID: ${studentId}`);
          return;
        }
      }
      
      // Step 2: Get student email and name - handling the complex object structure
      let studentEmail = '';
      if (studentRecord.field_91 && typeof studentRecord.field_91 === 'object') {
        studentEmail = studentRecord.field_91.email || studentRecord.field_91.label || '';
      } else {
        studentEmail = studentRecord.field_91 || '';
      }
      
      let studentName = '';
      if (studentRecord.field_90 && typeof studentRecord.field_90 === 'object') {
        studentName = studentRecord.field_90.full || 
                     (studentRecord.field_90.first + ' ' + studentRecord.field_90.last).trim() || '';
      } else {
        studentName = studentRecord.field_47 || '';
      }
      
      debugLog(`Found student record: ${studentName} (${studentEmail})`);
      
      // Step 3: Find profile using student email or name
      const profileIdCacheKey = `profile_id_${studentId}`; // Standardized cache key
      const profileNameCacheKey = studentName ? `profile_name_${studentName}` : null;
      let profileRecord = null;
      
      // Check cache for profile record (try ID first, then name if available)
      if (profileCache[profileIdCacheKey] && (Date.now() - profileCache[profileIdCacheKey].timestamp < CACHE_TTL)) {
        profileRecord = profileCache[profileIdCacheKey].data;
        debugLog(`Using cached profile for student ID: ${studentId} via key ${profileIdCacheKey}`);
      } else if (profileNameCacheKey && profileCache[profileNameCacheKey] && (Date.now() - profileCache[profileNameCacheKey].timestamp < CACHE_TTL)) {
        profileRecord = profileCache[profileNameCacheKey].data;
        debugLog(`Using cached profile for student name: ${studentName} via key ${profileNameCacheKey} (fallback in processStudentProfileById)`);
      } else {
        // First try to get profile by direct student ID connection
        profileRecord = await findProfileByStudentId(studentId);
        
        // If not found by ID, try finding a profile by any method available
        if (!profileRecord) {
          // Try finding a profile using the email
          if (studentEmail) {
            profileRecord = await findProfileUsingEmail(studentEmail);
          }
          
          // If still not found, try finding a profile by the student name
          if (!profileRecord && studentName) {
            profileRecord = await findProfileByStudentName(studentName);
          }
          
          // Last resort: If no profile is found, create a simple temporary profile from the student record
          if (!profileRecord) {
            debugLog(`No profile found for student ID ${studentId} - creating a temporary profile display`);
            
            // Create a minimal profile with just the data from the student record
            profileRecord = {
              [FIELD_MAPPING.studentName]: studentName,
              [FIELD_MAPPING.yearGroup]: studentRecord.field_548 || '',
              [FIELD_MAPPING.tutorGroup]: studentRecord.field_565 || '',
              [FIELD_MAPPING.attendance]: studentRecord.field_3139 || '',
              // Add the student's school if available
              [FIELD_MAPPING.vespaCustomer]: studentRecord.field_179 || 
                                           (studentRecord.field_122 ? { name: studentRecord.field_122 } : '')
            };
          }
        }
        
        // Cache the profile
        if (profileRecord) {
          profileCache[profileIdCacheKey] = { // Standardized cache key
            data: profileRecord,
            timestamp: Date.now()
          };
          debugLog(`Cached profile for student ID ${studentId} under key ${profileIdCacheKey}`);
          
          // Also cache by name for future lookups, if name is available
          if (profileNameCacheKey) {
            profileCache[profileNameCacheKey] = { // Standardized cache key
              data: profileRecord,
              timestamp: Date.now()
            };
            debugLog(`Also cached profile for student name ${studentName} under key ${profileNameCacheKey}`);
          }
        }
      }
      
      // Check if we actually have meaningful profile data before rendering
      const hasProfileData = profileRecord && (
        profileRecord[FIELD_MAPPING.studentName] || 
        profileRecord[FIELD_MAPPING.yearGroup] || 
        profileRecord[FIELD_MAPPING.tutorGroup]
      );
      
      if (hasProfileData) {
        // Step 4: Render the profile
        renderStudentProfile(profileRecord, profileContainer);
      } else {
        debugLog(`No valid profile data found for student ID: ${studentId} (${studentName})`);
        // Ensure the view is cleared if no data is found
        clearProfileView(profileContainer);
      }
    } catch (error) {
      console.error('[ReportProfiles] Error processing student profile by ID:', error);
      hideLoadingIndicator(); // Ensure overlay is hidden on error
    }
  }

  // Legacy function - updated with request management
  async function processStudentProfile(studentName, profileContainer) {
    try {
      // Show loading indicator immediately - now handled by handleReportChanges
      // showLoadingIndicator(profileContainer); // REMOVED - handleReportChanges calls global showLoadingIndicator()
      
      // Step 1: Find student record by name to get email
      debugLog(`Looking up student record for: ${studentName}`);
      
      const nameCacheKey = `student_name_${studentName}`;
      let studentRecord = null;
      
      // Check cache for student record
      if (profileCache[nameCacheKey] && (Date.now() - profileCache[nameCacheKey].timestamp < CACHE_TTL)) {
        studentRecord = profileCache[nameCacheKey].data;
        debugLog(`Using cached student record for name: ${studentName}`);
      } else {
        studentRecord = await findStudentRecordByName(studentName);
        
        if (studentRecord) {
          // Cache the student record
          profileCache[nameCacheKey] = {
            data: studentRecord,
            timestamp: Date.now()
          };
        } else {
          console.error(`[ReportProfiles] Could not find student record for: ${studentName}`);
          return;
        }
      }
      
      // Step 2: Get student email
      const studentEmail = studentRecord.field_91 || '';
      debugLog(`Found student email: ${studentEmail}`);
      
      // Step 3: Get profile data using the email or name
      const profileNameCacheKey = `profile_name_${studentName}`; // Standardized cache key
      let profileRecord = null;
      
      // Check cache for profile record
      if (profileCache[profileNameCacheKey] && (Date.now() - profileCache[profileNameCacheKey].timestamp < CACHE_TTL)) {
        profileRecord = profileCache[profileNameCacheKey].data;
        debugLog(`Using cached profile for student name: ${studentName}`);
      } else {
        profileRecord = await findProfileUsingEmail(studentEmail);
        
        if (!profileRecord) {
          profileRecord = await findProfileByStudentName(studentName);
        }
        
        if (profileRecord) {
          // Cache the profile
          profileCache[profileNameCacheKey] = { // Standardized cache key
            data: profileRecord,
            timestamp: Date.now()
          };
        }
      }
      
      if (profileRecord) {
        // Step 4: Render the profile
        renderStudentProfile(profileRecord, profileContainer);
      } else {
        debugLog(`No profile found for student: ${studentName} (${studentEmail})`);
        clearProfileView(profileContainer);
      }
    } catch (error) {
      console.error('[ReportProfiles] Error processing student profile:', error);
      hideLoadingIndicator(); // Ensure overlay is hidden on error
    }
  }

  // Get a student record directly by ID
  async function getStudentRecordById(studentId) {
    if (!studentId) return null;
    
    try {
      const response = await makeRequest(
        `${KNACK_API_URL}/objects/object_6/records/${studentId}`,
        {
          type: 'GET',
          headers: getKnackHeaders(),
          data: { format: 'raw' }
        },
        `student_get_${studentId}`
      );
      
      if (response && response.id) {
        debugLog(`Found student record with ID ${studentId}:`, response);
        return response;
      }
      
      debugLog(`No student record found with ID: ${studentId}`);
      return null;
    } catch (error) {
      console.error(`[ReportProfiles] Error finding student record with ID ${studentId}:`, error);
      return null;
    }
  }

  // Find a profile linked to a student ID via connection field
  async function findProfileByStudentId(studentId) {
    if (!studentId) return null;
    
    try {
      // Look for profiles where the student connection field matches the ID
      const profileFilters = encodeURIComponent(JSON.stringify({
        match: 'or',
        rules: [
          // Try various connection field possibilities
          { field: 'field_3070', operator: 'is', value: studentId },  // User account connection
          { field: 'field_3064', operator: 'is', value: studentId }   // User ID field
        ]
      }));
      
      const response = await makeRequest(
        `${KNACK_API_URL}/objects/${HOMEPAGE_OBJECT}/records?filters=${profileFilters}`,
        {
          type: 'GET',
          headers: getKnackHeaders(),
          data: { format: 'raw' }
        },
        `profile_find_${studentId}`
      );
      
      if (response && response.records && response.records.length > 0) {
        debugLog(`Found profile record using student ID ${studentId}:`, response.records[0]);
        return response.records[0];
      }
      
      debugLog(`No profile record found directly linked to student ID: ${studentId}`);
      return null;
    } catch (error) {
      console.error(`[ReportProfiles] Error finding profile for student ID ${studentId}:`, error);
      return null;
    }
  }

  // Helper to get standard Knack API headers
  function getKnackHeaders() {
    // Fallback to using Knack's global application ID
    const knackAppId = Knack.application_id;
    // Use our known API key
    const knackApiKey = '8f733aa5-dd35-4464-8348-64824d1f5f0d';
    
    if (typeof Knack === 'undefined' || typeof Knack.getUserToken !== 'function') {
      console.error("[ReportProfiles] Knack object or getUserToken function not available.");
      throw new Error("Knack authentication context not available.");
    }
    
    const token = Knack.getUserToken();
    if (!token) {
      console.warn("[ReportProfiles] Knack user token is null or undefined. API calls may fail.");
    }
    
    const headers = {
      'X-Knack-Application-Id': knackAppId,
      'X-Knack-REST-API-Key': knackApiKey,
      'Authorization': token || '',
      'Content-Type': 'application/json'
    };
    
    return headers;
  }

  // Find a student record by name
  async function findStudentRecordByName(studentName) {
    if (!studentName) return null;
    
    // Create filters to search by name (field_47 is the name field in object_6)
    const filters = encodeURIComponent(JSON.stringify({
      match: 'or',
      rules: [
        { field: 'field_47', operator: 'is', value: studentName },
        { field: 'field_47', operator: 'contains', value: studentName }
      ]
    }));
    
    try {
      const response = await makeRequest(
        `${KNACK_API_URL}/objects/object_6/records?filters=${filters}`,
        {
          type: 'GET',
          headers: getKnackHeaders(),
          data: { format: 'raw' }
        },
        `student_name_${studentName}`
      );
      
      if (response && response.records && response.records.length > 0) {
        debugLog(`Found student record for ${studentName}:`, response.records[0]);
        return response.records[0];
      }
      
      debugLog(`No student record found for ${studentName}`);
      return null;
    } catch (error) {
      console.error(`[ReportProfiles] Error finding student record for ${studentName}:`, error);
      return null;
    }
  }

  // Find a profile record using the student's name
  async function findProfileByStudentName(studentName) {
    if (!studentName) return null;
    
    debugLog(`Looking for profile with student name: ${studentName}`);
    
    try {
      // Try to find the profile directly using the student name field
      const profileFilters = encodeURIComponent(JSON.stringify({
        match: 'or',
        rules: [
          { field: 'field_3066', operator: 'is', value: studentName },
          { field: 'field_3066', operator: 'contains', value: studentName }
        ]
      }));
      
      const response = await makeRequest(
        `${KNACK_API_URL}/objects/${HOMEPAGE_OBJECT}/records?filters=${profileFilters}`,
        {
          type: 'GET',
          headers: getKnackHeaders(),
          data: { format: 'raw' }
        },
        `profile_name_${studentName}`
      );
      
      if (response && response.records && response.records.length > 0) {
        debugLog(`Found profile record using student name ${studentName}:`, response.records[0]);
        return response.records[0];
      }
      
      debugLog(`No profile found with exact name match. Trying partial match...`);
      return null;
    } catch (error) {
      console.error(`[ReportProfiles] Error finding profile for student name ${studentName}:`, error);
      return null;
    }
  }

  // Find a profile record using the student's email
  async function findProfileUsingEmail(email) {
    if (!email) return null;
    
    debugLog(`Looking for profile with email: ${email}`);
    
    try {
      // First, find the student record by email
      const studentEmailFilters = encodeURIComponent(JSON.stringify({
        match: 'or',
        rules: [
          { field: 'field_91', operator: 'is', value: email },
          { field: 'field_91', operator: 'contains', value: email }
        ]
      }));
      
      // Step 1: Find the student record using email
      const studentRecordResponse = await makeRequest(
        `${KNACK_API_URL}/objects/object_6/records?filters=${studentEmailFilters}`,
        {
          type: 'GET',
          headers: getKnackHeaders(),
          data: { format: 'raw' }
        },
        `student_email_${email}`
      );
      
      // Extract student ID and name if found
      let studentId = null;
      let studentName = null;
      
      if (studentRecordResponse?.records?.length > 0) {
        const studentRecord = studentRecordResponse.records[0];
        studentId = studentRecord.id;
        studentName = studentRecord.field_47; // Student name field
        debugLog(`Found student record by email: ID=${studentId}, Name=${studentName}`);
      
        // Step 2: Now look for profile matching this student
        if (studentId || studentName) {
          const rules = [];
          
          if (studentId) {
            rules.push({ field: 'field_3064', operator: 'is', value: studentId });
            rules.push({ field: 'field_3070', operator: 'is', value: studentId });
          }
          
          if (studentName) {
            rules.push({ field: 'field_3066', operator: 'is', value: studentName });
          }
          
          const profileFilters = encodeURIComponent(JSON.stringify({
            match: 'or',
            rules: rules
          }));
          
          const profileResponse = await makeRequest(
            `${KNACK_API_URL}/objects/${HOMEPAGE_OBJECT}/records?filters=${profileFilters}`,
            {
              type: 'GET',
              headers: getKnackHeaders(),
              data: { format: 'raw' }
            },
            `profile_email_${email}`
          );
          
          if (profileResponse?.records?.length > 0) {
            debugLog(`Found profile record for student: ${studentName}`, profileResponse.records[0]);
            return profileResponse.records[0];
          }
        }
      }
      
      debugLog(`No profile record found for ${email} after all attempts.`);
      return null;
    } catch (error) {
      console.error(`[ReportProfiles] Error finding profile for ${email}:`, error);
      return null;
    }
  }

  // Safely remove HTML from strings
  function sanitizeField(value) {
    if (value === null || value === undefined) return "";
    const strValue = String(value);
    let sanitized = strValue.replace(/<[^>]*?>/g, "");
    sanitized = sanitized.replace(/[_~`#]/g, ""); // REMOVED asterisk from this regex
    sanitized = sanitized
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
    return sanitized.trim();
  }

  // NEW HELPER: Format number as percentage string (consistent with homepage)
  function formatAsPercentage(value) {
    if (value === null || value === undefined || String(value).trim() === '' || String(value).trim().toLowerCase() === 'n/a') return 'N/A';
    const num = parseFloat(String(value));
    if (isNaN(num)) {
      return sanitizeField(String(value));
    }
    return `${Math.round(num * 100)}%`;
  }

  // Safe JSON parsing function
  function safeParseJSON(jsonString, defaultVal = null) {
    if (!jsonString) return defaultVal;
    try {
      // If it's already an object, return it directly
      if (typeof jsonString === 'object' && jsonString !== null) return jsonString;
      return JSON.parse(jsonString);
    } catch (error) {
      // console.warn("[ReportProfiles] JSON parse failed:", error, "String:", String(jsonString).substring(0, 100));
      debugLog("[ReportProfiles] JSON parse failed", { error: error.message, stringSample: String(jsonString).substring(0,100) });
      try {
        const cleanedString = String(jsonString).trim().replace(/^\uFEFF/, '');
        const recovered = cleanedString
          .replace(/\\"/g, '"')
          .replace(/,\s*([}\]])/g, '$1');
        const result = JSON.parse(recovered);
        // console.log("[ReportProfiles] JSON recovery successful.");
        debugLog("[ReportProfiles] JSON recovery successful", result);
        return result;
      } catch (secondError) {
        // console.error("[ReportProfiles] JSON recovery failed:", secondError);
        debugLog("[ReportProfiles] JSON recovery failed", { error: secondError.message });
        return defaultVal;
      }
    }
  }

  // Helper function to compare grades and return appropriate CSS class
  function getGradeColorClass(grade, minExpected) {
    if (!grade || !minExpected || grade === 'N/A' || minExpected === 'N/A') {
      return '';
    }
    
    const gradeStr = String(grade);
    const minExpectedStr = String(minExpected);

    const gradeOrder = ['A*', 'A', 'B', 'C', 'D', 'E', 'U'];
    const gradeVal = gradeOrder.indexOf(gradeStr.toUpperCase());
    const minExpectedVal = gradeOrder.indexOf(minExpectedStr.toUpperCase());

    if (gradeVal !== -1 && minExpectedVal !== -1) { // A-Level style grades
      if (gradeVal < minExpectedVal) { // Grade is better than expected
        return (minExpectedVal - gradeVal >= 2) ? 'grade-significantly-above' : 'grade-above';
      }
      if (gradeVal === minExpectedVal) return 'grade-matching';
      // Grade is below expected
      if (gradeVal - minExpectedVal === 1) return 'grade-one-below';
      if (gradeVal - minExpectedVal === 2) return 'grade-two-below';
      if (gradeVal - minExpectedVal >= 3) return 'grade-far-below';
      return ''; // Should not be reached if logic is correct
    }

    const numGrade = parseFloat(gradeStr);
    const numMinExpected = parseFloat(minExpectedStr);

    if (!isNaN(numGrade) && !isNaN(numMinExpected)) { // GCSE/Numerical grades
      const diff = numGrade - numMinExpected;
      if (diff >= 2) return 'grade-significantly-above';
      if (diff === 1) return 'grade-above';
      if (diff === 0) return 'grade-matching';
      if (diff === -1) return 'grade-one-below';
      if (diff === -2) return 'grade-two-below';
      if (diff <= -3) return 'grade-far-below';
      return ''; // Should not be reached
    }
    
    return ''; // Default no class if no specific logic matches
  }

  // NEW function to handle MASTER edit/save mode for the entire profile
  async function toggleMasterEditMode() {
    if (!isEditableByStaff()) return;

    const profileContainer = document.querySelector('#view_3015 .kn-rich_text__content');
    if (!profileContainer) {
      console.error("[ReportProfiles] Profile container not found for master edit toggle.");
      return;
    }
    const masterIcon = profileContainer.querySelector('.master-edit-icon'); 

    if (isProfileInEditMode) {
      // --- CURRENTLY IN EDIT MODE, SO SAVE ALL --- 
      // Icon change is now handled by re-render after save ensures correct state display
      debugLog("Attempting to SAVE ALL grade changes.");
      if(masterIcon) masterIcon.innerHTML = '💾 Saving...'; // Unicode for floppy disk
      showSavingOverlay(); // Show saving overlay

      // Update overlay text for the first major step
      const savingOverlayTextElement = document.getElementById('report-profile-saving-overlay')?.querySelector('.profile-loading-text');
      if (savingOverlayTextElement) savingOverlayTextElement.textContent = 'Saving subject details (1/2)...';

      const gradeInputs = Array.from(profileContainer.querySelectorAll('input.grade-input-dynamic'));
      const optionalGradeInputs = Array.from(profileContainer.querySelectorAll('input.optional-grade-input'));
      const allInputs = [...gradeInputs, ...optionalGradeInputs]; // Combine both types of inputs

      debugLog(`Found ${gradeInputs.length} main grade inputs and ${optionalGradeInputs.length} optional grade inputs. Total: ${allInputs.length}`);
      const updatePromises = [];
      const changesToCache = [];

      // Determine the correct cache key for the current profile before input check
      let activeProfileCacheKey;
      if (currentStudentId.startsWith("USE_NAME:")) {
          activeProfileCacheKey = `profile_name_${currentStudentId.substr(9)}`;
      } else {
          activeProfileCacheKey = `profile_id_${currentStudentId}`;
      }
      debugLog("Active profile cache key for save/update:", activeProfileCacheKey);

      // Removed: Detailed logging of cache field BEFORE update loop
      // if (profileCache[activeProfileCacheKey] && profileCache[activeProfileCacheKey].data) {
      //   const sampleFieldIdBefore = FIELD_MAPPING.sub1;
      //   debugLog("[toggleMasterEditMode] Value of cache field", sampleFieldIdBefore, "BEFORE update loop:", profileCache[activeProfileCacheKey].data[sampleFieldIdBefore]);
      // }

      if (allInputs.length === 0) {
          debugLog("No input fields found. Aborting save all.");
          isProfileInEditMode = false; // Ensure mode is reset
          lastRenderedProfileHash = null; // Force re-render to reflect mode change
          // Re-render to show text and correct icon, even if no changes
          if (profileCache[activeProfileCacheKey] && profileCache[activeProfileCacheKey].data) {
              renderStudentProfile(profileCache[activeProfileCacheKey].data, profileContainer);
          } else {
              // If cache is somehow gone, try to force a re-fetch in display mode.
              // lastRenderedProfileHash = null; // Already set above
              processStudentProfileById(currentStudentId, profileContainer); 
          }
          showTemporaryMessage("No editable fields were found or no changes made.", 'info');
          hideSavingOverlay(); // Hide overlay regardless of success or failure here
          return; // Exit save process
      }

      // Proceed with saving if inputs were found
      allInputs.forEach(input => { // Iterate over allInputs
          const originalRecordId = input.dataset.originalRecordId;
          const fieldId = input.dataset.fieldId;
          let newValue = input.value.trim();

          // Special handling for attendance percentage
          if (fieldId === 'field_3186') { // Subject Attendance field ID
            const numValue = parseFloat(newValue);
            if (!isNaN(numValue)) {
              newValue = (numValue / 100).toString(); // Convert to decimal string, e.g., "89" -> "0.89"
            } else {
              newValue = ''; // Or handle as an error / N/A if input is not a valid number
            }
          }

          debugLog(`Processing input for save: oRID=${originalRecordId}, fID=${fieldId}, newVal=${newValue}`);
          if (originalRecordId && fieldId) {
              updatePromises.push(
              updateSubjectGradeInObject113(originalRecordId, fieldId, newValue)
                  .then(success => {
                  if (success) {
                      debugLog(`Successfully saved: oRID=${originalRecordId}, fID=${fieldId}, Val=${newValue}`);
                      changesToCache.push({ originalRecordId, fieldId, newValue });
                  } else {
                      debugLog(`Failed to save: oRID=${originalRecordId}, fID=${fieldId}`);
                  }
                  return success;
                  })
              );
          }
      });
      isProfileInEditMode = false; // Switch mode before async operations that might re-render

      try {
        const results = await Promise.all(updatePromises);
        const allSucceeded = results.every(res => res === true);
        let saveMessage = '';
        let messageType = 'info';

        // Determine the correct cache key for the current profile
        let activeProfileCacheKey;
        if (currentStudentId.startsWith("USE_NAME:")) {
            activeProfileCacheKey = `profile_name_${currentStudentId.substr(9)}`;
        } else {
            activeProfileCacheKey = `profile_id_${currentStudentId}`;
        }
        debugLog("Active profile cache key for save/update:", activeProfileCacheKey);


        if (allInputs.length === 0) {
          saveMessage = "No editable fields were found or no changes made."; // Updated message
          debugLog(saveMessage);
        } else if (allSucceeded) {
          saveMessage = "All grades saved successfully to subject records!";
          messageType = 'success';
          debugLog(saveMessage);
          
          // Update the local cache with successfully saved changes
          if (profileCache[activeProfileCacheKey] && profileCache[activeProfileCacheKey].data) {
            const profileToUpdateInCache = profileCache[activeProfileCacheKey].data;
            changesToCache.forEach(change => {
              for (let i = 1; i <= 15; i++) {
                const fieldKey = `sub${i}`;
                const subjectFieldIdInProfile = FIELD_MAPPING[fieldKey];
                if (profileToUpdateInCache[subjectFieldIdInProfile]) { 
                  let subject = safeParseJSON(profileToUpdateInCache[subjectFieldIdInProfile]); 
                  if (subject && subject.originalRecordId === change.originalRecordId) { 
                    if (change.fieldId === 'field_3132') subject.currentGrade = change.newValue;
                    if (change.fieldId === 'field_3135') subject.targetGrade = change.newValue;
                    if (change.fieldId === 'field_3133') subject.effortGrade = change.newValue;
                    if (change.fieldId === 'field_3134') subject.behaviourGrade = change.newValue;
                    if (change.fieldId === 'field_3186') subject.subjectAttendance = change.newValue;
                    
                    profileToUpdateInCache[subjectFieldIdInProfile] = JSON.stringify(subject); 
                    debugLog(`[toggleMasterEditMode] Cache updated for oRID ${change.originalRecordId}, field ${change.fieldId} in ${subjectFieldIdInProfile} with new value ${change.newValue}`);
                    break;
                  }
                }
              }
            });
            debugLog("Profile cache updated with all changes.");

            // ---- NEW: Update Object_112 (Homepage Profile) ----
            const mainProfileRecordId = profileToUpdateInCache.id; // ID of the object_112 record
            if (mainProfileRecordId) {
              debugLog(`Attempting to update main profile (object_112) record ID: ${mainProfileRecordId}`);
              if (savingOverlayTextElement) savingOverlayTextElement.textContent = 'Updating student summary (2/2)...';

              const dataToUpdateInObject112 = {};
              let hasSubjectFieldsToUpdate = false;
              for (let i = 1; i <= 15; i++) {
                const fieldKey = `sub${i}`;
                const subjectFieldKnackId = FIELD_MAPPING[fieldKey];
                if (profileToUpdateInCache.hasOwnProperty(subjectFieldKnackId)) {
                  // Ensure we are sending the stringified JSON back
                  dataToUpdateInObject112[subjectFieldKnackId] = 
                    (typeof profileToUpdateInCache[subjectFieldKnackId] === 'string') 
                    ? profileToUpdateInCache[subjectFieldKnackId] 
                    : JSON.stringify(profileToUpdateInCache[subjectFieldKnackId]);
                  hasSubjectFieldsToUpdate = true;
                }
              }

              if (hasSubjectFieldsToUpdate) {
                try {
                  await makeRequest(
                    `${KNACK_API_URL}/objects/${HOMEPAGE_OBJECT}/records/${mainProfileRecordId}`,
                    {
                      type: 'PUT',
                      headers: getKnackHeaders(),
                      data: JSON.stringify(dataToUpdateInObject112),
                      contentType: 'application/json',
                    },
                    `update_object112_${mainProfileRecordId}`
                  );
                  debugLog(`Successfully updated main profile (object_112) record ID: ${mainProfileRecordId} with new subject JSONs.`);
                  saveMessage += " Main profile updated.";
                  if (savingOverlayTextElement) savingOverlayTextElement.textContent = 'Finalizing...'; // Brief message before hide
                } catch (obj112Error) {
                  console.error(`[ReportProfiles] Error updating main profile (object_112) record ID ${mainProfileRecordId}:`, obj112Error);
                  debugLog(`[ReportProfiles] Error updating main profile (object_112) record ID ${mainProfileRecordId}`, { error: obj112Error.message, responseText: obj112Error.responseText });
                  saveMessage += " Failed to update main profile.";
                  messageType = 'warning'; // Downgrade to warning as subject records were saved
                }
              } else {
                debugLog("No subject fields found in cached profile to update in object_112.");
              }
            } else {
              console.warn("[ReportProfiles] Cannot update object_112: Main profile record ID (profileData.id) is missing from cache.");
              debugLog("[ReportProfiles] Cannot update object_112: Main profile record ID (profileData.id) is missing from cache.");
              saveMessage += " Main profile ID missing, cannot update.";
              messageType = 'warning';
            }
            // ---- END NEW: Update Object_112 ----
          }
        } else {
          const failedCount = results.filter(r => r === false).length;
          saveMessage = `Error: ${failedCount} grade(s) failed to save to subject records. Please check console.`;
          messageType = 'error';
          debugLog("[ReportProfiles] One or more grade updates failed.", results);
        }
        
        // Always re-render from cache or re-fetch to reflect the latest state.
        // lastRenderedProfileHash should be null to force this re-render after saves or failures.
        lastRenderedProfileHash = null; 
        if (profileCache[activeProfileCacheKey] && profileCache[activeProfileCacheKey].data) {
          renderStudentProfile(profileCache[activeProfileCacheKey].data, profileContainer);
          debugLog("Master save complete: UI updated. LastRenderedProfileHash reset to force refresh.");
        } else {
          debugLog("Cache missing unexpectedly after save (key:", activeProfileCacheKey,"), forcing re-fetch. Current student ID:", currentStudentId);
          await processStudentProfileById(currentStudentId, profileContainer);
        }
        hideSavingOverlay(); // Hide overlay regardless of success or failure here
        showTemporaryMessage(saveMessage, messageType);

      } catch (error) {
        // console.error("[ReportProfiles] Error during Promise.all for grade updates:", error);
        debugLog("[ReportProfiles] Error during Promise.all for grade updates", { error: error.message, stack: error.stack });
        // Attempt to re-render in display mode even after a critical error
        isProfileInEditMode = false; // Ensure we are out of edit mode
        hideSavingOverlay(); // Hide overlay on critical error too
        if (profileCache[currentStudentId] && profileCache[currentStudentId].data) {
          renderStudentProfile(profileCache[currentStudentId].data, profileContainer);
        } else {
          lastRenderedProfileHash = null;
          await processStudentProfileById(currentStudentId, profileContainer); // Re-fetch if cache empty
        }
        showTemporaryMessage("A critical error occurred during save.", 'error');
      }

    } else {
      // --- CURRENTLY IN DISPLAY MODE, SO SWITCH TO EDIT ALL --- 
      isProfileInEditMode = true;
      debugLog("Switching to EDIT ALL grades mode.");
      // Re-render the profile; renderStudentProfile will now create inputs
      // Ensure we use existing data if possible to avoid unnecessary fetches just for mode switch
      isProfileInEditMode = true; // Set mode first
      lastRenderedProfileHash = null; // FORCE re-render for mode switch

      // Determine the correct cache key for the current profile
      let activeProfileCacheKeyForEdit;
      if (currentStudentId.startsWith("USE_NAME:")) {
          activeProfileCacheKeyForEdit = `profile_name_${currentStudentId.substr(9)}`;
      } else {
          activeProfileCacheKeyForEdit = `profile_id_${currentStudentId}`;
      }
      debugLog("Active profile cache key for switching to edit mode:", activeProfileCacheKeyForEdit);

      if (profileCache[activeProfileCacheKeyForEdit] && profileCache[activeProfileCacheKeyForEdit].data) { // Removed lastRenderedProfileHash check here as we force re-render
          debugLog("Using cached data to switch to master edit mode via key:", activeProfileCacheKeyForEdit);
          renderStudentProfile(profileCache[activeProfileCacheKeyForEdit].data, profileContainer);
      } else {
        // This case should be rare if profile is already loaded, but as a fallback, 
        // or if profile wasn't fully rendered before (lastRenderedProfileHash is null)
        debugLog("Cache/hash miss or forcing re-fetch for master edit mode. Key:", activeProfileCacheKeyForEdit);
        // lastRenderedProfileHash is already null, ensuring re-fetch/re-render
        // We need to ensure isProfileInEditMode is true BEFORE processStudentProfileById might call renderStudentProfile
        await processStudentProfileById(currentStudentId, profileContainer); 
      }

      // After attempting to render in edit mode, check if any inputs were actually created
      // Need a slight delay for the DOM to update from renderStudentProfile's timeout
      setTimeout(() => {
        const anyInputsRendered = profileContainer.querySelector('input.grade-input-dynamic, input.optional-grade-input');
        if (!anyInputsRendered) {
            debugLog("Switched to Edit Mode, but no editable fields were rendered (likely due to missing originalRecordIds). Reverting to display mode.");
            isProfileInEditMode = false; // Revert
            lastRenderedProfileHash = null; // Force re-render
            if (profileCache[activeProfileCacheKeyForEdit] && profileCache[activeProfileCacheKeyForEdit].data) {
                renderStudentProfile(profileCache[activeProfileCacheKeyForEdit].data, profileContainer);
            } else {
                // Fallback if cache is gone, should be rare
                processStudentProfileById(currentStudentId, profileContainer);
            }
            showTemporaryMessage("Editing not available: subject data incomplete.", 'warning');
        }
      }, 200); // Allow ample time for renderStudentProfile's inner timeout and DOM update
    }
  }

  // Helper function to re-render profile and optionally show a temporary message
  async function reRenderProfile(profileContainer, message = null, messageType = 'info') {
      debugLog(`Re-rendering profile. Message: ${message}`);
      if (profileCache[currentStudentId] && profileCache[currentStudentId].data) {
          renderStudentProfile(profileCache[currentStudentId].data, profileContainer);
      } else {
          lastRenderedProfileHash = null; // Force fetch if cache is missing
          await processStudentProfileById(currentStudentId, profileContainer);
      }
      if (message) {
          showTemporaryMessage(message, messageType);
      }
  }

  // Placeholder for a more sophisticated modal/messaging system
  function showTemporaryMessage(message, type = 'info') { // type can be 'success', 'error', 'info'
      let messageContainer = document.getElementById('report-profile-message-area');
      if (!messageContainer) {
          messageContainer = document.createElement('div');
          messageContainer.id = 'report-profile-message-area';
          // Style it to be noticeable, e.g., fixed or absolutely positioned overlay
          Object.assign(messageContainer.style, {
              position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
              padding: '10px 20px', backgroundColor: '#333', color: 'white',
              borderRadius: '5px', zIndex: '10001', boxShadow: '0 0 10px rgba(0,0,0,0.5)'
          });
          document.body.appendChild(messageContainer);
      }
      messageContainer.textContent = message;
      if (type === 'success') messageContainer.style.backgroundColor = '#28a745';
      else if (type === 'error') messageContainer.style.backgroundColor = '#dc3545';
      else messageContainer.style.backgroundColor = '#17a2b8'; // Info

      messageContainer.style.display = 'block';
      setTimeout(() => {
          messageContainer.style.display = 'none';
      }, 4000); // Hide after 4 seconds
  }

  function renderStudentProfile(profileData, profileContainer) {
    if (!profileData) {
      debugLog("Cannot render profile: No profile data provided");
      // document.body.classList.remove('report-profile-loading'); // REMOVED - hideLoadingIndicator will handle this
      hideLoadingIndicator();
      // Also ensure profile container is cleared if it was showing a loader
      if(profileContainer) profileContainer.innerHTML = '<div class="no-profile-data">No profile data available.</div>';
      return;
    }
    debugLog("renderStudentProfile called. isProfileInEditMode:", isProfileInEditMode); // Confirm isProfileInEditMode state
    
    if (!profileContainer) {
      debugLog("Cannot render profile: Container element not found");
      return;
    }
    
    // Ensure the container is truly accessible and part of the DOM
    if (!document.contains(profileContainer)) {
      debugLog("Container element is no longer in the DOM, attempting to find it again");
      // Try to find the container again
      const newContainer = document.querySelector('#view_3015 .kn-rich_text__content');
      if (newContainer) {
        profileContainer = newContainer;
        debugLog("Found new container reference");
      } else {
        debugLog("Could not find replacement container, cannot render profile");
        return;
      }
    }
    
    // Calculate a hash of the current profile data to avoid redundant renders
    const profileHash = hashProfileData(profileData);
    
    // Check if we're trying to render the exact same content
    if (profileHash === lastRenderedProfileHash) {
      debugLog(`Skipping render: Profile data hasn't changed (hash: ${profileHash})`);
      return;
    }
    
    // Update the DOM update flag to prevent observer reactions
    isUpdatingDOM = true;
    
    // Update our timestamp and hash tracking
    // lastRenderTime = Date.now(); // Not strictly needed with current hash logic
    lastRenderedProfileHash = profileHash;
    
    // Master edit/save icon logic
    let masterEditIconHTML = '';
    if (isEditableByStaff()) { // Only show master edit icon if staff can edit
      if (isProfileInEditMode) {
        masterEditIconHTML = `<span class="master-edit-icon save-icon" title="Save All Changes">\uD83D\uDCBE Save All</span>`; // Changed to Unicode escape
      } else {
        masterEditIconHTML = `<span class="master-edit-icon edit-icon" title="Edit All Grades">✏️ Edit Grades</span>`; // Changed to Unicode escape
      }
    }

    // Extract profile data
    const name = sanitizeField(profileData[FIELD_MAPPING.studentName]) || 'Student';
    
    // Handle school field (connection field)
    let schoolDisplay = 'N/A';
    if (profileData[FIELD_MAPPING.vespaCustomer]) {
      const schoolField = profileData[FIELD_MAPPING.vespaCustomer];
      
      if (typeof schoolField === 'object' && schoolField !== null) {
        // Extract school name from connection field
        if (schoolField.field_122_raw) {
          schoolDisplay = sanitizeField(schoolField.field_122_raw.identifier || 
                        schoolField.field_122_raw.name || 'VESPA ACADEMY');
        } else if (schoolField.text) {
          schoolDisplay = sanitizeField(schoolField.text);
        } else if (schoolField.identifier) {
          schoolDisplay = sanitizeField(schoolField.identifier);
        } else if (schoolField.name) {
          schoolDisplay = sanitizeField(schoolField.name);
        } else {
          schoolDisplay = "VESPA ACADEMY";
        }
      } else if (typeof schoolField === 'string') {
        schoolDisplay = sanitizeField(schoolField);
      }
    }
    
    const tutorGroup = sanitizeField(profileData[FIELD_MAPPING.tutorGroup]);
    const yearGroup = sanitizeField(profileData[FIELD_MAPPING.yearGroup]);
    const attendance = sanitizeField(profileData[FIELD_MAPPING.attendance]);
    
    // Parse subject data
    const subjectData = [];
    for (let i = 1; i <= 15; i++) {
      const fieldKey = `sub${i}`;
      const fieldId = FIELD_MAPPING[fieldKey];
      
      if (profileData[fieldId]) {
        try {
          const subject = safeParseJSON(profileData[fieldId]);
          if (subject && subject.subject) {
            // Ensure new optional fields are carried over or initialized
            subject.effortGrade = subject.effortGrade || '';
            subject.behaviourGrade = subject.behaviourGrade || '';
            subject.subjectAttendance = subject.subjectAttendance || '';
            subjectData.push(subject);
          }
        } catch (e) {
          // console.warn(`[ReportProfiles] Error parsing subject data for ${fieldKey}:`, e);
          debugLog(`[ReportProfiles] Error parsing subject data for ${fieldKey}`, { error: e.message });
        }
      }
    }
    
    // Render subjects
    let subjectsHTML = '';
    // const staffCanEdit = isEditableByStaff(); // Already checked for masterEditIconHTML, and used for isProfileInEditMode logic
    // debugLog("Staff can edit grades:", staffCanEdit);

    if (subjectData && subjectData.length > 0) {
      subjectData.forEach(subject => {
        const originalSubjectRecordId = subject.originalRecordId;
        if (!originalSubjectRecordId && isEditableByStaff()) {
          console.warn(`[ReportProfiles] Subject '${subject.subject}' is missing originalRecordId. Editing will not be possible for this subject.`);
          // ADDED DIAGNOSTIC LOGGING START
          let foundRawJsonForSubject = false;
          for (let k = 1; k <= 15; k++) {
            const checkFieldKey = `sub${k}`;
            const checkFieldId = FIELD_MAPPING[checkFieldKey];
            if (profileData[checkFieldId]) {
                let rawJsonString = profileData[checkFieldId];
                if (typeof rawJsonString === 'string') {
                    try {
                        const tempParsedSubject = safeParseJSON(rawJsonString);
                        // Check if this parsed object matches the 'subject' object from subjectData
                        // This check relies on subject.subject being a reasonably unique identifier here.
                        if (tempParsedSubject && tempParsedSubject.subject === subject.subject) {
                             debugLog(`[ReportProfiles] Raw JSON for subject '${subject.subject}' (from profile field ${checkFieldId}) which is missing originalRecordId:`, rawJsonString);
                             foundRawJsonForSubject = true;
                             break; 
                        }
                    } catch (parseError) {
                        // This specific rawJsonString might not be the one corresponding to the current 'subject' object,
                        // or it might be malformed. The main parsing loop for subjectData already logs general parsing errors.
                    }
                }
            }
          }
          if (!foundRawJsonForSubject) {
              debugLog(`[ReportProfiles] Could not find raw JSON in profileData corresponding to subject '${subject.subject}' to log its content, though originalRecordId is missing.`);
          }
          // ADDED DIAGNOSTIC LOGGING END
        }

        let qualTypeClass = '';
        const examType = (subject.examType || '').trim().toLowerCase(); // Normalize to lowercase

        // Map examType to a specific CSS class
        if (examType === 'a-level') {
          qualTypeClass = 'qual-a-level';
        } else if (examType === 'btec (2016)') {
          qualTypeClass = 'qual-btec-2016';
        } else if (examType === 'btec (2010)') {
          qualTypeClass = 'qual-btec-2010';
        } else if (examType === 'ib') {
          qualTypeClass = 'qual-ib';
        } else if (examType === 'pre-u') {
          qualTypeClass = 'qual-pre-u';
        } else if (examType === 'ual') {
          qualTypeClass = 'qual-ual';
        } else if (examType === 'wjec') {
          qualTypeClass = 'qual-wjec';
        } else if (examType === 'cache') {
          qualTypeClass = 'qual-cache';
        } else if (examType === 'gcse') {
          qualTypeClass = 'qual-gcse';
        } else if (examType === 'vocational') { // Fallback for generic vocational
          qualTypeClass = 'qual-vocational-generic';
        } else if (examType) { // Fallback for any other non-empty examType
          qualTypeClass = 'qual-' + examType.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }

        const currentGrade = sanitizeField(subject.currentGrade || 'N/A');
        const targetGrade = sanitizeField(subject.targetGrade || 'N/A');
        const megGrade = sanitizeField(subject.minimumExpectedGrade || 'N/A');
        const stgGrade = sanitizeField(subject.subjectTargetGrade || subject.minimumExpectedGrade || 'N/A');

        const currentGradeColorClass = getGradeColorClass(currentGrade, stgGrade);
        const targetGradeColorClass = getGradeColorClass(targetGrade, stgGrade);
        
        let currentGradeDisplay, targetGradeDisplay;

        // Current Grade Display
        if (isEditableByStaff() && isProfileInEditMode && originalSubjectRecordId) {
          currentGradeDisplay = `<div class="grade-value-display"><input type="text" class="grade-input-dynamic" value="${currentGrade === 'N/A' ? '' : subject.currentGrade}" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3132" placeholder="N/A"></div>`;
        } else {
          currentGradeDisplay = `<div class="grade-value-display"><span class="grade-text ${currentGradeColorClass}">${currentGrade}</span></div>`;
        }
        // Remove individual edit icon for current grade
        // if (isEditableByStaff() && originalSubjectRecordId) {
        //   currentGradeDisplay += `<span class="grade-edit-icon edit-icon" title="Edit Current Grade" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3132">✏️</span>`;
        // }

        // Target Grade Display
        if (isEditableByStaff() && isProfileInEditMode && originalSubjectRecordId) {
          targetGradeDisplay = `<div class="grade-value-display"><input type="text" class="grade-input-dynamic" value="${targetGrade === 'N/A' ? '' : subject.targetGrade}" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3135" placeholder="N/A"></div>`;
        } else {
          targetGradeDisplay = `<div class="grade-value-display"><span class="grade-text ${targetGradeColorClass}">${targetGrade}</span></div>`;
        }
        // Remove individual edit icon for target grade
        // if (isEditableByStaff() && originalSubjectRecordId) {
        //   targetGradeDisplay += `<span class="grade-edit-icon edit-icon" title="Edit Target Grade" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3135">✏️</span>`;
        // }

        // NEW: Optional Grades (Effort, Behaviour, Subject Attendance)
        let optionalGradesHTML = '';
        if (isEditableByStaff() && isProfileInEditMode && originalSubjectRecordId) {
          // EDIT MODE: Render inputs for optional fields
          optionalGradesHTML += `<div class="optional-grade-item">`;
          optionalGradesHTML += `<span class="optional-grade-label">Eff:</span>`;
          optionalGradesHTML += `<input type="text" class="optional-grade-input" value="${(subject.effortGrade && subject.effortGrade !== 'N/A' ? subject.effortGrade : '')}" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3133" placeholder="-">`;
          optionalGradesHTML += `</div>`;

          optionalGradesHTML += `<div class="optional-grade-item">`;
          optionalGradesHTML += `<span class="optional-grade-label">Beh:</span>`;
          optionalGradesHTML += `<input type="text" class="optional-grade-input" value="${(subject.behaviourGrade && subject.behaviourGrade !== 'N/A' ? subject.behaviourGrade : '')}" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3134" placeholder="-">`;
          optionalGradesHTML += `</div>`;
          
          optionalGradesHTML += `<div class="optional-grade-item">`;
          optionalGradesHTML += `<span class="optional-grade-label">Att:</span>`;
          // For attendance input, show the number part of percentage e.g. 89 from 0.89
          let attValueForInput = '';
          if (subject.subjectAttendance && subject.subjectAttendance !== 'N/A') {
            const numAtt = parseFloat(String(subject.subjectAttendance));
            if (!isNaN(numAtt)) {
              attValueForInput = Math.round(numAtt * 100);
            }
          }
          optionalGradesHTML += `<input type="text" class="optional-grade-input attendance-input" value="${attValueForInput}" data-original-record-id="${originalSubjectRecordId}" data-field-id="field_3186" placeholder="%">`;
          optionalGradesHTML += `</div>`;

        } else {
          // DISPLAY MODE: Render text for optional fields
          if (subject.effortGrade && subject.effortGrade !== 'N/A') {
            optionalGradesHTML += `<div class="optional-grade-item"><span class="optional-grade-label">Eff:</span>${sanitizeField(subject.effortGrade)}</div>`;
          }
          if (subject.behaviourGrade && subject.behaviourGrade !== 'N/A') {
            optionalGradesHTML += `<div class="optional-grade-item"><span class="optional-grade-label">Beh:</span>${sanitizeField(subject.behaviourGrade)}</div>`;
          }
          if (subject.subjectAttendance && subject.subjectAttendance !== 'N/A') {
            optionalGradesHTML += `<div class="optional-grade-item"><span class="optional-grade-label">Att:</span>${formatAsPercentage(subject.subjectAttendance)}</div>`;
          }
        }

        subjectsHTML += `
          <div class="subject-card ${qualTypeClass}">
            <div class="subject-name">${sanitizeField(subject.subject || '')}</div>
            <div class="subject-meta">
              ${subject.examType ? sanitizeField(subject.examType) : 'N/A'}
              ${subject.examBoard ? ` • ${sanitizeField(subject.examBoard)}` : ''}
            </div>
            <div class="grades-container">
              <div class="grade-item">
                <div class="grade-label">MEG <span class="meg-info-button" title="Understanding MEG">i</span></div>
                <div class="grade-value grade-meg"><span class="grade-text">${megGrade}</span></div>
              </div>
              <div class="grade-item">
                <div class="grade-label">STG</div>
                <div class="grade-value grade-stg"><span class="grade-text">${stgGrade}</span></div>
              </div>
              <div class="grade-item current-grade-item">
                <div class="grade-label">Current</div>
                ${currentGradeDisplay}
              </div>
              <div class="grade-item target-grade-item">
                <div class="grade-label">Target</div>
                ${targetGradeDisplay}
              </div>
            </div>
            ${ optionalGradesHTML ? `<div class="optional-grades-container">${optionalGradesHTML}</div>` : '' }
            <div class="grade-edit-feedback"></div>
          </div>
        `;
      });
    } else {
      subjectsHTML = '<div class="no-subjects">No subjects available</div>';
    }
    
    // Create the profile HTML
    const profileHTML = `
      <div id="vespa-profile">
        <section class="vespa-section profile-section">
          <h2 class="vespa-section-title">
            <span style="display: inline-flex; align-items: center;"> <!-- Grouping span -->
              Student Profile 
              <span class="profile-info-button report-profile-info-button" title="Understanding These Grades">i</span>
            </span>
            ${masterEditIconHTML}
          </h2>
          <div class="profile-info">
            <div class="profile-details">
              <div class="profile-name">${name}</div>
              
              <div class="profile-item">
                <span class="profile-label">School:</span>
                <span class="profile-value">${schoolDisplay}</span>
              </div>
              
            ${yearGroup ? `
            <div class="profile-item">
              <span class="profile-label">Year Group:</span>
              <span class="profile-value">${yearGroup}</span>
            </div>
            ` : ''}
            
            ${tutorGroup ? `
            <div class="profile-item">
              <span class="profile-label">Tutor Group:</span>
              <span class="profile-value">${tutorGroup}</span>
            </div>
            ` : ''}
            
            ${attendance ? `
            <div class="profile-item">
              <span class="profile-label">Attendance:</span>
              <span class="profile-value">${attendance}</span>
            </div>
            ` : ''}
            </div>
            
            <div class="subjects-container">
              <div class="subjects-grid">
                ${subjectsHTML}
              </div>
            </div>
          </div>
        </section>
      </div>
    `;
    
    // Delay rendering slightly to ensure DOM stability
    setTimeout(() => {
      // Clear container and add content
      profileContainer.innerHTML = profileHTML;
      lastRenderedProfileHash = profileHash; // Ensure hash is updated AFTER innerHTML set, before DOM lock release
      // document.body.classList.remove('report-profile-loading'); // REMOVED - hideLoadingIndicator will handle this
      hideLoadingIndicator();
      
      // Add event listener to the new master edit/save icon
      const masterIcon = profileContainer.querySelector('.master-edit-icon');
      if (masterIcon) {
          masterIcon.addEventListener('click', toggleMasterEditMode); // New function to be created
      }
      
      // NEW: Add event listener for the profile info button
      setupReportProfileInfoTooltip(profileContainer);
      
      // REMOVE event listeners for individual grade-edit-icons as they are gone
      // if (isEditableByStaff()) { // staffCanEdit variable was used before, ensure consistency
      //     profileContainer.querySelectorAll('.grade-edit-icon').forEach(icon => {
      //         icon.addEventListener('click', (event) => toggleGradeEditMode(event.currentTarget));
      //     });
      // }

      debugLog("Profile rendered with master edit icon logic");
      
      // Reset the DOM update flag after a slight delay to ensure rendering completes
      setTimeout(() => {
        isUpdatingDOM = false;
        debugLog("DOM update lock released");
      }, 100);
    }, 50);
    
    debugLog("Profile rendered successfully", { name, subjects: subjectData.length });
  }

  // NEW: Setup for profile information tooltip in ReportProfiles
  function setupReportProfileInfoTooltip(profileContainer) {
    const infoButton = profileContainer.querySelector('.report-profile-info-button');
    // The container for the tooltip will be the body to ensure it overlays everything
    const tooltipContainer = document.body; 

    if (infoButton) {
      infoButton.addEventListener('click', () => {
        // Remove existing tooltip if any
        const existingTooltip = document.getElementById('reportProfileGradeInfoTooltip');
        if (existingTooltip) {
          existingTooltip.remove();
        }

        const tooltipHTML = `
          <div id="reportProfileGradeInfoTooltip" class="profile-info-tooltip report-profile-tooltip-styling">
            <span class="profile-info-tooltip-close">&times;</span>
            <h4>Understanding Student Grades (Teacher View):</h4>
            <p><strong>1) Subject Target Grade (STG) - Teacher Explainer:</strong><br>
            The STG provides a more nuanced target by applying subject-specific value-added (VA) factors to the base MEG calculation. These VA factors, derived from national data, reflect the relative difficulty and grade distribution patterns of individual subjects. Schools can select different benchmark levels - while many use standard national benchmarks, some may opt for more aspirational targets to drive higher achievement across their cohorts. The calculation multiplies the student's base expected points by the subject's VA factor, then converts the result back to a grade. For example, subjects that historically award higher grades (like Further Mathematics with a VA factor of 1.05) receive a modest upward adjustment, while subjects known to be more challenging in their grading (like Biology with a VA factor of 0.90) receive a downward adjustment to create fairer, more realistic targets. However, the most effective target-setting considers all contributing factors: prior attainment, subject difficulty, individual student needs, teaching quality, and school context. STGs should inform differentiated target-setting and help identify where students may need additional support or challenge, but should always be contextualized within a broader understanding of each student's potential.</p>
            <p><strong>2) Current Grade (Teacher Input Required):</strong><br>
            When entering this grade, assess the student's present performance level based on:
            <ul>
              <li>Recent formal and informal assessments</li>
              <li>Quality and consistency of classwork and homework</li>
              <li>Participation and demonstration of subject knowledge</li>
              <li>Your professional judgment of their current mastery of content</li>
            </ul>
            This should reflect where the student is genuinely performing now, not where you hope they will be by the end of the course.</p>
            <p><strong>3) Target Grade (Teacher Input Required):</strong><br>
            When setting this grade, consider:
            <ul>
              <li>The student's STG as a starting reference point</li>
              <li>Their demonstrated potential and engagement in each subject</li>
              <li>Any contextual factors affecting their performance</li>
              <li>Historical progression patterns of similar students</li>
              <li>Department expectations and benchmarks</li>
            </ul>
            The target should be ambitious yet achievable with appropriate effort and support.</p>
          </div>
        `;
        
        tooltipContainer.insertAdjacentHTML('beforeend', tooltipHTML);
        const tooltipElement = document.getElementById('reportProfileGradeInfoTooltip');
        
        // Make it visible
        setTimeout(() => {
          if (tooltipElement) tooltipElement.classList.add('visible');
        }, 10);

        const closeButton = tooltipElement.querySelector('.profile-info-tooltip-close');
        if (closeButton) {
          closeButton.addEventListener('click', () => {
            tooltipElement.classList.remove('visible');
            setTimeout(() => {
              if (tooltipElement && tooltipElement.parentNode) {
                 tooltipElement.parentNode.removeChild(tooltipElement);
              }
            }, 300); // Corresponds to CSS transition time
          });
        }
      });
    } else {
      debugLog("Report Profile info button not found for tooltip setup.");
    }
    
    // Setup MEG info buttons
    setupMEGInfoButtons(profileContainer);
  }
  
  // NEW: Setup for MEG information tooltips
  function setupMEGInfoButtons(profileContainer) {
    const megInfoButtons = profileContainer.querySelectorAll('.meg-info-button');
    const tooltipContainer = document.body;
    
    megInfoButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event bubbling
        
        // Remove existing MEG tooltip if any
        const existingTooltip = document.getElementById('megInfoTooltip');
        if (existingTooltip) {
          existingTooltip.remove();
        }
        
        const tooltipHTML = `
          <div id="megInfoTooltip" class="profile-info-tooltip meg-tooltip">
            <span class="profile-info-tooltip-close">&times;</span>
            <h4>Understanding Minimum Expected Grades (MEG) - Teacher Explainer</h4>
            <p>The MEG is derived from national benchmark data, representing the performance of students with similar prior attainment (GCSE scores). While these benchmarks are typically set at a level where most students should be able to achieve them with good teaching and effort, schools can adjust their ambition level - some may choose to set more aspirational targets to drive higher achievement, while others may prefer more moderate goals. This grade serves as a baseline, calculated by mapping students' average GCSE scores to performance bands and their corresponding expected points. However, MEGs have limitations: they don't account for subject-specific variations, individual student factors, or contextual variables. The most effective targets are those that consider all contributing factors - prior attainment, subject difficulty, student circumstances, and school context. The MEG should be used alongside other indicators, particularly the Subject Target Grade (STG), which applies subject-specific adjustments.</p>
          </div>
        `;
        
        tooltipContainer.insertAdjacentHTML('beforeend', tooltipHTML);
        const tooltipElement = document.getElementById('megInfoTooltip');
        
        // Position the tooltip near the button
        const buttonRect = button.getBoundingClientRect();
        tooltipElement.style.position = 'fixed';
        tooltipElement.style.top = `${buttonRect.bottom + 5}px`;
        tooltipElement.style.left = `${buttonRect.left - 100}px`; // Center it roughly on the button
        
        // Make it visible with a slight delay for transition
        setTimeout(() => {
          if (tooltipElement) tooltipElement.classList.add('visible');
        }, 10);
        
        const closeButton = tooltipElement.querySelector('.profile-info-tooltip-close');
        if (closeButton) {
          closeButton.addEventListener('click', () => {
            tooltipElement.classList.remove('visible');
            setTimeout(() => {
              if (tooltipElement && tooltipElement.parentNode) {
                tooltipElement.parentNode.removeChild(tooltipElement);
              }
            }, 300);
          });
        }
        
        // Close on click outside
        setTimeout(() => {
          document.addEventListener('click', function closeMEGTooltip(event) {
            if (tooltipElement && !tooltipElement.contains(event.target) && event.target !== button) {
              tooltipElement.classList.remove('visible');
              setTimeout(() => {
                if (tooltipElement && tooltipElement.parentNode) {
                  tooltipElement.parentNode.removeChild(tooltipElement);
                }
              }, 300);
              document.removeEventListener('click', closeMEGTooltip);
            }
          });
        }, 100);
      });
    });
  }

  function addStyles() {
    // NEW: Link to the central stylesheet
    const styleId = 'academic-profile-styles-link';
    if (!document.getElementById(styleId)) {
      const linkElement = document.createElement('link');
      linkElement.id = styleId;
      linkElement.rel = 'stylesheet';
      linkElement.type = 'text/css';
      linkElement.href = 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/landingPage/academicProfile1c.css'; // Update CSS path
      document.head.appendChild(linkElement);
      debugLog("Linked central stylesheet: academicProfile1a.css from ReportProfiles");
    }
  }

  // Expose initializer to global scope so the Multi-App Loader can access it
  window.initializeReportProfiles = initializeReportProfiles;

  // Helper function to check if the current user is NOT a "Student"
  function isEditableByStaff() {
    if (typeof Knack !== 'undefined' && Knack.getUserRoles) {
      const userRoles = Knack.getUserRoles();
      // True if 'Student' role is NOT present.
      // Assumes role name is 'Student'. Adjust if the actual name or ID is different.
      return !userRoles.some(role => role.name === 'Student');
    }
    debugLog("Knack user roles not available, defaulting to not editable.");
    return false; // Default to not editable if roles can't be determined
  }

  // Function to update a specific grade field in Object_113
  async function updateSubjectGradeInObject113(subjectRecordId, fieldId, value) {
    if (!subjectRecordId || !fieldId) {
      // console.error('[ReportProfiles] Cannot update grade: Missing subjectRecordId or fieldId');
      debugLog('[ReportProfiles] Cannot update grade: Missing subjectRecordId or fieldId');
      return false;
    }
    // Ensure value is a string, even if empty, as Knack expects
    const sanitizedValue = value === null || value === undefined ? "" : String(value);
    debugLog(`Updating grade in Object_113: RecordID=${subjectRecordId}, FieldID=${fieldId}, Value='${sanitizedValue}'`);

    const updateData = { [fieldId]: sanitizedValue };

    try {
      await makeRequest( // Using the existing makeRequest for consistency
        `${KNACK_API_URL}/objects/object_113/records/${subjectRecordId}`,
        {
          type: 'PUT',
          headers: getKnackHeaders(), // Assumes getKnackHeaders is correctly defined
          data: JSON.stringify(updateData),
          contentType: 'application/json', // Knack requires this for PUT
        },
        `update_grade_${subjectRecordId}_${fieldId}` // Unique key for makeRequest
      );
      debugLog(`Successfully submitted update for ${fieldId} on record ${subjectRecordId}`);
      return true;
    } catch (error) {
      // console.error(`[ReportProfiles] Error updating grade in Object_113 (Record: ${subjectRecordId}, Field: ${fieldId}):`, error);
      debugLog(`[ReportProfiles] Error updating grade in Object_113 (Record: ${subjectRecordId}, Field: ${fieldId})`, { error: error.message, responseText: error.responseText });
      if (DEBUG_MODE && error.responseText) { // Keep this specific console.error if DEBUG_MODE is on, as it's extra detail
          console.error("Error responseText:", error.responseText);
      }
      return false;
    }
  }
} // End of the main initialization guard