// Generate auditable coaching examples from the same analyzer and pinned engine.
// This does not score Chess.com or substitute for an expert/learner comparison.
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {cpus,platform,release} from 'node:os';
const workers=new Set();
class NodeWorker {
    onmessage=null;onerror=null;
    constructor(){
        this.process=spawn(process.execPath,[resolve('node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
        workers.add(this);let buffer='';
        this.process.stdout.on('data',data=>{buffer+=data;const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines)this.onmessage?.({data:line});});
        this.process.on('error',()=>this.onerror?.());this.process.on('exit',()=>{if(workers.has(this))this.onerror?.();});
    }
    postMessage(message){this.process.stdin.write(message+'\n');}
    terminate(){workers.delete(this);this.process.kill();}
}
globalThis.Worker=NodeWorker;globalThis.chrome={runtime:{getURL:s=>s}};
const bundle=await build({stdin:{contents:`export {Engine} from './src/engine';export {ReviewAnalyzer} from './src/review-analysis';export {sessionFromMoves} from './src/review-session';export {coachingText} from './src/review-model';export {DEFAULT_REVIEW_PREFERENCES} from './src/review-scoring';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const cases=JSON.parse(await readFile('tests/fixtures/coaching-benchmark.json','utf8'));
const output=resolve('.bundle/coaching-benchmark');await mkdir(output,{recursive:true});
const reviewer=new api.ReviewAnalyzer(new api.Engine()),examples=[];
try{
 for(const entry of cases){
    const session=api.sessionFromMoves(entry.moves,entry.initialFen),ply=entry.ply??session.moves.length;
    const start=performance.now();let firstFeedbackMs;
    const assessment=await reviewer.analyze({type:'REVIEW_ANALYZE',sessionId:session.id,requestId:entry.id,initialFen:session.initialFen,moves:session.moves.map(m=>m.uci),ply,ai:false},new AbortController().signal,()=>{firstFeedbackMs??=Math.round(performance.now()-start);});
    const milliseconds=Math.round(performance.now()-start);firstFeedbackMs??=milliseconds;const text={};
    for(const level of ['beginner','intermediate','advanced'])text[level]=api.coachingText(session.moves[ply-1],{ply,...assessment},{...api.DEFAULT_REVIEW_PREFERENCES,level},session);
    examples.push({...entry,milliseconds,firstFeedbackMs,assessment,text,expertReview:null,chessComComparison:null});
    console.log(`${entry.id}: ${assessment.feedback?.label??'Position'}${assessment.feedback?.provisional?' (provisional)':''}, ${milliseconds} ms total, ${firstFeedbackMs} ms first feedback`);
 }
 const report={generatedAt:new Date().toISOString(),engine:'Stockfish 17.1 lite single',scoringVersion:2,host:{platform:platform(),release:release(),cpu:cpus()[0]?.model,node:process.version},comparativeReviewComplete:false,examples};
 await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
 await writeFile(join(output,'review.md'),'# Coaching quality benchmark\n\nGenerated examples; expert and Chess.com comparison are pending.\n\n'+examples.map(e=>`## ${e.id}\n\n${e.focus}\n\nAssessment: ${e.assessment.feedback?.label}; ${e.milliseconds} ms.\n\n`+Object.entries(e.text).map(([level,text])=>`**${level}:** ${text}\n`).join('\n')+'\nExpert scoring (0-2 each): factual correctness __; explanation specificity __; useful lesson __; uncertainty __.\n\nChess.com explanation and learning-transfer result: pending.\n').join('\n'));
 console.log(`Benchmark artifacts: ${output}`);
}finally{for(const worker of workers)worker.terminate();}
