// src/services/alpsBenchmarkData60.js
// This file stores national benchmarking data for ALPS calculations,
// using the 60th PERCENTILE as the primary benchmark for A-Levels
// and for subject-specific VA factors across all qualifications.

// Data from ALPS Benchmark Tables.txt: "Average Performance Per Subject" (A-LEVEL)
// Using 60th Percentile Points and Representative Grade
// Alps Band | GCSE score band   | 60th Pct Points | 60th Pct MEG Aspiration
// --------: | :---------------- | ---------------: | :----------------------
//         1 | 7.75 +            |           122.19 | A
//         2 | 7.00 – < 7.75     |           107.77 | A/B
//         3 | 6.55 – < 7.00     |            98.44 | B
//         4 | 6.10 – < 6.55     |            92.27 | B/C
//         5 | 5.65 – < 6.10     |            86.45 | C+
//         6 | 5.21 – < 5.65     |            80.68 | C
//         7 | 4.77 – < 5.21     |            75.90 | C-
//         8 | 4.37 – < 4.77     |            71.20 | C/D
//         9 | 3.79 – < 4.37     |            65.88 | D+
//        10 | 3.05 – < 3.79     |            60.00 | D
//        11 | 0.00 – < 3.05     |            56.67 | D

const gcseScoreToAlpsBandTable = [
  { gcseMinScore: 7.75, gcseMaxScore: Infinity, alpsBand: 1, minExpectedPoints: 122.19, megAspiration: 'A' },
  { gcseMinScore: 7.00, gcseMaxScore: 7.75, alpsBand: 2, minExpectedPoints: 107.77, megAspiration: 'A/B' },
  { gcseMinScore: 6.55, gcseMaxScore: 7.00, alpsBand: 3, minExpectedPoints: 98.44, megAspiration: 'B' },
  { gcseMinScore: 6.10, gcseMaxScore: 6.55, alpsBand: 4, minExpectedPoints: 92.27, megAspiration: 'B/C' },
  { gcseMinScore: 5.65, gcseMaxScore: 6.10, alpsBand: 5, minExpectedPoints: 86.45, megAspiration: 'C+' },
  { gcseMinScore: 5.21, gcseMaxScore: 5.65, alpsBand: 6, minExpectedPoints: 80.68, megAspiration: 'C' },
  { gcseMinScore: 4.77, gcseMaxScore: 5.21, alpsBand: 7, minExpectedPoints: 75.90, megAspiration: 'C-' },
  { gcseMinScore: 4.37, gcseMaxScore: 4.77, alpsBand: 8, minExpectedPoints: 71.20, megAspiration: 'C/D' },
  { gcseMinScore: 3.79, gcseMaxScore: 4.37, alpsBand: 9, minExpectedPoints: 65.88, megAspiration: 'D+' },
  { gcseMinScore: 3.05, gcseMaxScore: 3.79, alpsBand: 10, minExpectedPoints: 60.00, megAspiration: 'D' },
  { gcseMinScore: 0.00, gcseMaxScore: 3.05, alpsBand: 11, minExpectedPoints: 56.67, megAspiration: 'D-' },
];

function getAlpsBandDetailsFromGcseScore(gcsePriorAttainmentScore) {
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore)) {
    return null;
  }
  for (const bandDetails of gcseScoreToAlpsBandTable) {
    if (gcsePriorAttainmentScore >= bandDetails.gcseMinScore && 
        (bandDetails.gcseMaxScore === Infinity || gcsePriorAttainmentScore < bandDetails.gcseMaxScore)) {
      return {
        alpsBand: bandDetails.alpsBand,
        minExpectedPoints: bandDetails.minExpectedPoints, // These are 60th percentile points for A-Level
        megAspiration: bandDetails.megAspiration,       // This is 60th percentile MEG Aspiration for A-Level
      };
    }
  }
  return null; 
}

