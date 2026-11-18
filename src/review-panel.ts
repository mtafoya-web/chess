import { sendBackground, type ReviewControl } from './messages';
import { summarizeReview, reviewFingerprint, type ReviewState } from './review-model';
import { DEFAULT_REVIEW_PREFERENCES, winPercent, type ReviewPreferences } from './review-scoring';
import type { LibraryEntry } from './review-library';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n; };
export class ReviewPanel {
    private current?: ReviewState;
    private preferences: ReviewPreferences = {...DEFAULT_REVIEW_PREFERENCES};
    private signature='';
    private refreshing=false;
    private introductionDismissed=false;
    private switchingGame=false;
    private section='review';
    private timer?: ReturnType<typeof setTimeout>;
    constructor() {
        document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>button.addEventListener('click',()=>this.open(button.dataset.tab!)));
        el('dismiss-intro').addEventListener('click',()=>{this.introductionDismissed=true;document.querySelector<HTMLElement>('.first-use')!.hidden=true;});
        el<HTMLInputElement>('glossary-search').addEventListener('input',()=>{
            const query=el<HTMLInputElement>('glossary-search').value.trim().toLocaleLowerCase();let count=0;
            document.querySelectorAll<HTMLElement>('#glossary dt').forEach(term=>{const definition=term.nextElementSibling as HTMLElement;const hidden=!(term.textContent+' '+definition.textContent).toLocaleLowerCase().includes(query);term.hidden=hidden;definition.hidden=hidden;if(!hidden)count++;});
            el('glossary-status').textContent=count?`${count} ${count===1?'term':'terms'} found.`:'No matching terms.';
        });
        el<HTMLSelectElement>('learning-level').addEventListener('change',()=>{
            this.preferences={...this.preferences,level:el<HTMLSelectElement>('learning-level').value as ReviewPreferences['level']};
            void sendBackground({type:'SET_REVIEW_PREFERENCES',preferences:this.preferences}).then(r=>{if(r.error)el('review-status').textContent=r.error;}).catch(()=>{el('review-status').textContent='Your learning level could not be saved. Try again.';});
        });
        el('clear-history').addEventListener('click',async()=>{
            const button=el<HTMLButtonElement>('clear-history');
            if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Confirm: clear saved reviews and lessons';return;}
            const response=await sendBackground({type:'DELETE_LEARNING_HISTORY'}).catch(()=>({error:'History could not be cleared. Try again.'}));
            button.dataset.confirm='';button.textContent='Clear learning history';el('history-status').textContent=response.error??'Learning history cleared.';await this.history();
        });
        el('copy-diagnostics').addEventListener('click',async()=>{
            const manifest=chrome.runtime.getManifest?.();
            const text=JSON.stringify({app:'Kibitz',version:manifest?.version??'development',scoringVersion:2,browser:navigator.userAgent,online:navigator.onLine},null,2);
            try{await navigator.clipboard.writeText(text);el('support-status').textContent='Support diagnostics copied. No keys, game moves, or player names included.';}catch{el('support-status').textContent=text;}
        });
        void sendBackground({type:'GET_REVIEW_PREFERENCES'}).then(r=>{if(r.preferences){this.preferences=r.preferences;el<HTMLSelectElement>('learning-level').value=r.preferences.level;}}).catch(()=>{});
        this.poll();
        void this.refresh();
        document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void this.refresh();});
    }
    open(section: string) {
        if(!['review','lessons','settings'].includes(section))return;
        this.section=section;
        for(const key of ['review','lessons','settings'])el(`${key}-page`).hidden=key!==section;
        document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>{if(button.dataset.tab===section)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
        if(section==='lessons')void this.history();else if(section==='review')void this.refresh();
    }
    changed(){if(this.section==='review')void this.refresh();}
    private poll(){this.timer=setTimeout(async()=>{if(this.section==='review')await this.refresh();this.poll();},2000);}
    destroy(){clearTimeout(this.timer);}
    private async refresh(){
        if(this.refreshing)return;this.refreshing=true;
        try{
            const response=await sendBackground({type:'GET_REVIEW_STATE'});
            if(response.error) return;
            const state=response.state;
            const signature=state?JSON.stringify([state.session.id,state.updatedAt,state.session.selectedPly,state.running,state.preferences,state.practicePly,state.active]):'none';
            if(signature===this.signature || state?.session.id === this.current?.session.id && !state?.practicePly && !this.current?.practicePly && el('review-overview').contains(document.activeElement))return;
            if(state?.session.id!==this.current?.session.id)this.switchingGame=false;
            this.signature=signature;this.current=state;
            el('review-overview').replaceChildren();
            document.querySelector<HTMLElement>('.start')!.hidden=!!state&&!this.switchingGame;
            const firstUse=document.querySelector<HTMLElement>('.first-use');if(firstUse)firstUse.hidden=!!state||this.introductionDismissed;
            if(!state)return;
            this.preferences=state.preferences;el<HTMLSelectElement>('learning-level').value=state.preferences.level;
            this.renderOverview(state);
        }catch{el('review-status').textContent='Review controls are reconnecting. The board card remains available.';}finally{this.refreshing=false;}
    }
    private async command(command: ReviewControl){
        if(!this.current)return;
        if (this.current.active===false) {
            const response=await sendBackground({type:'START_PAGE_REVIEW'}).catch(()=>({error:'Open the reviewed game first.'}));
            if(response.error)el('review-status').textContent=response.error;else await this.refresh();
            return;
        }
        const response=await sendBackground({type:'REVIEW_CONTROL',sessionId:this.current.session.id,...command}).catch(()=>({error:'Open the reviewed game to use this control.'}));
        if(response.error)el('review-status').textContent=response.error;
    }
    private button(text: string, action:()=>void, primary=false){const button=node('button',text);button.type='button';button.className=primary?'':'secondary';button.addEventListener('click',action);return button;}
    private renderOverview(state: ReviewState){
        const root=el('review-overview');
        if(state.practicePly){root.append(node('h2','Practice in progress'),node('p','Answers and evaluations are hidden. Use the board card to enter your move, request a hint, or return to the game.'));return;}
        const summary=summarizeReview(state);
        const opening=state.assessments.filter(a=>a.opening?.current).sort((a,b)=>b.ply-a.ply)[0]?.opening?.current;
        if(opening)root.append(node('p',`${opening.name} (${opening.eco})`));
        root.append(node('h2',state.session.title),node('p',`${state.session.result} · ${summary.analyzed} of ${summary.total} positions reviewed${state.running?' · analyzing':summary.complete?' · complete':' · paused'}`));
        const actions=node('div');actions.className='actions';
        actions.append(this.button(state.active===false?'Resume review':'Start guided review',()=>void this.command({action:'next'}),true),this.button(state.running?'Pause analysis':summary.complete?'Recheck selected move':'Analyze whole game',()=>void this.command({action:summary.complete?'deeper':'sweep'})));root.append(actions);
        const scores=node('div');scores.className='review-scores';
        for(const side of ['w','b']as const){const value=summary.accuracy[side];const block=node('div');block.append(node('strong',side==='w'?'White':'Black'),node('span',value===undefined?'—':value.toFixed(1)+'%'));scores.append(block);}root.append(scores,node('p',`Kibitz accuracy${summary.provisional?' · provisional':''}. ${summary.complete?'Engine estimates; not player ratings.':'Complete the analysis to calculate game accuracy.'}`));
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 120');svg.setAttribute('aria-hidden','true');svg.classList.add('review-graph');
        const mid=document.createElementNS(svg.namespaceURI,'path');mid.setAttribute('d','M0 60H400');mid.setAttribute('class','graph-mid');svg.append(mid);
        let path='',previous=-2;
        for(const point of summary.points){path+=`${point.ply===previous+1?'L':'M'}${(point.ply/Math.max(1,summary.total)*400).toFixed(2)},${(110-winPercent(point.cp)).toFixed(2)} `;previous=point.ply;}
        const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',path);line.setAttribute('class','graph-line');svg.append(line);
        const cursor=document.createElementNS(svg.namespaceURI,'path');const x=state.session.selectedPly/Math.max(1,summary.total)*400;cursor.setAttribute('d',`M${x} 0V120`);cursor.setAttribute('class','graph-cursor');svg.append(cursor);
        svg.addEventListener('click',event=>{const rect=svg.getBoundingClientRect();if(rect.width)void this.command({action:'select',ply:Math.max(0,Math.min(summary.total,Math.round((event.clientX-rect.left)/rect.width*summary.total)))});});
        root.append(node('p','Evaluation history · upper half favors White'),svg);
        const label=node('label','Select a position (same positions as the graph)');const select=node('select');select.append(new Option('Starting position','0'));
        for(const move of state.session.moves){const assessment=state.assessments.find(a=>a.ply===move.ply);select.append(new Option(`${move.beforeFen.split(' ')[5]}${move.color==='w'?'.':'...'} ${move.san}${assessment?' · '+(assessment.feedback?.label??'Reviewed'):' · not analyzed'}`,String(move.ply)));}
        select.value=String(state.session.selectedPly);select.addEventListener('change',()=>void this.command({action:'select',ply:Number(select.value)}));label.append(select);root.append(label);
        const details=node('details');const header=node('summary','Move assessments by player');details.append(header);const table=node('table');table.innerHTML='<thead><tr><th scope="col">Assessment</th><th scope="col">White</th><th scope="col">Black</th></tr></thead>';const body=node('tbody');
        for(const grade of ['Best','Excellent','Good','Inaccuracy','Mistake','Blunder','Missed mate','Checkmate','Review']){if(!summary.counts.w[grade]&&!summary.counts.b[grade])continue;const row=node('tr');const th=node('th',grade);th.scope='row';row.append(th,node('td',String(summary.counts.w[grade]??0)),node('td',String(summary.counts.b[grade]??0)));body.append(row);}table.append(body);details.append(table);root.append(details);
        root.append(node('h3','Key moments'));const moments=node('ol');moments.className='moment-list';
        for(const ply of summary.moments){const move=state.session.moves[ply-1];const a=state.assessments.find(a=>a.ply===ply);const row=node('li');row.append(this.button(`${move.beforeFen.split(' ')[5]}${move.color==='w'?'.':'...'} ${move.san} · ${a?.feedback?.label}`,()=>void this.command({action:'select',ply})));moments.append(row);}root.append(moments);
        if(!summary.moments.length)root.append(node('p',summary.complete?'No significant confirmed mistakes for this selection. You can still browse every move.':'Key moments appear as analysis finishes.'));
        root.append(node('h3','Takeaways'));
        for(const lesson of summary.lessons){const block=node('section');block.className='lesson-row';block.append(node('h4',lesson.title),node('p',lesson.text),this.button('Review this position',()=>void this.command({action:'select',ply:lesson.ply})));root.append(block);}
        if(!summary.lessons.length)root.append(node('p',summary.complete?'No specific improvement lesson was established in this review.':'Lessons appear when a confirmed assessment supports them.'));
        root.append(this.button('Review another game or import PGN',()=>{
            this.switchingGame=true;document.querySelector<HTMLElement>('.start')!.hidden=false;
            const heading=el('start-heading');heading.tabIndex=-1;heading.focus();
        }));
    }
    private async history(){
        const root=el('lesson-history');
        try{
            const response=await sendBackground({type:'GET_LEARNING_HISTORY'});if(response.error)throw Error(response.error);
            const entries=response.history??[];root.replaceChildren();el('level-suggestion').replaceChildren();
            if(!entries.length){root.append(node('p','Your reviewed games and practice outcomes will appear here. Start with a completed game.'));el<HTMLButtonElement>('clear-history').disabled=true;return;}
            el<HTMLButtonElement>('clear-history').disabled=false;
            const themes=new Map<string,{title:string;games:number}>();
            for(const entry of entries){const summary=summarizeReview(entry);for(const lesson of summary.lessons){const theme=themes.get(lesson.id)??{title:lesson.title,games:0};theme.games++;themes.set(lesson.id,theme);}}
            if(themes.size){root.append(node('h2','Recurring themes'));for(const theme of themes.values())root.append(node('p',`${theme.title}: ${theme.games} of ${entries.length} reviewed games.`));}
            root.append(node('h2','Reviewed games'));
            for(const entry of entries){const summary=summarizeReview(entry),block=node('section');block.className='history-row';block.append(node('h3',entry.session.title),node('p',`${summary.analyzed}/${summary.total} positions · ${new Date(entry.updatedAt).toLocaleDateString()} · ${entry.attempts.filter(a=>a.outcome==='solved').length} independent solutions`));
                for(const lesson of summary.lessons)block.append(node('p',`${lesson.title}: ${lesson.text}`));
                const actions=node('div');actions.className='actions';
                if(entry.session.source?.url&&/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(entry.session.source.url)){const link=node('a','Open game to resume');link.href=entry.session.source.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
                actions.append(this.button('Delete saved review',async()=>{const response=await sendBackground({type:'DELETE_LEARNING_HISTORY',key:entry.key}).catch(()=>({error:'This saved review could not be deleted. Try again.'}));if(response.error)el('history-status').textContent=response.error;else await this.history();},true));block.append(actions);root.append(block);}
            this.suggestion(entries,response.suggestionAfter??0);
        }catch{root.replaceChildren(node('p','Saved history is unavailable. You can continue reviewing on the board.'));}
    }
    private suggestion(entries: LibraryEntry[], after: number){
        const root=el('level-suggestion');root.replaceChildren();const complete=entries.filter(e=>summarizeReview(e).complete).length;if(complete<5||complete<after)return;
        const first=entries.flatMap(e=>{const seen=new Set<number>();return e.attempts.filter(a=>{if(seen.has(a.ply))return false;seen.add(a.ply);return a.outcome==='solved'||a.outcome==='missed';});});
        if(first.length<10)return;const rate=first.filter(a=>a.outcome==='solved').length/first.length;
        const levels=['beginner','intermediate','advanced']as const,index=levels.indexOf(this.preferences.level),suggested=rate>=.8?levels[index+1]:rate<.4?levels[index-1]:undefined;
        if(!suggested)return;root.append(node('p',`Your recent exercises suggest trying ${suggested} explanations. Your level only changes if you choose it.`));
        root.append(this.button(`Use ${suggested}`,async()=>{this.preferences={...this.preferences,level:suggested};await sendBackground({type:'SET_REVIEW_PREFERENCES',preferences:this.preferences});await sendBackground({type:'DISMISS_LEVEL_SUGGESTION',after:complete+5});root.replaceChildren();}),this.button('Keep my level',async()=>{await sendBackground({type:'DISMISS_LEVEL_SUGGESTION',after:complete+5});root.replaceChildren();},true));
    }
}
