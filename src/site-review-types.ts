export interface NativeReviewSnapshot {
    url: string;
    gameId?: string;
    fen?: string;
    placement?: string;
    ply?: number;
    path?: string;
    initialFen?: string;
    moves?: string[];
    completed?: boolean;
    allowed: boolean;
    orientation: 'white' | 'black';
    canNavigate?: boolean;
}