// Subject Specific VA Factors - 60th Percentile
const subjectSpecificFactors60thPercentile = {
  // A-LEVELS (60% column from ALPS Benchmark Tables.txt)
  'A - Accounting': 0.92,
  'A – Ancient History': 1.00,
  'A - Arabic': 1.08,
  'A - Art (3D Design)': 1.15,
  'A - Art (Craft)': 1.12,
  'A - Art (Fine Art)': 1.12,
  'A - Art (Graphic Design)': 1.13,
  'A - Art (Photography)': 1.12,
  'A - Art (Textiles)': 1.16,
  'A - Biology': 0.86,
  'A - Business Studies': 1.03,
  'A - Chemistry': 0.87,
  'A - Chinese': 1.14,
  'A - Classical Civilisation': 1.02,
  'A - Classical Greek': 1.08,
  'A - Computer Science': 0.91,
  'A - D&T (Product Design)': 1.00,
  'A - D&T (Textiles)': 1.00,
  'A - Dance': 1.10,
  'A - Drama & Theatre Studies': 1.04,
  'A - Economics': 1.00,
  'A - Electronics': 1.09,
  'A - English Lang. & Lit.': 1.01,
  'A - English Language': 1.02,
  'A - English Literature': 1.01,
  'A - Environmental Science': 0.91,
  'A - Film Studies': 1.09,
  'A - French': 0.97,
  'A - Geography': 1.00,
  'A - Geology': 0.98,
  'A - German': 0.96,
  'A - Government & Politics': 1.02,
  'A - History': 1.00,
  'A - History of Art': 1.03,
  'A - Italian': 1.32,
  'A - Japanese': 1.24,
  'A - Latin': 0.98,
  'A - Law': 0.99,
  'A - Mathematics': 0.95,
  'A - Maths (Further)': 1.00,
  'A - Media Studies': 1.09,
  'A - Music': 0.95,
  'A - Music Technology': 0.93,
  'A - Philosophy': 0.93,
  'A - Physical Education': 0.96,
  'A - Physics': 0.89,
  'A - Polish': 1.23,
  'A - Portuguese': 1.07,
  'A - Psychology': 0.97,
  'A - Religious Studies': 1.02,
  'A - Russian': 1.28,
  'A - Sociology': 1.08,
  'A - Spanish': 0.99,
  'A - Statistics': 0.93,
  'A - Turkish': 1.18,
  'A - Urdu': 1.35,
  'LIBF Dip - Financial Studies': 1.16,
  'EPQ - Extended Project': 1.07,
  'L3 - Core Mathematics': 1.07,

  // BTEC 2016 Suite - VA Factors (60th Percentile from ALPS Benchmark Tables.txt)
  'BTEC Cert - Applied Law (2016)': 1.09,
  'BTEC Cert - Applied Science (2016)': 0.83,
  'BTEC Cert - Business (2016)': 0.86,
  'BTEC Cert - Health & Social Care (2016)': 0.91,
  'BTEC Cert - Information Technology (2016)': 0.85,
  'BTEC Cert - Performing Arts (2016)': 0.86,
  'BTEC Cert - Sport (2016)': 1.02,

  'BTEC Found Dip - Animal Management (2016)': 1.06,
  'BTEC Found Dip - Applied Science (2016)': 0.93,
  'BTEC Found Dip - Art & Design (2016)': 0.98,
  'BTEC Found Dip - Business (2016)': 1.07,
  'BTEC Found Dip - Children\'s Play Learning & Development (2016)': 0.87,
  'BTEC Found Dip - Computing (2016)': 0.83,
  'BTEC Found Dip - Creative Digital Media Production (2016)': 1.11,
  'BTEC Found Dip - Engineering (2016)': 0.76,
  'BTEC Found Dip - Forensic Investigation (2016)': 0.98,
  'BTEC Found Dip - Health & Social Care (2016)': 0.95,
  'BTEC Found Dip - Information Technology (2016)': 0.79,
  'BTEC Found Dip - Performing Arts (2016)': 1.29,
  'BTEC Found Dip - Sport (2016)': 1.00,
  'BTEC Found Dip - Sport & Exercise Science (2016)': 1.00,

  'BTEC Ext Cert - Animal Management (2016)': 1.03,
  'BTEC Ext Cert - Applied Law (2016)': 1.01,
  'BTEC Ext Cert - Applied Science (2016)': 0.90,
  'BTEC Ext Cert - Art & Design (2016)': 0.97,
  'BTEC Ext Cert - Business (2016)': 0.94,
  'BTEC Ext Cert - Children\'s Play Learning & Development (2016)': 0.92,
  'BTEC Ext Cert - Computing (2016)': 0.84,
  'BTEC Ext Cert - Creative Digital Media Production (2016)': 1.01,
  'BTEC Ext Cert - Digital Content Production (2016)': 1.01,
  'BTEC Ext Cert - Digital Film and Video Production (2016)': 1.01,
  'BTEC Ext Cert - Digital Games Production (2016)': 1.01,
  'BTEC Ext Cert - Digital Music Production (2016)': 1.01,
  'BTEC Ext Cert - Enterprise & Entrepreneurship (2016)': 0.84,
  'BTEC Ext Cert - Engineering (2016)': 0.90,
  'BTEC Ext Cert - Health & Social Care (2016)': 0.93,
  'BTEC Ext Cert - Information Technology (2016)': 0.94,
  'BTEC Ext Cert - Performing Arts (2016)': 0.96,
  'BTEC Ext Cert - Sport (2016)': 0.97,
  'BTEC Ext Cert - Sport & Exercise Science (2016)': 0.97,

  'BTEC Dip - Applied Science (2016)': 0.85,
  'BTEC Dip - Art & Design (2016)': 0.91,
  'BTEC Dip - Business (2016)': 0.95,
  'BTEC Dip - Aeronautical Engineering (2016)': 0.82,
  'BTEC Dip - Children\'s Play Learning and Development (2016)': 0.95,
  'BTEC Dip - Civil Engineering (2016)': 0.82,
  'BTEC Dip - Engineering (2016)': 0.82,
  'BTEC Dip - Film & Television Production (2016)': 0.92,
  'BTEC Dip - Fitness Services (2016)': 1.03,
  'BTEC Dip - Health & Social Care (2016)': 0.91,
  'BTEC Dip - Information Technology (2016)': 0.94,
  'BTEC Dip - Music Technology (2016)': 0.67,
  'BTEC Dip - Manufacturing Engineering (2016)': 0.82,
  'BTEC Dip - Mechanical Engineering (2016)': 0.82,
  'BTEC Dip - Performing Arts (2016)': 0.88,
  'BTEC Dip - Sport (2016)': 0.93,
  'BTEC Dip - Photography (2016)': 0.91,
  'BTEC Dip - Sport & Exercise Science (2016)': 0.88,

  'BTEC Ext Dip - Aeronautical Engineering (2016)': 0.86,
  'BTEC Ext Dip - Applied Science (2016)': 0.94,
  'BTEC Ext Dip - Art & Design (2016)': 0.93,
  'BTEC Ext Dip - Business (2016)': 0.96,
  'BTEC Ext Dip - Children\'s Play Learning & Development (2016)': 0.94,
  'BTEC Ext Dip - Computing (2016)': 0.84,
  'BTEC Ext Dip - Civil Engineering (2016)': 0.86,
  'BTEC Ext Dip - Construction & the Built Environment (2016)': 0.89,
  'BTEC Ext Dip - Creative Digital Media Production (2016)': 0.90,
  'BTEC Ext Dip - Engineering (2016)': 0.83,
  'BTEC Ext Dip - Electrical & Electronic Engineering (2016)': 0.86,
  'BTEC Ext Dip - Health & Social Care (2016)': 0.99,
  'BTEC Ext Dip - Horse Management (2016)': 0.93,
  'BTEC Ext Dip - Hospitality (2016)': 0.82,
  'BTEC Ext Dip - IT (2016)': 0.88,
  'BTEC Ext Dip - Land–based & Environment (2016)': 0.82,
  'BTEC Ext Dip - Manufacturing Engineering (2016)': 0.76,
  'BTEC Ext Dip - Mechanical Engineering (2016)': 0.85,
  'BTEC Ext Dip - Music (2016)': 0.75,
  'BTEC Ext Dip - Music Technology (2016)': 0.71,
  'BTEC Ext Dip - Performing Arts (2016)': 0.91,
  'BTEC Ext Dip - Performing Arts (Acting) (2016)': 0.96,
  'BTEC Ext Dip - Performing Arts (Dance) (2016)': 0.94,
  'BTEC Ext Dip - Performing Arts (Musical Theatre) (2016)': 0.91,
  'BTEC Ext Dip - Production Arts (2016)': 0.80,
  'BTEC Ext Dip - Public Services (2016)': 0.79,
  'BTEC Ext Dip - Sport (2016)': 0.91,
  'BTEC Ext Dip - Sport & Exercise Sciences (2016)': 0.92,
  'BTEC Ext Dip - Travel & Tourism (2016)': 0.89,
  'BTEC Ext Dip - Vehicle Technology (2016)': 0.90,
  
  // UAL (60th percentile from ALPS Benchmark Tables.txt)
  'UAL L3 Dip - Art & Design': 0.90,
  'UAL L3 Dip - Art & Design (Foundation Studies)': 0.88,
  'UAL L3 Dip - Creative Media Production & Technology': 0.92,
  'UAL L3 Dip - Music Performance & Production': 0.94,
  'UAL L3 Dip - Performing and Production Arts': 0.97,
  'UAL L3 Ext Dip - Art & Design': 0.89,
  'UAL L3 Ext Dip - Creative Media Production & Technology': 0.95,
  'UAL L3 Ext Dip - Music Performance & Production': 0.96,
  'UAL L3 Ext Dip - Performing & Production Arts': 1.03,

  // WJEC (60th percentile from ALPS Benchmark Tables.txt)
  'WJEC L3 Applied Cert - Criminology': 0.93,
  'WJEC L3 Applied Cert - Food Science & Nutrition': 0.88, 
  'WJEC L3 Applied Dip - Criminology': 0.85, 
  'WJEC L3 Applied Dip - Food Science & Nutrition': 0.81,

  // CACHE (60th percentile from ALPS Benchmark Tables.txt)
  'CACHE Award - Child Care & Education': 0.84,
  'CACHE Cert - Child Care & Education': 0.78,
  'CACHE Cert - Health & Social Care': 0.95,
  'CACHE Cert - Preparing to Work in Early Years Education & Care': 0.75,
  'CACHE Dip - Child Care & Education': 0.90,
  'CACHE Dip - Early Years Education & Care': 0.88,
  'CACHE Ext Dip - Health & Social Care': 0.98,
  'CACHE Tech Cert - Child Care and Education': 0.84,
  'CACHE Tech Cert - Health and Social Care': 0.92,
  'CACHE Tech Dip - Child Care and Education': 0.91,
  'CACHE Tech Ext Dip - Health and Social Care': 0.96,

  // IB (60th percentile from ALPS Benchmark Tables.txt)
  'IB SL - Biology': 0.99,
  'IB SL - Chemistry': 0.88,
  'IB SL - Economics': 1.01,
  'IB SL - Environmental systems & societies': 1.05,
  'IB SL - Geography': 1.11,
  'IB SL - History': 0.99,
  'IB SL - Language A: Language & Literature': 1.05,
  'IB SL - Language A: Literature': 0.97,
  'IB SL - Language ab initio': 0.98,
  'IB SL - Language B Option 1': 0.98,
  'IB SL - Mathematical Studies': 1.03,
  'IB SL - Mathematics': 0.87,
  'IB SL - Physics': 0.84,
  'IB SL - Psychology': 0.99,
  'IB SL - Sports, Exercise & Health Science': 1.10,
  'IB HL - Biology': 0.95,
  'IB HL - Chemistry': 0.87,
  'IB HL - Classical Languages': 1.00,
  'IB HL - Design Technology': 0.95,
  'IB HL - Economics': 1.00,
  'IB HL - Film': 1.02,
  'IB HL - Geography': 1.05,
  'IB HL - Global Politics': 1.03,
  'IB HL - History': 1.00,
  'IB HL - Language A: Language & Literature': 1.09,
  'IB HL - Language A: Literature': 1.00,
  'IB HL - Language B Option 1': 1.03,
  'IB HL - Mathematics': 0.80,
  'IB HL - Philosophy': 1.04,
  'IB HL - Physics': 0.86,
  'IB HL - Psychology': 1.01,
  'IB HL - Theatre': 1.17,
  'IB HL - Visual Arts': 0.95,

  // Pre-U (60th percentile from ALPS Benchmark Tables.txt)
  'Pre-U - Art & Design': 1.10,
  'Pre-U - Art History': 0.91,
  'Pre-U - Biology': 0.86,
  'Pre-U - Business & Management': 0.99,
  'Pre-U - Chemistry': 0.89,
  'Pre-U - Classical Greek': 0.95,
  'Pre-U - Economics': 0.90,
  'Pre-U - English Literature': 0.97,
  'Pre-U - French': 0.96,
  'Pre-U - Geography': 0.97,
  'Pre-U - German': 0.98,
  'Pre-U - Global Perspectives & Independent Research': 0.99,
  'Pre-U - History': 0.88,
  'Pre-U - Italian': 0.93,
  'Pre-U - Latin': 0.95,
  'Pre-U - Mandarin Chinese': 1.08,
  'Pre-U - Mathematics': 0.87,
  'Pre-U - Music': 1.05,
  'Pre-U - Philosophy & Theology': 0.88,
  'Pre-U - Physics': 0.97,
  'Pre-U - Russian': 1.05,
  'Pre-U - Spanish': 0.95,
  'Pre-U SC - Global Perspectives': 0.82,
  'Pre-U SC - Mandarin Chinese': 1.15,
};

