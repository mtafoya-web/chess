import type { ReviewRunAction } from './review-coordinator';
import { validPreferences, SEARCH_PROFILES } from './review-scoring';
import type { ReviewPreferences } from './review-scoring';
import type { ReviewState } from './review-model';
import { isDiagnostic } from './diagnostics';
import { isSiteTheme, type PanelThemeMessage } from './theme';
import { ORIGINS, type AnalysisEvent, type EngineJob, type Evaluation, type MoveAnalysisRequest } from './types';
import type { ReviewEvent, ReviewJob, ReviewRequest, ReviewSession } from './review-types';
import type { PanelSettings, SettingsUpdate } from './settings';
import { isProviderAttempt, type AiTestResult } from './provider-failures';

type RecordValue = Record<string, unknown>;
export const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 120): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const boundedText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown, max = 1500): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const member = (v: unknown, values: readonly unknown[]) => values.includes(v);
const array = (v: unknown, max: number, check: (v: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(check);
export const isUci = (v: unknown): v is string => typeof v === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v);
/** Structural FEN validation; chess.js remains responsible for legal board/replay checks. */
export function isFen(v: unknown): v is string {
    if (!text(v, 200)) return false;
    const f = v.trim().split(/\s+/);
    return f.length === 6 && f[0].split('/').length === 8 && f[0].split('/').every(rank => /^[prnbqkPRNBQK1-8]+$/.test(rank) && [...rank].reduce((n, c) => n + (/[1-8]/.test(c) ? Number(c) : 1), 0) === 8) && /^[wb]$/.test(f[1]) && /^(?:-|K?Q?k?q?)$/.test(f[2]) && /^(?:-|[a-h][36])$/.test(f[3]) && /^\d{1,8}$/.test(f[4]) && /^[1-9]\d{0,7}$/.test(f[5]);
}
function score(v: unknown): boolean {
    return record(v) && (v.kind === 'cp' && finite(v.value) || v.kind === 'mate' && member(v.winner, ['w', 'b']) && integer(v.moves, 100000) || v.kind === 'terminal' && (v.winner === undefined || member(v.winner, ['w', 'b'])));
}
export function isEvaluation(v: unknown): v is Evaluation {
    return record(v) && boundedText(v.bestMove, 5) && (v.bestMove === '' || isUci(v.bestMove)) && text(v.evaluation, 120) && finite(v.whiteScore) && array(v.pvLines, 10, x => boundedText(x, 2000)) && array(v.promisingMoves, 10, isUci) && array(v.candidates, 10, c => record(c) && isUci(c.uci) && text(c.san, 40) && boundedText(c.pv, 2000) && finite(c.score) && (c.mate === undefined || finite(c.mate)) && (c.depth === undefined || integer(c.depth, 1000)) && (c.engineScore === undefined || score(c.engineScore)) && (c.uciPv === undefined || array(c.uciPv, 100, isUci)) && (c.sanPv === undefined || array(c.sanPv, 100, x => text(x, 40)))) && (v.terminal === undefined || text(v.terminal, 300)) && (v.engineScore === undefined || score(v.engineScore)) && (v.depth === undefined || integer(v.depth, 1000)) && (v.source === undefined || record(v.source) && text(v.source.kind) && text(v.source.label, 300) && (v.source.depth === undefined || integer(v.source.depth, 1000)));
}
export function isReviewSession(v: unknown): v is ReviewSession {
    return record(v) && text(v.id) && text(v.title, 500) && isFen(v.initialFen) && boundedText(v.result, 40) && array(v.moves, 1500, m => record(m) && integer(m.ply) && isUci(m.uci) && text(m.san, 40) && member(m.color, ['w', 'b']) && isFen(m.beforeFen) && isFen(m.afterFen)) && integer(v.selectedPly, v.moves.length) && (v.source === undefined || record(v.source) && text(v.source.url, 2048) && text(v.source.gameId) && (v.source.tabId === undefined || integer(v.source.tabId, 2147483647)));
}
export function isOpeningContext(v: unknown): boolean {
    const match = (m: unknown) => record(m) && typeof m.eco === 'string' && /^[A-E]\d{2}$/.test(m.eco) && text(m.name, 500) && integer(m.ply) && member(m.match, ['sequence', 'transposition']) && (m.purpose === undefined || text(m.purpose, 1000));
    return record(v) && (v.current === undefined || match(v.current)) && (v.entered === undefined || match(v.entered));
}
function isFeedback(v: unknown): boolean { return record(v) && text(v.label,120) && text(v.summary,2000) && (v.lossCp === undefined || finite(v.lossCp) && (v.lossCp as number) >= 0) && (v.bestMove === undefined || isUci(v.bestMove)) && (v.lossWinPercent === undefined || finite(v.lossWinPercent) && (v.lossWinPercent as number) >= 0 && (v.lossWinPercent as number) <= 100) && (v.accuracy === undefined || finite(v.accuracy) && (v.accuracy as number) >= 0 && (v.accuracy as number) <= 100) && (v.provisional === undefined || typeof v.provisional === 'boolean') && (v.confirmed === undefined || typeof v.confirmed === 'boolean'); }
export function isAnalysisEvent(v: unknown): v is AnalysisEvent | ReviewEvent {
    if (!record(v) || !text(v.requestId) || !Number.isInteger(v.tabId) || !text(v.type) || (v.diagnostic !== undefined && !isDiagnostic(v.diagnostic))) return false;
    if (v.type.startsWith('REVIEW_') && !text(v.sessionId)) return false;
    if (v.attempts !== undefined && !array(v.attempts,10,isProviderAttempt)) return false;
    switch (v.type) {
        case 'EXPLANATION_STATE': case 'REVIEW_EXPLANATION_STATE':
            return isFen(v.fen) && (v.type !== 'REVIEW_EXPLANATION_STATE' || integer(v.ply)) && (
                member(v.state, ['pending', 'failed']) && v.provider === undefined
                || v.state === 'ready' && member(v.provider, ['chrome', ...Object.keys(ORIGINS)])
                || v.state === 'fallback' && v.provider === 'facts');
        case 'REVIEW_ENGINE_COMPLETE': return integer(v.ply);
        case 'REVIEW_PRACTICE_RESULT': return integer(v.ply) && v.ply > 0 && isUci(v.attempt) && typeof v.accepted === 'boolean' && typeof v.uncertain === 'boolean' && isFeedback(v.feedback);
        case 'REVIEW_OPENING': return integer(v.ply) && isOpeningContext(v.opening);
        case 'ENGINE_RESULT': return isEvaluation(v.result);
        case 'STREAM_CHUNK': return boundedText(v.textDelta, 10000) && typeof v.isComplete === 'boolean';
        case 'STATUS': case 'ERROR': case 'REVIEW_STATUS': case 'REVIEW_ERROR': return text(v.text, 2000);
        case 'REVIEW_TEXT': return boundedText(v.text, 20000) && (v.provider === undefined || text(v.provider));
        case 'REVIEW_RESULT': return (v.profile === undefined || member(v.profile,Object.keys(SEARCH_PROFILES))) && (v.refinement === undefined || member(v.refinement,['pending','done'])) && (v.pendingConfirmation === undefined || typeof v.pendingConfirmation === 'boolean') && (v.opening === undefined || isOpeningContext(v.opening)) && integer(v.ply) && isEvaluation(v.after) && (v.before === undefined || isEvaluation(v.before)) && (v.advice === undefined || isEvaluation(v.advice)) && (v.feedback === undefined || isFeedback(v.feedback));
        default: return false;
    }
}
export function isSettings(v: unknown): boolean {
    return record(v) && member(v.provider, ['auto', 'chrome', ...Object.keys(ORIGINS)]) && member(v.cloudProvider, ['gemini', 'openai', 'groq']) && record(v.models) && Object.keys(ORIGINS).every(p => text((v.models as RecordValue)[p], 120)) && (v.analysisSource === undefined || member(v.analysisSource, ['auto', 'local'])) && (v.autoReviewFinishedGames === undefined || typeof v.autoReviewFinishedGames === 'boolean') && !Object.hasOwn(v, 'keys');
}
export interface ReviewControl { action: 'select' | 'sweep' | 'practice' | 'deeper' | 'next' | 'preferences'; ply?: number; preferences?: ReviewPreferences }
function isReviewControl(v: RecordValue): boolean { return member(v.action,['select','sweep','practice','deeper','next','preferences']) && (v.ply === undefined || integer(v.ply)) && (v.action !== 'select' || integer(v.ply)) && (v.action !== 'preferences' || validPreferences(v.preferences)); }
export type BackgroundRequest = {type:'CANCEL';requestId?:string} | {type:'REVIEW_RUN_CONTROL';sessionId:string;action:ReviewRunAction} | {type:'GET_REVIEW_PREFERENCES'} | {type:'SET_REVIEW_PREFERENCES';preferences:ReviewPreferences} | {type:'DISMISS_LEVEL_SUGGESTION';after:number} | { type: 'GET_REVIEW_STATE' | 'GET_LEARNING_HISTORY' } | { type: 'DELETE_LEARNING_HISTORY'; key?: string } | ({type:'REVIEW_CONTROL';sessionId:string} & ReviewControl) | {type:'REVIEW_VIEW';sessionId:string;ply:number;running:boolean;active?:boolean;practicePly?:number} | {type:'REVIEW_PRACTICE_RECORD';sessionId:string;ply:number;outcome:'solved'|'hinted'|'revealed'|'skipped'|'missed'} | MoveAnalysisRequest | ReviewRequest | { type: 'GET_SETTINGS' } | ({ type: 'SAVE_SETTINGS' } & SettingsUpdate) | { type: 'TEST_AI' | 'POSITION_REQUEST' | 'GET_OVERLAY_PREFERENCES' | 'GET_SITE_THEME' | 'CAPTURE_GAME' | 'START_PAGE_REVIEW' | 'REVIEW_AVAILABILITY' | 'OPEN_REVIEW' | 'NATIVE_REVIEW_REQUEST' | 'REOPEN' | 'SETTINGS_CHANGED' } | { type: 'SET_OVERLAY_PREFERENCES'; heatmap: boolean; arrows: boolean } | { type: 'SITE_THEME'; theme: unknown } | { type: 'IMPORT_PAGE_REVIEW'; pgn: string } | { type: 'NATIVE_REVIEW_NAVIGATE'; direction: 'previous' | 'next' | 'first' | 'last' | 'select'; ply?: number };
export const publicTypes = new Set(['REVIEW_RUN_CONTROL','GET_REVIEW_PREFERENCES','SET_REVIEW_PREFERENCES','DISMISS_LEVEL_SUGGESTION','GET_REVIEW_STATE','GET_LEARNING_HISTORY','DELETE_LEARNING_HISTORY','REVIEW_CONTROL','REVIEW_VIEW','REVIEW_PRACTICE_RECORD','TEST_AI','GET_SETTINGS', 'SAVE_SETTINGS', 'ANALYSIS_REQUEST', 'REVIEW_ANALYZE', 'POSITION_REQUEST', 'GET_OVERLAY_PREFERENCES', 'SET_OVERLAY_PREFERENCES', 'SITE_THEME', 'GET_SITE_THEME', 'CAPTURE_GAME', 'START_PAGE_REVIEW', 'IMPORT_PAGE_REVIEW', 'REVIEW_AVAILABILITY', 'OPEN_REVIEW', 'NATIVE_REVIEW_REQUEST', 'NATIVE_REVIEW_NAVIGATE', 'CANCEL', 'REOPEN', 'SETTINGS_CHANGED']);
export function isBackgroundRequest(v: unknown): v is BackgroundRequest {
    if (!record(v) || !(typeof v.type === 'string' && publicTypes.has(v.type))) return false;
    switch (v.type) {
        case 'CANCEL': return v.requestId === undefined || text(v.requestId);
        case 'REVIEW_RUN_CONTROL': return text(v.sessionId) && member(v.action,['pause','resume','stop','hide','show']);
        case 'GET_REVIEW_PREFERENCES': return true;
        case 'SET_REVIEW_PREFERENCES': return validPreferences(v.preferences);
        case 'DISMISS_LEVEL_SUGGESTION': return integer(v.after,100000);
        case 'GET_REVIEW_STATE': case 'GET_LEARNING_HISTORY': return true;
        case 'DELETE_LEARNING_HISTORY': return v.key === undefined || text(v.key,120);
        case 'REVIEW_CONTROL': return text(v.sessionId) && isReviewControl(v);
        case 'REVIEW_VIEW': return text(v.sessionId) && integer(v.ply) && typeof v.running === 'boolean' && (v.active === undefined || typeof v.active === 'boolean') && (v.practicePly === undefined || integer(v.practicePly) && v.practicePly > 0);
        case 'REVIEW_PRACTICE_RECORD': return text(v.sessionId) && integer(v.ply) && v.ply > 0 && member(v.outcome,['solved','hinted','revealed','skipped','missed']);
        case 'ANALYSIS_REQUEST': return text(v.requestId) && isFen(v.fen) && member(v.orientation, ['white', 'black']) && (v.manual === undefined || typeof (v as RecordValue).manual === 'boolean');
        case 'REVIEW_ANALYZE': return text(v.sessionId) && text(v.requestId) && isFen(v.initialFen) && array(v.moves, 1500, isUci) && integer(v.ply, v.moves.length) && (v.ai === undefined || typeof v.ai === 'boolean') && (v.background === undefined || typeof v.background === 'boolean') && (v.level === undefined || member(v.level,['beginner','intermediate','advanced'])) && (v.profile === undefined || member(v.profile,Object.keys(SEARCH_PROFILES))) && (v.attempt === undefined || isUci(v.attempt) && (v.ply as number)>0 && !v.background && v.ai === false);
        case 'SAVE_SETTINGS': return isSettings(v.settings) && (v.credentials === undefined || record(v.credentials) && Object.entries(v.credentials).every(([p,k]) => member(p, ['gemini','openai','groq']) && (k === null || text(k, 2048))));
        case 'SET_OVERLAY_PREFERENCES': return typeof v.heatmap === 'boolean' && typeof v.arrows === 'boolean';
        case 'SITE_THEME': return isSiteTheme(v.theme);
        case 'IMPORT_PAGE_REVIEW': return text(v.pgn, 262144);
        case 'NATIVE_REVIEW_NAVIGATE': return v.direction === 'select' ? integer(v.ply) : member(v.direction, ['previous', 'next', 'first', 'last']);
        default: return true;
    }
}
export type OffscreenCommand = {target:'offscreen';type:'REVIEW_CANCEL';requestId:string} | EngineJob | ReviewJob | {target:'offscreen';type:'EXPLANATION_TEST';settings:import('./types').ExecutionSettings} | { target: 'offscreen'; type: 'ENGINE_CANCEL' | 'EXPLANATION_RESET' };
export function isOffscreenCommand(v: unknown): v is OffscreenCommand {
    if (!record(v) || v.target !== 'offscreen') return false;
    if (v.type === 'REVIEW_CANCEL') return text(v.requestId);
    if (v.type === 'ENGINE_CANCEL' || v.type === 'EXPLANATION_RESET') return true;
    if (!record(v.settings) || !isSettings(Object.fromEntries(Object.entries(v.settings).filter(([k]) => k !== 'keys'))) || !record(v.settings.keys) || !Object.entries(v.settings.keys).every(([p,k]) => member(p, ['gemini','openai','groq']) && text(k,2048))) return false;
    if (v.type === 'EXPLANATION_TEST') return true;
    if (!Number.isInteger(v.tabId) || (v.manual !== undefined && typeof v.manual !== 'boolean') || (v.nativeEvaluation !== undefined && !isEvaluation(v.nativeEvaluation))) return false;
    return v.type === 'ENGINE_START' ? text(v.requestId) && isFen(v.fen) && typeof v.manual === 'boolean' && (v.level === undefined || member(v.level,['beginner','intermediate','advanced'])) : v.type === 'REVIEW_START' && isBackgroundRequest(v.request) && v.request.type === 'REVIEW_ANALYZE';
}
export function isBackgroundSender(sender: chrome.runtime.MessageSender): boolean {
    try {
        return !!chrome.runtime.id && sender.id === chrome.runtime.id && !sender.tab && (sender.url === chrome.runtime.getURL('background.js') || sender.url === chrome.runtime.getURL(''));
    } catch { return false; } // A content script can outlive its extension context.
}
export function contextFor(sender: chrome.runtime.MessageSender): 'panel' | 'offscreen' | 'content' | undefined {
    if (sender.id !== chrome.runtime.id) return;
    if (sender.url === chrome.runtime.getURL('sidepanel.html')) return 'panel';
    if (sender.url === chrome.runtime.getURL('offscreen.html') && !sender.tab) return 'offscreen';
    if (sender.tab?.id !== undefined && sender.frameId === 0 && typeof sender.url === 'string' && /^https:\/\/(www\.chess\.com|lichess\.org)\//.test(sender.url)) return 'content';
}
const panelOnly = new Set(['GET_REVIEW_PREFERENCES','SET_REVIEW_PREFERENCES','DISMISS_LEVEL_SUGGESTION','GET_LEARNING_HISTORY','DELETE_LEARNING_HISTORY','REVIEW_CONTROL','TEST_AI','GET_SETTINGS','SAVE_SETTINGS','GET_SITE_THEME','CAPTURE_GAME','START_PAGE_REVIEW','IMPORT_PAGE_REVIEW','REOPEN','SETTINGS_CHANGED']);
export function canSendRequest(v: BackgroundRequest, context: 'panel' | 'content'): boolean {
    return v.type === 'REVIEW_CONTROL' && v.action === 'preferences' ? true : panelOnly.has(v.type) ? context === 'panel' : member(v.type, ['GET_REVIEW_STATE','ANALYSIS_REQUEST','CANCEL','GET_OVERLAY_PREFERENCES','SET_OVERLAY_PREFERENCES']) || context === 'content';
}
export interface RuntimeResponse { error?: string; ok?: boolean; title?: string; theme?: unknown; tabId?: number; url?: string; test?: AiTestResult; preferences?: ReviewPreferences; suggestionAfter?: number; state?: ReviewState; history?: import('./review-library').LibraryEntry[] }
export function sendBackground(message: { type: 'GET_SETTINGS' } | ({ type: 'SAVE_SETTINGS' } & SettingsUpdate)): Promise<PanelSettings & RuntimeResponse>;
export function sendBackground(message: BackgroundRequest): Promise<RuntimeResponse>;
export function sendBackground(message: BackgroundRequest): Promise<RuntimeResponse | PanelSettings> { return chrome.runtime.sendMessage(message); }
export function loadSettings(): Promise<PanelSettings> { return sendBackground({ type: 'GET_SETTINGS' }); }
export type ContentMessage = {type:'REVIEW_STATE_CHANGED';sessionId:string} | AnalysisEvent | ReviewEvent | { type: 'REOPEN' | 'REFRESH' } | { type: 'REVIEW_LOADED'; session: ReviewSession } | ({type:'REVIEW_CONTROL';sessionId:string} & ReviewControl);
export function isContentMessage(v: unknown): v is ContentMessage {
    return isAnalysisEvent(v) || record(v) && (v.type === 'REVIEW_STATE_CHANGED' && text(v.sessionId) || v.type === 'REVIEW_CONTROL' && text(v.sessionId) && isReviewControl(v) || v.type === 'REOPEN' || v.type === 'REFRESH' || v.type === 'REVIEW_LOADED' && isReviewSession(v.session));
}
export function isPanelMessage(v: unknown): v is {type:'REVIEW_STATE_CHANGED';sessionId:string;tabId:number} | (AnalysisEvent | ReviewEvent) & { manual: boolean } | PanelThemeMessage {
    return record(v) && (v.type === 'REVIEW_STATE_CHANGED' && text(v.sessionId) && Number.isInteger(v.tabId) || v.type === 'SITE_THEME' && Number.isInteger(v.tabId) && boundedText(v.url, 2048) && (v.theme === undefined || isSiteTheme(v.theme)) || isAnalysisEvent(v) && typeof (v as RecordValue).manual === 'boolean');
}
