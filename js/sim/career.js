// STUB — replaced by the real implementation (docs/GOALS_AND_ENDING.md). Keeps the game booting meanwhile.
export const CAREER_YEARS = 10;
export function initCareer() {}
export function ensureCareer(state) { return state.career; }
export function onboardingList(state) { return []; }
export function currentGoals(state) { return []; }
export function yearReviews(state) { return (state.career && state.career.reviews) || []; }
export function careerSummary(state) { return { year: state.time.year, yearsLeft: Math.max(0, CAREER_YEARS - state.time.year + 1), endless: false, ending: null }; }
export function setEndless(state, on) { if (state.career) state.career.endless = !!on; }
export function careerCardText(state) { return ''; }