// --- IB Specific Benchmark Data (Table 1 from IB section) ---
// This table REMAINS THE SAME as it defines bands based on GCSE scores to IB points/MEG aspirations.
// The choice of percentile will affect A-Level base points and subject factors, 
// but IB prior attainment banding usually remains consistent.
const ibGcseScoreToExpectedPointsTable = [
  { gcseMin: 8.35, gcseMax: Infinity, hlPoints: 6.58, hlMeg: '7', slPoints: 6.46, slMeg: '7', ibAlpsBand: 1 },
  { gcseMin: 8.10, gcseMax: 8.35, hlPoints: 6.43, hlMeg: '7', slPoints: 6.33, slMeg: '7', ibAlpsBand: 2 },
  { gcseMin: 7.70, gcseMax: 8.10, hlPoints: 6.11, hlMeg: '6', slPoints: 6.04, slMeg: '6', ibAlpsBand: 3 },
  { gcseMin: 7.28, gcseMax: 7.70, hlPoints: 5.92, hlMeg: '6', slPoints: 5.78, slMeg: '6', ibAlpsBand: 4 },
  { gcseMin: 7.00, gcseMax: 7.28, hlPoints: 5.59, hlMeg: '6', slPoints: 5.82, slMeg: '6', ibAlpsBand: 5 },
  { gcseMin: 6.25, gcseMax: 7.00, hlPoints: 5.52, hlMeg: '6', slPoints: 5.38, slMeg: '6', ibAlpsBand: 6 },
  { gcseMin: 5.50, gcseMax: 6.25, hlPoints: 5.22, hlMeg: '5', slPoints: 4.80, slMeg: '5', ibAlpsBand: 7 },
  { gcseMin: 4.80, gcseMax: 5.50, hlPoints: 4.89, hlMeg: '5', slPoints: 4.39, slMeg: '5', ibAlpsBand: 8 },
  { gcseMin: 0.00, gcseMax: 4.80, hlPoints: 3.85, hlMeg: '4', slPoints: 3.88, slMeg: '4', ibAlpsBand: 9 },
];

