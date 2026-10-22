export interface NativeReviewSnapshot {
    url: string;
    gameId?: string;
    fen?: string;
    ply?: number;
    path?: string;
    initialFen?: string;
    moves?: string[];
    allowed: boolean;
    orientation: 'white' | 'black';
    canNavigate?: boolean;
}
