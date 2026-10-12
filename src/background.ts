import { MoveAnalysisRequest } from "./types";

//automatically open side panel if user clicks icon
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});

chrome.runtime.onMessage.addListener(
    (message: MoveAnalysisRequest, _sender, sendRespose) => 
        {
        if(message.type === 'ANALYSIS_REQUEST'){
            console.log('Recieved FEN for analysis:', message.fen);
            //Future -> Foward FEN to Stockfish WASM worker & query ollama API
            sendRespose({status: 'ACK'});
        }
        return true;
    });