function getIbExpectedPointsDetails(gcsePriorAttainmentScore, level) {
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || (level !== 'HL' && level !== 'SL')) {
    return null;
  }
  for (const band of ibGcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= band.gcseMin && gcsePriorAttainmentScore < band.gcseMax) {
      return {
        expectedPoints: level === 'HL' ? band.hlPoints : band.slPoints,
        megAspiration: level === 'HL' ? band.hlMeg : band.slMeg, 
        ibAlpsBand: band.ibAlpsBand,
      };
    }
  }
  return null;
}

// --- Pre-U Specific Benchmark Data ---
// This table REMAINS THE SAME.
const preUGcseScoreToExpectedPointsTable = [
  { gcseMin: 8.50, gcseMax: Infinity, fullPoints: 81.57, fullMeg: 'D1/D2', scPoints: 40.79, scMeg: 'D1/D2', preUAlpsBand: 1 },
  { gcseMin: 8.22, gcseMax: 8.50, fullPoints: 78.18, fullMeg: 'D2', scPoints: 39.09, scMeg: 'D2', preUAlpsBand: 2 },
  { gcseMin: 8.05, gcseMax: 8.22, fullPoints: 76.67, fullMeg: 'D2/D3', scPoints: 38.34, scMeg: 'D2/D3', preUAlpsBand: 3 },
  { gcseMin: 7.83, gcseMax: 8.05, fullPoints: 74.29, fullMeg: 'D2/D3', scPoints: 36.96, scMeg: 'D2/D3', preUAlpsBand: 4 },
  { gcseMin: 7.55, gcseMax: 7.83, fullPoints: 70.83, fullMeg: 'D3', scPoints: 35.00, scMeg: 'D3', preUAlpsBand: 5 },
  { gcseMin: 7.17, gcseMax: 7.55, fullPoints: 68.26, fullMeg: 'D3', scPoints: 34.13, scMeg: 'D3', preUAlpsBand: 6 },
  { gcseMin: 6.68, gcseMax: 7.17, fullPoints: 66.67, fullMeg: 'D3/M1', scPoints: 33.34, scMeg: 'D3/M1', preUAlpsBand: 7 },
  { gcseMin: 5.95, gcseMax: 6.68, fullPoints: 60.00, fullMeg: 'M1', scPoints: 30.00, scMeg: 'M1', preUAlpsBand: 8 },
  { gcseMin: 0.00, gcseMax: 5.95, fullPoints: 51.82, fullMeg: 'M2', scPoints: 25.91, scMeg: 'M2', preUAlpsBand: 9 },
];

function getPreUExpectedPointsDetails(gcsePriorAttainmentScore, courseType) {
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || (courseType !== 'FULL' && courseType !== 'SC')) {
    return null;
  }
  for (const band of preUGcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= band.gcseMin && gcsePriorAttainmentScore < band.gcseMax) {
      return {
        expectedPoints: courseType === 'FULL' ? band.fullPoints : band.scPoints,
        megAspiration: courseType === 'FULL' ? band.fullMeg : band.scMeg, 
        preUAlpsBand: band.preUAlpsBand,
      };
    }
  }
  return null;
}

