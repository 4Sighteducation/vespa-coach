// == Knack Builder Multi-App Loader v3.16 ==
// == Knack Builder Multi-App Loader v3.16 ==
// Goal: Load different JS apps based on Knack Scene/View event data, regardless of order.
// Strategy: Store the latest scene AND view keys. After each event, check if the
//           current combination matches an app. Load script, set specific config, call initializer.
// Changes from v3.15: Added configGlobalVar/initializerFunctionName, explicit call after load.

(function () {
    console.log("[Knack Builder Loader v3.16] Script start.");

    // --- Configuration ---
    const VERSION = "3.16"; // Updated version
    const DEBUG_MODE = true; // Force DEBUG_MODE to true for enhanced logging

    // --- App Configuration ---
    const APPS = {
        'myAcademicProfile': {
  scenes: ['scene_43'], // Load on scene_43
  views: ['view_3046'],  // Specifically for view_3046
  scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/report/MyAcademicProfilePage2c.js', // Ensure this URL is correct and points to your script
  configBuilder: (baseConfig, sceneKey, viewKey) => ({
    ...baseConfig, // Includes knackAppId, knackApiKey, debugMode, etc.
    appType: 'myAcademicProfile',
    sceneKey: sceneKey, // Will be 'scene_43' in this case
    viewKey: viewKey,   // Will be 'view_3046' in this case
    elementSelector: '#view_3046 .kn-rich-text', // Target for rendering the profile
  }),
  configGlobalVar: 'MY_ACADEMIC_PROFILE_CONFIG', // Matches the global variable used in your script
  initializerFunctionName: 'initializeMyAcademicProfilePage' // Matches the function name in your script
},
     
        'reportProfiles': {
            scenes: ['scene_1095'],
            views: ['view_2776', 'view_3015'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/report/ReportProfiles2n.js',
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'reportProfiles',
                debugMode: false,
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelectors: {
                    reportContainer: '#view_2776 .kn-rich_text__content',
                    profileContainer: '#view_3015 .kn-rich_text__content'
                }
            }),
            configGlobalVar: 'REPORTPROFILE_CONFIG',
            initializerFunctionName: 'initializeReportProfiles'
        },
        'aiCoachLauncher': { // New entry for the AI Coach Launcher
            scenes: ['scene_1095'], // Same scene as reportProfiles
            views: ['view_3047'],   // The new rich text view
            scriptUrl: 'https://raw.githubusercontent.com/4Sighteducation/vespa-coach/main/src/aiCoachLauncher1c.js', // Ensure this matches the actual filename on GitHub
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'aiCoachLauncher',
                debugMode: true, // Enable debugging for aiCoachLauncher
                sceneKey: sceneKey,
                viewKey: viewKey, // Will be 'view_3047'
                elementSelector: '#view_3047 .kn-rich_text__content', // Target for the button
                aiCoachPanelId: 'aiCoachSlidePanel', // ID for the panel we'll create
                aiCoachToggleButtonId: 'activateAICoachBtn', // ID for the toggle button
                mainContentSelector: '#kn-scene_1095' // Selector for the main content area to resize
            }),
            configGlobalVar: 'AI_COACH_LAUNCHER_CONFIG',
            initializerFunctionName: 'initializeAICoachLauncher' // New function to create in ReportProfiles2k.js
        },
        'flashcards': {
            scenes: ['scene_1206'],
            views: ['view_3005'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/Flashcards4z.js',
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'flashcards',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '.kn-rich-text',
                appUrl: 'https://vespa-flashcards-e7f31e9ff3c9.herokuapp.com/'
            }),
            configGlobalVar: 'VESPA_CONFIG',
            initializerFunctionName: 'initializeFlashcardApp'
        },
        'studyPlanner': {
            scenes: ['scene_1208'],
            views: ['view_3008'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/studyPlanner2m.js',
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'studyPlanner',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '.kn-rich-text',
                appUrl: 'https://studyplanner2-fc98f9e231f4.herokuapp.com/'
            }),
            configGlobalVar: 'STUDYPLANNER_CONFIG',
            initializerFunctionName: 'initializeStudyPlannerApp'
        },
        'taskboards': {
            scenes: ['scene_1188'], 
            views: ['view_3009'],   
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/taskboard1c.js', 
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'taskboards',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '.kn-rich-text',
                appUrl: 'https://vespataskboards-00affb61eb55.herokuapp.com/' 
            }),
            configGlobalVar: 'TASKBOARD_CONFIG', 
            initializerFunctionName: 'initializeTaskboardApp' 
        },
        'homepage': {
            scenes: ['scene_1210'],
            views: ['view_3013'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/landingPage/Homepage3w.js', 
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'homepage',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '#view_3013', 
            }),
            configGlobalVar: 'HOMEPAGE_CONFIG',
            initializerFunctionName: 'initializeHomepage'
        },
        'uploadSystem': {
            scenes: ['scene_1212'],
            views: ['view_3020'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/vespa-upload-bridge@main/src/index4f.js',
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'uploadSystem',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '#view_3020 .kn-rich_text__content',
                apiUrl: 'https://vespa-upload-api-07e11c285370.herokuapp.com',
                userRole: Knack.getUserRoles()[0] || 'Staff Admin', 
            }),
            configGlobalVar: 'VESPA_UPLOAD_CONFIG',
            initializerFunctionName: 'initializeUploadBridge'
        },
        'staffHomepage': {
            scenes: ['scene_1215'],
            views: ['view_3024'],
            scriptUrl: 'https://cdn.jsdelivr.net/gh/4Sighteducation/FlashcardLoader@main/integrations/landingPage/staffHomepage4d.js',
            configBuilder: (baseConfig, sceneKey, viewKey) => ({
                ...baseConfig,
                appType: 'staffHomepage',
                sceneKey: sceneKey,
                viewKey: viewKey,
                elementSelector: '#view_3024',
                sendGrid: {
                    proxyUrl: 'https://vespa-sendgrid-proxy-660b8a5a8d51.herokuapp.com/api/send-email',
                    fromEmail: 'noreply@notifications.vespa.academy',
                    fromName: 'VESPA Academy',
                    templateId: 'd-6a6ac61c9bab43e28706dbb3da4acdcf', 
                    confirmationtemplateId: 'd-2e21f98579f947b08f2520c567b43c35',
                }
            }),
            configGlobalVar: 'STAFFHOMEPAGE_CONFIG',
            initializerFunctionName: 'initializeStaffHomepage'
        }
    };

    // --- Shared Configuration --- (Optional: Can be merged by configBuilder if needed)
    const sharedConfig = {
        knackAppId: '5ee90912c38ae7001510c1a9',
        knackApiKey: '8f733aa5-dd35-4464-8348-64824d1f5f0d',
        // Add SendGrid configuration
        sendGrid: {
            apiKey: "YOUR_SENDGRID_API_KEY_HERE_OR_LOAD_SECURELY", // Direct API key REMOVED - DO NOT COMMIT ACTUAL KEY
            fromEmail: 'noreply@notifications.vespa.academy',
            fromName: 'VESPA Academy'
        }
    };

    // --- State ---
    let loadedAppKey = null;
    let lastRenderedSceneKey = null; // Store the latest scene key
    let lastRenderedViewKey = null;  // Store the latest view key

    // --- Helper Functions ---
    function log(message, data) {
        if (DEBUG_MODE) {
            let logData = data;
            // Avoid circular structure issues in logging complex objects
            if (typeof data === 'object' && data !== null) {
                try { logData = JSON.parse(JSON.stringify(data)); } catch (e) { logData = "[Data non-serializable for logging]"; }
            }
            console.log(`[Loader v${VERSION}] ${message}`, logData === undefined ? '' : logData);
        }
    }

    function errorLog(message, data) {
        console.error(`[Loader v${VERSION} ERROR] ${message}`, data === undefined ? '' : data);
        // Optionally, include more details or context if DEBUG_MODE is true
        if (DEBUG_MODE && typeof data === 'object' && data !== null && data.exception) {
            console.error("[Loader Detailed Exception]:", data.exception);
        }
    }

    // Adjusted loadScript: Resolves AFTER success, easier chaining
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            if (typeof $ === 'undefined' || typeof $.getScript === 'undefined') {
                const errorMsg = "jQuery ($) or $.getScript is not defined.";
                errorLog(errorMsg, { scriptUrl: url });
                return reject(new Error(errorMsg));
            }
            log("loadScript: Attempting to load script via jQuery:", url);
            $.getScript(url)
                .done(() => {
                    log("loadScript: Script loaded successfully via getScript:", url);
                    resolve(); // Resolve *after* script execution succeeded
                })
                .fail((jqxhr, settings, exception) => {
                    errorLog("loadScript: Failed to load script via jQuery.", { scriptUrl: url, status: jqxhr?.status, settings: settings, exception: exception });
                    reject(new Error(`Failed to load script: ${url} - ${exception || 'Unknown reason'}`));
                });
        });
    }

    // Simplified findAppToLoad: DOM check for reportProfiles, standard loop for others.
    function findAppToLoad(sceneKey, viewKey) {
        let appsFound = []; // Store multiple apps if applicable

        // DOM check for myAcademicProfile when its scene is active
        if (sceneKey === 'scene_43' && APPS.myAcademicProfile) {
            const academicProfileAppConfig = APPS.myAcademicProfile;
            const elementSelectorToCheck = `#${academicProfileAppConfig.views[0]}`;
            if (document.querySelector(elementSelectorToCheck)) {
                log(`findAppToLoad: [myAcademicProfile] DOM Match on scene_43: Element '${elementSelectorToCheck}' (view container) exists.`);
                lastRenderedViewKey = academicProfileAppConfig.views[0]; 
                appsFound.push('myAcademicProfile');
            }
        }

        // DOM checks for scene_1095
        if (sceneKey === 'scene_1095') { 
            if (APPS.reportProfiles) {
                const reportContainerSelector = APPS.reportProfiles.configBuilder(sharedConfig, sceneKey, APPS.reportProfiles.views[0]).elementSelectors.reportContainer;
                const profileContainerSelector = APPS.reportProfiles.configBuilder(sharedConfig, sceneKey, APPS.reportProfiles.views[1]).elementSelectors.profileContainer;
                if (document.querySelector(reportContainerSelector) && document.querySelector(profileContainerSelector)) {
                    log('findAppToLoad: [reportProfiles] DOM Match: Both required views/elements found for scene_1095.');
                    appsFound.push('reportProfiles');
                }
            }
            if (APPS.aiCoachLauncher) {
                const aiCoachAppConfig = APPS.aiCoachLauncher;
                const elementSelectorToCheck = aiCoachAppConfig.configBuilder(sharedConfig, sceneKey, aiCoachAppConfig.views[0]).elementSelector;
                if (document.querySelector(elementSelectorToCheck)) {
                    log(`findAppToLoad: [aiCoachLauncher] DOM Match on scene_1095: Element '${elementSelectorToCheck}' exists.`);
                    lastRenderedViewKey = aiCoachAppConfig.views[0];
                    appsFound.push('aiCoachLauncher');
                } 
            }
        }
                
        // Standard scene/view matching for all other apps or as a fallback if no DOM-based apps were found
        if (appsFound.length === 0 && sceneKey && viewKey && typeof sceneKey === 'string' && typeof viewKey === 'string') {
            log(`findAppToLoad: Standard Search: Searching for app matching Scene Key: ${sceneKey}, View Key: ${viewKey}`);
            for (const key in APPS) {
                // Avoid re-processing apps already handled by DOM checks if they were definitively found or not found for that scene.
                if ((sceneKey === 'scene_43' && key === 'myAcademicProfile') || (sceneKey === 'scene_1095' && (key === 'reportProfiles' || key === 'aiCoachLauncher'))) {
                    continue; 
                }
                const app = APPS[key];
                const sceneMatch = app.scenes.includes(sceneKey);
                const viewMatch = app.views.includes(viewKey);
                if (sceneMatch && viewMatch) {
                    log(`findAppToLoad: Standard Match found for app '${key}'.`);
                    appsFound.push(key);
                    break; // Assuming only one standard app per specific scene/view combo is primary
                }
            }
        }

        if (appsFound.length > 0) {
            log(`findAppToLoad: Apps identified for loading: ${appsFound.join(', ')}`);
            return appsFound;
        }
        
        log(`findAppToLoad: No app configuration found for Scene '${sceneKey}', View '${viewKey}'.`);
        return null;
    }

    // Central function to check conditions and load the app
    async function tryLoadApp() {
        log(`tryLoadApp: Checking load conditions. Scene: ${lastRenderedSceneKey}, View: ${lastRenderedViewKey}`);
        
        const appKeysToLoad = findAppToLoad(lastRenderedSceneKey, lastRenderedViewKey);

        if (!appKeysToLoad || appKeysToLoad.length === 0) {
            log("tryLoadApp: No app matches current scene/view.");
            return; 
        }

        for (const appKey of appKeysToLoad) {
            // More nuanced check for loadedAppKey to allow re-initialization of reportProfiles and aiCoachLauncher if needed
            if (loadedAppKey === appKey && !['reportProfiles', 'aiCoachLauncher'].includes(appKey)) {
                log(`tryLoadApp: App '${appKey}' already loaded and not whitelisted for re-load. Skipping.`);
                continue;
            }
             // If it IS reportProfiles or aiCoachLauncher, we allow it to proceed to potentially re-initialize or load if not already truly loaded.
            // A more sophisticated script-level guard within those actual scripts is better for preventing true re-execution if not desired.

            log(`tryLoadApp: Conditions met for app: ${appKey}. Preparing load.`);
            // loadedAppKey = appKey; // Potentially set this after successful load or manage a list of loaded apps

            const appConfigDef = APPS[appKey]; 
            if (!appConfigDef || !appConfigDef.scriptUrl || !appConfigDef.configBuilder || !appConfigDef.configGlobalVar || !appConfigDef.initializerFunctionName) {
                errorLog(`tryLoadApp: Configuration error for app (missing required properties): ${appKey}`, appConfigDef);
                // loadedAppKey = null; // Revert if this specific app load fails due to config
                continue; // Try next app in the list
            }

            try {
                // Ensure the correct viewKey is used for config building, especially for DOM-matched apps
                let currentViewForConfig = lastRenderedViewKey; // Default to the most recently rendered view
                if (appKey === 'myAcademicProfile' && APPS.myAcademicProfile.views.includes(lastRenderedViewKey)) {
                    currentViewForConfig = lastRenderedViewKey;
                } else if ((appKey === 'reportProfiles' || appKey === 'aiCoachLauncher') && lastRenderedSceneKey === 'scene_1095') {
                     // For these, the viewKey is less critical as their configBuilder might not use it, or it's already set by DOM check
                     // However, if they have multiple views in their config and specific logic is needed, this might need refinement.
                     // For now, using lastRenderedViewKey which findAppToLoad might have updated for these DOM-checked apps.
                } else if (!appConfigDef.views.includes(lastRenderedViewKey)){
                    // If the app has multiple views and the lastRenderedViewKey isn't one of them, use the first one from its config.
                    // This handles cases where the scene renders, then a non-target view, then tryLoadApp runs.
                    currentViewForConfig = appConfigDef.views[0];
                }

                const instanceConfig = appConfigDef.configBuilder(sharedConfig, lastRenderedSceneKey, currentViewForConfig);
                log(`tryLoadApp: Built instance config for ${appKey}`, instanceConfig);

                log(`tryLoadApp: Attempting to load script for ${appKey} from URL: ${appConfigDef.scriptUrl}`);
                await loadScript(appConfigDef.scriptUrl);
                log(`tryLoadApp: Script successfully loaded for app '${appKey}'.`);

                window[appConfigDef.configGlobalVar] = instanceConfig;
                log(`tryLoadApp: Set global config variable '${appConfigDef.configGlobalVar}' for ${appKey}`);

                if (typeof window[appConfigDef.initializerFunctionName] === 'function') {
                    log(`tryLoadApp: Calling initializer function: ${appConfigDef.initializerFunctionName} for ${appKey}`); 
                    try {
                        window[appConfigDef.initializerFunctionName](); 
                    } catch (initError) {
                        errorLog(`tryLoadApp: Error calling initializer function ${appConfigDef.initializerFunctionName} for ${appKey}:`, initError);
                        window[appConfigDef.configGlobalVar] = undefined; 
                        continue; // Try next app
                    }
                    log(`tryLoadApp: Initializer function ${appConfigDef.initializerFunctionName} called successfully for ${appKey}.`);
                    // Update loadedAppKey only on successful initialization of single-load apps
                    if (!['reportProfiles', 'aiCoachLauncher'].includes(appKey)) {
                        loadedAppKey = appKey;
                    }
                } else {
                    errorLog(`tryLoadApp: Initializer function '${appConfigDef.initializerFunctionName}' not found after loading script for app '${appKey}'.`);
                    window[appConfigDef.configGlobalVar] = undefined; 
                }

            } catch (error) {
                errorLog(`tryLoadApp: Failed during load/init process for app ${appKey}:`, error);
                if (appConfigDef && appConfigDef.configGlobalVar) {
                    window[appConfigDef.configGlobalVar] = undefined;
                }
            }
        }
    }

    // --- Main Execution (jQuery Document Ready) ---
    $(function () {
        // ... (DOM ready and event listener attachment remains the same) ...
        log("DOM ready. Attaching Knack event listeners.");

        if (typeof $ === 'undefined' || typeof $.ajax === 'undefined') {
            errorLog("Critical Error: jQuery ($) is not available at DOM ready.");
            return;
        }
        log("jQuery confirmed available.");

        // Listener 1: Store scene key and then check if conditions are met
        $(document).on('knack-scene-render.any', function (event, scene) {
            if (scene && scene.key) {
                // If the scene is changing, reset loadedAppKey to allow reinitialization if needed
                // This is important if navigating back and forth between scenes that use different apps
                // or the same app that needs a fresh start.
                if (lastRenderedSceneKey && lastRenderedSceneKey !== scene.key) {
                    log(`Scene changed from ${lastRenderedSceneKey} to ${scene.key}. Resetting loadedAppKey.`);
                    loadedAppKey = null; // Reset to allow the new scene's app (or same app) to load/re-initialize
                }

                log(`Scene rendered: Storing scene key '${scene.key}'`);
                lastRenderedSceneKey = scene.key;
                // Check if this completes the required pair OR if a special DOM condition is met
                tryLoadApp();
            } else {
                log("Scene render event fired, but no scene key found.");
            }
        });

        // Listener 2: Store view key and then check if conditions are met
        $(document).on('knack-view-render.any', function (event, view) {
            if (view && view.key) {
                // Do not reset loadedAppKey on mere view render, as a scene can have multiple views
                // and we might be loading an app that spans multiple views or depends on a specific scene-view combo.
                // The scene change logic above is better suited for resetting loadedAppKey.
                log(`View rendered: Storing view key '${view.key}'`);
                lastRenderedViewKey = view.key;
                // Check if this completes the required pair OR if a special DOM condition is met
                tryLoadApp();
            } else {
                log("View render event fired, but no view key found.");
            }
        });

        log("Knack render event listeners attached.");
        log("Loader setup complete. Waiting for render events.");

    });

    log("Knack Builder Loader setup registered. Waiting for DOM ready.");

}());