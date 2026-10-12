export interface MoveAnalysisRequest{
    type: 'ANALYSIS_REQUEST';
    fen: string;
    orientation: 'white' | 'black'
}

export interface EngineEvaluation {
    bestMove: string;
    pvLines: string[];
    promisingMoves: string[];
    evaluation: string;
}

export interface AnalysisStreamChunk {
    type: "STREAM_CHUNK";
    textDelta: string;
    isComplete: boolean;
}