// --- BTEC 2016 Suite (Main - ExtCert, Dip, ExtDip) --- 
// These tables REMAINS THE SAME as they define 75th percentile MEG aspirations.
const btec2016MainGcseScoreToExpectedPointsTable = [
  { gcseMin: 6.00, gcseMax: Infinity, extCertPoints: 132.50, extCertMeg: 'D*', dipPoints: 273.33, dipMeg: 'D*D*', extDipPoints: 395.00, extDipMeg: 'D*D*D', btecAlpsBand: 1 },
  { gcseMin: 5.28, gcseMax: 6.00, extCertPoints: 120.00, extCertMeg: 'Dis', dipPoints: 265.00, dipMeg: 'D*D*/D*D', extDipPoints: 380.00, extDipMeg: 'D*DD', btecAlpsBand: 2 },
  { gcseMin: 4.90, gcseMax: 5.28, extCertPoints: 113.33, extCertMeg: 'Dis', dipPoints: 253.33, dipMeg: 'D*D', extDipPoints: 365.00, extDipMeg: 'D*DD/DDD', btecAlpsBand: 3 },
  { gcseMin: 4.62, gcseMax: 4.90, extCertPoints: 106.67, extCertMeg: 'Dis', dipPoints: 250.00, dipMeg: 'D*D/DD', extDipPoints: 355.00, extDipMeg: 'DDD', btecAlpsBand: 4 },
  { gcseMin: 4.37, gcseMax: 4.62, extCertPoints: 100.00, extCertMeg: 'D/M', dipPoints: 240.00, dipMeg: 'DD', extDipPoints: 350.00, extDipMeg: 'DDD', btecAlpsBand: 5 },
  { gcseMin: 4.13, gcseMax: 4.37, extCertPoints: 95.00, extCertMeg: 'D/M', dipPoints: 226.67, dipMeg: 'DD', extDipPoints: 333.33, extDipMeg: 'DDD/DDM', btecAlpsBand: 6 },
  { gcseMin: 3.89, gcseMax: 4.13, extCertPoints: 90.00, extCertMeg: 'D/M', dipPoints: 225.00, dipMeg: 'DD', extDipPoints: 320.00, extDipMeg: 'DDM', btecAlpsBand: 7 },
  { gcseMin: 3.62, gcseMax: 3.89, extCertPoints: 84.80, extCertMeg: 'M', dipPoints: 220.00, dipMeg: 'DD/DM', extDipPoints: 310.00, extDipMeg: 'DDM', btecAlpsBand: 8 },
  { gcseMin: 3.20, gcseMax: 3.62, extCertPoints: 80.00, extCertMeg: 'M', dipPoints: 205.00, dipMeg: 'DM', extDipPoints: 293.33, extDipMeg: 'DDM/DMM', btecAlpsBand: 9 },
  { gcseMin: 0.00, gcseMax: 3.20, extCertPoints: 64.00, extCertMeg: 'M/P', dipPoints: 186.67, dipMeg: 'DM/MM', extDipPoints: 275.00, extDipMeg: 'DMM', btecAlpsBand: 10 },
];

function getBtec2016MainExpectedPointsDetails(gcsePriorAttainmentScore, btecSize) {
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['EXTCERT', 'DIP', 'EXTDIP'].includes(btecSize.toUpperCase())) {
    return null;
  }
  for (const band of btec2016MainGcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= band.gcseMin && gcsePriorAttainmentScore < band.gcseMax) {
      let points, meg;
      switch (btecSize.toUpperCase()) {
        case 'EXTCERT': points = band.extCertPoints; meg = band.extCertMeg; break;
        case 'DIP': points = band.dipPoints; meg = band.dipMeg; break;
        case 'EXTDIP': points = band.extDipPoints; meg = band.extDipMeg; break;
        default: return null;
      }
      return {
        expectedPoints: points, 
        megAspiration: meg,    
        btecAlpsBand: band.btecAlpsBand,
      };
    }
  }
  return null;
}

// --- BTEC 2016 Suite (One Year - Cert, FoundDip) ---
// This table REMAINS THE SAME.
const btec2016OneYearGcseScoreToExpectedPointsTable = [
  { gcseMin: 6.00, gcseMax: Infinity, certPoints: 61.67, certMeg: 'D*/D', foundDipPoints: 180.00, foundDipMeg: 'D*/D', camTechFoundDipMeg: 'D*D', btecAlpsBand: 1 },
  { gcseMin: 5.28, gcseMax: 6.00, certPoints: 54.29, certMeg: 'Dis', foundDipPoints: 156.00, foundDipMeg: 'Dis', camTechFoundDipMeg: 'DD', btecAlpsBand: 2 },
  { gcseMin: 4.90, gcseMax: 5.28, certPoints: 51.67, certMeg: 'Dis', foundDipPoints: 140.00, foundDipMeg: 'D/M', camTechFoundDipMeg: 'DM', btecAlpsBand: 3 },
  { gcseMin: 4.62, gcseMax: 4.90, certPoints: 46.67, certMeg: 'D/M', foundDipPoints: 135.00, foundDipMeg: 'D/M', camTechFoundDipMeg: 'DM', btecAlpsBand: 4 },
  { gcseMin: 4.37, gcseMax: 4.62, certPoints: 44.29, certMeg: 'D/M', foundDipPoints: 120.00, foundDipMeg: 'M', camTechFoundDipMeg: 'MM', btecAlpsBand: 5 },
  { gcseMin: 4.13, gcseMax: 4.37, certPoints: 42.22, certMeg: 'D/M', foundDipPoints: 120.00, foundDipMeg: 'M', camTechFoundDipMeg: 'MM', btecAlpsBand: 6 },
  { gcseMin: 3.89, gcseMax: 4.13, certPoints: 37.14, certMeg: 'M', foundDipPoints: 108.00, foundDipMeg: 'M', camTechFoundDipMeg: 'MM', btecAlpsBand: 7 },
  { gcseMin: 3.62, gcseMax: 3.89, certPoints: 40.00, certMeg: 'M', foundDipPoints: 107.14, foundDipMeg: 'M', camTechFoundDipMeg: 'MM', btecAlpsBand: 8 },
  { gcseMin: 3.20, gcseMax: 3.62, certPoints: 33.57, certMeg: 'M', foundDipPoints: 94.29, foundDipMeg: 'M/P', camTechFoundDipMeg: 'MP', btecAlpsBand: 9 },
  { gcseMin: 0.00, gcseMax: 3.20, certPoints: 28.57, certMeg: 'M/P', foundDipPoints: 90.00, foundDipMeg: 'M/P', camTechFoundDipMeg: 'MP', btecAlpsBand: 10 },
];

