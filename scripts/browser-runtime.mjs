import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Command-line extension loading requires testing Chromium in current Chrome releases. */
export function browserExecutable() {
    if (process.env.CHROME_PATH) {
        if (!existsSync(process.env.CHROME_PATH)) throw new Error('CHROME_PATH does not point to a browser executable.');
        return process.env.CHROME_PATH;
    }
    const base=process.env.LOCALAPPDATA;
    if(base){
        const root=join(base,'ms-playwright');
        if(existsSync(root))for(const name of readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))) {
            for(const directory of ['chrome-win64','chrome-win']){const path=join(root,name,directory,'chrome.exe');if(existsSync(path))return path;}
        }
    }
    return process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'chromium';
}