function getBtec2016OneYearExpectedPointsDetails(gcsePriorAttainmentScore, btecSize) {
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['CERT', 'FOUNDDIP'].includes(btecSize.toUpperCase())) {
    return null;
  }
  for (const band of btec2016OneYearGcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= band.gcseMin && gcsePriorAttainmentScore < band.gcseMax) {
      let points, meg;
      const camTechMeg = band.camTechFoundDipMeg;
      switch (btecSize.toUpperCase()) {
        case 'CERT': points = band.certPoints; meg = band.certMeg; break;
        case 'FOUNDDIP': points = band.foundDipPoints; meg = band.foundDipMeg; break;
        default: return null;
      }
      return {
        expectedPoints: points, 
        megAspiration: meg,    
        btecAlpsBand: band.btecAlpsBand,
        camTechFoundDipMeg: camTechMeg 
      };
    }
  }
  return null;
}

// --- BTEC 2010 Suite Benchmark Data ---
// This table REMAINS THE SAME.
const btec2010GcseBandsToMegGradeTable = [
  { band: 1, gcseMin: 6.60, gcseMax: Infinity, certMEG: 'D*', subDipMEG: 'D*', ninetyCrMEG: 'D*D*', dipMEG: 'D*D*', extDipMEG: 'D*D*D*' },
  { band: 2, gcseMin: 6.17, gcseMax: 6.60, certMEG: 'D*', subDipMEG: 'D*', ninetyCrMEG: 'D*D*', dipMEG: 'D*D*', extDipMEG: 'D*D*D*' },
  { band: 3, gcseMin: 5.67, gcseMax: 6.17, certMEG: 'D*', subDipMEG: 'D*', ninetyCrMEG: 'D*D*', dipMEG: 'D*D*', extDipMEG: 'D*D*D*' },
  { band: 4, gcseMin: 5.23, gcseMax: 5.67, certMEG: 'D*', subDipMEG: 'D*', ninetyCrMEG: 'D*D/DD', dipMEG: 'D*D/DD', extDipMEG: 'D*D*D*/D*D*D' },
  { band: 5, gcseMin: 4.76, gcseMax: 5.23, certMEG: 'D*', subDipMEG: 'D*/D', ninetyCrMEG: 'DD', dipMEG: 'DD', extDipMEG: 'D*D*D' },
  { band: 6, gcseMin: 4.38, gcseMax: 4.76, certMEG: 'Dis', subDipMEG: 'Dis', ninetyCrMEG: 'D*/D', dipMEG: 'D*/D', extDipMEG: 'D*DD' },
  { band: 7, gcseMin: 3.75, gcseMax: 4.38, certMEG: 'Dis', subDipMEG: 'Dis', ninetyCrMEG: 'D', dipMEG: 'D', extDipMEG: 'DDD' },
  { band: 8, gcseMin: 3.31, gcseMax: 3.75, certMEG: 'Dis', subDipMEG: 'D/M', ninetyCrMEG: 'DM', dipMEG: 'DM', extDipMEG: 'DDD' },
  { band: 9, gcseMin: 3.00, gcseMax: 3.31, certMEG: 'D/M', subDipMEG: 'DM', ninetyCrMEG: 'DM/MM', dipMEG: 'DM/MM', extDipMEG: 'DDM' },
  { band: 10, gcseMin: 2.58, gcseMax: 3.00, certMEG: 'D/M', subDipMEG: 'DM', ninetyCrMEG: 'MM', dipMEG: 'MM', extDipMEG: 'DDM/DMM' },
  { band: 11, gcseMin: 0.00, gcseMax: 2.58, certMEG: 'M', subDipMEG: 'M', ninetyCrMEG: 'DM/MM', dipMEG: 'DM/MM', extDipMEG: 'DMM' },
];

const btec2010GradeToPoints = {
  CERT: { 'D*': 140, 'D': 120, 'M': 80, 'P': 40, 'D*/D': 130, 'D/M': 100, 'M/P': 60, 'P/U': 20, 'U': 0 },
  SUBDIP: { 'D*': 140, 'D': 120, 'M': 80, 'P': 40, 'D*/D': 130, 'D/M': 100, 'M/P': 60, 'P/U': 20, 'U': 0 }, 
  NINETY_CR: {
    'D*D*': 280, 'D*D': 260, 'DD': 240, 'DM': 200, 'MM': 160, 'MP': 120, 'PP': 80,
    'D*D/DD': 250, 'D*/D': 200, 'D': 120, 'D/M': 100, 'MM/MP': 140, 'DM/MM': 180,
    'M': 80, 'M/P': 60, 'P': 40, 'U': 0,
  },
  DIP: {
    'D*D*': 280, 'D*D': 260, 'DD': 240, 'DM': 200, 'MM': 160, 'MP': 120, 'PP': 80,
    'D*D*/D*D': 270, 'D*D/DD': 250, 'DD/DM': 220, 'DM/MM': 180, 'MM/MP': 140, 'MP/PP': 100,
    'D*': 140, 'D': 120, 'M': 80, 'P': 40, 'U': 0,
  },
  EXTDIP: {
    'D*D*D*': 420, 'D*D*D': 400, 'D*DD': 380, 'DDD': 360, 'DDM': 320, 'DMM': 280, 
    'MMM': 240, 'MMP': 200, 'MPP': 160, 'PPP': 120,
    'D*D*D*/D*D*D': 410, 'D*D*D/D*DD': 390, 'D*DD/DDD': 370, 'DDD/DDM': 340,
    'DDM/DMM': 300, 'DMM/MMM': 260, 'MMM/MMP': 220, 'MMP/MPP': 180, 'MPP/PPP': 140,
    'D*': 140, 'D': 120, 'M': 80, 'P': 40, 'U': 0,
  }
};

function getBtec2010MegDetails(gcsePriorAttainmentScore, btecSize) {
  const sizeKey = String(btecSize).toUpperCase();
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['CERT', 'SUBDIP', 'NINETY_CR', 'DIP', 'EXTDIP'].includes(sizeKey)) {
    return null;
  }
  for (const bandDetails of btec2010GcseBandsToMegGradeTable) {
    if (gcsePriorAttainmentScore >= bandDetails.gcseMin && gcsePriorAttainmentScore < bandDetails.gcseMax) {
      let megGradeString;
      switch (sizeKey) {
        case 'CERT': megGradeString = bandDetails.certMEG; break;
        case 'SUBDIP': megGradeString = bandDetails.subDipMEG; break;
        case 'NINETY_CR': megGradeString = bandDetails.ninetyCrMEG; break;
        case 'DIP': megGradeString = bandDetails.dipMEG; break;
        case 'EXTDIP': megGradeString = bandDetails.extDipMEG; break;
        default: return null;
      }
      const pointsForMegGrade = btec2010GradeToPoints[sizeKey]?.[megGradeString];
      return {
        megAspiration: megGradeString, 
        expectedPoints: pointsForMegGrade !== undefined ? pointsForMegGrade : null, 
        btecAlpsBand: bandDetails.band,
      };
    }
  }
  return null;
}

// --- UAL L3 Specific Benchmark Data ---
// This table REMAINS THE SAME.
const ualL3GcseScoreToExpectedPointsTable = [
  { band: 1, gcseMin: 5.80, gcseMax: Infinity, dipPoints: 79.20, extDipPoints: 158.40, megGrade: 'Dis' },
  { band: 2, gcseMin: 5.06, gcseMax: 5.80, dipPoints: 71.08, extDipPoints: 142.15, megGrade: 'D/M' },
  { band: 3, gcseMin: 4.65, gcseMax: 5.06, dipPoints: 70.40, extDipPoints: 140.80, megGrade: 'D/M' },
  { band: 4, gcseMin: 4.39, gcseMax: 4.65, dipPoints: 64.80, extDipPoints: 129.60, megGrade: 'D/M' },
  { band: 5, gcseMin: 4.10, gcseMax: 4.39, dipPoints: 64.00, extDipPoints: 128.00, megGrade: 'M' },
  { band: 6, gcseMin: 3.91, gcseMax: 4.10, dipPoints: 62.00, extDipPoints: 124.00, megGrade: 'M' },
  { band: 7, gcseMin: 3.67, gcseMax: 3.91, dipPoints: 60.00, extDipPoints: 120.00, megGrade: 'M' },
  { band: 8, gcseMin: 3.37, gcseMax: 3.67, dipPoints: 57.60, extDipPoints: 115.20, megGrade: 'M' },
  { band: 9, gcseMin: 3.00, gcseMax: 3.37, dipPoints: 55.20, extDipPoints: 110.40, megGrade: 'M' },
  { band: 10, gcseMin: 0.00, gcseMax: 3.00, dipPoints: 52.94, extDipPoints: 105.88, megGrade: 'M/P' },
];

function getUalL3ExpectedPointsDetails(gcsePriorAttainmentScore, ualSize) {
  const sizeKey = String(ualSize).toUpperCase();
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['DIP', 'EXTDIP'].includes(sizeKey)) {
    return null;
  }
  for (const bandDetails of ualL3GcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= bandDetails.gcseMin && gcsePriorAttainmentScore < bandDetails.gcseMax) {
      let points;
      switch (sizeKey) {
        case 'DIP': points = bandDetails.dipPoints; break;
        case 'EXTDIP': points = bandDetails.extDipPoints; break;
        default: return null;
      }
      return {
        expectedPoints: points, 
        megAspiration: bandDetails.megGrade, 
        ualAlpsBand: bandDetails.band,
      };
    }
  }
  return null;
}

// --- WJEC L3 Specific Benchmark Data ---
// This table REMAINS THE SAME.
const wjecL3GcseScoreToExpectedPointsTable = [
  { band: 1, gcseMin: 6.00, gcseMax: Infinity, certPoints: 54.44, certMeg: 'A*/A', dipPoints: 132.50, dipMegAsp: 'D*' },
  { band: 2, gcseMin: 5.28, gcseMax: 6.00, certPoints: 49.55, certMeg: 'A/B', dipPoints: 120.00, dipMegAsp: 'Dis' },
  { band: 3, gcseMin: 4.90, gcseMax: 5.28, certPoints: 44.29, certMeg: 'B', dipPoints: 113.33, dipMegAsp: 'Dis' },
  { band: 4, gcseMin: 4.62, gcseMax: 4.90, certPoints: 40.00, certMeg: 'B/C', dipPoints: 106.67, dipMegAsp: 'Dis' },
  { band: 5, gcseMin: 4.37, gcseMax: 4.62, certPoints: 37.50, certMeg: 'B/C', dipPoints: 100.00, dipMegAsp: 'D/M' },
  { band: 6, gcseMin: 4.13, gcseMax: 4.37, certPoints: 36.92, certMeg: 'C', dipPoints: 95.00, dipMegAsp: 'D/M' },
  { band: 7, gcseMin: 3.89, gcseMax: 4.13, certPoints: 33.33, certMeg: 'C/D', dipPoints: 90.00, dipMegAsp: 'D/M' },
  { band: 8, gcseMin: 3.62, gcseMax: 3.89, certPoints: 30.00, certMeg: 'C/D', dipPoints: 84.80, dipMegAsp: 'M' },
  { band: 9, gcseMin: 3.20, gcseMax: 3.62, certPoints: 30.00, certMeg: 'Dis', dipPoints: 80.00, dipMegAsp: 'M' },
  { band: 10, gcseMin: 0.00, gcseMax: 3.20, certPoints: 0, certMeg: 'Dis', dipPoints: 64.00, dipMegAsp: 'M/P' },
];

function getWjecL3ExpectedPointsDetails(gcsePriorAttainmentScore, wjecSize) {
  const sizeKey = String(wjecSize).toUpperCase();
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['CERT', 'DIP'].includes(sizeKey)) {
    return null;
  }
  for (const bandDetails of wjecL3GcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= bandDetails.gcseMin && gcsePriorAttainmentScore < bandDetails.gcseMax) {
      let points, meg;
      switch (sizeKey) {
        case 'CERT': points = bandDetails.certPoints; meg = bandDetails.certMeg; break;
        case 'DIP': points = bandDetails.dipPoints; meg = bandDetails.dipMegAsp; break;
        default: return null;
      }
      return {
        expectedPoints: points, 
        megAspiration: meg,    
        wjecAlpsBand: bandDetails.band,
      };
    }
  }
  return null;
}

// --- CACHE Specific Benchmark Data ---
// This table REMAINS THE SAME.
const cacheGcseScoreToExpectedPointsTable = [
  { band: 1, gcseMin: 6.60, gcseMax: Infinity, awardPts: 32.50, certPts: 65.00, dipPts: 130.00, extDipPts: 195.00, megGrade: 'A*/A' },
  { band: 2, gcseMin: 6.17, gcseMax: 6.60, awardPts: 32.50, certPts: 65.00, dipPts: 130.00, extDipPts: 195.00, megGrade: 'A*/A' },
  { band: 3, gcseMin: 5.67, gcseMax: 6.17, awardPts: 32.50, certPts: 65.00, dipPts: 130.00, extDipPts: 195.00, megGrade: 'A*/A' },
  { band: 4, gcseMin: 5.23, gcseMax: 5.67, awardPts: 30.00, certPts: 60.00, dipPts: 120.00, extDipPts: 180.00, megGrade: 'A' },
  { band: 5, gcseMin: 4.76, gcseMax: 5.23, awardPts: 30.00, certPts: 60.00, dipPts: 120.00, extDipPts: 180.00, megGrade: 'A' },
  { band: 6, gcseMin: 4.38, gcseMax: 4.76, awardPts: 28.22, certPts: 56.43, dipPts: 112.86, extDipPts: 169.29, megGrade: 'A/B' },
  { band: 7, gcseMin: 3.75, gcseMax: 4.38, awardPts: 26.36, certPts: 52.73, dipPts: 105.45, extDipPts: 158.18, megGrade: 'A/B' },
  { band: 8, gcseMin: 3.31, gcseMax: 3.75, awardPts: 24.17, certPts: 48.34, dipPts: 96.67, extDipPts: 145.01, megGrade: 'B' },
  { band: 9, gcseMin: 3.00, gcseMax: 3.31, awardPts: 23.75, certPts: 47.50, dipPts: 95.00, extDipPts: 142.50, megGrade: 'B' },
  { band: 10, gcseMin: 2.58, gcseMax: 3.00, awardPts: 22.73, certPts: 45.46, dipPts: 90.91, extDipPts: 136.37, megGrade: 'B/C' },
  { band: 11, gcseMin: 0.00, gcseMax: 2.58, awardPts: 20.00, certPts: 40.00, dipPts: 80.00, extDipPts: 120.00, megGrade: 'C' },
];

function getCacheExpectedPointsDetails(gcsePriorAttainmentScore, cacheSize) {
  const sizeKey = String(cacheSize).toUpperCase();
  if (typeof gcsePriorAttainmentScore !== 'number' || isNaN(gcsePriorAttainmentScore) || 
      !['AWARD', 'CERT', 'DIP', 'EXTDIP'].includes(sizeKey)) {
    return null;
  }
  for (const bandDetails of cacheGcseScoreToExpectedPointsTable) {
    if (gcsePriorAttainmentScore >= bandDetails.gcseMin && gcsePriorAttainmentScore < bandDetails.gcseMax) {
      let points;
      switch (sizeKey) {
        case 'AWARD': points = bandDetails.awardPts; break;
        case 'CERT': points = bandDetails.certPts; break;
        case 'DIP': points = bandDetails.dipPts; break;
        case 'EXTDIP': points = bandDetails.extDipPts; break;
        default: return null;
      }
      return {
        expectedPoints: points, 
        megAspiration: bandDetails.megGrade, 
        cacheAlpsBand: bandDetails.band, 
      };
    }
  }
  return null;
}

module.exports = {
  getAlpsBandDetailsFromGcseScore, 
  subjectSpecificFactors60thPercentile, // Exporting the 60th percentile factors
  // All other tables and functions below REMAINS THE SAME as they define 75th percentile MEG aspirations/points for vocational quals.
  // The percentile variation for these is primarily applied via the A-Level base points (if A-Level is the root qual type)
  // and the subjectSpecificFactors<XX>thPercentile that gets applied.
  getIbExpectedPointsDetails, 
  getPreUExpectedPointsDetails,
  getBtec2016MainExpectedPointsDetails,
  getBtec2016OneYearExpectedPointsDetails,
  getBtec2010MegDetails,
  btec2010GradeToPoints, 
  getUalL3ExpectedPointsDetails,
  getWjecL3ExpectedPointsDetails,
  getCacheExpectedPointsDetails, 
}; 